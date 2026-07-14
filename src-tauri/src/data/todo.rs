use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use uuid::Uuid;

use crate::storage::Db;

#[derive(Serialize, Deserialize, Clone)]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub priority: i64,
    pub due_at: Option<i64>,
    pub created_at: i64,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[tauri::command]
pub fn todo_list(db: State<Db>) -> Result<Vec<Todo>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, done, priority, due_at, created_at FROM todos ORDER BY done ASC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Todo {
                id: row.get(0)?,
                title: row.get(1)?,
                done: row.get::<_, i64>(2)? != 0,
                priority: row.get(3)?,
                due_at: row.get(4)?,
                created_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut todos = Vec::new();
    for row in rows {
        todos.push(row.map_err(|e| e.to_string())?);
    }
    Ok(todos)
}

#[tauri::command]
pub fn todo_create(
    title: String,
    priority: Option<i64>,
    due_at: Option<i64>,
    db: State<Db>,
) -> Result<Todo, String> {
    let id = Uuid::new_v4().to_string();
    let created_at = now_ts();
    let priority = priority.unwrap_or(0);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO todos (id, title, done, priority, due_at, created_at) VALUES (?1, ?2, 0, ?3, ?4, ?5)",
        params![id, title, priority, due_at, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(Todo {
        id,
        title,
        done: false,
        priority,
        due_at,
        created_at,
    })
}

#[tauri::command]
pub fn todo_update(
    id: String,
    title: Option<String>,
    done: Option<bool>,
    priority: Option<i64>,
    db: State<Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Some(t) = title {
        conn.execute("UPDATE todos SET title=?1 WHERE id=?2", params![t, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(d) = done {
        conn.execute(
            "UPDATE todos SET done=?1 WHERE id=?2",
            params![d as i64, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(p) = priority {
        conn.execute("UPDATE todos SET priority=?1 WHERE id=?2", params![p, id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn todo_delete(id: String, db: State<Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM todos WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
