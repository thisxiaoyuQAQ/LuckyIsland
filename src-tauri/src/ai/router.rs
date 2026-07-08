use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::storage::Db;

#[derive(Debug, Deserialize, Clone)]
pub struct Action {
    pub action: String,
    pub args: serde_json::Value,
}

#[derive(Serialize, Clone)]
pub struct ActionResult {
    pub action: String,
    pub args: serde_json::Value,
    pub success: bool,
    pub message: String,
}

/// 解析 AI 输出为动作：严格 JSON -> ```json``` 代码块 -> 首个 {...} -> None（当 reply 处理）
pub fn parse_action(raw: &str) -> Option<Action> {
    let trimmed = raw.trim();
    if let Ok(a) = serde_json::from_str::<Action>(trimmed) {
        return Some(a);
    }
    // ```json ... ``` 或 ``` ... ``` 代码块
    for marker in ["```json", "```"] {
        if let Some(start) = trimmed.find(marker) {
            let after = &trimmed[start + marker.len()..];
            if let Some(end) = after.find("```") {
                if let Ok(a) = serde_json::from_str::<Action>(after[..end].trim()) {
                    return Some(a);
                }
            }
        }
    }
    // 首个 { 到末个 }
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end > start {
        if let Ok(a) = serde_json::from_str::<Action>(&trimmed[start..=end]) {
            return Some(a);
        }
    }
    None
}

/// 执行动作（reply/add_todo；不含任何操控灵动岛窗口或打开外部浏览器的动作，见 prompt.rs 说明）。
/// `_app` 暂未用到（add_todo 不需要），保留给未来 open_external/notify 等非灵动岛动作用。
pub async fn execute(_app: &AppHandle, db: &Db, action: &Action) -> ActionResult {
    match action.action.as_str() {
        "reply" => {
            let text = action
                .args
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            ok(action, text)
        }
        "add_todo" => {
            let title = action
                .args
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if title.is_empty() {
                return err(action, "标题不能为空".to_string());
            }
            let id = uuid::Uuid::new_v4().to_string();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            match db.0.lock() {
                Ok(conn) => match conn.execute(
                    "INSERT INTO todos (id, title, done, priority, due_at, created_at) VALUES (?1, ?2, 0, 0, NULL, ?3)",
                    rusqlite::params![id, title, now],
                ) {
                    Ok(_) => ok(action, format!("已添加待办：{title}")),
                    Err(e) => err(action, format!("添加失败：{e}")),
                },
                Err(e) => err(action, format!("DB 锁失败：{e}")),
            }
        }
        other => err(action, format!("未知动作：{other}")),
    }
}

fn ok(action: &Action, message: String) -> ActionResult {
    ActionResult {
        action: action.action.clone(),
        args: action.args.clone(),
        success: true,
        message,
    }
}

fn err(action: &Action, message: String) -> ActionResult {
    ActionResult {
        action: action.action.clone(),
        args: action.args.clone(),
        success: false,
        message,
    }
}
