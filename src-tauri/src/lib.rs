mod ai;
mod data;
mod notify;
mod settings;
mod settings_window;
mod storage;
mod terminal;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, PhysicalPosition, Size, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use data::calendar::calendar_month;
use data::stock::{
    poll_loop, stock_get, stock_kline, stock_search, stock_watchlist_add, stock_watchlist_list,
    stock_watchlist_remove, stock_watchlist_reorder,
};
use data::todo::{todo_create, todo_delete, todo_list, todo_update};
use data::weather::{
    weather_cities_add, weather_cities_list, weather_cities_remove, weather_cities_reorder,
    weather_get, weather_get_city, weather_locate, weather_set_city,
};
use notify::{notify_create, notify_get_token, notify_list, notify_mark_read};
use settings::{setting_get, setting_set};
use settings_window::{autostart_get, autostart_set, open_settings, setting_set_and_emit, settings_list};
use ai::{
    ai_chat, ai_clear_history, ai_get_position, ai_history_list, ai_reset_position,
    ai_save_position, ai_switch_provider, hide_ai_palette, open_ai_palette,
};
use terminal::{term_create, term_kill, term_open_wt, term_resize, term_snapshot, term_write, TerminalRegistry};

use std::sync::atomic::AtomicBool;

/// AI 思考中标志：ai_chat 期间 true，on_window_event 据此不隐藏 ai-palette
pub static AI_LOADING: AtomicBool = AtomicBool::new(false);

const WIN_W: f64 = 720.0;
const COMPACT_H: f64 = 80.0;
const EXPANDED_H: f64 = 400.0;

/// 把窗口定位到当前显示器顶部居中（顶部留 16px）
fn position_top_center(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.current_monitor()? {
        let msize = monitor.size();
        let mpos = monitor.position();
        let wsize = window.outer_size()?;
        let x = mpos.x + ((msize.width as i32 - wsize.width as i32) / 2);
        let y = mpos.y + 16;
        window.set_position(PhysicalPosition { x, y })?;
    }
    Ok(())
}

/// 应用状态：调整窗口尺寸与可见性
fn apply_state(window: &tauri::WebviewWindow, state: &str) -> tauri::Result<()> {
    match state {
        "hidden" => window.hide()?,
        "compact" => {
            window.set_size(Size::Logical(LogicalSize {
                width: WIN_W,
                height: COMPACT_H,
            }))?;
            window.show()?;
            window.set_focus()?;
        }
        "expanded" => {
            window.set_size(Size::Logical(LogicalSize {
                width: WIN_W,
                height: EXPANDED_H,
            }))?;
            window.show()?;
            window.set_focus()?;
        }
        _ => {}
    }
    Ok(())
}

/// 改状态并通知前端
fn set_state_and_emit(app: &tauri::AppHandle, state: &str) {
    if let Some(window) = app.get_webview_window("island") {
        let _ = apply_state(&window, state);
    }
    let _ = app.emit("window://state-changed", state.to_string());
}

/// Alt+X / 托盘：在 hidden ↔ compact 间切换
fn toggle_visibility(app: &tauri::AppHandle) {
    let visible = app
        .get_webview_window("island")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    set_state_and_emit(app, if visible { "hidden" } else { "compact" });
}

/// Alt+Space / 托盘「AI 助手」：面板已显示则关闭（同 ESC，保存位置），否则打开
fn toggle_ai_palette(app: &tauri::AppHandle) {
    let visible = app
        .get_webview_window("ai-palette")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    if visible {
        let _ = hide_ai_palette(app.clone());
    } else {
        let _ = open_ai_palette(app.clone());
    }
}

#[tauri::command]
fn set_island_state(app: tauri::AppHandle, state: String) -> Result<(), String> {
    set_state_and_emit(&app, &state);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例：重复启动时唤起已有窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            set_state_and_emit(app, "compact");
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // 开机自启（M7 设置面板）
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        // 设置窗口点关闭改为隐藏（保持单例，避免销毁后重建）
        // ai-palette 不做失焦自动隐藏：顶部拖动区域会触发焦点变化，失焦隐藏会导致点击标题栏即关闭。
        // AI 面板改为仅 ESC / 显式 hide 关闭，拖动位置由 hide_ai_palette 保存。
        .on_window_event(|window, event| match window.label() {
            "settings" => {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        // 全局热键
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if shortcut == &Shortcut::new(Some(Modifiers::ALT), Code::Space) {
                            toggle_ai_palette(app);
                        } else {
                            toggle_visibility(app);
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_island_state,
            todo_list,
            todo_create,
            todo_update,
            todo_delete,
            calendar_month,
            weather_get,
            weather_get_city,
            weather_set_city,
            weather_locate,
            weather_cities_list,
            weather_cities_add,
            weather_cities_remove,
            weather_cities_reorder,
            stock_get,
            stock_search,
            stock_kline,
            stock_watchlist_list,
            stock_watchlist_add,
            stock_watchlist_remove,
            stock_watchlist_reorder,
            setting_get,
            setting_set,
            settings_list,
            setting_set_and_emit,
            open_settings,
            autostart_set,
            autostart_get,
            ai_chat,
            ai_switch_provider,
            ai_history_list,
            ai_clear_history,
            open_ai_palette,
            hide_ai_palette,
            ai_save_position,
            ai_get_position,
            ai_reset_position,
            notify_list,
            notify_mark_read,
            notify_create,
            notify_get_token,
            term_create,
            term_write,
            term_resize,
            term_snapshot,
            term_kill,
            term_open_wt
        ])
        .setup(|app| {
            // 注册全局热键：Alt+X 切换灵动岛，Alt+Space 唤起 AI 面板
            app.global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT), Code::KeyX))?;
            app.global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT), Code::Space))?;

            // 系统托盘
            let show_item = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置...", true, None::<&str>)?;
            let ai_item = MenuItem::with_id(app, "ai", "AI 助手", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &settings_item, &ai_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("missing default window icon"),
                )
                .menu(&menu)
                .tooltip("LuckyIsland")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_visibility(app),
                    "settings" => {
                        let _ = open_settings(app.clone());
                    }
                    "ai" => toggle_ai_palette(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_visibility(tray.app_handle());
                    }
                })
                .build(app)?;

            // 初始化 SQLite（%APPDATA%/com.luckyisland.app/data.db）
            let db = storage::Db::init(app.handle())?;
            let default_state = db
                .setting_get("general:default_state")
                .filter(|s| matches!(s.as_str(), "hidden" | "compact" | "expanded"))
                .unwrap_or_else(|| "compact".to_string());
            app.manage(db);

            // 共享 HTTP 客户端（天气 / 股票拉取复用）
            let http = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (compatible; LuckyIsland/0.1)")
                .build()?;
            app.manage(http);

            // 股票行情后台轮询：交易时段 5s / 非交易 30s，emit stock://tick
            tauri::async_runtime::spawn(poll_loop(app.handle().clone()));

            // 终端注册表（多 tab PTY 管理）
            app.manage(TerminalRegistry::new());

            // 本地通知 HTTP server：127.0.0.1:9753/notify
            let notify_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                notify::server::start(notify_app).await;
            });

            // 定位到顶部居中，并按设置面板的启动默认态显示
            if let Some(window) = app.get_webview_window("island") {
                let _ = position_top_center(&window);
                let _ = apply_state(&window, &default_state);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 退出时杀掉所有终端子进程，避免僵尸
            if let tauri::RunEvent::Exit = event {
                if let Some(reg) = app_handle.try_state::<TerminalRegistry>() {
                    terminal::cleanup_all(reg.inner());
                }
            }
        });
}
