mod data;
mod storage;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, PhysicalPosition, Size,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use data::calendar::calendar_month;
use data::todo::{todo_create, todo_delete, todo_list, todo_update};

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
        // 全局热键
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_visibility(app);
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
            calendar_month
        ])
        .setup(|app| {
            // 注册 Alt+X 全局热键
            app.global_shortcut()
                .register(Shortcut::new(Some(Modifiers::ALT), Code::KeyX))?;

            // 系统托盘
            let show_item = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
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
            app.manage(db);

            // 定位到顶部居中，初始 compact 态
            if let Some(window) = app.get_webview_window("island") {
                let _ = position_top_center(&window);
                let _ = apply_state(&window, "compact");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
