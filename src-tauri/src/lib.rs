mod about;
mod ai;
mod data;
mod fullscreen;
mod hotkeys;
mod logging;
mod monitor;
mod notify;
mod settings;
mod settings_window;
mod storage;
mod terminal;
mod voice;
mod window_policy;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::ShortcutState;

use about::about_diagnostics;
use ai::{
    ai_cancel, ai_chat, ai_clear_history, ai_get_position, ai_history_list, ai_reset_position,
    ai_save_position, ai_switch_provider, hide_ai_palette, open_ai_palette, runtime::AiRuntime,
};
use data::calendar::calendar_month;
use data::stock::{
    poll_loop, stock_get, stock_kline, stock_search, stock_watchlist_add, stock_watchlist_list,
    stock_watchlist_remove, stock_watchlist_reorder,
};
use data::time_api::{time_programmer_history_get, time_saying_get};
use data::todo::{todo_create, todo_delete, todo_list, todo_update};
use data::weather::{
    weather_cities_add, weather_cities_list, weather_cities_remove, weather_cities_reorder,
    weather_get, weather_get_city, weather_locate, weather_location_search, weather_set_city,
};
use hotkeys::{
    hotkeys_apply, hotkeys_list, hotkeys_reload, hotkeys_reset, hotkeys_suspend, HotkeyMap,
};
use monitor::{
    monitor_get_selection, monitor_list, monitor_select, restore_island_monitor,
    start_runtime_watch, window_offset_apply,
};
use notify::{notify_clear, notify_create, notify_get_token, notify_list, notify_mark_read};
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

fn cleanup_runtime_resources(app: &tauri::AppHandle) {
    if let Some(registry) = app.try_state::<TerminalRegistry>() {
        terminal::cleanup_all(registry.inner());
    }
    if let Some(state) = app.try_state::<VoiceState>() {
        let _ = voice_stop_listening(state);
    }
}

/// 持有非阻塞日志 writer 的 guard，直到 App resource 清理时才 drop（flush 落盘）。
/// 与 UpdaterCleanupGuard 同机制：进程退出路径 drop resource 时冲刷最后的日志。
/// 字段从不读取是有意的——只为把 guard 的生命周期绑到 resource 上。
#[allow(dead_code)]
struct LoggingGuard(tracing_appender::non_blocking::WorkerGuard);

impl tauri::Resource for LoggingGuard {}

/// Updater 2.10 runs `AppHandle::cleanup_before_exit` immediately before its
/// Windows installer exits the process. An app resource is dropped by that
/// cleanup path, letting us release terminal and voice resources first.
struct UpdaterCleanupGuard(tauri::AppHandle);

impl tauri::Resource for UpdaterCleanupGuard {}

impl Drop for UpdaterCleanupGuard {
    fn drop(&mut self) {
        cleanup_runtime_resources(&self.0);
    }
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

fn storage_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("storage")
        .setup(|app, _api| {
            let db = storage::Db::init(app).map_err(|error| {
                std::io::Error::other(format!("failed to initialize SQLite: {error}"))
            })?;
            if !app.manage(db) {
                return Err(std::io::Error::other("SQLite state was already managed").into());
            }
            Ok(())
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // SQLite 必须在 tauri.conf.json 的静态 webview 创建前可用，避免首屏 setting_get 抢跑。
        .plugin(storage_plugin())
        // 单实例：重复启动时唤起已有窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = window_policy::set_desired_state(
                app,
                window_policy::IslandState::Compact,
                window_policy::FocusIntent::Focus,
            ) {
                eprintln!("[window-policy] 单实例唤起失败：{error}");
            }
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
        .on_window_event(|window, event| {
            if window.label() == "settings" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        // 全局热键：handler 用 HotKey::id() 反查 HotkeyMap 得到动作并分发，
        // 具体绑定由 hotkeys::apply 按设置面板的 hotkeys:<id> KV 注册（支持自定义）。
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let Some(action) = app
                        .try_state::<HotkeyMap>()
                        .and_then(|m| m.0.lock().ok().and_then(|g| g.get(&shortcut.id()).copied()))
                    else {
                        return;
                    };
                    match action {
                        hotkeys::Action::ToggleIsland => {
                            if let Err(error) = window_policy::toggle_visibility(app) {
                                eprintln!("[window-policy] 全局热键切换失败：{error}");
                            }
                        }
                        hotkeys::Action::ToggleAi => toggle_ai_palette(app),
                        hotkeys::Action::ToggleClickThrough => {
                            let db = app.state::<storage::Db>();
                            if let Err(error) = window_policy::toggle_click_through(app, db.inner())
                            {
                                eprintln!("[window-policy] 切换鼠标穿透失败：{error}");
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            about_diagnostics,
            window_policy::set_island_state,
            window_policy::window_policy_get,
            window_policy::window_click_through_set,
            window_policy::window_hover_set,
            window_policy::window_hover_expand_set,
            window_policy::window_hide_in_fullscreen_set,
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
            weather_location_search,
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
            notify_clear,
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
            voice_validate_keyword,
            hotkeys_list,
            hotkeys_apply,
            hotkeys_reset,
            hotkeys_suspend,
            hotkeys_reload
        ])
        .setup(|app| {
            // B4 日志：最早初始化，保证后续启动日志都能落盘（轮转 + 脱敏）。
            // guard 存为 resource，进程退出 resource 清理时 drop 冲刷最后日志。
            match logging::init_logging(app.handle()) {
                Ok(guard) => {
                    app.resources_table().add(LoggingGuard(guard));
                    tracing::info!(version = env!("CARGO_PKG_VERSION"), "LuckyIsland 启动");
                }
                Err(error) => eprintln!("[logging] 初始化失败，回退到 stderr：{error}"),
            }

            // Updater Config 不接受缺失配置对应的 null；真实公钥与 endpoint 接入前保持禁用。
            // 配置存在后再注册 cleanup guard，确保安装器退出路径也释放终端和语音资源。
            if app.config().plugins.0.contains_key("updater") {
                app.resources_table()
                    .add(UpdaterCleanupGuard(app.handle().clone()));
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }

            // 系统托盘
            let show_item = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置...", true, None::<&str>)?;
            let ai_item = MenuItem::with_id(app, "ai", "AI 助手", true, None::<&str>)?;
            let restart_item = MenuItem::with_id(app, "restart", "重启", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &settings_item,
                    &ai_item,
                    &restart_item,
                    &quit_item,
                ],
            )?;
            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("missing default window icon"),
                )
                .menu(&menu)
                .tooltip("LuckyIsland")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Err(error) = window_policy::toggle_visibility(app) {
                            eprintln!("[window-policy] 托盘切换失败：{error}");
                        }
                    }
                    "settings" => {
                        let _ = open_settings(app.clone(), None);
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
                        if let Err(error) = window_policy::toggle_visibility(tray.app_handle()) {
                            eprintln!("[window-policy] 托盘点击切换失败：{error}");
                        }
                    }
                })
                .build(app)?;

            // SQLite 已在 storage_plugin 中初始化；这里只读取启动默认态。
            let default_state = app
                .state::<storage::Db>()
                .setting_get("general:default_state")
                .filter(|s| matches!(s.as_str(), "hidden" | "compact" | "expanded"))
                .unwrap_or_else(|| "compact".to_string());
            let default_state = match default_state.as_str() {
                "hidden" => window_policy::IslandState::Hidden,
                "expanded" => window_policy::IslandState::Expanded,
                _ => window_policy::IslandState::Compact,
            };
            app.manage(window_policy::WindowPolicy::new(
                window_policy::WindowPolicyInputs::new(default_state),
            ));
            let fullscreen_controller = fullscreen::FullscreenController::default();
            app.manage(fullscreen_controller.clone());
            fullscreen::start(app.handle().clone(), fullscreen_controller);

            // 自定义全局热键：按用户绑定注册（DB 无值则默认 alt+KeyX / alt+Space）。
            // HotkeyMap 供插件 handler 用 HotKey::id() 反查动作分发。
            app.manage(HotkeyMap::default());
            let app_handle = app.handle();
            for r in hotkeys::apply(app_handle, app.state::<storage::Db>().inner()) {
                if !r.ok {
                    eprintln!(
                        "[hotkeys] 启动注册失败 {:?}: {}",
                        r.action,
                        r.error.as_deref().unwrap_or("?")
                    );
                }
            }

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
            if let Err(error) = window_policy::reapply(app.handle()) {
                eprintln!("[window-policy] 启动应用窗口状态失败：{error}");
            }
            if let Err(error) = window_policy::restore_click_through(
                app.handle(),
                app.state::<storage::Db>().inner(),
            ) {
                eprintln!("[window-policy] restore click-through failed: {error}");
            }
            if let Err(error) = window_policy::restore_hover_expand(
                app.handle(),
                app.state::<storage::Db>().inner(),
            ) {
                eprintln!("[window-policy] restore hover-expand failed: {error}");
            }
            if let Err(error) = window_policy::restore_hide_in_fullscreen(
                app.handle(),
                app.state::<storage::Db>().inner(),
            ) {
                eprintln!("[window-policy] restore fullscreen setting failed: {error}");
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
                tracing::info!("LuckyIsland 退出，开始清理运行时资源");
                if let Some(controller) = app_handle.try_state::<fullscreen::FullscreenController>()
                {
                    controller.shutdown();
                }
                cleanup_runtime_resources(app_handle);
            }
        });
}
