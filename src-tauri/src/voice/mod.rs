//! M8 语音唤醒（KWS）+ 语音问答（流式 ASR，第二阶段）。
//!
//! 技术选型见 memory `luckyisland-m8-voice`：Porcupine 官方 Rust binding 已被
//! yank 弃用，改用 sherpa-onnx（k2-fsa 官方，KWS + 流式 ASR）+ cpal（纯 Rust
//! 音频采集）。默认关闭（`wake:enabled=false`），不影响任何现有功能。
//!
//! 现状：KWS 唤醒检测（模型下载 + 唤醒词编码 + cpal 常驻监听 + 命中后打开 AI 面板）
//! 已实现，`cargo check` 编译通过但**尚未跑真机验证**（真实麦克风 + 真实模型推理）。
//! 流式 ASR 语音问答是独立第二阶段，见 TaskList #9，尚未开始。

mod keyword;
mod tts;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use sherpa_onnx::{KeywordSpotter, KeywordSpotterConfig, OnlineRecognizer, OnlineRecognizerConfig};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

/// KWS 模型下载地址（sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01，实测 32,654,866 字节）。
/// 纯中文唤醒词模型；下载速度实测约 147KB/s（GitHub Releases 签名 URL），32.6MB 耗时约 3~4 分钟，
/// 国内用户可能更慢，前端需展示进度 + 允许重试，不做静默失败。
const KWS_MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2";
const KWS_MODEL_DIR_NAME: &str = "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01";

/// ASR 流式识别模型（双语 zh-en）。⚠️ 未在本环境联网验证（sandbox 封 GitHub 443）：
/// 下载 URL、体积、解压后文件清单都是从 crate doc 示例（online_asr.rs:17-27）和 KWS 同 pattern
/// 推测的。真机首次验证时若 404 或文件名对不上，只需改这个常量块，不动其余结构。
/// 推测文件：encoder-epoch-99-avg-1.int8.onnx / decoder-epoch-99-avg-1.onnx（decoder 不带 int8）
///           / joiner-epoch-99-avg-1.int8.onnx / tokens.txt。体积预估 80-100MB。
const ASR_MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2";
const ASR_MODEL_DIR_NAME: &str = "sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20";

/// ASR 单轮录制窗口超时：唤醒命中后给用户 8s 说话，超时仍未 endpoint 就放弃这条、回 KWS 等下次唤醒。
/// 避免一直开着 ASR 把环境噪音误当输入，也避免用户唤醒了却没说话时录音空转。
const ASR_UTTERANCE_TIMEOUT: Duration = Duration::from_secs(8);

/// 模型种类标识，前端下载/就绪命令传参用。Command 参数化后 KWS 与 ASR 互不依赖可独立下载。
const MODEL_KWS: &str = "kws";
const MODEL_ASR: &str = "asr";

enum ModelKind {
    Kws,
    Asr,
}

impl ModelKind {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            MODEL_KWS => Ok(ModelKind::Kws),
            MODEL_ASR => Ok(ModelKind::Asr),
            other => Err(format!("未知模型类型「{other}」，应为 kws 或 asr")),
        }
    }

    fn url(&self) -> &'static str {
        match self {
            ModelKind::Kws => KWS_MODEL_URL,
            ModelKind::Asr => ASR_MODEL_URL,
        }
    }

    fn dir_name(&self) -> &'static str {
        match self {
            ModelKind::Kws => KWS_MODEL_DIR_NAME,
            ModelKind::Asr => ASR_MODEL_DIR_NAME,
        }
    }
}

/// 语音功能运行时状态：模型是否已下载、监听是否开启。
/// 仿 `AI_LOADING` 模式（见 lib.rs），用 AtomicBool 做跨线程标志位。
pub struct VoiceState {
    /// 监听是否正在跑；Arc 是因为监听线程要持有一份共享引用，靠它判断何时退出循环。
    /// start_listening 里从 false swap 成 true 时才真正 spawn 线程，避免重复启动。
    pub listening: Arc<AtomicBool>,
    /// 模型是否正在下载中（防止重复触发下载）
    pub downloading: AtomicBool,
    /// 监听线程的 JoinHandle，reload 时能 join() 等它真正退出再重启，
    /// 消除 stop→start 的小竞态（旧线程还没释放麦克风、新线程已抢同设备）。
    pub thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            listening: Arc::new(AtomicBool::new(false)),
            downloading: AtomicBool::new(false),
            thread: Mutex::new(None),
        }
    }
}

/// 模型文件存放目录：`<app_data_dir>/voice-models/<model_dir_name>/`
fn model_kind_dir(app: &AppHandle, kind: &ModelKind) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice-models")
        .join(kind.dir_name());
    Ok(base)
}

/// 判断模型是否已下载完整。
/// KWS：tokens.txt/keywords.txt + encoder/decoder/joiner 三件 int8 onnx。
/// ASR：tokens.txt + encoder/joiner（int8）+ decoder（**不带** int8，是 .onnx）。
fn is_model_ready(app: &AppHandle, kind: &ModelKind) -> bool {
    let Ok(dir) = model_kind_dir(app, kind) else {
        return false;
    };
    if !dir.join("tokens.txt").is_file() {
        return false;
    }
    match kind {
        ModelKind::Kws => dir.join("keywords.txt").is_file() && has_onnx_triplet_int8(&dir),
        ModelKind::Asr => has_asr_triplet(&dir),
    }
}

/// KWS 目录下是否有一套完整的 encoder/decoder/joiner int8 onnx（优先 int8，体积小，KWS 场景精度够）
fn has_onnx_triplet_int8(dir: &std::path::Path) -> bool {
    has_prefixed_onnx(dir, "encoder-", ".int8.onnx")
        && has_prefixed_onnx(dir, "decoder-", ".int8.onnx")
        && has_prefixed_onnx(dir, "joiner-", ".int8.onnx")
}

/// ASR 目录：encoder/joiner 用 int8，decoder 是 .onnx（不含 int8，crate doc 示例确认）
fn has_asr_triplet(dir: &std::path::Path) -> bool {
    has_prefixed_onnx(dir, "encoder-", ".int8.onnx")
        && has_prefixed_onnx(dir, "decoder-", ".onnx")
        && has_prefixed_onnx(dir, "joiner-", ".int8.onnx")
}

/// 目录下是否有指定前缀 + 后缀的 onnx 文件
fn has_prefixed_onnx(dir: &std::path::Path, prefix: &str, suffix: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.filter_map(|e| e.ok()).any(|e| {
        let n = e.file_name().to_string_lossy().to_string();
        n.starts_with(prefix) && n.ends_with(suffix)
    })
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    /// done | error 阶段用 message 传状态文案；下载中 message 为空
    stage: String,
    message: String,
}

/// 查询 KWS 模型是否已就绪（前端用于决定显示"下载"还是"已就绪"）
#[tauri::command]
pub fn voice_model_ready(app: AppHandle) -> bool {
    is_model_ready(&app, &ModelKind::Kws)
}

/// 查询 ASR 流式识别模型是否已就绪（唤醒后语音问答必备；与 KWS 独立，可单独下）
#[tauri::command]
pub fn voice_asr_model_ready(app: AppHandle) -> bool {
    is_model_ready(&app, &ModelKind::Asr)
}

/// 下载并解压指定模型（`model` = "kws" 或 "asr"）到 app_data_dir/voice-models/。
/// emit `voice://download-progress` 报进度。已就绪直接返回，下载中重复调用被 `downloading` 标志拒绝。
#[tauri::command]
pub async fn voice_download_model(
    app: AppHandle,
    http: tauri::State<'_, reqwest::Client>,
    state: tauri::State<'_, VoiceState>,
    model: String,
) -> Result<(), String> {
    let kind = ModelKind::parse(&model)?;
    if is_model_ready(&app, &kind) {
        return Ok(());
    }
    if state
        .downloading
        .swap(true, Ordering::SeqCst)
    {
        return Err("已有下载任务在进行".to_string());
    }

    let result = download_and_extract(&app, http.inner(), &kind).await;

    state
        .downloading
        .store(false, Ordering::SeqCst);

    match &result {
        Ok(()) => {
            let _ = app.emit(
                "voice://download-progress",
                DownloadProgress {
                    downloaded: 0,
                    total: 0,
                    stage: "done".to_string(),
                    message: String::new(),
                },
            );
        }
        Err(e) => {
            let _ = app.emit(
                "voice://download-progress",
                DownloadProgress {
                    downloaded: 0,
                    total: 0,
                    stage: "error".to_string(),
                    message: e.clone(),
                },
            );
        }
    }
    result
}

async fn download_and_extract(
    app: &AppHandle,
    http: &reqwest::Client,
    kind: &ModelKind,
) -> Result<(), String> {
    let dir = model_kind_dir(app, kind)?;
    let parent = dir
        .parent()
        .ok_or("模型目录路径异常")?
        .to_path_buf();
    std::fs::create_dir_all(&parent).map_err(|e| format!("创建模型目录失败：{e}"))?;

    let tmp_path = parent.join("voice-model.tar.bz2.tmp");
    let resp = http
        .get(kind.url())
        .send()
        .await
        .map_err(|e| format!("下载请求失败：{e}（检查网络）"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败：HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);

    let mut file = std::fs::File::create(&tmp_path).map_err(|e| format!("创建临时文件失败：{e}"))?;
    let mut downloaded: u64 = 0;
    let mut resp = resp;
    // 逐块写盘 + emit 进度，避免大文件整体读进内存；下载慢（KWS 实测约 147KB/s，ASR 更大更久）
    // 必须让前端看到进度，不能一次性 await 到底让用户以为卡死。
    use std::io::Write;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("下载中断：{e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("写入失败：{e}"))?;
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "voice://download-progress",
            DownloadProgress {
                downloaded,
                total,
                stage: "downloading".to_string(),
                message: String::new(),
            },
        );
    }
    drop(file);

    // 解压：bzip2 纯 Rust 后端（libbz2-rs-sys，无需系统 C 库）+ tar
    let _ = app.emit(
        "voice://download-progress",
        DownloadProgress {
            downloaded,
            total,
            stage: "extracting".to_string(),
            message: String::new(),
        },
    );
    extract_tar_bz2(&tmp_path, &parent)?;
    let _ = std::fs::remove_file(&tmp_path);

    if !is_model_ready(app, kind) {
        return Err("解压完成但模型文件不完整，请重试".to_string());
    }
    Ok(())
}

fn extract_tar_bz2(archive: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("打开归档失败：{e}"))?;
    let decoder = bzip2::read::BzDecoder::new(file);
    let mut ar = tar::Archive::new(decoder);
    ar.unpack(dest)
        .map_err(|e| format!("解压失败：{e}"))?;
    Ok(())
}

/// 启动常驻监听：spawn 一个独立 OS 线程（非 tokio，因为 cpal::Stream 要在创建它的线程里
/// 一直存活才能持续采集，且该线程要同步跑 KWS 检测循环）。已在监听中则直接返回。
#[tauri::command]
pub fn voice_start_listening(app: AppHandle, state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    if !is_model_ready(&app, &ModelKind::Kws) {
        return Err("唤醒模型尚未下载，请先在设置里下载语音唤醒模型".to_string());
    }
    let keyword_setting = read_keyword(&app);

    // 已在监听：false -> true 才继续；已经是 true 说明线程已经跑着，直接返回不重复 spawn
    if state
        .listening
        .swap(true, Ordering::SeqCst)
    {
        return Ok(());
    }

    spawn_listen_thread(&app, state.inner(), &keyword_setting)?;
    Ok(())
}

/// 共用的监听线程 spawn 逻辑（start_listening 与 reload_keyword 共用）。
/// 调用方须已把 listening 置 true 占住（防重复 spawn），本函数不再 swap。
fn spawn_listen_thread(
    app: &AppHandle,
    state: &VoiceState,
    keyword_setting: &str,
) -> Result<(), String> {
    let dir = model_kind_dir(app, &ModelKind::Kws)?;
    let tokens_content = std::fs::read_to_string(dir.join("tokens.txt"))
        .map_err(|e| format!("读取 tokens.txt 失败：{e}"))?;
    let table = keyword::TokenTable::load(&tokens_content);
    let encoded = keyword::encode_keyword(keyword_setting, &table).map_err(|e| {
        state.listening.store(false, Ordering::SeqCst);
        format!("唤醒词「{keyword_setting}」编码失败：{e}")
    })?;

    let listening_flag = state.listening.clone();
    let app_for_thread = app.clone();
    let handle = std::thread::spawn(move || {
        // 监听线程的 COM 初始化：SAPI5 TTS（唤醒应答）和 sherpa-onnx 的底层 COM 调用
        // 都需要线程已 CoInitialize。MTA（多线程套间）足够，cpal 纯 Rust 不碰 COM 不冲突。
        // CoInitializeEx 返回 S_FALSE（已初始化）也算成功，忽略返回值即可。
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if let Err(e) = run_listen_loop(app_for_thread.clone(), &dir, &encoded, listening_flag.clone()) {
            let _ = app_for_thread.emit("voice://listen-error", e);
        }
        listening_flag.store(false, Ordering::SeqCst);
        unsafe { CoUninitialize() };
    });
    *state.thread.lock().unwrap() = Some(handle);
    Ok(())
}

/// 改唤醒词后热重载：等旧监听线程真正退出（join）→ 用新词重新 start_listening。
/// 消除 stop→start 小竞态（旧线程还占着麦克风、新线程抢同设备报错），并让用户
/// 改词后不用手动关再开——校验过的新词直接重载即生效。未在监听则什么都不做
/// （新词已写库，下次开启监听时自然读到）。
#[tauri::command]
pub fn voice_reload_keyword(app: AppHandle, state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    if state.listening.load(Ordering::SeqCst) {
        // 在监听中：先让旧线程退出并 join 等它真正释放麦克风，再用新词重启
        state.listening.store(false, Ordering::SeqCst);
        if let Some(handle) = state.thread.lock().unwrap().take() {
            let _ = handle.join();
        }
        // join 后线程已把 listening 置 false；重新占住并 spawn（读库里的新词）
        state.listening.store(true, Ordering::SeqCst);
        if let Err(e) = spawn_listen_thread(&app, state.inner(), &read_keyword(&app)) {
            state.listening.store(false, Ordering::SeqCst);
            return Err(e);
        }
    }
    Ok(())
}

/// 读 wake:keyword 设置，空则回退默认「小岛小岛」。
fn read_keyword(app: &AppHandle) -> String {
    app.state::<crate::storage::Db>()
        .setting_get("wake:keyword")
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "小岛小岛".to_string())
}

/// 读 wake:reply 设置（唤醒应答语音文案），空则回退默认「主人我在」。
fn read_wake_reply(app: &AppHandle) -> String {
    app.state::<crate::storage::Db>()
        .setting_get("wake:reply")
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "主人我在".to_string())
}

/// 唤醒应答：起一次性线程同步播报 wake:reply 文案。独立线程自带 CoInitializeEx/CoUninitialize，
/// 不阻塞监听循环；且 TTS 在监听线程外播放，避免 TTS 声回灌麦克风被 ASR 当成用户输入自我对话。
fn speak_wake_reply(app: &AppHandle) {
    let reply = read_wake_reply(app);
    std::thread::spawn(move || {
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let _ = tts::speak(&reply);
        unsafe { CoUninitialize() };
    });
}

/// 停止常驻监听：切标志位 + join 等监听线程真正释放麦克风退出。
/// （reload_keyword 内部也用同样的 stop 逻辑；Exit 清理时不 join——进程马上退出 OS 会回收句柄。）
#[tauri::command]
pub fn voice_stop_listening(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    state
        .listening
        .store(false, Ordering::SeqCst);
    if let Some(handle) = state.thread.lock().unwrap().take() {
        let _ = handle.join();
    }
    Ok(())
}

/// 监听线程主体：建 KeywordSpotter + cpal 输入流，PCM 经 mpsc 通道送进检测循环，
/// 命中唤醒词后 emit `voice://wake` + 打开 AI 面板；若 ASR 模型已就绪，接着切进单轮录制
/// （把用户问的话实时转写，endpoint 命中后 emit `voice://transcript`），完事再回 KWS 等下一次唤醒。
fn run_listen_loop(
    app: AppHandle,
    model_dir: &std::path::Path,
    encoded_keyword: &str,
    listening: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut config = KeywordSpotterConfig::default();
    config.model_config.transducer.encoder = Some(onnx_path_with_suffix(model_dir, "encoder-", ".int8.onnx")?);
    config.model_config.transducer.decoder = Some(onnx_path_with_suffix(model_dir, "decoder-", ".int8.onnx")?);
    config.model_config.transducer.joiner = Some(onnx_path_with_suffix(model_dir, "joiner-", ".int8.onnx")?);
    config.model_config.tokens = Some(
        model_dir
            .join("tokens.txt")
            .to_string_lossy()
            .to_string(),
    );
    config.model_config.provider = Some("cpu".to_string());
    // 不用 keywords_file（模型自带的默认唤醒词），用运行时编码的用户自定义唤醒词
    config.keywords_buf = Some(encoded_keyword.to_string());

    let spotter = KeywordSpotter::create(&config).ok_or("创建 KeywordSpotter 失败（模型文件可能损坏，尝试重新下载）")?;
    let stream = spotter.create_stream();

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("未找到麦克风设备")?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("读取麦克风配置失败：{e}"))?;
    let sample_format = supported.sample_format();
    let stream_config = supported.config();
    let channels = stream_config.channels as usize;
    // cpal 0.18 的 SampleRate 是裸 u32 类型别名（不是旧版本的元组结构体，没有 .0 字段）
    let sample_rate = stream_config.sample_rate as i32;

    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let err_fn = |e| eprintln!("[voice] 音频流错误：{e:?}");

    // 三种设备采样格式统一转换成单声道 f32（多声道取平均），做法照抄 sherpa-onnx 官方
    // rust-api-examples/streaming_zipformer_microphone.rs 的转换逻辑。
    // build_input_stream 要 StreamConfig 值（非引用），三个分支各 clone 一份（stream_config
    // 后面 onnx_path 等不再用到，但仍需 clone 因为 match 只会走一个分支，其它分支代码仍会被
    // 类型检查器检查参数类型，clone 避免每分支消费同一个变量报 move 冲突）。
    let cpal_stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let mono: Vec<f32> = to_mono_f32(data, channels, |s| s);
                let _ = tx.send(mono);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let mono: Vec<f32> = to_mono_f32(data, channels, |s| s as f32 / i16::MAX as f32);
                let _ = tx.send(mono);
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                let mono: Vec<f32> =
                    to_mono_f32(data, channels, |s| (s as f32 - 32768.0) / 32768.0);
                let _ = tx.send(mono);
            },
            err_fn,
            None,
        ),
        other => return Err(format!("不支持的麦克风采样格式：{other:?}")),
    }
    .map_err(|e| format!("创建音频输入流失败：{e}"))?;

    cpal_stream
        .play()
        .map_err(|e| format!("启动麦克风采集失败：{e}"))?;

    // cpal 设备采样率确定后、循环开始前懒建 ASR recognizer（若 ASR 模型已就绪）。
    // 命中唤醒词后切进单轮录制，endpoint 命中即 emit voice://transcript。
    // 重载 ASR 模型慢（几十~百 ms），建一次循环里反复用，不在唤醒时再建。
    let asr = build_asr_if_ready(&app, sample_rate)?;

    // KWS 同样需要重采样：feat_config.sample_rate 默认 16000，cpal 设备多是 48000/44100，
    // 直传设备采样率会让模型按 3x 速度吃音频→音素全错→唤醒不了（M8 真机实测唤醒失败根因）。
    // sherpa-onnx 不在 accept_waveform 内部自动重采样（resampler.rs 是独立 API），所以自己建。
    let kws_resampler = sherpa_onnx::LinearResampler::create(sample_rate, 16000)
        .ok_or("创建 KWS LinearResampler 失败")?;

    // 检测循环：轮询 listening 标志位决定何时退出；用 recv_timeout 而非阻塞 recv，
    // 保证即使一段时间没音频数据也能定期检查退出信号，不会卡死。
    while listening.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(samples) => {
                // 重采样到 16k 再喂 KWS；flush=false（流式持续，非最后一块）
                let resampled = kws_resampler.resample(&samples, false);
                stream.accept_waveform(16000, &resampled);
                while spotter.is_ready(&stream) {
                    spotter.decode(&stream);
                    if let Some(result) = spotter.get_result(&stream) {
                        if !result.keyword.is_empty() {
                            // 先语音应答「主人我在」（独立线程，不阻塞监听），再 emit + 弹面板。
                            // 顺序：应答声和面板几乎同时出现，用户听到应答就知道在听了。
                            speak_wake_reply(&app);
                            let _ = app.emit("voice://wake", &result.keyword);
                            let _ = open_ai_palette_from_voice(&app);
                            spotter.reset(&stream);
                            // 切进 ASR 单轮录制：把用户问的话转写后 emit voice://transcript。
                            // ASR 未就绪时跳过（唤醒照常能弹面板，用户手动打字）。
                            // 命中唤醒到 ASR 录制期间继续排空音频通道，但此线程同步等 endpoint，
                            // 麦克风仍在采集、PCM 在 channel 里缓冲——record_single_utterance 会
                            // 先排空积压再开始喂 ASR，避免唤醒词自身尾音被当成问题录进去。
                            if let Some(asr) = &asr {
                                if !listening.load(Ordering::SeqCst) {
                                    break;
                                }
                                if let Err(e) = record_single_utterance(
                                    &app,
                                    asr,
                                    &rx,
                                    listening.clone(),
                                ) {
                                    let _ = app.emit("voice://listen-error", e);
                                }
                            }
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    drop(cpal_stream); // 显式停止音频采集（Drop 触发底层流关闭）
    Ok(())
}

/// ASR 预建的 recognizer + 重采样器（resampler 复用：设 16k 已绑，loop 里 reset 复原状态）
struct AsrRecognizer {
    recognizer: OnlineRecognizer,
    resampler: sherpa_onnx::LinearResampler,
}

/// ASR 模型已就绪时建 recognizer；未就绪返回 None（唤醒照常弹面板，用户手动打字）。
/// device_sample_rate 是 cpal 设备实际采样率，resampler 16k 由这路重采样得到。
fn build_asr_if_ready(app: &AppHandle, device_sample_rate: i32) -> Result<Option<AsrRecognizer>, String> {
    if !is_model_ready(app, &ModelKind::Asr) {
        return Ok(None);
    }
    let dir = model_kind_dir(app, &ModelKind::Asr)?;
    let mut config = OnlineRecognizerConfig::default();
    config.model_config.transducer.encoder = Some(onnx_path_with_suffix(&dir, "encoder-", ".int8.onnx")?);
    config.model_config.transducer.decoder = Some(onnx_path_with_suffix(&dir, "decoder-", ".onnx")?);
    config.model_config.transducer.joiner = Some(onnx_path_with_suffix(&dir, "joiner-", ".int8.onnx")?);
    config.model_config.tokens = Some(dir.join("tokens.txt").to_string_lossy().to_string());
    config.model_config.provider = Some("cpu".to_string());
    config.decoding_method = Some("greedy_search".to_string());
    // 启用端点检测（内置 VAD）：rule1 短静音即结束（约 0.8s 停顿当作说完）。
    config.enable_endpoint = true;
    config.rule1_min_trailing_silence = 0.8;
    config.rule2_min_trailing_silence = 1.0;
    config.rule3_min_utterance_length = 0.0;

    let recognizer = OnlineRecognizer::create(&config)
        .ok_or("创建 OnlineRecognizer 失败（ASR 模型可能损坏，尝试重新下载）")?;
    let resampler = sherpa_onnx::LinearResampler::create(device_sample_rate, 16000)
        .ok_or("创建 LinearResampler 失败")?;
    Ok(Some(AsrRecognizer {
        recognizer,
        resampler,
    }))
}

/// 唤醒词命中后：排空缓冲 PCM（避免唤醒词尾音入 ASR），新建 ASR stream 喂重采样 PCM，
/// endpoint 命中或 ASR_UTTERANCE_TIMEOUT 超时即结束。endpoint 命中且转写非空 → emit transcript。
/// 超时/空文本静默回 KWS（不打扰用户）。
fn record_single_utterance(
    app: &AppHandle,
    asr: &AsrRecognizer,
    rx: &mpsc::Receiver<Vec<f32>>,
    listening: Arc<AtomicBool>,
) -> Result<(), String> {
    // 排空唤醒词尾音：非阻塞收掉 channel 里积压的几帧（最多 50 帧，约 0.5~1s 积压上限）
    for _ in 0..50 {
        match rx.try_recv() {
            Ok(_) => {}
            Err(_) => break,
        }
    }

    let stream = asr.recognizer.create_stream();
    let deadline = Instant::now() + ASR_UTTERANCE_TIMEOUT;

    loop {
        if !listening.load(Ordering::SeqCst) {
            // 退出信号：停掉当前 ASR，不再 emit，直接回 KWS 循环（外层会检测 listening 退出）
            break;
        }
        // 超时优先于收样判断，避免 timeout 后还多收一轮
        let now = Instant::now();
        if now >= deadline && !asr.recognizer.is_ready(&stream) {
            break;
        }
        let remain = deadline.saturating_duration_since(now);
        let wait = remain.min(Duration::from_millis(200));
        match rx.recv_timeout(wait) {
            Ok(samples) => {
                // 重采样到 16k 再喂 ASR；flush=false（不是最后一块，流式持续）
                let resampled = asr.resampler.resample(&samples, false);
                stream.accept_waveform(16000, &resampled);
                while asr.recognizer.is_ready(&stream) {
                    asr.recognizer.decode(&stream);
                }
                if asr.recognizer.is_endpoint(&stream) {
                    if let Some(result) = asr.recognizer.get_result(&stream) {
                        let text = result.text.trim().to_string();
                        if !text.is_empty() {
                            let _ = app.emit("voice://transcript", &text);
                        }
                    }
                    asr.recognizer.reset(&stream);
                    asr.resampler.reset();
                    break; // 一句结束，回 KWS 等下次唤醒
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = app.emit("voice://listen-error", "音频通道断开".to_string());
                break;
            }
        }
    }
    Ok(())
}

/// 多声道 PCM 帧降混成单声道 f32；`conv` 把源采样类型换算到 [-1.0, 1.0]。
fn to_mono_f32<T: Copy>(data: &[T], channels: usize, conv: impl Fn(T) -> f32) -> Vec<f32> {
    if data.is_empty() || channels == 0 {
        return Vec::new();
    }    data.chunks(channels)
        .map(|frame| {
            let sum: f32 = frame
                .iter()
                .map(|&s| conv(s))
                .sum();
            sum / channels as f32
        })
        .collect()
}

/// 在模型目录里找指定前缀 + 后缀的 onnx 文件，返回完整路径字符串。
/// KWS：encoder/decoder/joiner 都是 `.int8.onnx`；ASR：encoder/joiner 是 `.int8.onnx`，
/// decoder 是 `.onnx`（不含 int8），所以后缀由调用方传入。
fn onnx_path_with_suffix(
    dir: &std::path::Path,
    prefix: &str,
    suffix: &str,
) -> Result<String, String> {
    std::fs::read_dir(dir)
        .map_err(|e| format!("读取模型目录失败：{e}"))?
        .filter_map(|e| e.ok())
        .find(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.starts_with(prefix) && name.ends_with(suffix)
        })
        .map(|e| e.path().to_string_lossy().to_string())
        .ok_or_else(|| format!("模型目录缺少 {prefix}*{suffix} 文件"))
}

/// 唤醒后打开 AI 面板：直接复用 ai 模块现成的 open_ai_palette 命令函数体
fn open_ai_palette_from_voice(app: &AppHandle) -> Result<(), String> {
    crate::ai::open_ai_palette(app.clone())
}

// 读取/写入 wake:enabled、wake:keyword 走现有通用 `settings` 表（同 ai:provider 模式），
// 不需要专门的 Tauri 命令——前端直接用 settingGet/settingSetEmit。

/// 校验用户输入的唤醒词是否能被正确编码（纯中文、每个字都有对应拼音 token）。
/// 供设置面板在用户输入唤醒词时实时校验，避免等到真正启动监听才发现编码失败。
/// 模型未下载时直接报错提示先下载。
#[tauri::command]
pub fn voice_validate_keyword(app: AppHandle, phrase: String) -> Result<String, String> {
    if phrase.trim().is_empty() {
        return Err("唤醒词不能为空".to_string());
    }
    let dir = model_kind_dir(&app, &ModelKind::Kws)?;
    let tokens_path = dir.join("tokens.txt");
    let tokens_content = std::fs::read_to_string(&tokens_path)
        .map_err(|_| "唤醒模型尚未下载，请先在设置里下载语音唤醒模型".to_string())?;
    let table = keyword::TokenTable::load(&tokens_content);
    keyword::encode_keyword(phrase.trim(), &table).map_err(|e| e.to_string())
}

/// 按需录一轮语音转写（AI 面板麦克风按钮用）：不依赖常驻监听，开一个独立 cpal 输入流
/// 喂 ASR，endpoint 命中或超时即结束，**返回转写文本**（不 emit 事件，前端 await 拿到后
/// 填进输入框，不自动发送，用户可改可发）。ASR 模型未就绪时报错引导下载。
///
/// 用同步命令 + std::thread 是因为 cpal::Stream 必须在创建它的线程存活期间采集，
/// Tauri 命令线程不能阻塞跑这个循环（会占住 async runtime）。所以 spawn 独立线程跑
/// 录音+转写，主线程等 channel 拿结果返回。
#[tauri::command]
pub fn voice_record_utterance(app: AppHandle) -> Result<String, String> {
    if !is_model_ready(&app, &ModelKind::Asr) {
        return Err("语音问答模型尚未下载，请先在设置里下载语音问答模型".to_string());
    }

    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("未找到麦克风设备")?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("读取麦克风配置失败：{e}"))?;
    let sample_format = supported.sample_format();
    let stream_config = supported.config();
    let channels = stream_config.channels as usize;
    let sample_rate = stream_config.sample_rate as i32;

    let asr = build_asr_if_ready(&app, sample_rate)?
        .ok_or("ASR 模型未就绪")?;

    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let err_fn = |e| eprintln!("[voice] 按需录音流错误：{e:?}");

    let cpal_stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let _ = tx.send(to_mono_f32(data, channels, |s| s));
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let _ = tx.send(to_mono_f32(data, channels, |s| s as f32 / i16::MAX as f32));
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            stream_config.clone(),
            move |data: &[u16], _: &cpal::InputCallbackInfo| {
                let _ = tx.send(to_mono_f32(data, channels, |s| (s as f32 - 32768.0) / 32768.0));
            },
            err_fn,
            None,
        ),
        other => return Err(format!("不支持的麦克风采样格式：{other:?}")),
    }
    .map_err(|e| format!("创建音频输入流失败：{e}"))?;

    cpal_stream
        .play()
        .map_err(|e| format!("启动麦克风采集失败：{e}"))?;

    // spawn 录音+转写线程；cpal_stream 必须 move 进线程并 Drop 时才停采集
    let (result_tx, result_rx) = mpsc::channel::<Result<String, String>>();
    let asr = std::sync::Arc::new(asr);
    let asr_clone = asr.clone();
    std::thread::spawn(move || {
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let result = transcribe_once(&asr_clone, &rx);
        unsafe { CoUninitialize() };
        drop(cpal_stream); // 显式停采集（线程结束也会 Drop，这里清楚一些）
        let _ = result_tx.send(result);
    });

    result_rx
        .recv()
        .map_err(|_| "录音线程异常退出".to_string())?
}

/// 按需单轮转写：建 ASR stream，喂重采样 PCM，endpoint 或超时结束，返回转写文本。
/// 跟常驻循环里的 record_single_utterance 区别：无 listening 标志、不 emit 事件、返回文本。
fn transcribe_once(asr: &AsrRecognizer, rx: &mpsc::Receiver<Vec<f32>>) -> Result<String, String> {
    let stream = asr.recognizer.create_stream();
    let deadline = Instant::now() + ASR_UTTERANCE_TIMEOUT;
    loop {
        let now = Instant::now();
        if now >= deadline && !asr.recognizer.is_ready(&stream) {
            break;
        }
        let wait = deadline.saturating_duration_since(now).min(Duration::from_millis(200));
        match rx.recv_timeout(wait) {
            Ok(samples) => {
                let resampled = asr.resampler.resample(&samples, false);
                stream.accept_waveform(16000, &resampled);
                while asr.recognizer.is_ready(&stream) {
                    asr.recognizer.decode(&stream);
                }
                if asr.recognizer.is_endpoint(&stream) {
                    let text = asr
                        .recognizer
                        .get_result(&stream)
                        .map(|r| r.text.trim().to_string())
                        .unwrap_or_default();
                    asr.recognizer.reset(&stream);
                    return Ok(text);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("音频通道断开".to_string()),
        }
    }
    Ok(String::new()) // 超时无 endpoint，返回空（前端不填）
}
