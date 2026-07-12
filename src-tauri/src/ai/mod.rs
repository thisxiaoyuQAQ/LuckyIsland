pub mod history;
pub mod process;
pub mod prompt;
pub mod provider;
pub mod router;
pub mod runtime;
pub mod types;

pub use history::{ai_clear_history, ai_history_list};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};
use uuid::Uuid;

use crate::storage::Db;
use provider::Message;
use runtime::{ActiveRequest, AiRuntime};
use types::{CancelStatus, ProviderKind};

#[derive(Serialize)]
pub struct ActionExec {
    pub action: String,
    pub args: serde_json::Value,
    pub success: bool,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponse {
    pub reply: String,
    pub action: Option<ActionExec>,
    pub provider_used: ProviderKind,
}

fn validate_provider_selection(
    requested: ProviderKind,
    persisted: &str,
) -> Result<ProviderKind, String> {
    let persisted = persisted.parse::<ProviderKind>()?;
    if persisted == requested {
        Ok(requested)
    } else {
        Err(format!(
            "Provider 状态不一致：请求={}，已保存={}",
            requested.as_str(),
            persisted.as_str()
        ))
    }
}

fn guard_current(runtime: &AiRuntime, request: &ActiveRequest) -> Result<(), String> {
    if request.cancel.is_cancelled() || !runtime.is_current(&request.id) {
        Err("请求已取消".to_string())
    } else {
        Ok(())
    }
}

/// AI 对话：校验 provider -> 注册单活 request -> provider -> 动作/历史/事件检查点。
#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
    runtime: State<'_, AiRuntime>,
    request_id: String,
    provider: String,
    message: String,
    history: Vec<Message>,
) -> Result<AiResponse, String> {
    if request_id.trim().is_empty() {
        return Err("requestId 不能为空".to_string());
    }
    if message.trim().is_empty() {
        return Err("消息不能为空".to_string());
    }
    let requested = provider.parse::<ProviderKind>()?;
    let persisted = db
        .setting_get("ai:provider")
        .unwrap_or_else(|| "claude-cli".to_string());
    validate_provider_selection(requested, &persisted)?;

    let request = runtime.register(request_id.clone(), requested)?;
    let result = ai_chat_inner(
        &app,
        db.inner(),
        http.inner(),
        runtime.inner(),
        &request,
        message,
        history,
    )
    .await;
    runtime.clear_if_current(&request_id);
    result
}

async fn ai_chat_inner(
    app: &AppHandle,
    db: &Db,
    http: &reqwest::Client,
    runtime: &AiRuntime,
    request: &ActiveRequest,
    message: String,
    history: Vec<Message>,
) -> Result<AiResponse, String> {
    let provider = provider::provider_for(request.provider, db, http)?;
    let system_prompt = prompt::build_system_prompt(db);
    let mut provider_history = history;
    provider_history.push(Message {
        role: "user".to_string(),
        content: message.clone(),
    });

    let raw = provider
        .chat(&provider_history, &system_prompt, request.cancel.clone())
        .await
        .map_err(|error| error.to_string())?;
    guard_current(runtime, request)?;

    let (reply, action_exec) = match router::parse_action(&raw) {
        Some(action) => {
            guard_current(runtime, request)?;
            let result = router::execute(app, db, &action).await;
            guard_current(runtime, request)?;
            let reply = result.message.clone();
            let action_exec = ActionExec {
                action: result.action,
                args: result.args,
                success: result.success,
                message: result.message,
            };
            (reply, Some(action_exec))
        }
        None => (raw, None),
    };

    guard_current(runtime, request)?;
    db.ai_history_add(&Uuid::new_v4().to_string(), "user", &message)?;
    guard_current(runtime, request)?;
    db.ai_history_add(&Uuid::new_v4().to_string(), "assistant", &reply)?;
    guard_current(runtime, request)?;
    if let Err(error) = app.emit("ai://action-result", &action_exec) {
        eprintln!("[ai] 发送动作结果事件失败：{error}");
    }
    guard_current(runtime, request)?;

    Ok(AiResponse {
        reply,
        action: action_exec,
        provider_used: request.provider,
    })
}

#[tauri::command]
pub fn ai_cancel(runtime: State<'_, AiRuntime>, request_id: String) -> CancelStatus {
    if request_id.trim().is_empty() {
        CancelStatus::NotCurrent
    } else {
        runtime.cancel(&request_id)
    }
}

#[tauri::command]
pub async fn ai_switch_provider(
    app: AppHandle,
    db: State<'_, Db>,
    provider: String,
) -> Result<(), String> {
    let provider = provider.parse::<ProviderKind>()?;
    db.setting_set("ai:provider", provider.as_str())?;
    if let Err(error) = app.emit("ai://provider-changed", provider.as_str()) {
        eprintln!("[ai] Provider 已持久化，但切换事件发送失败：{error}");
    }
    Ok(())
}
/// 打开 AI 面板窗口（Alt+Space / 托盘菜单）：优先恢复用户上次拖动保存的 ai:position，
/// 未设置时回退屏幕中央偏上。show + 聚焦（不做失焦隐藏，仅 ESC / 再按 Alt+Space 关闭）。
#[tauri::command]
pub fn open_ai_palette(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("ai-palette") {
        // 从 managed state 取 Db（热键/托盘/前端 invoke 三种入口统一走这里）
        let db = app.state::<Db>();
        let placed = restore_position(&win, db.inner());
        if !placed {
            if let Some(pos) = default_center_position(&win) {
                let _ = win.set_position(pos);
            }
        }
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 屏幕中央偏上的默认坐标（未保存过位置时的回退位置，也是「重置位置」的目标位置）
fn default_center_position(win: &tauri::WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = win.current_monitor().ok()??;
    let msize = monitor.size();
    let mpos = monitor.position();
    let wsize = win.outer_size().unwrap_or_default();
    let x = mpos.x + ((msize.width as i32 - wsize.width as i32) / 2);
    let y = mpos.y + (msize.height as i32 / 4);
    Some(PhysicalPosition { x, y })
}

/// 恢复保存的位置（格式 "x,y"（logical））。成功定位返回 true。
fn restore_position(win: &tauri::WebviewWindow, db: &Db) -> bool {
    let Some(raw) = db.setting_get("ai:position") else {
        return false;
    };
    let mut parts = raw.split(',');
    match (parts.next(), parts.next()) {
        (Some(x), Some(y))
            if x.trim().parse::<i32>().is_ok() && y.trim().parse::<i32>().is_ok() =>
        {
            let x: i32 = x.trim().parse().unwrap();
            let y: i32 = y.trim().parse().unwrap();
            let _ = win.set_position(PhysicalPosition { x, y });
            true
        }
        _ => false,
    }
}

/// 保存 AI 面板当前位置到 ai:position（预留：前端如需在拖动停止时主动保存可调用；
/// 目前 hide_ai_palette 已在隐藏前自动保存，通常不需要单独调此命令）
#[tauri::command]
pub fn ai_save_position(app: AppHandle, db: State<'_, Db>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("ai-palette") {
        let pos = win.outer_position().map_err(|e| e.to_string())?;
        let _ = db.setting_set("ai:position", &format!("{},{}", pos.x, pos.y));
    }
    Ok(())
}

/// 读取 ai:position（供设置面板「重置位置」用），未设置返回 None
#[tauri::command]
pub fn ai_get_position(db: State<'_, Db>) -> Result<Option<String>, String> {
    Ok(db.setting_get("ai:position"))
}

/// 清除 ai:position（设置面板「重置位置」按钮调用）。若面板当前正打开，立刻挪到默认居中位置；
/// 否则只清 DB，下次打开自然回默认居中。
#[tauri::command]
pub fn ai_reset_position(app: AppHandle, db: State<'_, Db>) -> Result<(), String> {
    db.setting_set("ai:position", "")?;
    if let Some(win) = app.get_webview_window("ai-palette") {
        if win.is_visible().unwrap_or(false) {
            if let Some(pos) = default_center_position(&win) {
                let _ = win.set_position(pos);
            }
        }
    }
    Ok(())
}

/// 隐藏 AI 面板窗口（ESC / 前端 invoke 调用）：隐藏前保存当前位置，下次打开记忆
#[tauri::command]
pub fn hide_ai_palette(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("ai-palette") {
        if let Ok(pos) = win.outer_position() {
            if let Some(db) = app.try_state::<Db>() {
                let _ = db.setting_set("ai:position", &format!("{},{}", pos.x, pos.y));
            }
        }
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{runtime::AiRuntime, types::ProviderKind};

    #[test]
    fn provider_mismatch_is_rejected() {
        assert!(validate_provider_selection(ProviderKind::CodexCli, "chat-api").is_err());
        assert_eq!(
            validate_provider_selection(ProviderKind::ChatApi, "chat-api").unwrap(),
            ProviderKind::ChatApi
        );
    }

    #[test]
    fn cancelled_or_replaced_request_fails_gate() {
        let runtime = AiRuntime::default();
        let a = runtime
            .register("A".to_string(), ProviderKind::CodexCli)
            .unwrap();
        runtime.cancel("A");
        runtime
            .register("B".to_string(), ProviderKind::ChatApi)
            .unwrap();
        assert!(guard_current(&runtime, &a).is_err());
    }

    #[test]
    fn response_serializes_backend_provider_kind() {
        let response = AiResponse {
            reply: "ok".to_string(),
            action: None,
            provider_used: ProviderKind::CodexCli,
        };
        let value = serde_json::to_value(response).unwrap();
        assert_eq!(value["providerUsed"], "codex-cli");
    }
}
