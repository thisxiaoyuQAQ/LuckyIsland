use tauri::{AppHandle, Manager};
use windows::Win32::{
    Foundation::RECT,
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::WindowsAndMessaging::{
        GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowRect, IsIconic,
        IsWindowVisible,
    },
};

use super::{covers_monitor, PhysicalRect, FULLSCREEN_EDGE_TOLERANCE_PX};

pub(super) fn sample(app: &AppHandle) -> Option<bool> {
    let island = app.get_webview_window("island")?;
    let island_hwnd = island.hwnd().ok()?;
    let excluded = [
        Some(island_hwnd),
        app.get_webview_window("settings")
            .and_then(|window| window.hwnd().ok()),
        app.get_webview_window("ai-palette")
            .and_then(|window| window.hwnd().ok()),
    ];

    // SAFETY: all handles come from Win32/Tauri and output structs live for each call.
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.0.is_null()
            || foreground == GetDesktopWindow()
            || foreground == GetShellWindow()
            || excluded
                .into_iter()
                .flatten()
                .any(|hwnd| hwnd == foreground)
            || !IsWindowVisible(foreground).as_bool()
            || IsIconic(foreground).as_bool()
        {
            return Some(false);
        }

        let foreground_monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONEAREST);
        let island_monitor = MonitorFromWindow(island_hwnd, MONITOR_DEFAULTTONEAREST);
        if foreground_monitor.0.is_null() || island_monitor.0.is_null() {
            return None;
        }
        if foreground_monitor != island_monitor {
            return Some(false);
        }

        let mut window_rect = RECT::default();
        GetWindowRect(foreground, &mut window_rect).ok()?;
        let mut monitor_info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(foreground_monitor, &mut monitor_info).as_bool() {
            return None;
        }

        Some(covers_monitor(
            physical_rect(window_rect),
            physical_rect(monitor_info.rcMonitor),
            FULLSCREEN_EDGE_TOLERANCE_PX,
        ))
    }
}

fn physical_rect(rect: RECT) -> PhysicalRect {
    PhysicalRect {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    }
}
