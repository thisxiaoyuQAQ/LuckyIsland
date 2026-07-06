use crate::storage::Db;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const TOKEN_KEY: &str = "notify:http_token";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotifyAction {
    #[serde(rename = "type")]
    pub action_type: String,
    pub cwd: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotifyInput {
    pub title: String,
    pub body: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_level")]
    pub level: String,
    pub action: Option<NotifyAction>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Notification {
    pub id: String,
    pub title: String,
    pub body: Option<String>,
    pub source: String,
    pub level: String,
    pub created_at: i64,
    pub read: bool,
    pub action: Option<NotifyAction>,
}

fn default_source() -> String {
    "custom".into()
}

fn default_level() -> String {
    "info".into()
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn normalize_source(s: &str) -> Result<String, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "claude" => Ok("claude".into()),
        "codex" => Ok("codex".into()),
        "custom" | "" => Ok("custom".into()),
        other => Err(format!("invalid source: {other}")),
    }
}

fn normalize_level(s: &str) -> Result<String, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "info" => Ok("info".into()),
        "success" => Ok("success".into()),
        "warn" | "warning" => Ok("warn".into()),
        "error" => Ok("error".into()),
        other => Err(format!("invalid level: {other}")),
    }
}

fn validate_input(input: NotifyInput) -> Result<NotifyInput, String> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err("title cannot be empty".into());
    }
    if title.chars().count() > 200 {
        return Err("title too long (max 200 chars)".into());
    }

    let body = input
        .body
        .map(|b| b.trim().to_string())
        .filter(|b| !b.is_empty());
    if body.as_ref().map(|b| b.chars().count()).unwrap_or(0) > 2000 {
        return Err("body too long (max 2000 chars)".into());
    }

    let action = input.action.and_then(|a| {
        let cwd = a.cwd.trim().to_string();
        if a.action_type == "open_terminal" && !cwd.is_empty() {
            Some(NotifyAction {
                action_type: "open_terminal".into(),
                cwd,
            })
        } else {
            None
        }
    });

    Ok(NotifyInput {
        title,
        body,
        source: normalize_source(&input.source)?,
        level: normalize_level(&input.level)?,
        action,
    })
}

pub fn ensure_http_token(db: &Db) -> Result<String, String> {
    if let Ok(t) = std::env::var("LUCKY_TOKEN") {
        let t = t.trim().to_string();
        if !t.is_empty() {
            db.setting_set(TOKEN_KEY, &t)?;
            return Ok(t);
        }
    }
    if let Some(t) = db.setting_get(TOKEN_KEY) {
        if !t.trim().is_empty() {
            return Ok(t);
        }
    }
    let token = Uuid::new_v4().to_string();
    db.setting_set(TOKEN_KEY, &token)?;
    Ok(token)
}

fn insert_notification(db: &Db, input: NotifyInput) -> Result<Notification, String> {
    let input = validate_input(input)?;
    let id = Uuid::new_v4().to_string();
    let created_at = now_ts();
    let action_type = input.action.as_ref().map(|a| a.action_type.clone());
    let action_cwd = input.action.as_ref().map(|a| a.cwd.clone());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO notifications (id,title,body,source,level,created_at,read,action_type,action_cwd)
         VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8)",
        params![
            id,
            input.title,
            input.body,
            input.source,
            input.level,
            created_at,
            action_type,
            action_cwd
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(Notification {
        id,
        title: input.title,
        body: input.body,
        source: input.source,
        level: input.level,
        created_at,
        read: false,
        action: input.action,
    })
}

pub fn list_notifications(db: &Db, limit: Option<i64>) -> Result<Vec<Notification>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id,title,body,source,level,created_at,read,action_type,action_cwd
             FROM notifications ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| {
            let action_type: Option<String> = row.get(7)?;
            let action_cwd: Option<String> = row.get(8)?;
            let action = match (action_type, action_cwd) {
                (Some(action_type), Some(cwd)) if action_type == "open_terminal" => {
                    Some(NotifyAction { action_type, cwd })
                }
                _ => None,
            };
            Ok(Notification {
                id: row.get(0)?,
                title: row.get(1)?,
                body: row.get(2)?,
                source: row.get(3)?,
                level: row.get(4)?,
                created_at: row.get(5)?,
                read: row.get::<_, i64>(6)? != 0,
                action,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn mark_read(db: &Db, id: Option<String>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Some(id) = id {
        conn.execute("UPDATE notifications SET read=1 WHERE id=?1", params![id])
            .map_err(|e| e.to_string())?;
    } else {
        conn.execute("UPDATE notifications SET read=1", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn dispatch_notification(
    app: &AppHandle,
    db: &Db,
    input: NotifyInput,
) -> Result<Notification, String> {
    let n = insert_notification(db, input)?;
    let _ = app.emit("notify://incoming", n.clone());
    let _ = app.emit("window://state-changed", "expanded".to_string());
    if let Some(window) = app.get_webview_window("island") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(n)
}

#[tauri::command]
pub fn notify_list(limit: Option<i64>, db: State<'_, Db>) -> Result<Vec<Notification>, String> {
    list_notifications(&db, limit)
}

#[tauri::command]
pub fn notify_mark_read(id: Option<String>, db: State<'_, Db>) -> Result<(), String> {
    mark_read(&db, id)
}

#[tauri::command]
pub fn notify_create(
    app: AppHandle,
    input: NotifyInput,
    db: State<'_, Db>,
) -> Result<Notification, String> {
    dispatch_notification(&app, &db, input)
}

#[tauri::command]
pub fn notify_get_token(db: State<'_, Db>) -> Result<String, String> {
    ensure_http_token(&db)
}
