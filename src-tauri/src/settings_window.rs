//! 设置面板窗口控制 + settings KV 增强命令（M7）。
//!
//! 设置窗口在 `tauri.conf.json` 静态声明（label="settings"，visible:false），
//! `open_settings` 只 show+聚焦；关闭按钮由 `lib.rs` 的 `on_window_event` 改为 hide，
//! 避免销毁后重复创建、保证全局单例。
//!
//! 不动 `settings.rs`（M3 勿动文件）：新增 `setting_set_and_emit` 在写 KV 后
//! 广播 `settings://changed { key, value }`，原 `setting_set` 保持不动供 notify 等复用。

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::storage::Db;

/// `settings://changed` 事件载荷
#[derive(Serialize, Clone)]
pub struct SettingsChanged {
    pub key: String,
    pub value: Option<String>,
}

/// 打开设置面板窗口：静态窗口 show + 聚焦（CloseRequested 在 lib.rs 改为 hide）。
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 批量读 settings：key 以 `prefix` 开头的全部 (key, value)。设置面板初始化用。
#[tauri::command]
pub fn settings_list(prefix: String, db: State<'_, Db>) -> Result<Vec<(String, String)>, String> {
    db.settings_list_prefix(&prefix)
}

/// 写一个 settings KV（None=删除）并广播 `settings://changed { key, value }`。
#[tauri::command]
pub fn setting_set_and_emit(
    app: tauri::AppHandle,
    key: String,
    value: Option<String>,
    db: State<'_, Db>,
) -> Result<(), String> {
    match &value {
        Some(v) => db.setting_set(&key, v)?,
        None => db.setting_delete(&key)?,
    }
    app.emit(
        "settings://changed",
        SettingsChanged {
            key: key.clone(),
            value: value.clone(),
        },
    )
    .map_err(|e| e.to_string())
}

/// 开/关开机自启（tauri-plugin-autostart）。
#[tauri::command]
pub fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())
    } else {
        mgr.disable().map_err(|e| e.to_string())
    }
}

/// 查询当前开机自启是否启用。
#[tauri::command]
pub fn autostart_get(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}
