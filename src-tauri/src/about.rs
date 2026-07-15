use serde::Serialize;
use tauri::AppHandle;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticInfo {
    pub app_version: String,
    pub os: String,
    pub architecture: String,
    pub webview2: String,
    pub update_channel: String,
}

fn normalized(value: String) -> String {
    if value.trim().is_empty() {
        "未知".to_string()
    } else {
        value
    }
}

fn normalize_unknowns(info: &mut DiagnosticInfo) {
    info.os = normalized(std::mem::take(&mut info.os));
    info.webview2 = normalized(std::mem::take(&mut info.webview2));
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn diagnostic_text(info: &DiagnosticInfo) -> String {
    format!(
        "LuckyIsland: {}\nOS: {}\nArchitecture: {}\nWebView2: {}\nUpdate channel: {}",
        info.app_version, info.os, info.architecture, info.webview2, info.update_channel
    )
}

#[tauri::command]
pub fn about_diagnostics(app: AppHandle) -> DiagnosticInfo {
    let mut info = DiagnosticInfo {
        app_version: app.package_info().version.to_string(),
        os: os_version(),
        architecture: std::env::consts::ARCH.to_string(),
        webview2: tauri::webview_version().unwrap_or_else(|_| "未知".to_string()),
        update_channel: "stable".to_string(),
    };
    normalize_unknowns(&mut info);
    info
}

#[cfg(windows)]
fn os_version() -> String {
    let version = windows_version::OsVersion::current();
    format!(
        "Windows {}.{}.{}",
        version.major, version.minor, version.build
    )
}

#[cfg(not(windows))]
fn os_version() -> String {
    std::env::consts::OS.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> DiagnosticInfo {
        DiagnosticInfo {
            app_version: "0.2.1".into(),
            os: "Windows 11 10.0.26100".into(),
            architecture: "x86_64".into(),
            webview2: "138.0.3351.55".into(),
            update_channel: "stable".into(),
        }
    }

    #[test]
    fn diagnostic_text_has_exactly_five_safe_fields() {
        assert_eq!(
            diagnostic_text(&info()),
            "LuckyIsland: 0.2.1\nOS: Windows 11 10.0.26100\nArchitecture: x86_64\nWebView2: 138.0.3351.55\nUpdate channel: stable"
        );
    }

    #[test]
    fn diagnostic_text_never_contains_unrelated_secrets_or_paths() {
        let text = diagnostic_text(&info());
        for private in [
            "notify:http_token",
            "Authorization",
            "PRIVATE KEY",
            "C:\\Users\\alice",
            "sk-secret",
        ] {
            assert!(!text.contains(private));
        }
    }

    #[test]
    fn missing_platform_values_are_normalized_to_unknown() {
        let mut value = info();
        value.os.clear();
        value.webview2 = "   ".into();
        normalize_unknowns(&mut value);
        assert_eq!(value.os, "未知");
        assert_eq!(value.webview2, "未知");
    }
}
