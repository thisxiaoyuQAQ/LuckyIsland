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

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use sherpa_onnx::{KeywordSpotter, KeywordSpotterConfig};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// KWS 模型下载地址（sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01，实测 32,654,866 字节）。
/// 纯中文唤醒词模型；下载速度实测约 147KB/s（GitHub Releases 签名 URL），32.6MB 耗时约 3~4 分钟，
/// 国内用户可能更慢，前端需展示进度 + 允许重试，不做静默失败。
const KWS_MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2";
const KWS_MODEL_DIR_NAME: &str = "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01";

/// 语音功能运行时状态：模型是否已下载、监听是否开启。
/// 仿 `AI_LOADING` 模式（见 lib.rs），用 AtomicBool 做跨线程标志位。
pub struct VoiceState {
    /// 监听是否正在跑；Arc 是因为监听线程要持有一份共享引用，靠它判断何时退出循环。
    /// start_listening 里从 false swap 成 true 时才真正 spawn 线程，避免重复启动。
    pub listening: Arc<AtomicBool>,
    /// 模型是否正在下载中（防止重复触发下载）
    pub downloading: AtomicBool,
}

impl VoiceState {
    pub fn new() -> Self {
        Self {
            listening: Arc::new(AtomicBool::new(false)),
            downloading: AtomicBool::new(false),
        }
    }
}

/// 模型文件存放目录：`<app_data_dir>/voice-models/<model_dir_name>/`
fn kws_model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice-models")
        .join(KWS_MODEL_DIR_NAME);
    Ok(base)
}

/// 判断 KWS 模型是否已下载完整（关键文件都在即视为完整；tokens.txt 是编码唤醒词必需的）。
fn kws_model_ready(app: &AppHandle) -> bool {
    let Ok(dir) = kws_model_dir(app) else {
        return false;
    };
    dir.join("tokens.txt").is_file()
        && dir.join("keywords.txt").is_file()
        && has_onnx_triplet(&dir)
}

/// 目录下是否有一套完整的 encoder/decoder/joiner int8 onnx（优先用 int8，体积小，KWS 场景精度够）
fn has_onnx_triplet(dir: &std::path::Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    let has = |prefix: &str| {
        names
            .iter()
            .any(|n| n.starts_with(prefix) && n.ends_with(".int8.onnx"))
    };
    has("encoder-") && has("decoder-") && has("joiner-")
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    /// done | error 阶段用 message 传状态文案；下载中 message 为空
    stage: String,
    message: String,
}

/// 查询模型是否已就绪（前端用于决定显示"下载"还是"已就绪"）
#[tauri::command]
pub fn voice_model_ready(app: AppHandle) -> bool {
    kws_model_ready(&app)
}

/// 下载并解压 KWS 模型到 app_data_dir/voice-models/。emit `voice://download-progress` 报进度。
/// 已就绪时直接返回成功，不重复下载。下载中重复调用会被 `downloading` 标志拒绝。
#[tauri::command]
pub async fn voice_download_model(
    app: AppHandle,
    http: tauri::State<'_, reqwest::Client>,
    state: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    if kws_model_ready(&app) {
        return Ok(());
    }
    if state
        .downloading
        .swap(true, Ordering::SeqCst)
    {
        return Err("已有下载任务在进行".to_string());
    }

    let result = download_and_extract(&app, http.inner()).await;

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

async fn download_and_extract(app: &AppHandle, http: &reqwest::Client) -> Result<(), String> {
    let dir = kws_model_dir(app)?;
    let parent = dir
        .parent()
        .ok_or("模型目录路径异常")?
        .to_path_buf();
    std::fs::create_dir_all(&parent).map_err(|e| format!("创建模型目录失败：{e}"))?;

    let tmp_path = parent.join("kws-model.tar.bz2.tmp");
    let resp = http
        .get(KWS_MODEL_URL)
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
    // 逐块写盘 + emit 进度，避免 32MB 文件整体读进内存；下载慢（实测约 147KB/s）必须让前端看到进度，
    // 不能一次性 await 到底让用户以为卡死。
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

    if !kws_model_ready(app) {
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
    if !kws_model_ready(&app) {
        return Err("模型尚未下载，请先在设置里下载语音模型".to_string());
    }
    let keyword_setting = app
        .state::<crate::storage::Db>()
        .setting_get("wake:keyword")
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "小岛小岛".to_string());

    // 已在监听：false -> true 才继续；已经是 true 说明线程已经跑着，直接返回不重复 spawn
    if state
        .listening
        .swap(true, Ordering::SeqCst)
    {
        return Ok(());
    }

    let dir = kws_model_dir(&app)?;
    let tokens_content = std::fs::read_to_string(dir.join("tokens.txt"))
        .map_err(|e| format!("读取 tokens.txt 失败：{e}"))?;
    let table = keyword::TokenTable::load(&tokens_content);
    let encoded = keyword::encode_keyword(&keyword_setting, &table).map_err(|e| {
        state
            .listening
            .store(false, Ordering::SeqCst);
        format!("唤醒词「{keyword_setting}」编码失败：{e}")
    })?;

    let listening_flag = state.listening.clone();
    let app_for_thread = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_listen_loop(app_for_thread.clone(), &dir, &encoded, listening_flag.clone()) {
            let _ = app_for_thread.emit("voice://listen-error", e);
        }
        listening_flag.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// 停止常驻监听：只切标志位，监听线程的检测循环轮询到 false 后自行退出（见 run_listen_loop）。
/// 已知小竞态：stop 后 200ms 内立刻 start，旧线程可能还没退出、新线程已尝试打开同一麦克风
/// 设备（`recv_timeout` 轮询间隔 200ms）。概率低且失败模式只是瞬时报错不崩溃，暂不处理，
/// 真机验证阶段如遇到再补一个"等待旧线程退出"的同步信号。
#[tauri::command]
pub fn voice_stop_listening(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    state
        .listening
        .store(false, Ordering::SeqCst);
    Ok(())
}

/// 监听线程主体：建 KeywordSpotter + cpal 输入流，PCM 经 mpsc 通道送进检测循环，
/// 命中唤醒词后 emit `voice://wake` + 打开 AI 面板，然后继续监听（不自动停止，
/// 除非用户手动关闭或说话人反复触发——sherpa-onnx 每次 get_result 后需要 reset 才能继续检测下一次）。
fn run_listen_loop(
    app: AppHandle,
    model_dir: &std::path::Path,
    encoded_keyword: &str,
    listening: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut config = KeywordSpotterConfig::default();
    config.model_config.transducer.encoder = Some(onnx_path(model_dir, "encoder-")?);
    config.model_config.transducer.decoder = Some(onnx_path(model_dir, "decoder-")?);
    config.model_config.transducer.joiner = Some(onnx_path(model_dir, "joiner-")?);
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

    // 检测循环：轮询 listening 标志位决定何时退出；用 recv_timeout 而非阻塞 recv，
    // 保证即使一段时间没音频数据也能定期检查退出信号，不会卡死。
    while listening.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(samples) => {
                stream.accept_waveform(sample_rate, &samples);
                while spotter.is_ready(&stream) {
                    spotter.decode(&stream);
                    if let Some(result) = spotter.get_result(&stream) {
                        if !result.keyword.is_empty() {
                            let _ = app.emit("voice://wake", &result.keyword);
                            let _ = open_ai_palette_from_voice(&app);
                            spotter.reset(&stream);
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

/// 多声道 PCM 帧降混成单声道 f32；`conv` 把源采样类型换算到 [-1.0, 1.0]。
fn to_mono_f32<T: Copy>(data: &[T], channels: usize, conv: impl Fn(T) -> f32) -> Vec<f32> {
    if data.is_empty() || channels == 0 {
        return Vec::new();
    }
    data.chunks(channels)
        .map(|frame| {
            let sum: f32 = frame
                .iter()
                .map(|&s| conv(s))
                .sum();
            sum / channels as f32
        })
        .collect()
}

/// 在模型目录里找指定前缀 + `.int8.onnx` 后缀的文件，返回完整路径字符串
fn onnx_path(dir: &std::path::Path, prefix: &str) -> Result<String, String> {
    std::fs::read_dir(dir)
        .map_err(|e| format!("读取模型目录失败：{e}"))?
        .filter_map(|e| e.ok())
        .find(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.starts_with(prefix) && name.ends_with(".int8.onnx")
        })
        .map(|e| e.path().to_string_lossy().to_string())
        .ok_or_else(|| format!("模型目录缺少 {prefix}*.int8.onnx 文件"))
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
    let dir = kws_model_dir(&app)?;
    let tokens_path = dir.join("tokens.txt");
    let tokens_content = std::fs::read_to_string(&tokens_path)
        .map_err(|_| "模型尚未下载，请先在设置里下载语音模型".to_string())?;
    let table = keyword::TokenTable::load(&tokens_content);
    keyword::encode_keyword(phrase.trim(), &table).map_err(|e| e.to_string())
}
