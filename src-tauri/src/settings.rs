use tauri::State;

use crate::storage::Db;

/// 通用 settings KV：供前端持久化轻量选择（如紧凑态显示的城市/个股）。
/// M6 config.toml 落地前作为过渡存储。
#[tauri::command]
pub fn setting_get(key: String, db: State<'_, Db>) -> Result<Option<String>, String> {
    Ok(db.setting_get(&key))
}

/// value = Some → 写入；value = None → 删除
#[tauri::command]
pub fn setting_set(key: String, value: Option<String>, db: State<'_, Db>) -> Result<(), String> {
    match value {
        Some(v) => db.setting_set(&key, &v),
        None => db.setting_delete(&key),
    }
}
