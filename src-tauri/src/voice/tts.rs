//! Windows SAPI5 文本转语音（唤醒应答用）。
//!
//! 用 `windows` crate 的 `Win32_Media_Speech`（ISpVoice COM）+ `Win32_System_Com`，
//! 调系统自带 SAPI5 语音引擎，**不下模型不加原生库**（SAPI5 随 Windows 出货）。
//!
//! 关键坑（读 windows 0.61 源码 + winapi crate 交叉验证确定）：windows crate 的
//! `Win32_Media_Speech` 只导出 `ISpVoice` 接口（IID），**不导出 coclass CLSID**
//! （`CLSID_SpVoice`）。winapi crate 里有但 windows 没移植这个常量。所以 SpVoice
//! 的 CLSID 必须在代码里按 GUID 硬编码：`{96749377-3394-11D2-BEE8-0800362C6406}`
//! （winapi um/sapi51.rs 的 CLSID_SpVoice 对应值，SAPI5 标准值，跨机器一致）。
//!
//! 中文播报依赖系统装了 zh-CN 语音（Win11 中文版默认 Huihui；纯英文系统会乱读）。
//! 调用方所在线程须已 CoInitializeEx，speak() 本身的 CoCreateInstance 才能成功。
//! 建议每次 speak 起一个一次性线程并自带 CoInitializeEx/CoUninitialize，避免
//! 改动监听线程的 apartment（监听线程也已经 CoInitialize 了，见 mod.rs）。

use windows::core::{GUID, PCWSTR};
use windows::Win32::Media::Speech::ISpVoice;
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

/// SpVoice coclass 的 CLSID。windows crate 不导出这个常量，硬编码 SAPI5 标准值。
const CLSID_SPVOICE: GUID = GUID::from_u128(0x96749377_3394_11D2_BEE8_080036_2C6406);

/// 用系统默认 SAPI5 语音同步播报一句中文（阻塞到播完）。调用方线程须已 CoInitializeEx。
///
/// rate: [-10,+10] 速度（0 正常）；volume: [0,100] 音量（100 满）。都用默认。
/// Speak flags 0 = SPF_DEFAULT 同步（等播完返回），适合短应答"主人我在"几百 ms。
pub fn speak(phrase: &str) -> windows::core::Result<()> {
    let mut wide: Vec<u16> = phrase.encode_utf16().collect();
    wide.push(0); // NUL 结尾的 UTF-16，PCWSTR 要

    let voice: ISpVoice = unsafe { CoCreateInstance(&CLSID_SPVOICE, None, CLSCTX_ALL)? };
    unsafe {
        voice.SetRate(0).ok();
        voice.SetVolume(100).ok();
        // 第 3 参 pulStreamNumber 传 None；SPF_DEFAULT=0 同步播完返回
        voice.Speak(PCWSTR(wide.as_ptr()), 0, None)?;
    }
    Ok(())
}
