//! Windows SAPI5 文本转语音（唤醒应答用）。
//!
//! 用 `windows` crate 的 `Win32_Media_Speech`（ISpVoice COM）+ `Win32_System_Com`，
//! 调系统自带 SAPI5 语音引擎，**不下模型不加原生库**（SAPI5 随 Windows 出货）。
//!
//! SpVoice 的 CLSID 直接用 windows crate 导出的常量 `SpVoice`（mod.rs:18452，
//! `96749377-3391-11d2-9ee3-00c04f797396`）。注意：早期调研误以为 crate 不导 coclass
//! CLSID 而硬编码了错误值，真机报 REGDB_E_CLASSNOTREG（0x80040154 没有注册类）；
//! 实际 crate 0.61.3 导出了 `SpVoice` 常量，直接用即可，不要自己编 GUID。
//!
//! 中文播报依赖系统装了 zh-CN 语音（Win11 中文版默认 Huihui；纯英文系统会乱读）。
//! 调用方所在线程须已 CoInitializeEx，speak() 本身的 CoCreateInstance 才能成功。
//! 建议每次 speak 起一个一次性线程并自带 CoInitializeEx/CoUninitialize，避免
//! 改动监听线程的 apartment（监听线程也已经 CoInitialize 了，见 mod.rs）。

use windows::core::PCWSTR;
use windows::Win32::Media::Speech::{ISpVoice, SpVoice};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

/// 用系统默认 SAPI5 语音同步播报一句中文（阻塞到播完）。调用方线程须已 CoInitializeEx。
///
/// rate: [-10,+10] 速度（0 正常）；volume: [0,100] 音量（100 满）。都用默认。
/// Speak flags 0 = SPF_DEFAULT 同步（等播完返回），适合短应答"主人我在"几百 ms。
///
/// SpVoice 的 CLSID 直接用 windows crate 导出的常量（mod.rs:18452，
/// `96749377-3391-11d2-9ee3-00c04f797396`）--之前误信"crate 不导 coclass CLSID"硬编码
/// 了错误值，真机报 REGDB_E_CLASSNOTREG (0x80040154 没有注册类)。crate 实际导出了。
pub fn speak(phrase: &str) -> windows::core::Result<()> {
    let mut wide: Vec<u16> = phrase.encode_utf16().collect();
    wide.push(0); // NUL 结尾的 UTF-16，PCWSTR 要

    let voice: ISpVoice = match unsafe { CoCreateInstance(&SpVoice, None, CLSCTX_ALL) } {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[voice/tts] CoCreateInstance(SpVoice) 失败：{e}");
            return Err(e);
        }
    };
    unsafe {
        if let Err(e) = voice.SetRate(0) {
            eprintln!("[voice/tts] SetRate 失败（忽略）：{e}");
        }
        if let Err(e) = voice.SetVolume(100) {
            eprintln!("[voice/tts] SetVolume 失败（忽略）：{e}");
        }
        // 第 3 参 pulStreamNumber 传 None；SPF_DEFAULT=0 同步播完返回
        if let Err(e) = voice.Speak(PCWSTR(wide.as_ptr()), 0, None) {
            eprintln!("[voice/tts] Speak 失败：{e}（phrase={phrase:?}）");
            return Err(e);
        }
    }
    Ok(())
}
