//! 设置面板窗口控制 + settings KV 增强命令（M7）。
//!
//! 设置窗口在 `tauri.conf.json` 静态声明（label="settings"，visible:false），
//! `open_settings` 只 show+聚焦；关闭按钮由 `lib.rs` 的 `on_window_event` 改为 hide，
//! 避免销毁后重复创建、保证全局单例。
//!
//! 不动 `settings.rs`（M3 勿动文件）：新增 `setting_set_and_emit` 在写 KV 后
//! 广播 `settings://changed { key, value }`，原 `setting_set` 保持不动供 notify 等复用。

use serde::Serialize;
use tauri::{Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::monitor::{OFFSET_X_KEY, OFFSET_Y_KEY};
use crate::storage::Db;

/// `settings://changed` 事件载荷
#[derive(Serialize, Clone)]
pub struct SettingsChanged {
    pub key: String,
    pub value: Option<String>,
}

/// 07a 导入结果摘要：覆盖的 settings / 自选股 / 天气城市条数。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub settings: usize,
    pub watchlist: usize,
    pub cities: usize,
    pub needs_offset_apply: bool,
}

/// 导出 JSON 结构。version 固定 1，schema 升级时再 bump。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportPayload<'a> {
    version: u32,
    app: &'a str,
    exported_at: &'a str,
    settings: std::collections::BTreeMap<String, String>,
    stock_watchlist: Vec<StockRow>,
    weather_cities: Vec<CityRow>,
}

#[derive(Serialize)]
struct StockRow {
    symbol: String,
    sort: i64,
}

#[derive(Serialize)]
struct CityRow {
    city: String,
    sort: i64,
}

/// 导入 JSON 结构（反序列化用，字段宽容：缺 stockWatchlist/weatherCities 视为空）。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportPayload {
    version: u32,
    settings: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    stock_watchlist: Vec<ImportStockRow>,
    #[serde(default)]
    weather_cities: Vec<ImportCityRow>,
}

#[derive(serde::Deserialize)]
struct ImportStockRow {
    symbol: String,
    sort: i64,
}

#[derive(serde::Deserialize)]
struct ImportCityRow {
    city: String,
    sort: i64,
}

/// 打开设置面板窗口：静态窗口 show + 聚焦（CloseRequested 在 lib.rs 改为 hide）。
#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("settings") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 批量读 settings：key 以 `prefix` 开头的全部 (key, value)。设置面板初始化用。
#[tauri::command]
pub fn settings_list(prefix: String, db: State<'_, Db>) -> Result<Vec<(String, String)>, String> {
    db.settings_list_prefix(&prefix)
}

/// 写一个 settings KV（None=删除）并广播 `settings://changed { key, value }`。
#[tauri::command]
pub fn setting_set_and_emit(
    app: tauri::AppHandle,
    key: String,
    value: Option<String>,
    db: State<'_, Db>,
) -> Result<(), String> {
    match &value {
        Some(v) => db.setting_set(&key, v)?,
        None => db.setting_delete(&key)?,
    }
    app.emit(
        "settings://changed",
        SettingsChanged {
            key: key.clone(),
            value: value.clone(),
        },
    )
    .map_err(|e| e.to_string())
}

/// 开/关开机自启（tauri-plugin-autostart）。
#[tauri::command]
pub fn autostart_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())
    } else {
        mgr.disable().map_err(|e| e.to_string())
    }
}

/// 查询当前开机自启是否启用。
#[tauri::command]
pub fn autostart_get(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// 07a 导出配置：把可安全迁移的 settings + stock_watchlist + weather_cities 序列化为 JSON 写入 `path`。
/// `exported_at` 由前端拼好传入（ISO 字符串），避免后端取系统时间。
#[tauri::command]
pub fn config_export(
    path: String,
    exported_at: String,
    db: State<'_, Db>,
) -> Result<(), String> {
    let settings = db.settings_portable()?;
    let watchlist = db.watchlist_all()?;
    let cities = db.weather_cities_all()?;
    let payload = ExportPayload {
        version: 1,
        app: "com.luckyisland.app",
        exported_at: &exported_at,
        settings: settings.into_iter().collect(),
        stock_watchlist: watchlist
            .into_iter()
            .map(|(symbol, sort, _)| StockRow { symbol, sort })
            .collect(),
        weather_cities: cities
            .into_iter()
            .map(|(city, sort, _)| CityRow { city, sort })
            .collect(),
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("写入导出文件失败：{e}"))
}

/// 07a 导入配置：读 `path` JSON → 校验 version=1 → 事务内全量覆盖三表 →
/// 逐条 emit `settings://changed` 让各页重算 → 返回覆盖条数。
/// `needs_offset_apply=true` 表示导出含 window:offset_x/y，前端需额外触发
/// `window_offset_apply` 让窗口真正上屏（本命令只改数据不移动窗口）。
#[tauri::command]
pub fn config_import(
    app: tauri::AppHandle,
    path: String,
    db: State<'_, Db>,
) -> Result<ImportSummary, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取导入文件失败：{e}"))?;
    let payload: ImportPayload =
        serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败（不是有效 JSON 或格式不符）：{e}"))?;
    if payload.version != 1 {
        return Err(format!(
            "配置文件版本不兼容（期望 1，实际 {}）；该文件可能由更新版本导出。",
            payload.version
        ));
    }

    let mut settings_vec: Vec<(String, String)> = payload.settings.into_iter().collect();
    // 排序只为输出条数稳定，不影响语义
    settings_vec.sort_by(|a, b| a.0.cmp(&b.0));
    let watchlist_vec: Vec<(String, i64, i64)> = payload
        .stock_watchlist
        .into_iter()
        .map(|r| (r.symbol, r.sort, 0))
        .collect();
    let cities_vec: Vec<(String, i64, i64)> = payload
        .weather_cities
        .into_iter()
        .map(|r| (r.city, r.sort, 0))
        .collect();

    let old_settings = db.settings_portable()?;
    let old_keys = old_settings
        .iter()
        .map(|(key, _)| key.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let new_keys = settings_vec
        .iter()
        .map(|(key, _)| key.clone())
        .collect::<std::collections::BTreeSet<_>>();
    let needs_offset_apply = old_keys.contains(OFFSET_X_KEY)
        || old_keys.contains(OFFSET_Y_KEY)
        || new_keys.contains(OFFSET_X_KEY)
        || new_keys.contains(OFFSET_Y_KEY);
    let needs_hotkeys_apply = old_keys.iter().any(|k| k.starts_with("hotkeys:"))
        || new_keys.iter().any(|k| k.starts_with("hotkeys:"));

    let settings_count = settings_vec.len();
    let watchlist_count = watchlist_vec.len();
    let cities_count = cities_vec.len();
    db.config_replace_all(&settings_vec, &watchlist_vec, &cities_vec)?;

    // 逐条广播 settings://changed，让灵动岛各页即时按导入值重算。
    // 对旧表中存在、导入文件中缺失的 key 额外广播 value=None，确保运行中的 UI
    // 不会继续保留已被全量覆盖删除的旧值。
    for key in old_keys.difference(&new_keys) {
        let _ = app.emit(
            "settings://changed",
            SettingsChanged {
                key: key.clone(),
                value: None,
            },
        );
    }
    for (key, value) in &settings_vec {
        let _ = app.emit(
            "settings://changed",
            SettingsChanged {
                key: key.clone(),
                value: Some(value.clone()),
            },
        );
    }

    let summary = ImportSummary {
        settings: settings_count,
        watchlist: watchlist_count,
        cities: cities_count,
        needs_offset_apply,
    };
    let _ = app.emit("config://imported", summary.clone());

    // 热键绑定可能被导入覆盖：spawn 到 worker 线程重新注册。apply 内部 marshal 到
    // 主线程，不能在本 sync 命令的主线程上下文直接调（会死锁）；worker 线程阻塞等
    // 主线程执行即可。未触及 hotkeys: 时不做无谓重注册。
    if needs_hotkeys_apply {
        let hk_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let db = hk_app.state::<crate::storage::Db>();
            let _ = crate::hotkeys::apply(&hk_app, db.inner());
        });
    }

    Ok(summary)
}
