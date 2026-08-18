//! Windows taskbar embedding primitives and lifecycle state.
//!
//! The taskbar strip is intentionally separate from the top-level island window.
//! Win32 calls are kept in this module so the rest of the application only deals
//! with validated snapshots and typed lifecycle functions.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Size};

use crate::storage::Db;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl TaskbarRect {
    pub fn width(self) -> i32 {
        self.right - self.left
    }

    pub fn height(self) -> i32 {
        self.bottom - self.top
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarAvailability {
    pub available: bool,
    pub reason: Option<String>,
    pub explorer_pid: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarSnapshot {
    pub available: bool,
    pub taskbar: Option<TaskbarRect>,
    pub client: Option<TaskbarRect>,
    pub work_area: Option<TaskbarRect>,
    pub dpi: u32,
    pub strip: Option<TaskbarRect>,
    pub explorer_pid: Option<u32>,
    pub expanded: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Default)]
struct TaskbarState {
    tray_hwnd: usize,
    explorer_pid: u32,
    strip_hwnd: usize,
    original_parent: usize,
    original_style: isize,
    expanded: bool,
    /// 上次观测到的任务栏矩形与 DPI；变化时面板需重定位（显示器/DPI/任务栏换边场景）。
    last_taskbar: Option<TaskbarRect>,
    last_dpi: u32,
}

#[derive(Debug, Default)]
pub struct TaskbarManager(Mutex<TaskbarState>);

impl TaskbarManager {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Calculate the first strip pixel after the Start button and an optional gap.
pub fn start_adjacent_x(taskbar_left: i32, start_width: i32, gap: i32) -> i32 {
    taskbar_left
        .saturating_add(start_width.max(0))
        .saturating_add(gap.max(0))
}

/// Clamp a rectangle to a client rectangle, rejecting malformed dimensions.
pub fn clamp_rect_to_client(rect: TaskbarRect, client: TaskbarRect) -> Result<TaskbarRect, String> {
    if client.width() <= 0 || client.height() <= 0 {
        return Err("任务栏客户区尺寸无效".to_string());
    }
    if rect.width() <= 0 || rect.height() <= 0 {
        return Err("任务栏条尺寸无效".to_string());
    }
    let width = rect.width().min(client.width());
    let height = rect.height().min(client.height());
    let left = rect.left.max(client.left).min(client.right - width);
    let top = rect.top.max(client.top).min(client.bottom - height);
    Ok(TaskbarRect {
        left,
        top,
        right: left + width,
        bottom: top + height,
    })
}

/// Return the panel's bottom edge immediately above the visible taskbar.
#[allow(dead_code)]
pub fn panel_bottom(taskbar_visible_top: i32, panel_height: i32, gap: i32) -> Result<i32, String> {
    if panel_height <= 0 {
        return Err("面板高度无效".to_string());
    }
    Ok(taskbar_visible_top.saturating_sub(gap.max(0)))
}

pub fn logical_to_physical(value: i32, dpi: u32) -> Result<i32, String> {
    if value <= 0 || dpi == 0 {
        return Err("逻辑尺寸或 DPI 无效".to_string());
    }
    let scaled = (i64::from(value) * i64::from(dpi) + 48) / 96;
    i32::try_from(scaled).map_err(|_| "物理尺寸超出范围".to_string())
}

fn unavailable(reason: impl Into<String>) -> TaskbarSnapshot {
    TaskbarSnapshot {
        reason: Some(reason.into()),
        ..TaskbarSnapshot::default()
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, FindWindowW, GetClientRect, GetWindowLongPtrW, GetWindowRect,
        GetWindowThreadProcessId, IsWindow, SetParent, SetWindowLongPtrW, SetWindowPos, ShowWindow,
        GWL_STYLE, HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE, SW_SHOW,
        WS_CHILD,
    };

    fn rect_from(rect: RECT) -> Result<TaskbarRect, String> {
        let result = TaskbarRect {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        };
        if result.width() <= 0 || result.height() <= 0 {
            return Err("Win32 返回了无效矩形".to_string());
        }
        Ok(result)
    }

    fn screen_client_rect(hwnd: HWND) -> Result<TaskbarRect, String> {
        let mut rect = RECT::default();
        unsafe { GetClientRect(hwnd, &mut rect) }
            .map_err(|e| format!("读取任务栏客户区失败：{e}"))?;
        let mut top_left = POINT {
            x: rect.left,
            y: rect.top,
        };
        let mut bottom_right = POINT {
            x: rect.right,
            y: rect.bottom,
        };
        unsafe {
            if !ClientToScreen(hwnd, &mut top_left).as_bool() {
                return Err("转换任务栏客户区坐标失败".to_string());
            }
            if !ClientToScreen(hwnd, &mut bottom_right).as_bool() {
                return Err("转换任务栏客户区坐标失败".to_string());
            }
        }
        rect_from(RECT {
            left: top_left.x,
            top: top_left.y,
            right: bottom_right.x,
            bottom: bottom_right.y,
        })
    }

    fn taskbar_context() -> Result<(HWND, TaskbarRect, TaskbarRect, u32, u32), String> {
        let tray = unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }
            .map_err(|e| format!("查找 Shell_TrayWnd 失败：{e}"))?;
        if tray.is_invalid() {
            return Err("未找到 Windows 任务栏".to_string());
        }
        let mut taskbar_rect = RECT::default();
        unsafe { GetWindowRect(tray, &mut taskbar_rect) }
            .map_err(|e| format!("读取任务栏矩形失败：{e}"))?;
        let taskbar_rect = rect_from(taskbar_rect)?;
        let client = screen_client_rect(tray)?;
        let dpi = unsafe { GetDpiForWindow(tray) };
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(tray, Some(&mut pid)) };
        if pid == 0 || dpi == 0 {
            return Err("任务栏进程或 DPI 无效".to_string());
        }
        Ok((tray, taskbar_rect, client, dpi, pid))
    }

    fn start_width(tray: HWND) -> i32 {
        let start = match unsafe { FindWindowExW(Some(tray), None, w!("Start"), None) } {
            Ok(hwnd) => hwnd,
            Err(_) => return 0,
        };
        let mut rect = RECT::default();
        if unsafe { GetWindowRect(start, &mut rect) }.is_ok() {
            (rect.right - rect.left).max(0)
        } else {
            0
        }
    }

    pub(super) fn snapshot(manager: &TaskbarManager) -> TaskbarSnapshot {
        let expanded = manager
            .0
            .lock()
            .map(|state| state.expanded)
            .unwrap_or(false);
        match taskbar_context() {
            Ok((tray, taskbar, client, dpi, pid)) => {
                let strip = manager.0.lock().ok().and_then(|state| {
                    if state.strip_hwnd == 0 {
                        return None;
                    }
                    let hwnd = HWND(state.strip_hwnd as *mut _);
                    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
                        return None;
                    }
                    let mut rect = RECT::default();
                    unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
                    rect_from(rect).ok()
                });
                if let Ok(mut state) = manager.0.lock() {
                    state.tray_hwnd = tray.0 as usize;
                    state.explorer_pid = pid;
                }
                TaskbarSnapshot {
                    available: true,
                    taskbar: Some(taskbar),
                    client: Some(client),
                    work_area: Some(client),
                    dpi,
                    strip,
                    explorer_pid: Some(pid),
                    expanded,
                    reason: None,
                }
            }
            Err(error) => unavailable(error),
        }
    }

    pub(super) fn availability(manager: &TaskbarManager) -> TaskbarAvailability {
        let snapshot = snapshot(manager);
        TaskbarAvailability {
            available: snapshot.available,
            reason: snapshot.reason,
            explorer_pid: snapshot.explorer_pid,
        }
    }

    pub(super) fn enter(
        app: &AppHandle,
        manager: &TaskbarManager,
        db: &Db,
    ) -> Result<TaskbarSnapshot, String> {
        let strip = app
            .get_webview_window("taskbar-strip")
            .ok_or_else(|| "taskbar-strip 窗口尚未注册".to_string())?;
        let strip_hwnd = strip
            .hwnd()
            .map_err(|e| format!("读取 taskbar-strip HWND 失败：{e}"))?;
        let (tray, taskbar, client, dpi, pid) = taskbar_context()?;
        let width = logical_to_physical(140, dpi)?;
        let height = client.height().min(logical_to_physical(40, dpi)?);
        if height <= 0 || width <= 0 {
            return Err("任务栏客户区不足以承载条窗口".to_string());
        }
        let x = start_adjacent_x(client.left, start_width(tray), 4);
        let desired = clamp_rect_to_client(
            TaskbarRect {
                left: x,
                top: client.top,
                right: x + width,
                bottom: client.top + height,
            },
            client,
        )?;
        let mut state = manager
            .0
            .lock()
            .map_err(|_| "任务栏状态锁失败".to_string())?;
        let old_parent = unsafe { SetParent(strip_hwnd, Some(tray)) }
            .map_err(|e| format!("嵌入任务栏失败：{e}"))?;
        let old_style = unsafe { GetWindowLongPtrW(strip_hwnd, GWL_STYLE) };
        let new_style = old_style | WS_CHILD.0 as isize;
        unsafe { SetWindowLongPtrW(strip_hwnd, GWL_STYLE, new_style) };
        let positioned = unsafe {
            SetWindowPos(
                strip_hwnd,
                Some(HWND_TOP),
                desired.left - client.left,
                desired.top - client.top,
                desired.width(),
                desired.height(),
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
            )
        };
        if let Err(error) = positioned {
            let _ = unsafe { SetParent(strip_hwnd, Some(old_parent)) };
            unsafe { SetWindowLongPtrW(strip_hwnd, GWL_STYLE, old_style) };
            return Err(format!("设置任务栏条位置失败，已回滚：{error}"));
        }
        let _ = unsafe { ShowWindow(strip_hwnd, SW_SHOW) };
        state.tray_hwnd = tray.0 as usize;
        state.explorer_pid = pid;
        state.strip_hwnd = strip_hwnd.0 as usize;
        state.original_parent = old_parent.0 as usize;
        state.original_style = old_style;
        state.expanded = false;
        state.last_taskbar = Some(taskbar);
        state.last_dpi = dpi;
        // 展开面板的初始尺寸与位置：按任务栏模式宽度键与展开高度放到任务栏上方左下角，
        // 避免切回展开时沿用顶部模式的几何。失败时整体回滚 strip 父子关系，不留半嵌入态。
        let panel_result = (|| -> Result<(), String> {
            let width_logical = crate::window_policy::parse_island_width(
                db.setting_get("window:width:taskbar").as_deref(),
            );
            if let Some(island) = app.get_webview_window("island") {
                let physical_width = logical_to_physical(width_logical.round() as i32, dpi)?;
                let physical_height = logical_to_physical(400, dpi)?;
                let rect = taskbar_panel_rect(
                    &TaskbarSnapshot {
                        available: true,
                        taskbar: Some(taskbar),
                        work_area: Some(client),
                        strip: Some(desired),
                        ..TaskbarSnapshot::default()
                    },
                    physical_width,
                    physical_height,
                    8,
                )?;
                island
                    .set_size(Size::Physical(PhysicalSize::new(
                        rect.width() as u32,
                        rect.height() as u32,
                    )))
                    .map_err(|e| format!("设置任务栏面板尺寸失败：{e}"))?;
                island
                    .set_position(PhysicalPosition::new(rect.left, rect.top))
                    .map_err(|e| format!("设置任务栏面板位置失败：{e}"))?;
            }
            Ok(())
        })();
        if let Err(error) = panel_result {
            let _ = unsafe { ShowWindow(strip_hwnd, SW_HIDE) };
            let _ = unsafe { SetParent(strip_hwnd, Some(old_parent)) };
            unsafe { SetWindowLongPtrW(strip_hwnd, GWL_STYLE, old_style) };
            *state = TaskbarState::default();
            return Err(format!("任务栏面板几何失败，已整体回滚：{error}"));
        }
        Ok(TaskbarSnapshot {
            available: true,
            taskbar: Some(taskbar),
            client: Some(client),
            work_area: Some(client),
            dpi,
            strip: Some(desired),
            explorer_pid: Some(pid),
            expanded: false,
            reason: None,
        })
    }

    pub(super) fn leave(app: &AppHandle, manager: &TaskbarManager) -> Result<(), String> {
        let strip = app.get_webview_window("taskbar-strip");
        let mut state = manager
            .0
            .lock()
            .map_err(|_| "任务栏状态锁失败".to_string())?;
        if let Some(strip) = strip {
            let hwnd = strip
                .hwnd()
                .map_err(|e| format!("读取 taskbar-strip HWND 失败：{e}"))?;
            let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
            if state.original_parent != 0 {
                unsafe { SetParent(hwnd, Some(HWND(state.original_parent as *mut _))) }
                    .map_err(|e| format!("恢复 taskbar-strip 父窗口失败：{e}"))?;
            }
            if state.original_style != 0 {
                unsafe { SetWindowLongPtrW(hwnd, GWL_STYLE, state.original_style) };
            }
        }
        *state = TaskbarState::default();
        Ok(())
    }

    pub(super) fn toggle(manager: &TaskbarManager) -> Result<bool, String> {
        let mut state = manager
            .0
            .lock()
            .map_err(|_| "任务栏状态锁失败".to_string())?;
        if state.strip_hwnd == 0
            || !unsafe { IsWindow(Some(HWND(state.strip_hwnd as *mut _))) }.as_bool()
        {
            return Err("任务栏条窗口不可用".to_string());
        }
        state.expanded = !state.expanded;
        Ok(state.expanded)
    }

    pub(super) fn needs_reattach(manager: &TaskbarManager) -> bool {
        let Ok(mut state) = manager.0.lock() else {
            return false;
        };
        if state.strip_hwnd == 0 {
            return false;
        }
        // strip HWND 已失效（Explorer 重启会销毁子窗口）。
        if !unsafe { IsWindow(Some(HWND(state.strip_hwnd as *mut _))) }.as_bool() {
            return true;
        }
        // 任务栏 HWND、Explorer 进程、任务栏矩形或 DPI 变化都需要重挂/重定位。
        match taskbar_context() {
            Ok((tray, taskbar, _, dpi, pid)) => {
                let changed = tray.0 as usize != state.tray_hwnd
                    || pid != state.explorer_pid
                    || state.last_taskbar != Some(taskbar)
                    || state.last_dpi != dpi;
                if tray.0 as usize == state.tray_hwnd && pid == state.explorer_pid {
                    // 同任务栏：只刷新矩形/DPI 基线，由 changed 决定是否触发 reapply。
                    state.last_taskbar = Some(taskbar);
                    state.last_dpi = dpi;
                }
                changed
            }
            Err(_) => true,
        }
    }
}

#[cfg(not(windows))]
mod windows_impl {
    use super::*;

    pub(super) fn snapshot(_manager: &TaskbarManager) -> TaskbarSnapshot {
        unavailable("任务栏模式仅支持 Windows")
    }

    pub(super) fn availability(_manager: &TaskbarManager) -> TaskbarAvailability {
        TaskbarAvailability {
            available: false,
            reason: Some("任务栏模式仅支持 Windows".to_string()),
            explorer_pid: None,
        }
    }

    pub(super) fn enter(
        _app: &AppHandle,
        _manager: &TaskbarManager,
        _db: &Db,
    ) -> Result<TaskbarSnapshot, String> {
        Err("任务栏模式仅支持 Windows".to_string())
    }

    pub(super) fn leave(_app: &AppHandle, _manager: &TaskbarManager) -> Result<(), String> {
        Ok(())
    }

    pub(super) fn toggle(_manager: &TaskbarManager) -> Result<bool, String> {
        Err("任务栏模式仅支持 Windows".to_string())
    }

    pub(super) fn needs_reattach(_manager: &TaskbarManager) -> bool {
        false
    }
}

pub fn taskbar_is_available(manager: &TaskbarManager) -> TaskbarAvailability {
    windows_impl::availability(manager)
}

pub fn taskbar_snapshot(manager: &TaskbarManager) -> TaskbarSnapshot {
    windows_impl::snapshot(manager)
}

pub fn enter_taskbar_mode(
    app: &AppHandle,
    manager: &TaskbarManager,
    db: &Db,
) -> Result<TaskbarSnapshot, String> {
    windows_impl::enter(app, manager, db)
}

pub fn leave_taskbar_mode(app: &AppHandle, manager: &TaskbarManager) -> Result<(), String> {
    windows_impl::leave(app, manager)
}

/// 按 strip 左边缘与任务栏可见上沿计算展开面板矩形；供 WindowPolicy 在 taskbar 展开时调用。
pub fn taskbar_panel_rect(
    snapshot: &TaskbarSnapshot,
    width: i32,
    height: i32,
    gap: i32,
) -> Result<TaskbarRect, String> {
    if width <= 0 || height <= 0 {
        return Err("任务栏面板尺寸无效".to_string());
    }
    let strip = snapshot
        .strip
        .ok_or_else(|| "任务栏条几何不可用".to_string())?;
    let taskbar = snapshot
        .taskbar
        .ok_or_else(|| "任务栏可见矩形不可用".to_string())?;
    let work = snapshot
        .work_area
        .ok_or_else(|| "任务栏工作区不可用".to_string())?;
    let width = width.min(work.width()).max(1);
    let height = height.min(work.height()).max(1);
    let left = strip.left.max(work.left).min(work.right - width);
    let bottom = panel_bottom(taskbar.top, height, gap)?.min(work.bottom);
    let top = (bottom - height).max(work.top);
    Ok(TaskbarRect {
        left,
        top,
        right: left + width,
        bottom: top + height,
    })
}

/// 把 island 窗口按任务栏模式面板几何 resize + 定位到任务栏上方左下角。
pub fn apply_taskbar_panel_geometry(
    app: &AppHandle,
    manager: &TaskbarManager,
    width: f64,
    height: f64,
) -> Result<TaskbarSnapshot, String> {
    let snapshot = taskbar_snapshot(manager);
    if !snapshot.available {
        return Err(snapshot
            .reason
            .unwrap_or_else(|| "任务栏不可用".to_string()));
    }
    let dpi = snapshot.dpi;
    let physical_width = logical_to_physical(width.round() as i32, dpi)?;
    let physical_height = logical_to_physical(height.round() as i32, dpi)?;
    let rect = taskbar_panel_rect(&snapshot, physical_width, physical_height, 8)?;
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    window
        .set_size(Size::Physical(PhysicalSize::new(
            rect.width() as u32,
            rect.height() as u32,
        )))
        .map_err(|error| format!("设置任务栏面板尺寸失败：{error}"))?;
    window
        .set_position(PhysicalPosition::new(rect.left, rect.top))
        .map_err(|error| format!("设置任务栏面板位置失败：{error}"))?;
    Ok(snapshot)
}

pub fn taskbar_strip_toggle(manager: &TaskbarManager) -> Result<bool, String> {
    windows_impl::toggle(manager)
}

/// 是否需要重挂：strip 曾嵌入过（strip_hwnd 非 0）但任务栏 HWND 或 Explorer PID 已变化，
/// 或 strip HWND 已失效。供运行时 watcher 判断是否需要 taskbar_reapply。
pub fn taskbar_needs_reattach(manager: &TaskbarManager) -> bool {
    windows_impl::needs_reattach(manager)
}

pub fn taskbar_reapply(
    app: &AppHandle,
    manager: &TaskbarManager,
    db: &Db,
) -> Result<TaskbarSnapshot, String> {
    let _ = leave_taskbar_mode(app, manager);
    enter_taskbar_mode(app, manager, db)
}

#[tauri::command]
pub fn taskbar_enter_command(
    app: AppHandle,
    manager: tauri::State<'_, TaskbarManager>,
    db: tauri::State<'_, Db>,
) -> Result<TaskbarSnapshot, String> {
    taskbar_enter_mode(&app, manager.inner(), db.inner())
}

#[tauri::command]
pub fn taskbar_leave_command(
    app: AppHandle,
    manager: tauri::State<'_, TaskbarManager>,
) -> Result<(), String> {
    taskbar_leave_mode(&app, manager.inner())
}

pub fn taskbar_enter_mode(
    app: &AppHandle,
    manager: &TaskbarManager,
    db: &Db,
) -> Result<TaskbarSnapshot, String> {
    enter_taskbar_mode(app, manager, db)
}

pub fn taskbar_leave_mode(app: &AppHandle, manager: &TaskbarManager) -> Result<(), String> {
    leave_taskbar_mode(app, manager)
}

#[tauri::command]
pub fn taskbar_availability(manager: tauri::State<'_, TaskbarManager>) -> TaskbarAvailability {
    taskbar_is_available(manager.inner())
}

#[tauri::command]
pub fn taskbar_reapply_command(
    app: AppHandle,
    manager: tauri::State<'_, TaskbarManager>,
    db: tauri::State<'_, Db>,
) -> Result<TaskbarSnapshot, String> {
    taskbar_reapply(&app, manager.inner(), db.inner())
}

#[tauri::command]
pub fn taskbar_strip_toggle_command(
    app: AppHandle,
    manager: tauri::State<'_, TaskbarManager>,
) -> Result<bool, String> {
    let expanded = taskbar_strip_toggle(manager.inner())?;
    // strip 点击驱动 island 面板：expanded 展开左下角面板，否则收起（island 隐藏、strip 保留）。
    let desired = if expanded {
        crate::window_policy::IslandState::Expanded
    } else {
        crate::window_policy::IslandState::Compact
    };
    crate::window_policy::set_desired_state(
        &app,
        desired,
        crate::window_policy::FocusIntent::Preserve,
    )?;
    app.emit(
        "window://taskbar-state-changed",
        taskbar_snapshot(manager.inner()),
    )
    .map_err(|error| format!("广播任务栏状态失败：{error}"))?;
    Ok(expanded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_adjacent_position_includes_gap() {
        assert_eq!(start_adjacent_x(10, 40, 4), 54);
    }

    #[test]
    fn clamp_rect_to_client_keeps_valid_size_and_bounds() {
        let rect = TaskbarRect {
            left: -10,
            top: 5,
            right: 200,
            bottom: 80,
        };
        let client = TaskbarRect {
            left: 0,
            top: 0,
            right: 100,
            bottom: 48,
        };
        assert_eq!(
            clamp_rect_to_client(rect, client).unwrap(),
            TaskbarRect {
                left: 0,
                top: 0,
                right: 100,
                bottom: 48
            }
        );
    }

    #[test]
    fn panel_bottom_is_above_taskbar() {
        assert_eq!(panel_bottom(900, 400, 8).unwrap(), 892);
    }

    #[test]
    fn panel_rect_aligns_to_strip_and_sits_above_taskbar() {
        let snapshot = TaskbarSnapshot {
            available: true,
            taskbar: Some(TaskbarRect {
                left: 0,
                top: 900,
                right: 1920,
                bottom: 948,
            }),
            work_area: Some(TaskbarRect {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 900,
            }),
            strip: Some(TaskbarRect {
                left: 64,
                top: 900,
                right: 204,
                bottom: 940,
            }),
            ..TaskbarSnapshot::default()
        };
        assert_eq!(
            taskbar_panel_rect(&snapshot, 720, 400, 8).unwrap(),
            TaskbarRect {
                left: 64,
                top: 492,
                right: 784,
                bottom: 892
            }
        );
    }

    #[test]
    fn malformed_dimensions_are_rejected() {
        let client = TaskbarRect {
            left: 0,
            top: 0,
            right: 100,
            bottom: 48,
        };
        assert!(clamp_rect_to_client(TaskbarRect::default(), client).is_err());
        assert!(panel_bottom(900, 0, 8).is_err());
        assert!(logical_to_physical(0, 96).is_err());
    }

    #[test]
    fn logical_dimensions_scale_with_dpi() {
        assert_eq!(logical_to_physical(100, 144).unwrap(), 150);
    }
}
