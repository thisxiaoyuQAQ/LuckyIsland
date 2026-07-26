//! 任务栏嵌入（模块 13a.2）：把 `taskbar-strip` 窗口真嵌入 Windows 任务栏。
//!
//! 契约见 `vault/13a-左下角贴角模式.md` 的 13a.2 节。要点：
//!
//! - **真嵌入**：`GWL_STYLE` 去 `WS_POPUP` 加 `WS_CHILD` → `SetParent` 到 `Shell_TrayWnd`
//!   → `SetWindowPos` 定位到任务栏客户区左端 → `AttachThreadInput` 打通输入队列
//!   （跨进程父子窗口不共享输入状态，不 attach 时 webview 收不到 hover/click）。
//! - **子窗口会被父窗口裁剪**：所以嵌入条只承载静息 UI（时间 + 温度），720×400 的展开
//!   面板必须是另一个顶层窗口（island），不能靠这个窗口向上生长。
//! - **失败必须降级不崩**：探测不到任务栏或 `SetParent` 失败时，窗口保持顶层置顶并按
//!   同一矩形覆盖在任务栏左端（观感退回「贴」而非「嵌」），绝不留下「没有静息 UI」的状态。

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::monitor::MonitorInfo;
use crate::storage::Db;

/// 嵌入条窗口 label（`corner.html`；corner 模式下运行时创建，切走时销毁）。
pub const STRIP_LABEL: &str = "taskbar-strip";
/// 嵌入条逻辑宽度；高度跟随探测到的任务栏高度。
pub const STRIP_WIDTH_LOGICAL: f64 = 200.0;
/// 探测不到任务栏时的兜底逻辑高度（Win11 默认任务栏约 48）。
pub const STRIP_FALLBACK_HEIGHT_LOGICAL: f64 = 48.0;

/// 物理像素矩形（left/top/right/bottom），语义同 `monitor.rs` 的屏幕矩形。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhysicalRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl PhysicalRect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }

    /// 两个矩形是否有正面积交集（用于把副屏任务栏配到对应显示器）。
    fn intersects(&self, other: &PhysicalRect) -> bool {
        self.left < other.right
            && other.left < self.right
            && self.top < other.bottom
            && other.top < self.bottom
    }
}

/// 显示器完整矩形（物理像素，含任务栏）。
pub fn monitor_rect(monitor: &MonitorInfo) -> PhysicalRect {
    PhysicalRect {
        left: monitor.position.x,
        top: monitor.position.y,
        right: monitor.position.x + monitor.size.width as i32,
        bottom: monitor.position.y + monitor.size.height as i32,
    }
}

/// 嵌入条在任务栏内的位置（相对**任务栏客户区**左上角的偏移，物理像素）。
///
/// 基准是任务栏左端贴角（0,0），叠加用户偏移后 clamp 到任务栏矩形内——嵌入后窗口
/// 会被父窗口裁剪，超出部分直接看不见，所以 clamp 是「让用户调不丢」而非美化。
pub fn strip_offset_in_taskbar(
    taskbar: PhysicalRect,
    strip_width: i32,
    strip_height: i32,
    offset_x: i32,
    offset_y: i32,
) -> (i32, i32) {
    let max_x = (taskbar.width() - strip_width).max(0);
    let max_y = (taskbar.height() - strip_height).max(0);
    (offset_x.clamp(0, max_x), offset_y.clamp(0, max_y))
}

/// 降级（未嵌入）时嵌入条的屏幕绝对位置：等价于把上面的相对偏移加回任务栏原点。
pub fn strip_screen_position(
    taskbar: PhysicalRect,
    strip_width: i32,
    strip_height: i32,
    offset_x: i32,
    offset_y: i32,
) -> (i32, i32) {
    let (dx, dy) = strip_offset_in_taskbar(taskbar, strip_width, strip_height, offset_x, offset_y);
    (taskbar.left + dx, taskbar.top + dy)
}

/// 从候选任务栏矩形里挑与目标显示器相交的那一个；没有相交项时回退第一个候选。
pub fn pick_taskbar_for_monitor(
    candidates: &[PhysicalRect],
    monitor: PhysicalRect,
) -> Option<PhysicalRect> {
    candidates
        .iter()
        .find(|rect| rect.intersects(&monitor))
        .or_else(|| candidates.first())
        .copied()
}

/// 探测不到任务栏时的兜底矩形：目标显示器底部一条 `fallback_height` 高的带子。
pub fn fallback_taskbar_rect(monitor: PhysicalRect, fallback_height: i32) -> PhysicalRect {
    PhysicalRect {
        left: monitor.left,
        top: monitor.bottom - fallback_height,
        right: monitor.right,
        bottom: monitor.bottom,
    }
}

/// 目标显示器上「贴屏底的横向任务栏」矩形。
///
/// 只认底部停靠的任务栏：左/右/上侧停靠时它的矩形不是我们要嵌的那条，返回 None 让
/// 调用方走屏底兜底带（此时不尝试嵌入，只做覆盖）。
#[cfg(windows)]
fn bottom_docked_taskbar(screen: PhysicalRect) -> Option<PhysicalRect> {
    let bars = taskbar_rects();
    let bar = pick_taskbar_for_monitor(&bars, screen)?;
    let docked = (bar.bottom - screen.bottom).abs() <= 2
        && bar.top > screen.top
        && bar.height() > 0
        && bar.width() >= screen.width() / 2;
    docked.then_some(bar)
}

#[cfg(not(windows))]
fn bottom_docked_taskbar(_screen: PhysicalRect) -> Option<PhysicalRect> {
    None
}

/// 同步嵌入条到目标状态（模块 13a.2 的唯一入口，由窗口策略裁决点调用）。
///
/// - `corner=false`：销毁窗口。嵌入条是 corner 模式专属，另两种模式下不该常驻一个
///   WebView2 实例白吃几十 MB 内存——所以它是运行时按需创建，而不是静态声明。
/// - `corner=true, visible=false`：只隐藏不销毁。Alt+X 与全屏隐藏是高频动作，
///   每次重建 webview 会有肉眼可见的延迟。
pub fn sync_strip(app: &AppHandle, corner: bool, visible: bool) -> Result<(), String> {
    if !corner {
        if let Some(window) = app.get_webview_window(STRIP_LABEL) {
            #[cfg(windows)]
            if let Ok(hwnd) = window.hwnd() {
                // 先脱离再销毁：留着子窗口交给任务栏销毁会在任务栏里留下空洞。
                detach(hwnd);
            }
            window
                .destroy()
                .map_err(|error| format!("销毁嵌入条失败：{error}"))?;
        }
        return Ok(());
    }
    let window = ensure_strip_window(app)?;
    if !visible {
        return window
            .hide()
            .map_err(|error| format!("隐藏嵌入条失败：{error}"));
    }
    place_strip(app, &window)?;
    window
        .show()
        .map_err(|error| format!("显示嵌入条失败：{error}"))
}

/// 取得（必要时创建）嵌入条窗口。运行时创建在任何线程都可用：tauri-runtime-wry 会把
/// 消息投递到主线程，主线程调用则直接执行。
fn ensure_strip_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(STRIP_LABEL) {
        return Ok(window);
    }
    tauri::WebviewWindowBuilder::new(
        app,
        STRIP_LABEL,
        tauri::WebviewUrl::App("corner.html".into()),
    )
    .title("LuckyIsland 任务栏条")
    .inner_size(STRIP_WIDTH_LOGICAL, STRIP_FALLBACK_HEIGHT_LOGICAL)
    .decorations(false)
    .transparent(true)
    // 嵌入后置顶无意义（子窗口跟随父窗口 z 序）；降级路径再单独打开置顶。
    .always_on_top(false)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .visible(false)
    // 与其它窗口一致：关掉 webview 的拖放接管，避免拦截 HTML5 DnD。
    .disable_drag_drop_handler()
    .build()
    .map_err(|error| format!("创建嵌入条窗口失败：{error}"))
}

/// 重新定位已显示的嵌入条（偏移变化、切屏后调用）；未显示时什么都不做。
pub fn resync_strip(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(STRIP_LABEL) else {
        return Ok(());
    };
    if !window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    place_strip(app, &window)
}

/// 看门狗（2 秒轮询）：explorer 重启会销毁 `Shell_TrayWnd`，任务栏高度/位置/DPI 变化也会
/// 让条错位。`place_strip` 幂等——已正确挂好时只是一次 `SetWindowPos`，代价可忽略。
pub fn watchdog(app: &AppHandle) -> Result<(), String> {
    resync_strip(app)
}

/// 计算并应用嵌入条的尺寸与位置：优先真嵌入任务栏，失败降级为覆盖任务栏左端。
fn place_strip(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let db = app
        .try_state::<Db>()
        .ok_or_else(|| "存储尚未就绪".to_string())?;
    let target = crate::monitor::resolved_monitor_target(app, db.inner()).ok();
    let scale = target
        .as_ref()
        .map(|(_, scale)| *scale)
        .or_else(|| window.scale_factor().ok())
        .unwrap_or(1.0);
    let screen = target
        .as_ref()
        .map(|(monitor, _)| monitor_rect(monitor))
        .or_else(|| {
            // 选屏解析失败（极早期启动）时退回主任务栏所在区域，不放弃定位。
            #[cfg(windows)]
            {
                taskbar_rects().first().copied()
            }
            #[cfg(not(windows))]
            {
                None
            }
        })
        .ok_or_else(|| "无法确定目标显示器".to_string())?;

    let docked = bottom_docked_taskbar(screen);
    let bar = docked.unwrap_or_else(|| {
        fallback_taskbar_rect(
            screen,
            (STRIP_FALLBACK_HEIGHT_LOGICAL * scale).round() as i32,
        )
    });
    let width = (STRIP_WIDTH_LOGICAL * scale).round().max(1.0) as i32;
    let height = bar.height().max(1);
    let (offset_x, offset_y) = crate::monitor::current_offsets(db.inner());

    window
        .set_size(PhysicalSize::new(width as u32, height as u32))
        .map_err(|error| format!("设置嵌入条尺寸失败：{error}"))?;

    #[cfg(windows)]
    if docked.is_some() {
        if let (Ok(hwnd), Some(tray)) = (window.hwnd(), taskbar_hwnd_for(screen)) {
            let (dx, dy) = strip_offset_in_taskbar(bar, width, height, offset_x, offset_y);
            if is_child_of(hwnd, tray) {
                move_child(hwnd, dx, dy, width, height);
                return Ok(());
            }
            if embed(hwnd, tray, dx, dy, width, height) {
                return Ok(());
            }
            tracing::warn!("[taskbar] SetParent 嵌入失败，降级为覆盖任务栏左端");
        }
    }

    // 降级路径：保持顶层置顶，按同一矩形覆盖在任务栏左端（观感退回「贴」而非「嵌」）。
    // 先确保不是子窗口——否则 set_position 的屏幕坐标会被当成父窗口客户区坐标。
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        detach(hwnd);
    }
    let (x, y) = strip_screen_position(bar, width, height, offset_x, offset_y);
    let _ = window.set_always_on_top(true);
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| format!("定位嵌入条失败：{error}"))
}

#[cfg(windows)]
mod platform {
    use super::PhysicalRect;
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::System::Threading::AttachThreadInput;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, FindWindowW, GetParent, GetWindowLongPtrW, GetWindowRect,
        GetWindowThreadProcessId, IsWindow, SetParent, SetWindowLongPtrW, SetWindowPos, GWL_STYLE,
        HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_CHILD, WS_POPUP,
    };

    /// 全部任务栏窗口矩形：主屏 `Shell_TrayWnd` 在前，副屏 `Shell_SecondaryTrayWnd` 依次在后。
    pub fn taskbar_rects() -> Vec<PhysicalRect> {
        let mut out = Vec::new();
        // SAFETY: 只读查询窗口句柄与矩形，句柄由 Win32 返回，失败以 null/Err 表达。
        unsafe {
            if let Ok(primary) = FindWindowW(w!("Shell_TrayWnd"), None) {
                if let Some(rect) = window_rect(primary) {
                    out.push(rect);
                }
            }
            let mut secondary = HWND::default();
            loop {
                let Ok(next) =
                    FindWindowExW(None, Some(secondary), w!("Shell_SecondaryTrayWnd"), None)
                else {
                    break;
                };
                if next.0.is_null() {
                    break;
                }
                if let Some(rect) = window_rect(next) {
                    out.push(rect);
                }
                secondary = next;
            }
        }
        out
    }

    /// 目标显示器上的任务栏窗口句柄（与 `taskbar_rects` 同一套查找规则）。
    pub fn taskbar_hwnd_for(monitor: PhysicalRect) -> Option<HWND> {
        let mut candidates = Vec::new();
        // SAFETY: 同 taskbar_rects。
        unsafe {
            if let Ok(primary) = FindWindowW(w!("Shell_TrayWnd"), None) {
                if !primary.0.is_null() {
                    candidates.push(primary);
                }
            }
            let mut secondary = HWND::default();
            loop {
                let Ok(next) =
                    FindWindowExW(None, Some(secondary), w!("Shell_SecondaryTrayWnd"), None)
                else {
                    break;
                };
                if next.0.is_null() {
                    break;
                }
                candidates.push(next);
                secondary = next;
            }
        }
        let intersecting = candidates.iter().copied().find(|hwnd| {
            window_rect(*hwnd)
                .map(|rect| {
                    rect.left < monitor.right
                        && monitor.left < rect.right
                        && rect.top < monitor.bottom
                        && monitor.top < rect.bottom
                })
                .unwrap_or(false)
        });
        intersecting.or_else(|| candidates.first().copied())
    }

    pub fn window_rect(hwnd: HWND) -> Option<PhysicalRect> {
        if hwnd.0.is_null() {
            return None;
        }
        let mut rect = RECT::default();
        // SAFETY: rect 在调用期间有效；失败返回 Err。
        unsafe { GetWindowRect(hwnd, &mut rect).ok()? };
        Some(PhysicalRect {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        })
    }

    /// 把 `hwnd` 变成 `parent` 的子窗口并定位到 (x, y)（相对父窗口客户区）。
    pub fn embed(hwnd: HWND, parent: HWND, x: i32, y: i32, width: i32, height: i32) -> bool {
        // SAFETY: 两个句柄均来自 Win32/Tauri，调用前校验非空。
        unsafe {
            if hwnd.0.is_null() || parent.0.is_null() || !IsWindow(Some(parent)).as_bool() {
                return false;
            }
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            let child_style = (style & !(WS_POPUP.0 as isize)) | WS_CHILD.0 as isize;
            SetWindowLongPtrW(hwnd, GWL_STYLE, child_style);
            if SetParent(hwnd, Some(parent)).is_err() {
                // 还原样式，交给调用方走降级路径。
                SetWindowLongPtrW(hwnd, GWL_STYLE, style);
                return false;
            }
            let _ = SetWindowPos(
                hwnd,
                None,
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
            attach_input(hwnd, parent, true);
            true
        }
    }

    /// 脱离任务栏，恢复为顶层置顶窗口（切出 corner 模式时调用）。
    pub fn detach(hwnd: HWND) {
        // SAFETY: 句柄来自 Tauri；SetParent(None) 恢复顶层。
        unsafe {
            if hwnd.0.is_null() {
                return;
            }
            let parent = GetParent(hwnd).unwrap_or_default();
            if !parent.0.is_null() {
                attach_input(hwnd, parent, false);
            }
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            let popup_style = (style & !(WS_CHILD.0 as isize)) | WS_POPUP.0 as isize;
            let _ = SetParent(hwnd, None);
            SetWindowLongPtrW(hwnd, GWL_STYLE, popup_style);
            // NOMOVE|NOSIZE 必须带上——只想改 z 序，否则 0,0,0,0 会把窗口挪到左上角并缩成 0×0。
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            );
        }
    }

    /// 当前是否已挂在指定父窗口下（看门狗用：explorer 重启后父窗口失效需重挂）。
    pub fn is_child_of(hwnd: HWND, parent: HWND) -> bool {
        // SAFETY: 只读查询。
        unsafe {
            if hwnd.0.is_null() || parent.0.is_null() {
                return false;
            }
            if !IsWindow(Some(parent)).as_bool() {
                return false;
            }
            GetParent(hwnd).map(|p| p == parent).unwrap_or(false)
        }
    }

    /// 移动已嵌入的子窗口（相对父窗口客户区）。
    pub fn move_child(hwnd: HWND, x: i32, y: i32, width: i32, height: i32) {
        // SAFETY: 句柄来自 Tauri。
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                None,
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }
    }

    /// 跨进程父子窗口默认不共享输入队列，attach 后子窗口才能正常收到鼠标/焦点。
    fn attach_input(hwnd: HWND, parent: HWND, attach: bool) {
        // SAFETY: 线程 ID 由 Win32 返回；attach/detach 成对调用。
        unsafe {
            let mut parent_pid = 0u32;
            let parent_thread = GetWindowThreadProcessId(parent, Some(&mut parent_pid));
            let mut self_pid = 0u32;
            let self_thread = GetWindowThreadProcessId(hwnd, Some(&mut self_pid));
            if parent_thread == 0 || self_thread == 0 || parent_thread == self_thread {
                return;
            }
            let _ = AttachThreadInput(self_thread, parent_thread, attach);
        }
    }
}

#[cfg(windows)]
pub use platform::{detach, embed, is_child_of, move_child, taskbar_hwnd_for, taskbar_rects};

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> PhysicalRect {
        PhysicalRect {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn strip_offset_defaults_to_taskbar_left_corner() {
        // 1920x1080 屏、48px 任务栏；默认偏移 0/0 → 贴任务栏最左上（即屏幕最左下角）。
        let taskbar = rect(0, 1032, 1920, 1080);
        assert_eq!(strip_offset_in_taskbar(taskbar, 200, 48, 0, 0), (0, 0));
        assert_eq!(strip_screen_position(taskbar, 200, 48, 0, 0), (0, 1032));
    }

    #[test]
    fn strip_offset_is_clamped_inside_taskbar() {
        let taskbar = rect(0, 1032, 1920, 1080);
        // 负偏移不能跑出任务栏左边/上边。
        assert_eq!(
            strip_offset_in_taskbar(taskbar, 200, 48, -500, -500),
            (0, 0)
        );
        // 横向最多推到 1920-200；纵向条与任务栏等高时无可移动空间。
        assert_eq!(
            strip_offset_in_taskbar(taskbar, 200, 48, 9999, 9999),
            (1720, 0)
        );
        // 条比任务栏矮时纵向可微调。
        assert_eq!(strip_offset_in_taskbar(taskbar, 200, 40, 0, 9999), (0, 8));
        // 常规值原样通过。
        assert_eq!(strip_offset_in_taskbar(taskbar, 200, 48, 120, 0), (120, 0));
    }

    #[test]
    fn strip_offset_survives_strip_wider_than_taskbar() {
        // 极端：条比任务栏还宽（超小分辨率），clamp 上界不得为负。
        let taskbar = rect(0, 100, 150, 148);
        assert_eq!(strip_offset_in_taskbar(taskbar, 200, 48, 50, 50), (0, 0));
    }

    #[test]
    fn picks_taskbar_intersecting_target_monitor() {
        let primary_bar = rect(0, 1032, 1920, 1080);
        let secondary_bar = rect(1920, 1392, 4480, 1440);
        let candidates = [primary_bar, secondary_bar];
        // 副屏在主屏右侧：应选到副屏那条。
        assert_eq!(
            pick_taskbar_for_monitor(&candidates, rect(1920, 0, 4480, 1440)),
            Some(secondary_bar)
        );
        assert_eq!(
            pick_taskbar_for_monitor(&candidates, rect(0, 0, 1920, 1080)),
            Some(primary_bar)
        );
        // 目标屏没有任何任务栏（副屏关任务栏）→ 回退主屏那条，不返回 None 断链。
        assert_eq!(
            pick_taskbar_for_monitor(&candidates, rect(-1920, 0, 0, 1080)),
            Some(primary_bar)
        );
        // 完全没有候选 → None，调用方走 fallback_taskbar_rect。
        assert_eq!(pick_taskbar_for_monitor(&[], rect(0, 0, 1920, 1080)), None);
    }

    #[test]
    fn fallback_rect_is_bottom_band_of_monitor() {
        assert_eq!(
            fallback_taskbar_rect(rect(0, 0, 1920, 1080), 48),
            rect(0, 1032, 1920, 1080)
        );
        // 负坐标副屏同样成立。
        assert_eq!(
            fallback_taskbar_rect(rect(-1920, -1080, 0, 0), 48),
            rect(-1920, -48, 0, 0)
        );
    }
}
