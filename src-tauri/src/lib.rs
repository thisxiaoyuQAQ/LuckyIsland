use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, PhysicalPosition,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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

/// 切换灵动岛显示/隐藏
fn toggle_visibility(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("island") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例：重复启动时唤起已有窗口
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("island") {
                let _ = window.show();
                let _ = window.set_focus();
            }
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

            // 定位到顶部居中并显示
            if let Some(window) = app.get_webview_window("island") {
                let _ = position_top_center(&window);
                let _ = window.show();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
