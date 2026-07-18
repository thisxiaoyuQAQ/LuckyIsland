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

/// 数据库 schema 的当前版本。每次结构变更 +1 并在此追加对应 migrate_vN 步骤。
/// v1：基线六表。v2：notifications.priority 列。
pub(crate) const SCHEMA_VERSION: u32 = 2;

/// v1：基线六表。全新库直接建成含 priority 的最终形态；
/// 已存在的旧库因 CREATE TABLE IF NOT EXISTS 不会动其结构（priority 由 v2 兜底补）。
fn migrate_v1_baseline(conn: &Connection) -> Result<(), String> {
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
    )
    .map_err(|error| error.to_string())
}

/// v2：为迁移前的旧 notifications 表补 priority 列（新库 v1 已含则跳过，幂等）。
fn migrate_v2_notification_priority(conn: &Connection) -> Result<(), String> {
    migrate_notifications(conn)
}

fn user_version(conn: &Connection) -> Result<u32, String> {
    conn.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))
        .map_err(|error| error.to_string())
}

fn set_user_version(conn: &Connection, version: u32) -> Result<(), String> {
    // PRAGMA 不支持参数绑定；version 来自本模块的整数常量，安全。
    conn.execute_batch(&format!("PRAGMA user_version = {version}"))
        .map_err(|error| error.to_string())
}

/// 一个迁移步骤：目标版本号 + 在该版事务内执行的结构变更。
type MigrationStep = (u32, fn(&Connection) -> Result<(), String>);

/// 全部迁移步骤，按版本升序。最后一版的版本号必须等于 SCHEMA_VERSION。
const MIGRATION_STEPS: &[MigrationStep] = &[
    (1, migrate_v1_baseline),
    (2, migrate_v2_notification_priority),
];

/// 逐版本把数据库迁移到 SCHEMA_VERSION。
///
/// 每一版先在其自身事务内执行结构变更（失败即回滚该版、user_version 不前进，
/// 下次从断点继续），提交后再在事务外推进 user_version（SQLite 不允许事务内写
/// user_version）。重复执行幂等：已是最新则什么都不做。
/// 库的 user_version 高于本代码的 SCHEMA_VERSION 时拒绝打开，避免旧版应用
/// 在不知晓新版结构的情况下静默读写、造成降级损坏。
pub(crate) fn run_migrations(conn: &Connection) -> Result<(), String> {
    debug_assert_eq!(
        MIGRATION_STEPS.last().map(|step| step.0),
        Some(SCHEMA_VERSION),
        "MIGRATION_STEPS 最后一版必须等于 SCHEMA_VERSION"
    );

    let current = user_version(conn)?;
    if current > SCHEMA_VERSION {
        return Err(format!(
            "数据库版本 {current} 高于应用支持的 {SCHEMA_VERSION}，请升级应用"
        ));
    }

    for &(version, step) in MIGRATION_STEPS {
        if version <= current {
            continue;
        }
        // 单连接、无嵌套事务：用 unchecked_transaction 以 &Connection 表达。
        let tx = conn
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        step(&tx)?;
        tx.commit().map_err(|error| error.to_string())?;
        set_user_version(conn, version)?;
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
        run_migrations(&conn).map_err(std::io::Error::other)?;
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

#[cfg(test)]
mod migration_tests {
    use super::{run_migrations, SCHEMA_VERSION};
    use rusqlite::Connection;

    fn user_version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    fn table_exists(conn: &Connection, name: &str) -> bool {
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
            > 0
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        names.iter().any(|n| n == column)
    }

    #[test]
    fn empty_database_gets_full_schema_and_current_version() {
        let conn = Connection::open_in_memory().unwrap();
        assert_eq!(user_version(&conn), 0);

        run_migrations(&conn).unwrap();

        for table in [
            "todos",
            "settings",
            "weather_cities",
            "stock_watchlist",
            "notifications",
            "ai_conversations",
        ] {
            assert!(table_exists(&conn, table), "missing table {table}");
        }
        assert!(column_exists(&conn, "notifications", "priority"));
        assert_eq!(user_version(&conn), SCHEMA_VERSION as i64);
    }

    #[test]
    fn legacy_database_without_priority_is_upgraded_and_data_preserved() {
        // 迁移前旧库：基线表都在，notifications 无 priority 列，含历史数据。
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0, due_at INTEGER, created_at INTEGER NOT NULL);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE weather_cities (city TEXT PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL);
             CREATE TABLE stock_watchlist (symbol TEXT PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL);
             CREATE TABLE notifications (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, source TEXT NOT NULL, level TEXT NOT NULL, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, action_type TEXT, action_cwd TEXT);
             CREATE TABLE ai_conversations (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
             INSERT INTO notifications (id,title,source,level,created_at) VALUES ('old','legacy','custom','error',1);
             INSERT INTO settings (key,value) VALUES ('general:theme','dark');",
        )
        .unwrap();
        assert_eq!(user_version(&conn), 0);
        assert!(!column_exists(&conn, "notifications", "priority"));

        run_migrations(&conn).unwrap();

        assert!(column_exists(&conn, "notifications", "priority"));
        assert_eq!(user_version(&conn), SCHEMA_VERSION as i64);
        // 旧数据保留，priority 用默认值。
        let priority: String = conn
            .query_row(
                "SELECT priority FROM notifications WHERE id='old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(priority, "normal");
        let theme: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='general:theme'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(theme, "dark");
    }

    #[test]
    fn running_migrations_twice_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        assert_eq!(user_version(&conn), SCHEMA_VERSION as i64);
        // priority 列只加一次（重复 ALTER 会报错，幂等要求第二次直接跳过）。
        assert!(column_exists(&conn, "notifications", "priority"));
    }

    #[test]
    fn partially_migrated_v1_database_only_applies_later_versions() {
        // 已是 v1：基线六表存在但 notifications 无 priority。
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0, due_at INTEGER, created_at INTEGER NOT NULL);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE weather_cities (city TEXT PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL);
             CREATE TABLE stock_watchlist (symbol TEXT PRIMARY KEY, sort INTEGER NOT NULL DEFAULT 0, added_at INTEGER NOT NULL);
             CREATE TABLE notifications (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, source TEXT NOT NULL, level TEXT NOT NULL, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, action_type TEXT, action_cwd TEXT);
             CREATE TABLE ai_conversations (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);
             PRAGMA user_version = 1;
             INSERT INTO notifications (id,title,source,level,created_at) VALUES ('n1','t','custom','info',1);",
        )
        .unwrap();
        assert_eq!(user_version(&conn), 1);

        run_migrations(&conn).unwrap();

        assert!(column_exists(&conn, "notifications", "priority"));
        assert_eq!(user_version(&conn), SCHEMA_VERSION as i64);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notifications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn already_current_database_is_untouched() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // 标记一行，确认二次运行不动数据。
        conn.execute("INSERT INTO settings (key, value) VALUES ('k', 'v')", [])
            .unwrap();
        run_migrations(&conn).unwrap();
        let value: String = conn
            .query_row("SELECT value FROM settings WHERE key='k'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(value, "v");
    }

    #[test]
    fn newer_database_than_app_is_rejected() {
        // 库来自更新版本的应用：拒绝打开，避免旧代码静默降级损坏数据。
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA user_version = 99;").unwrap();

        let result = run_migrations(&conn);
        assert!(result.is_err());
        let message = result.unwrap_err();
        assert!(
            message.contains("99"),
            "error should name the db version: {message}"
        );
        // 不前进、不改动：user_version 保持 99。
        assert_eq!(user_version(&conn), 99);
    }

    #[test]
    fn failed_version_rolls_back_and_does_not_advance_user_version() {
        // 模拟损坏的部分迁移：声称已是 v1，但 notifications 表缺失，
        // v2 的 ALTER 必然失败。要求：该版回滚、user_version 不前进、可诊断重试。
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             PRAGMA user_version = 1;",
        )
        .unwrap();
        assert_eq!(user_version(&conn), 1);

        let result = run_migrations(&conn);
        assert!(
            result.is_err(),
            "v2 should fail without notifications table"
        );
        // user_version 未前进：仍停在 1，下次可从断点重试。
        assert_eq!(user_version(&conn), 1);

        // 修复缺口（补上 notifications 表）后可续传到最新版本。
        conn.execute_batch(
            "CREATE TABLE notifications (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, source TEXT NOT NULL, level TEXT NOT NULL, created_at INTEGER NOT NULL, read INTEGER NOT NULL DEFAULT 0, action_type TEXT, action_cwd TEXT);",
        )
        .unwrap();
        run_migrations(&conn).unwrap();
        assert_eq!(user_version(&conn), SCHEMA_VERSION as i64);
        assert!(column_exists(&conn, "notifications", "priority"));
    }
}
