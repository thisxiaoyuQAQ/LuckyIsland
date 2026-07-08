pub mod history;
pub mod prompt;
pub mod provider;
pub mod router;

pub use history::{ai_clear_history, ai_history_list};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};
use uuid::Uuid;

use crate::storage::Db;
use provider::Message;

#[derive(Serialize)]
pub struct ActionExec {
    pub action: String,
    pub args: serde_json::Value,
    pub success: bool,
    pub message: String,
}

#[derive(Serialize)]
pub struct AiResponse {
    pub reply: String,
    pub action: Option<ActionExec>,
}

/// AI 对话：history + message -> provider.chat -> 解析动作 -> router 执行 -> 返回 reply + 动作结果
#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
    message: String,
    history: Vec<Message>,
) -> Result<AiResponse, String> {
    let provider = provider::current_provider(db.inner(), http.inner())?;
    let system_prompt = prompt::build_system_prompt(db.inner());
    let mut hist = history;
    hist.push(Message {
        role: "user".into(),
        content: message.clone(),
    });
    crate::AI_LOADING.store(true, std::sync::atomic::Ordering::SeqCst);
    let raw = provider.chat(&hist, &system_prompt).await;
    crate::AI_LOADING.store(false, std::sync::atomic::Ordering::SeqCst);
    let raw = raw?;
    let parsed = router::parse_action(&raw);
    let (reply, action_exec) = match parsed {
        Some(a) => {
            let r = router::execute(&app, db.inner(), &a).await;
            let reply = r.message.clone();
            let exec = ActionExec {
                action: r.action,
                args: r.args,
                success: r.success,
                message: r.message,
            };
            (reply, Some(exec))
        }
        None => (raw.clone(), None),
    };
    let uid = Uuid::new_v4().to_string();
    let _ = db.ai_history_add(&uid, "user", &message);
    let aid = Uuid::new_v4().to_string();
    let _ = db.ai_history_add(&aid, "assistant", &reply);
    let _ = app.emit("ai://action-result", &action_exec);
    Ok(AiResponse {
        reply,
        action: action_exec,
    })
}

#[tauri::command]
pub async fn ai_switch_provider(
    app: AppHandle,
    db: State<'_, Db>,
    provider: String,
) -> Result<(), String> {
    db.setting_set("ai:provider", &provider)?;
    let _ = app.emit("ai://provider-changed", &provider);
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
        (Some(x), Some(y)) if x.trim().parse::<i32>().is_ok() && y.trim().parse::<i32>().is_ok() => {
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
        let pos = win
            .outer_position()
            .map_err(|e| e.to_string())?;
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
