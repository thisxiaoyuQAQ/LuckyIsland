use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

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
            );",
        )?;
        // 首次启动：播种默认自选股（贵州茅台 + 平安银行），方便即时实测
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM stock_watchlist", [], |r| r.get(0))?;
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
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get(0))
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
}

fn now_ts() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
