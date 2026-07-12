use tauri::State;

use crate::storage::Db;

#[tauri::command]
pub fn ai_history_list(
    db: State<'_, Db>,
    limit: Option<i64>,
) -> Result<Vec<(String, String, String)>, String> {
    db.ai_history_list(limit.unwrap_or(100).clamp(1, 1000))
}

#[tauri::command]
pub fn ai_clear_history(db: State<'_, Db>) -> Result<(), String> {
    db.ai_history_clear()
}
