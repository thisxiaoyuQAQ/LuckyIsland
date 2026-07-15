use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug)]
struct NotificationColumn {
    name: String,
    #[cfg(test)]
    not_null: bool,
    #[cfg(test)]
    default_value: Option<String>,
}

fn notification_columns(conn: &Connection) -> Result<Vec<NotificationColumn>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(notifications)")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NotificationColumn {
                name: row.get(1)?,
                #[cfg(test)]
                not_null: row.get::<_, i64>(3)? != 0,
                #[cfg(test)]
                default_value: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn migrate_notifications(conn: &Connection) -> Result<(), String> {
    if !notification_columns(conn)?
        .iter()
        .any(|column| column.name == "priority")
    {
        conn.execute(
            "ALTER TABLE notifications ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'",
            [],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn init(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("data.db");
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                priority INTEGER NOT NULL DEFAULT 0,
                due_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS weather_cities (
                city TEXT PRIMARY KEY,
                sort INTEGER NOT NULL DEFAULT 0,
                added_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS stock_watchlist (
                symbol TEXT PRIMARY KEY,
                sort INTEGER NOT NULL DEFAULT 0,
                added_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT,
                source TEXT NOT NULL,
                level TEXT NOT NULL,
                priority TEXT NOT NULL DEFAULT 'normal',
                created_at INTEGER NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                action_type TEXT,
                action_cwd TEXT
            );
            CREATE TABLE IF NOT EXISTS ai_conversations (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );",
        )?;
        migrate_notifications(&conn).map_err(std::io::Error::other)?;
        // 首次启动：播种默认自选股（贵州茅台 + 平安银行），方便即时实测
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM stock_watchlist", [], |r| r.get(0))?;
        if count == 0 {
            let now = now_ts();
            conn.execute(
                "INSERT INTO stock_watchlist (symbol, sort, added_at) VALUES ('sh600519', 0, ?1)",
                params![now],
            )?;
            conn.execute(
                "INSERT INTO stock_watchlist (symbol, sort, added_at) VALUES ('sz000001', 1, ?1)",
                params![now],
            )?;
        }
        Ok(Db(Mutex::new(conn)))
    }

    /// 读取一个 settings KV（M3 用于天气城市 / 天气缓存 / 股票缓存）
    pub fn setting_get(&self, key: &str) -> Option<String> {
        let conn = self.0.lock().ok()?;
        conn.query_row(
            "SELECT value FROM settings WHERE key=?1",
            params![key],
            |r| r.get(0),
        )
        .ok()
    }

    /// 写入（覆盖）一个 settings KV
    pub fn setting_set(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 删除一个 settings KV
    pub fn setting_delete(&self, key: &str) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM settings WHERE key=?1", params![key])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// 批量读 settings：key 以 `prefix` 开头的全部 (key, value)。M7 设置面板初始化用。
    pub fn settings_list_prefix(&self, prefix: &str) -> Result<Vec<(String, String)>, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings WHERE key LIKE ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![format!("{}%", prefix)], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// AI 对话历史：追加一条（id 用 uuid，role=user/assistant，content 文本/JSON）
    pub fn ai_history_add(&self, id: &str, role: &str, content: &str) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO ai_conversations (id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, role, content, now_ts()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// AI 对话历史：最近 limit 条，按时间升序返回（旧->新）
    pub fn ai_history_list(&self, limit: i64) -> Result<Vec<(String, String, String)>, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT role, content, created_at FROM ai_conversations ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?.to_string(),
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out: Vec<(String, String, String)> = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        out.reverse();
        Ok(out)
    }

    /// AI 对话历史：清空
    pub fn ai_history_clear(&self) -> Result<(), String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ai_conversations", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ---- 07a 配置导入导出：读三表 / 全量覆盖三表 ----

    /// settings 中可安全跨机迁移的用户配置。
    /// 明确排除 notify:http_token、ai:chat_api_key、weather:last/stock:last 缓存、
    /// ai:position 等机器或运行时数据，避免把密钥写进导出文件或导入时删掉本机 token。
    fn is_portable_setting(key: &str) -> bool {
        key.starts_with("pages:")
            || key.starts_with("general:")
            || key.starts_with("terminal:")
            || key.starts_with("window:")
            || key.starts_with("wake:")
            || key.starts_with("hotkeys:")
            || key == "update:auto_check"
            || key.starts_with("weather:location:")
            || (key.starts_with("time:") && !key.starts_with("time:data:"))
            || matches!(
                key,
                "notify:filter_sources"
                    | "weather:refresh_min"
                    | "weather:city"
                    | "weather:compact_city"
                    | "stock:red_up"
                    | "ai:provider"
                    | "ai:thinking"
                    | "ai:claude_cli_path"
                    | "ai:claude_cli_model"
                    | "ai:codex_cli_path"
                    | "ai:chat_api_base_url"
                    | "ai:chat_api_model"
            )
    }

    /// 可安全迁移的 settings → (key, value) 列表（配置导入导出用）。
    pub fn settings_portable(&self) -> Result<Vec<(String, String)>, String> {
        Ok(self
            .settings_all()?
            .into_iter()
            .filter(|(key, _)| Self::is_portable_setting(key))
            .collect())
    }

    /// settings 全表 → (key, value) 列表（仅用于内部比较/保留非迁移数据）。
    pub fn settings_all(&self) -> Result<Vec<(String, String)>, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// 导出用：stock_watchlist 全表 → (symbol, sort, added_at)
    pub fn watchlist_all(&self) -> Result<Vec<(String, i64, i64)>, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT symbol, sort, added_at FROM stock_watchlist ORDER BY sort ASC, added_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// 导出用：weather_cities 全表 → (city, sort, added_at)
    pub fn weather_cities_all(&self) -> Result<Vec<(String, i64, i64)>, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT city, sort, added_at FROM weather_cities ORDER BY sort ASC, added_at ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// 导入用：在一个事务内覆盖「可迁移 settings」+ 全量覆盖 stock_watchlist/weather_cities。
    /// 本机密钥、token、缓存等非迁移 settings 原样保留；迁移配置先删后写，任一步失败回滚整批。
    pub fn config_replace_all(
        &self,
        settings: &[(String, String)],
        watchlist: &[(String, i64, i64)],
        cities: &[(String, i64, i64)],
    ) -> Result<(), String> {
        if settings
            .iter()
            .any(|(key, _)| !Self::is_portable_setting(key))
        {
            return Err("配置文件包含不允许导入的设置项".to_string());
        }
        let mut conn = self.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let existing_keys = {
            let mut stmt = tx
                .prepare("SELECT key FROM settings")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            let mut keys = Vec::new();
            for row in rows {
                keys.push(row.map_err(|e| e.to_string())?);
            }
            keys
        };
        for key in existing_keys
            .into_iter()
            .filter(|key| Self::is_portable_setting(key))
        {
            tx.execute("DELETE FROM settings WHERE key=?1", params![key])
                .map_err(|e| e.to_string())?;
        }
        tx.execute_batch("DELETE FROM stock_watchlist; DELETE FROM weather_cities;")
            .map_err(|e| e.to_string())?;
        for (k, v) in settings {
            tx.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)",
                params![k, v],
            )
            .map_err(|e| e.to_string())?;
        }
        for (symbol, sort, added_at) in watchlist {
            tx.execute(
                "INSERT INTO stock_watchlist (symbol, sort, added_at) VALUES (?1, ?2, ?3)",
                params![symbol, sort, added_at],
            )
            .map_err(|e| e.to_string())?;
        }
        for (city, sort, added_at) in cities {
            tx.execute(
                "INSERT INTO weather_cities (city, sort, added_at) VALUES (?1, ?2, ?3)",
                params![city, sort, added_at],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn now_ts() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod portable_tests {
    use super::{migrate_notifications, notification_columns};
    use crate::storage::Db;
    use rusqlite::Connection;

    #[test]
    fn time_settings_portable_but_data_not() {
        assert!(Db::is_portable_setting("time:layout"));
        assert!(Db::is_portable_setting("time:appearance"));
        assert!(Db::is_portable_setting("time:widget:saying"));
        assert!(!Db::is_portable_setting("time:data:saying:last"));
        assert!(!Db::is_portable_setting("time:data:wooden_fish"));
        assert!(!Db::is_portable_setting("time:data:mood:2026-07-12"));
    }

    #[test]
    fn notifications_priority_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notifications (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT,
                source TEXT NOT NULL,
                level TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                action_type TEXT,
                action_cwd TEXT
            );
            INSERT INTO notifications (id,title,source,level,created_at)
            VALUES ('old','legacy','custom','error',1);",
        )
        .unwrap();

        migrate_notifications(&conn).unwrap();
        migrate_notifications(&conn).unwrap();

        let columns = notification_columns(&conn).unwrap();
        assert_eq!(
            columns
                .iter()
                .filter(|column| column.name == "priority")
                .count(),
            1
        );
        let priority = columns
            .iter()
            .find(|column| column.name == "priority")
            .unwrap();
        assert!(priority.not_null);
        assert_eq!(priority.default_value.as_deref(), Some("'normal'"));
        assert_eq!(
            conn.query_row(
                "SELECT priority FROM notifications WHERE id='old'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
            "normal"
        );
    }

    #[test]
    fn weather_location_mapping_is_portable_but_cache_is_not() {
        assert!(Db::is_portable_setting("weather:location:无锡"));
        assert!(!Db::is_portable_setting("weather:cache:open-meteo:1790923"));
        assert!(!Db::is_portable_setting("weather:last"));
    }

    #[test]
    fn hotkeys_settings_portable() {
        // 自定义热键随配置导出/导入；密钥/运行时数据仍被排除。
        assert!(Db::is_portable_setting("hotkeys:toggle_island"));
        assert!(Db::is_portable_setting("hotkeys:toggle_ai"));
        assert!(Db::is_portable_setting("hotkeys:toggle_click_through"));
        assert!(Db::is_portable_setting("window:click_through"));
        assert!(Db::is_portable_setting("window:hide_in_fullscreen"));
        assert!(Db::is_portable_setting("update:auto_check"));
        assert!(!Db::is_portable_setting("notify:http_token"));
        assert!(!Db::is_portable_setting("ai:chat_api_key"));
    }
}
