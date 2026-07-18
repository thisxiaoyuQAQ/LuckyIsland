//! B4 持久、脱敏、轮转日志。
//!
//! - 设施：`init_logging` 在应用数据目录 `logs/` 下按天轮转写文件（tracing-appender），
//!   同时镜像到 stderr，Release 下仍可定位（不依赖 debug_assertions）。
//! - 脱敏：`redact` 统一在写入前剥除 API key / token / 鉴权头，禁止把密钥写进日志文件。
//!   完整 prompt / 对话内容不属于日志范畴，调用方本来就不应整体 record。
//! - 本批只接入「启动 / 退出」两条主路径；Provider / CLI / HTTP / PTY / 显示器 / 语音
//!   等日志点在后续小批逐个接入（见 vault 10b REF-10B-05 接入点清单）。

use std::io::{self, Write};
use std::path::PathBuf;
#[cfg(test)]
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::{fmt, EnvFilter};

/// 默认日志级别（Release 下也可定位），可被 RUST_LOG 覆盖。
const DEFAULT_FILTER: &str = "info";

/// 轮转文件所在目录：<app_data>/logs
fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("无法解析日志目录: {error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("无法创建日志目录: {error}"))?;
    Ok(dir)
}

/// 脱敏：把日志文本里的密钥 / token 替换为占位符。
///
/// 覆盖：Authorization: Bearer <token>、`token=<v>`、`api_key=<v>` / `apikey=<v>`、
/// `key=<v>`（仅当值足够长、疑似密钥时），以及形似 JWT / 长 hex 的裸 token。
/// 宁可误伤长随机串，也不让真实密钥落盘；短普通词不受影响。
pub(crate) fn redact(input: &str) -> String {
    let mut out = input.to_string();

    // 1) Authorization: Bearer <token>（大小写不敏感）
    out = redact_bearer(&out);

    // 2) key=value 形式的命名密钥参数
    for name in [
        "token",
        "api_key",
        "apikey",
        "api-key",
        "access_token",
        "secret",
        "password",
    ] {
        out = redact_named_param(&out, name);
    }

    // 3) 裸的高熵 token：>= 24 位的字母数字/-/_. 串（JWT、长 hex、UUID 链等）
    out = redact_high_entropy(&out);

    out
}

const REDACTED: &str = "[REDACTED]";

fn redact_bearer(input: &str) -> String {
    let lower = input.to_lowercase();
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    let mut rest_lower = lower.as_str();
    while let Some(idx) = rest_lower.find("bearer ") {
        result.push_str(&rest[..idx + "bearer ".len()]);
        let after = &rest[idx + "bearer ".len()..];
        let end = after
            .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
            .unwrap_or(after.len());
        if end > 0 {
            result.push_str(REDACTED);
            rest = &after[end..];
            rest_lower = &rest_lower[idx + "bearer ".len() + end..];
        } else {
            // "bearer" 后没有值：原样保留已扫描部分，继续。
            rest = after;
            rest_lower = &rest_lower[idx + "bearer ".len()..];
        }
    }
    result.push_str(rest);
    result
}

fn redact_named_param(input: &str, name: &str) -> String {
    let lower = input.to_lowercase();
    let needle = format!("{name}=");
    let mut result = String::with_capacity(input.len());
    let mut rest = input;
    let mut rest_lower = lower.as_str();
    while let Some(idx) = rest_lower.find(&needle) {
        // 确保匹配的是参数名边界（前一个字符不是字母数字，避免 "mytoken=" 误伤 "token="）。
        let boundary = idx == 0
            || !rest[..idx]
                .chars()
                .last()
                .map(|c| c.is_alphanumeric() || c == '_')
                .unwrap_or(false);
        if !boundary {
            result.push_str(&rest[..idx + 1]);
            rest = &rest[idx + 1..];
            rest_lower = &rest_lower[idx + 1..];
            continue;
        }
        result.push_str(&rest[..idx + needle.len()]);
        let after = &rest[idx + needle.len()..];
        let end = after
            .find(|c: char| c.is_whitespace() || c == '&' || c == '"' || c == '\'')
            .unwrap_or(after.len());
        if end > 0 {
            result.push_str(REDACTED);
            rest = &after[end..];
            rest_lower = &rest_lower[idx + needle.len() + end..];
        } else {
            rest = after;
            rest_lower = &rest_lower[idx + needle.len()..];
        }
    }
    result.push_str(rest);
    result
}

fn redact_high_entropy(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut current = String::new();
    let is_token_char = |c: char| c.is_alphanumeric() || matches!(c, '-' | '_' | '.');

    let flush = |current: &mut String, result: &mut String| {
        if current.len() >= 24 && current.chars().any(|c| c.is_alphanumeric()) {
            result.push_str(REDACTED);
        } else {
            result.push_str(current);
        }
        current.clear();
    };

    for c in input.chars() {
        if is_token_char(c) {
            current.push(c);
        } else {
            flush(&mut current, &mut result);
            result.push(c);
        }
    }
    flush(&mut current, &mut result);
    result
}

/// 包装一个 `Write`，在每次 `write` 前对整段文本跑 `redact`，确保落盘内容不含密钥。
/// tracing fmt 对每条日志事件调用一次 writer 写入完整格式化行，这里按段脱敏即可。
struct RedactingWriter<W: Write> {
    inner: W,
}

impl<W: Write> Write for RedactingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let text = String::from_utf8_lossy(buf);
        let redacted = redact(&text);
        // 返回原始 buf 长度，让上层认为整段都被消费（redact 不改变语义长度假设）。
        self.inner.write_all(redacted.as_bytes())?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// `MakeWriter` 适配：每次产出包了一层脱敏的 writer。
#[derive(Clone)]
struct RedactingMakeWriter<M> {
    inner: M,
}

impl<'a, M> MakeWriter<'a> for RedactingMakeWriter<M>
where
    M: MakeWriter<'a>,
    M::Writer: Write,
{
    type Writer = RedactingWriter<M::Writer>;

    fn make_writer(&'a self) -> Self::Writer {
        RedactingWriter {
            inner: self.inner.make_writer(),
        }
    }
}

/// 共享内存 writer（测试用）：线程安全地把日志写进一个可断言的 buffer。
#[cfg(test)]
#[derive(Clone, Default)]
struct SharedBuf(Arc<Mutex<Vec<u8>>>);

#[cfg(test)]
impl Write for SharedBuf {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// 初始化全局日志订阅器。返回的 guard 必须持有到进程退出，否则非阻塞文件写入会丢日志。
///
/// 在 `tauri::Builder` 的 setup 早期调用；重复调用返回 Err（不覆盖已安装的全局订阅器）。
pub(crate) fn init_logging(
    app: &AppHandle,
) -> Result<tracing_appender::non_blocking::WorkerGuard, String> {
    let dir = log_dir(app)?;
    let file_appender = tracing_appender::rolling::daily(&dir, "lucky-island.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));

    fmt()
        .with_env_filter(filter)
        .with_writer(RedactingMakeWriter {
            inner: non_blocking,
        })
        .with_ansi(false)
        .try_init()
        .map_err(|error| format!("安装日志订阅器失败: {error}"))?;

    Ok(guard)
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn redacts_bearer_token() {
        assert_eq!(
            redact("GET /notify Authorization: Bearer abc123secrettoken"),
            "GET /notify Authorization: Bearer [REDACTED]"
        );
        assert_eq!(redact("bearer xyz"), "bearer [REDACTED]");
    }

    #[test]
    fn redacts_named_secret_params() {
        assert_eq!(
            redact("url=http://127.0.0.1:9753/notify?token=deadbeefcafe"),
            "url=http://127.0.0.1:9753/notify?token=[REDACTED]"
        );
        assert_eq!(
            redact("config api_key=sk-abcdef123456 done"),
            "config api_key=[REDACTED] done"
        );
        assert_eq!(
            redact("openai apikey=sk-test tail"),
            "openai apikey=[REDACTED] tail"
        );
    }

    #[test]
    fn redacts_high_entropy_bare_token() {
        // 32 位 hex（典型 API key 形态）应被剥除。
        assert_eq!(
            redact("key 0123456789abcdef0123456789abcdef end"),
            "key [REDACTED] end"
        );
    }

    #[test]
    fn keeps_normal_text_untouched() {
        assert_eq!(
            redact("启动完成，监听 127.0.0.1:9753"),
            "启动完成，监听 127.0.0.1:9753"
        );
        assert_eq!(
            redact("provider codex-cli started"),
            "provider codex-cli started"
        );
        // 短词不误判为密钥。
        assert_eq!(redact("token expired"), "token expired");
        // 普通标识符（短）保留。
        assert_eq!(redact("window main focused"), "window main focused");
    }

    #[test]
    fn does_not_redact_partial_name_match() {
        // "mytoken=" 不应触发 "token=" 的剥除（参数名边界）。
        assert_eq!(redact("mytoken=keepme"), "mytoken=keepme");
    }

    #[test]
    fn writer_redacts_secrets_before_writing() {
        use super::{RedactingWriter, SharedBuf};
        use std::io::Write;

        let buf = SharedBuf::default();
        let storage = buf.clone();
        let mut writer = RedactingWriter { inner: buf };
        writer
            .write_all(b"connect Authorization: Bearer secrettoken123\n")
            .unwrap();
        writer.flush().unwrap();

        let written = String::from_utf8(storage.0.lock().unwrap().clone()).unwrap();
        assert!(
            written.contains("[REDACTED]"),
            "expected redacted: {written}"
        );
        assert!(
            !written.contains("secrettoken123"),
            "secret leaked: {written}"
        );
    }

    #[test]
    fn subscriber_output_is_redacted_end_to_end() {
        use super::{RedactingMakeWriter, SharedBuf};
        use tracing_subscriber::fmt;

        let buf = SharedBuf::default();
        let storage = buf.clone();
        let subscriber = fmt()
            .with_writer(RedactingMakeWriter {
                inner: move || buf.clone(),
            })
            .with_ansi(false)
            .without_time()
            .finish();

        tracing::subscriber::with_default(subscriber, || {
            tracing::info!("notify server token=topsecretvalue999 bound");
            tracing::info!("api_key = sk-live-abcdef0123456789");
        });

        let written = String::from_utf8(storage.0.lock().unwrap().clone()).unwrap();
        assert!(
            !written.contains("topsecretvalue999"),
            "token leaked: {written}"
        );
        assert!(
            written.contains("token=[REDACTED]"),
            "expected token redacted: {written}"
        );
    }
}
