//! Windows taskbar embedding primitives and lifecycle state.
//!
//! The taskbar strip is intentionally separate from the top-level island window.
//! Win32 calls are kept in this module so the rest of the application only deals
//! with validated snapshots and typed lifecycle functions.

use std::sync::atomic::{AtomicU32, Ordering};
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
    original_exstyle: isize,
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
/// tauri.conf.json 中嵌入条窗口的标签。
const STRIP_CONFIG_LABEL: &str = "taskbar-strip";
/// 嵌入条窗口已重建的次数，决定当前嵌入条的窗口标签（BUG-20261109-02）。
static STRIP_GENERATION: AtomicU32 = AtomicU32::new(0);

/// 第 `generation` 次重建后的嵌入条标签；首个嵌入条沿用配置标签。
///
/// 资源管理器重启会连带销毁嵌入在任务栏里的嵌入条窗口，但 Tauri 收不到销毁事件，旧标签一直
/// 被失效的窗口对象占用（`destroy()` 也只清空内部指针、不注销标签），重建只能换新标签。
fn strip_label(generation: u32) -> String {
    if generation == 0 {
        STRIP_CONFIG_LABEL.to_string()
    } else {
        format!("{STRIP_CONFIG_LABEL}-r{generation}")
    }
}

/// 当前嵌入条窗口。
fn strip_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(&strip_label(STRIP_GENERATION.load(Ordering::SeqCst)))
}

/// 嵌入条窗口是否已丢失：未注册，或已注册但原生窗口已被销毁。
fn strip_window_lost(app: &AppHandle) -> bool {
    strip_window(app).is_none_or(|window| !windows_impl::window_alive(&window))
}

/// 确保有可用的嵌入条窗口；丢失时按配置换新标签重建（BUG-20261109-02）。
///
/// 只能在后台线程调用（运行时巡检）：新建 WebView 会等待主线程，在主线程的 WebView IPC
/// 回调里新建 WebView2 会死锁，而 `run_on_main_thread` 在主线程上是同步执行的，无法推迟。
/// 失效的旧窗口对象留在 Tauri 里不再使用。
pub fn ensure_strip_window(app: &AppHandle) -> Result<(), String> {
    if !strip_window_lost(app) {
        return Ok(());
    }
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == STRIP_CONFIG_LABEL)
        .cloned()
        .ok_or_else(|| "配置中缺少 taskbar-strip 窗口".to_string())?;
    let next = STRIP_GENERATION.load(Ordering::SeqCst).wrapping_add(1);
    config.label = strip_label(next);
    tauri::WebviewWindowBuilder::from_config(app, &config)
        .and_then(|builder| builder.build())
        .map_err(|error| format!("重建任务栏嵌入条失败：{error}"))?;
    STRIP_GENERATION.store(next, Ordering::SeqCst);
    tracing::info!(label = %config.label, "[taskbar] 嵌入条窗口已被销毁，已重建");
    Ok(())
}

/// 任务栏变化是否需要重挂嵌入条：只看尺寸与 DPI（BUG-20261109-01 #4）。
///
/// 嵌入条是任务栏的子窗口，任务栏整体移动（自动隐藏时滑入/滑出）它会跟着移动；若按整个矩形
/// 比较，每次滑动都会触发拆下重挂，用户去点击时嵌入条正在重建，点击丢失。
pub fn taskbar_change_needs_reattach(
    previous: Option<TaskbarRect>,
    previous_dpi: u32,
    current: TaskbarRect,
    current_dpi: u32,
) -> bool {
    match previous {
        None => true,
        Some(previous) => {
            previous.width() != current.width()
                || previous.height() != current.height()
                || previous_dpi != current_dpi
        }
    }
}

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
    use windows::Win32::Graphics::Gdi::{
        ClientToScreen, GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, FindWindowW, GetClientRect, GetWindowLongPtrW, GetWindowRect,
        GetWindowThreadProcessId, IsWindow, SetParent, SetWindowLongPtrW, SetWindowPos, ShowWindow,
        GWL_EXSTYLE, GWL_STYLE, HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_SHOWWINDOW,
        SW_HIDE, SW_SHOW, WS_CAPTION, WS_CHILD, WS_EX_APPWINDOW, WS_EX_DLGMODALFRAME,
        WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
        WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
    };

    /// 嵌入任务栏的子窗口样式（BUG-20261109-01 #1）。
    ///
    /// tao 给无边框窗口也保留 `WS_CAPTION | WS_SYSMENU | 最小化/最大化框`，只靠 `WM_NCCALCSIZE`
    /// 隐藏非客户区；作为子窗口时系统会画出经典标题栏，点击后条变成带「— □ ✕」的小窗。
    /// 这里去掉全部边框/标题相关样式与顶层扩展样式，只加 `WS_CHILD`（与 tao 自己的子窗口一致）。
    pub(super) fn embedded_child_styles(style: isize, exstyle: isize) -> (isize, isize) {
        let frame = (WS_POPUP
            | WS_CAPTION
            | WS_SYSMENU
            | WS_THICKFRAME
            | WS_MINIMIZEBOX
            | WS_MAXIMIZEBOX)
            .0 as isize;
        // 去除 WS_EX_TOOLWINDOW：真机上留着它会导致 SetParent 后子窗口不随任务栏渲染（条消失）。
        let top_level_ex = (WS_EX_TOOLWINDOW
            | WS_EX_APPWINDOW
            | WS_EX_WINDOWEDGE
            | WS_EX_TOPMOST
            | WS_EX_DLGMODALFRAME)
            .0 as isize;
        (
            (style & !frame) | WS_CHILD.0 as isize,
            exstyle & !top_level_ex,
        )
    }

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

    /// 任务栏所在显示器的工作区（不含任务栏）。面板必须按它 clamp，不能用任务栏自己的
    /// 客户区（BUG-20261109-01 #2：用任务栏客户区会把面板压成任务栏高度并叠在任务栏上）。
    fn monitor_work_area(tray: HWND) -> Result<TaskbarRect, String> {
        let monitor = unsafe { MonitorFromWindow(tray, MONITOR_DEFAULTTONEAREST) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
            return Err("读取任务栏所在显示器工作区失败".to_string());
        }
        rect_from(info.rcWork)
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
        match taskbar_context().and_then(|context| Ok((context, monitor_work_area(context.0)?))) {
            Ok(((tray, taskbar, client, dpi, pid), work_area)) => {
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
                    work_area: Some(work_area),
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
        // 嵌入条丢失（资源管理器重启连带销毁）时由运行时巡检在后台重建，这里不就地重建：
        // enter 可能运行在 WebView IPC 回调里（切换界面模式），在那里新建 WebView2 会死锁。
        let strip = strip_window(app)
            .filter(window_alive)
            .ok_or_else(|| "任务栏嵌入条窗口已失效，正在重建，请稍后再试".to_string())?;
        let strip_hwnd = strip
            .hwnd()
            .map_err(|e| format!("读取 taskbar-strip HWND 失败：{e}"))?;
        let (tray, taskbar, client, dpi, pid) = taskbar_context()?;
        let work_area = monitor_work_area(tray)?;
        let width = logical_to_physical(140, dpi)?;
        // 高度填满任务栏客户区（真机 48px），且条顶部与客户区顶部对齐，垂直居中于任务栏。
        let height = client.height();
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
        let old_exstyle = unsafe { GetWindowLongPtrW(strip_hwnd, GWL_EXSTYLE) };
        let (new_style, new_exstyle) = embedded_child_styles(old_style, old_exstyle);
        unsafe { SetWindowLongPtrW(strip_hwnd, GWL_STYLE, new_style) };
        unsafe { SetWindowLongPtrW(strip_hwnd, GWL_EXSTYLE, new_exstyle) };
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
            unsafe { SetWindowLongPtrW(strip_hwnd, GWL_EXSTYLE, old_exstyle) };
            return Err(format!("设置任务栏条位置失败，已回滚：{error}"));
        }
        let _ = unsafe { ShowWindow(strip_hwnd, SW_SHOW) };
        state.tray_hwnd = tray.0 as usize;
        state.explorer_pid = pid;
        state.strip_hwnd = strip_hwnd.0 as usize;
        state.original_parent = old_parent.0 as usize;
        state.original_style = old_style;
        state.original_exstyle = old_exstyle;
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
                        work_area: Some(work_area),
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
            unsafe { SetWindowLongPtrW(strip_hwnd, GWL_EXSTYLE, old_exstyle) };
            *state = TaskbarState::default();
            return Err(format!("任务栏面板几何失败，已整体回滚：{error}"));
        }
        Ok(TaskbarSnapshot {
            available: true,
            taskbar: Some(taskbar),
            client: Some(client),
            work_area: Some(work_area),
            dpi,
            strip: Some(desired),
            explorer_pid: Some(pid),
            expanded: false,
            reason: None,
        })
    }

    pub(super) fn window_alive(window: &tauri::WebviewWindow) -> bool {
        window
            .hwnd()
            .is_ok_and(|hwnd| unsafe { IsWindow(Some(hwnd)) }.as_bool())
    }

    /// 按嵌入时记录的句柄恢复嵌入条；句柄已被销毁（资源管理器重启）时跳过恢复、只清理状态，
    /// 否则重挂会一直卡在「恢复父窗口失败」（BUG-20261109-02）。
    pub(super) fn leave(_app: &AppHandle, manager: &TaskbarManager) -> Result<(), String> {
        let mut state = manager
            .0
            .lock()
            .map_err(|_| "任务栏状态锁失败".to_string())?;
        let hwnd = HWND(state.strip_hwnd as *mut _);
        if state.strip_hwnd != 0 && unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
            if state.original_parent != 0 {
                unsafe { SetParent(hwnd, Some(HWND(state.original_parent as *mut _))) }
                    .map_err(|e| format!("恢复 taskbar-strip 父窗口失败：{e}"))?;
            }
            if state.original_style != 0 {
                unsafe { SetWindowLongPtrW(hwnd, GWL_STYLE, state.original_style) };
            }
            if state.original_exstyle != 0 {
                unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, state.original_exstyle) };
            }
        }
        *state = TaskbarState::default();
        Ok(())
    }

    pub(super) fn ensure_strip(manager: &TaskbarManager) -> Result<(), String> {
        let state = manager
            .0
            .lock()
            .map_err(|_| "任务栏状态锁失败".to_string())?;
        if state.strip_hwnd == 0
            || !unsafe { IsWindow(Some(HWND(state.strip_hwnd as *mut _))) }.as_bool()
        {
            return Err("任务栏条窗口不可用".to_string());
        }
        Ok(())
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
                    || taskbar_change_needs_reattach(
                        state.last_taskbar,
                        state.last_dpi,
                        taskbar,
                        dpi,
                    );
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

    pub(super) fn window_alive(_window: &tauri::WebviewWindow) -> bool {
        true
    }

    pub(super) fn ensure_strip(_manager: &TaskbarManager) -> Result<(), String> {
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
    let snapshot = windows_impl::enter(app, manager, db)?;
    // 嵌入成功后由 Rust 接管嵌入条点击（BUG-20261109-01 #7）；钩子失败时前端 onClick 仍是后备。
    let strip = manager.0.lock().map(|state| state.strip_hwnd).unwrap_or(0);
    if strip != 0 {
        if let Err(error) = crate::taskbar_click::enable(app, strip) {
            tracing::warn!("[taskbar] {error}");
        }
    }
    Ok(snapshot)
}

pub fn leave_taskbar_mode(app: &AppHandle, manager: &TaskbarManager) -> Result<(), String> {
    crate::taskbar_click::disable();
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

/// 嵌入条点击的目标状态：以策略的有效状态为准（BUG-20261109-01 #3）。
pub fn strip_toggle_target(
    current: crate::window_policy::IslandState,
) -> crate::window_policy::IslandState {
    use crate::window_policy::IslandState;
    if current == IslandState::Expanded {
        IslandState::Compact
    } else {
        IslandState::Expanded
    }
}

/// 同步嵌入条的展开标记，返回是否真的变化。未嵌入时不跟踪。
pub fn set_strip_expanded(manager: &TaskbarManager, expanded: bool) -> bool {
    let Ok(mut state) = manager.0.lock() else {
        return false;
    };
    if state.strip_hwnd == 0 || state.expanded == expanded {
        return false;
    }
    state.expanded = expanded;
    true
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

/// 运行时重挂（Explorer 重启、任务栏尺寸/DPI 变化），由运行时巡检投递到主线程执行
/// （BUG-20261109-01 #5）：`SetParent` 会同步等待嵌入条所在的主线程处理消息，若在后台线程
/// 持有状态锁执行，而主线程恰好在点击命令里等同一把锁，两边互等、应用卡死。
pub fn reattach_on_main_thread(app: &AppHandle) {
    let manager = app.state::<TaskbarManager>();
    let db = app.state::<Db>();
    if let Err(error) = taskbar_reapply(app, manager.inner(), db.inner()) {
        tracing::warn!("[taskbar] 运行时重挂任务栏失败：{error}");
        return;
    }
    tracing::info!("[taskbar] 任务栏已变化，嵌入条已重挂");
    // 重挂会复位嵌入条的展开标记：按窗口策略重放一次，面板几何与标记回到实际状态。
    if let Err(error) = crate::window_policy::reapply(app) {
        tracing::warn!("[taskbar] 重挂后重放窗口策略失败：{error}");
    }
    if let Err(error) = app.emit(
        "window://taskbar-state-changed",
        taskbar_snapshot(manager.inner()),
    ) {
        tracing::warn!("[taskbar] 广播任务栏状态失败：{error}");
    }
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
pub fn taskbar_strip_toggle_command(app: AppHandle) -> Result<bool, String> {
    toggle_from_strip(&app, "webview")
}

/// 嵌入条点击：展开左下角面板或收起（island 隐藏、strip 保留）。`source` 只用于日志，
/// 区分 Rust 钩子接管（`hook`）与前端 onClick 后备（`webview`）。须在主线程调用。
/// 展开标记与 window://taskbar-state-changed 由窗口策略随有效状态同步。
pub fn toggle_from_strip(app: &AppHandle, source: &str) -> Result<bool, String> {
    let manager = app.state::<TaskbarManager>();
    windows_impl::ensure_strip(manager.inner())
        .inspect_err(|error| tracing::warn!(source, "[taskbar] 嵌入条点击被拒绝：{error}"))?;
    let snapshot = crate::window_policy::toggle_taskbar_panel(app)
        .inspect_err(|error| tracing::warn!(source, "[taskbar] 嵌入条点击切换面板失败：{error}"))?;
    let expanded = snapshot.effective_state == crate::window_policy::IslandState::Expanded;
    tracing::info!(
        source,
        expanded,
        effective = ?snapshot.effective_state,
        "[taskbar] 嵌入条点击"
    );
    Ok(expanded)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// BUG-20261109-01 #1：tao 无边框窗口保留 WS_CAPTION/WS_SYSMENU/最小化最大化框，
    /// 作为任务栏子窗口时系统会画出经典标题栏；嵌入样式必须全部去掉，只留子窗口与可见性。
    #[cfg(windows)]
    #[test]
    fn embedded_strip_drops_every_frame_style() {
        use windows::Win32::UI::WindowsAndMessaging::{
            WS_CAPTION, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_ACCEPTFILES, WS_EX_APPWINDOW,
            WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX,
            WS_POPUP, WS_SYSMENU, WS_THICKFRAME, WS_VISIBLE,
        };
        let tao_style = (WS_CAPTION
            | WS_CLIPSIBLINGS
            | WS_SYSMENU
            | WS_MINIMIZEBOX
            | WS_MAXIMIZEBOX
            | WS_THICKFRAME
            | WS_POPUP
            | WS_VISIBLE)
            .0 as isize;
        let tao_exstyle = (WS_EX_WINDOWEDGE
            | WS_EX_ACCEPTFILES
            | WS_EX_TOPMOST
            | WS_EX_TOOLWINDOW
            | WS_EX_APPWINDOW)
            .0 as isize;
        let (style, exstyle) = windows_impl::embedded_child_styles(tao_style, tao_exstyle);
        assert_eq!(style, (WS_CHILD | WS_CLIPSIBLINGS | WS_VISIBLE).0 as isize);
        assert_eq!(exstyle, WS_EX_ACCEPTFILES.0 as isize);
    }

    fn rect(top: i32, height: i32, width: i32) -> TaskbarRect {
        TaskbarRect {
            left: 0,
            top,
            right: width,
            bottom: top + height,
        }
    }

    /// BUG-20261109-01 #4：自动隐藏的任务栏滑入滑出只改位置；嵌入条是它的子窗口会跟着移动，
    /// 不能因此重挂（重挂会在用户点击时拆掉嵌入条）。只有尺寸或 DPI 变化才需要重挂。
    #[test]
    fn auto_hide_slide_does_not_require_reattach() {
        let hidden = rect(1438, 48, 2560);
        let shown = rect(1392, 48, 2560);
        assert!(!taskbar_change_needs_reattach(Some(hidden), 96, shown, 96));
        assert!(!taskbar_change_needs_reattach(Some(shown), 96, hidden, 96));
    }

    #[test]
    fn size_or_dpi_changes_require_reattach() {
        let base = rect(1392, 48, 2560);
        assert!(taskbar_change_needs_reattach(
            Some(base),
            96,
            rect(1368, 72, 2560),
            96
        ));
        assert!(taskbar_change_needs_reattach(
            Some(base),
            96,
            rect(1392, 48, 1920),
            96
        ));
        assert!(taskbar_change_needs_reattach(Some(base), 96, base, 144));
        assert!(taskbar_change_needs_reattach(None, 96, base, 96));
    }

    /// BUG-20261109-02：资源管理器重启会连带销毁嵌入条窗口，而 Tauri 收不到销毁事件、
    /// 旧标签一直占用，重建必须换新标签；首个嵌入条沿用配置里的标签。
    #[test]
    fn rebuilt_strips_get_fresh_labels() {
        assert_eq!(strip_label(0), "taskbar-strip");
        assert_eq!(strip_label(1), "taskbar-strip-r1");
        assert_eq!(strip_label(12), "taskbar-strip-r12");
    }

    /// 重建后的嵌入条必须仍在 taskbar-strip 权限范围内，否则前端调不了后端命令。
    #[test]
    fn strip_capability_covers_rebuilt_labels() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/taskbar-strip.json")).unwrap();
        let windows: Vec<&str> = capability["windows"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|value| value.as_str())
            .collect();
        assert!(windows.contains(&"taskbar-strip"));
        assert!(windows.contains(&"taskbar-strip-*"));
    }

    /// BUG-20261109-01 #3：点击嵌入条以策略的有效状态为准切换，Esc/通知收起后不会错位。
    #[test]
    fn strip_click_toggles_from_the_effective_state() {
        use crate::window_policy::IslandState;
        assert_eq!(
            strip_toggle_target(IslandState::Expanded),
            IslandState::Compact
        );
        assert_eq!(
            strip_toggle_target(IslandState::Compact),
            IslandState::Expanded
        );
        assert_eq!(
            strip_toggle_target(IslandState::Capsule),
            IslandState::Expanded
        );
        assert_eq!(
            strip_toggle_target(IslandState::Hidden),
            IslandState::Expanded
        );
    }

    #[test]
    fn strip_expanded_flag_reports_only_real_changes() {
        let manager = TaskbarManager::new();
        // 未嵌入：不跟踪展开态。
        assert!(!set_strip_expanded(&manager, true));
        manager.0.lock().unwrap().strip_hwnd = 1;
        assert!(set_strip_expanded(&manager, true));
        assert!(!set_strip_expanded(&manager, true));
        assert!(set_strip_expanded(&manager, false));
    }

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
