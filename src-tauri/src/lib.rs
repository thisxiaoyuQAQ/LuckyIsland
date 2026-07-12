mod ai;
mod data;
mod monitor;
mod notify;
mod settings;
mod settings_window;
mod storage;
mod terminal;
mod voice;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, Size, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use ai::{
    ai_cancel, ai_chat, ai_clear_history, ai_get_position, ai_history_list, ai_reset_position,
    ai_save_position, ai_switch_provider, hide_ai_palette, open_ai_palette, runtime::AiRuntime,
};
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
use data::time_api::{time_programmer_history_get, time_saying_get};
use monitor::{
    monitor_get_selection, monitor_list, monitor_select, restore_island_monitor,
    start_runtime_watch, window_offset_apply, ISLAND_WIDTH_LOGICAL,
};
use notify::{notify_create, notify_get_token, notify_list, notify_mark_read};
use settings::{setting_get, setting_set};
use settings_window::{
    autostart_get, autostart_set, config_export, config_import, open_settings,
    setting_set_and_emit, settings_list,
};
use terminal::{
    term_create, term_kill, term_open_wt, term_resize, term_snapshot, term_write, TerminalRegistry,
};
use voice::{
    voice_asr_model_ready, voice_download_model, voice_model_ready, voice_record_utterance,
    voice_reload_keyword, voice_start_listening, voice_stop_listening, voice_validate_keyword,
    VoiceState,
};

const COMPACT_H: f64 = 80.0;
const EXPANDED_H: f64 = 400.0;

/// 应用状态：调整窗口尺寸与可见性
fn apply_state(window: &tauri::WebviewWindow, state: &str) -> tauri::Result<()> {
    match state {
        "hidden" => window.hide()?,
        "compact" => {
            window.set_size(Size::Logical(LogicalSize {
                width: ISLAND_WIDTH_LOGICAL,
                height: COMPACT_H,
            }))?;
            window.show()?;
            window.set_focus()?;
        }
        "expanded" => {
            window.set_size(Size::Logical(LogicalSize {
                width: ISLAND_WIDTH_LOGICAL,
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
        .plugin(tauri_plugin_dialog::init())
        // 开机自启（M7 设置面板）
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
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
            monitor_list,
            monitor_get_selection,
            monitor_select,
            window_offset_apply,
            config_export,
            config_import,
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
            time_saying_get,
            time_programmer_history_get,
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
            ai_cancel,
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
            term_open_wt,
            voice_model_ready,
            voice_asr_model_ready,
            voice_download_model,
            voice_start_listening,
            voice_stop_listening,
            voice_reload_keyword,
            voice_record_utterance,
            voice_validate_keyword
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
            let restart_item = MenuItem::with_id(app, "restart", "重启", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &settings_item, &ai_item, &restart_item, &quit_item])?;
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
                    "restart" => app.request_restart(),
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
            app.manage(AiRuntime::default());

            // 股票行情后台轮询：交易时段 5s / 非交易 30s，emit stock://tick
            tauri::async_runtime::spawn(poll_loop(app.handle().clone()));

            // 终端注册表（多 tab PTY 管理）
            app.manage(TerminalRegistry::new());

            // 语音唤醒/问答状态（M8/M9，默认关闭）。manage 后若 wake:enabled=true 则自动恢复监听
            // （重启软件不用再进设置开关一次）。模型未下载/编码失败时静默忽略，不阻塞启动。
            app.manage(VoiceState::new());
            {
                let app_for_voice = app.handle().clone();
                let db = app.state::<crate::storage::Db>();
                let enabled = db
                    .setting_get("wake:enabled")
                    .map(|v| v == "true")
                    .unwrap_or(false);
                if enabled {
                    let state = app.state::<VoiceState>();
                    if let Err(e) = voice::start_listening_inner(&app_for_voice, state.inner()) {
                        eprintln!("[voice] 启动自动恢复监听失败：{e}");
                    }
                }
            }

            // 本地通知 HTTP server：127.0.0.1:9753/notify
            let notify_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                notify::server::start(notify_app).await;
            });

            // 恢复所选显示器位置，再按设置面板的启动默认态显示。
            // 已保存的具体显示器缺失时只临时回退主屏，不覆盖用户选择。
            if let Err(error) =
                restore_island_monitor(app.handle(), app.state::<storage::Db>().inner())
            {
                eprintln!("[monitor] 启动恢复显示器失败：{error}");
            }
            if let Some(window) = app.get_webview_window("island") {
                let _ = apply_state(&window, &default_state);
            }

            // 运行时显示器变化监听：副屏断开时立即临时跳回主屏（不改持久化选择）。
            start_runtime_watch(app.handle().clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 退出时杀掉所有终端子进程，避免僵尸；停止语音监听（若开着），
            // 释放麦克风占用——监听线程的检测循环会在下一次 200ms 轮询时看到标志位
            // 变化并退出，Drop 里会关掉 cpal 音频流。进程马上就要退出，不等线程真正
            // 结束也无妨（OS 会在进程退出时回收所有句柄）。
            if let tauri::RunEvent::Exit = event {
                if let Some(reg) = app_handle.try_state::<TerminalRegistry>() {
                    terminal::cleanup_all(reg.inner());
                }
                if let Some(state) = app_handle.try_state::<VoiceState>() {
                    let _ = voice_stop_listening(state);
                }
            }
        });
}
