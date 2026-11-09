//! 任务栏嵌入条的点击接管（BUG-20261109-01 #7，用户 2026-11-09 选择「由 Rust 直接接管点击」）。
//!
//! Win11 任务栏的 XAML 内容层（`DesktopWindowContentBridge`）在任务栏显示时会反复排到子窗口
//! 最上层并覆盖整条任务栏：嵌入条看得见，点击却被它接收，前端的 onClick 永远收不到。
//! 与资源管理器争夺层级（第 3 轮的置顶守护）6 秒要抢 28 次，点击仍会落在被压住的瞬间。
//!
//! 因此在任务栏模式下装一个低级鼠标钩子（`WH_MOUSE_LL`），只处理主按钮的按下/松开：
//! 按下与松开都落在「完全露出的嵌入条」范围内时，由 Rust 直接切换面板，并吞掉这次按下与松开，
//! 资源管理器和 WebView 都不会再收到，避免重复处理。其余鼠标事件原样放行，不记录坐标。
//! 钩子跑在独立线程的消息循环里；钩子回调只做原子读写与几个只读 Win32 查询，不加锁、不阻塞。

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::OnceLock;

use tauri::AppHandle;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Button {
    Down,
    Up,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Decision {
    /// 处理后「按下发生在嵌入条上」的标记。
    pressed: bool,
    /// 是否吞掉这条鼠标消息。
    swallow: bool,
    /// 是否切换面板。
    toggle: bool,
}

/// 按键状态机：按下在嵌入条上才接管；接管的按下对应的松开一律吞掉，松开仍在嵌入条上才切换。
fn decide(pressed: bool, button: Button, inside: bool) -> Decision {
    match button {
        Button::Down => Decision {
            pressed: inside,
            swallow: inside,
            toggle: false,
        },
        Button::Up => Decision {
            pressed: false,
            swallow: pressed,
            toggle: pressed && inside,
        },
    }
}

/// 物理像素屏幕矩形，右、下边界不含（与 Win32 `PtInRect` 一致）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ScreenRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// 光标是否点在完全露出的嵌入条上。自动隐藏的任务栏收起时嵌入条大部分在屏外，此时不接管，
/// 避免用户在屏幕底边点一下就意外展开面板。
fn strip_clickable(strip: ScreenRect, monitor: ScreenRect, point: (i32, i32)) -> bool {
    let fully_shown = strip.left >= monitor.left
        && strip.top >= monitor.top
        && strip.right <= monitor.right
        && strip.bottom <= monitor.bottom;
    fully_shown
        && point.0 >= strip.left
        && point.0 < strip.right
        && point.1 >= strip.top
        && point.1 < strip.bottom
}

static APP: OnceLock<AppHandle> = OnceLock::new();
/// 嵌入条 HWND；0 表示未接管（钩子回调直接放行）。
static STRIP: AtomicUsize = AtomicUsize::new(0);
/// 当前生效的钩子线程 ID；旧线程退出前收到的事件按它判断后放行。
static ACTIVE_THREAD: AtomicU32 = AtomicU32::new(0);
static PRESSED: AtomicBool = AtomicBool::new(false);
/// 按下时任务栏最上层子窗口是否就是嵌入条（只用于日志取证）。
static STRIP_ON_TOP_AT_PRESS: AtomicBool = AtomicBool::new(false);

/// 开始接管嵌入条点击。须在主线程调用（嵌入任务栏成功后）；钩子线程已在运行时只更新目标。
pub fn enable(app: &AppHandle, strip_hwnd: usize) -> Result<(), String> {
    let _ = APP.set(app.clone());
    PRESSED.store(false, Ordering::SeqCst);
    STRIP.store(strip_hwnd, Ordering::SeqCst);
    imp::start()
}

/// 停止接管并卸下钩子（退出任务栏模式或重挂前调用）。
pub fn disable() {
    STRIP.store(0, Ordering::SeqCst);
    PRESSED.store(false, Ordering::SeqCst);
    let thread = ACTIVE_THREAD.swap(0, Ordering::SeqCst);
    if thread != 0 {
        imp::stop(thread);
    }
}

fn on_toggle(strip_on_top: bool) {
    let Some(app) = APP.get() else {
        return;
    };
    let handle = app.clone();
    let posted = app.run_on_main_thread(move || {
        tracing::info!(strip_on_top, "[taskbar] 钩子捕获到嵌入条点击");
        let _ = crate::taskbar::toggle_from_strip(&handle, "hook");
    });
    if let Err(error) = posted {
        tracing::warn!("[taskbar] 投递嵌入条点击失败：{error}");
    }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, GetParent, GetWindow, GetWindowRect, IsWindowVisible,
        PeekMessageW, PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx, GW_CHILD, MSG,
        MSLLHOOKSTRUCT, PM_NOREMOVE, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_QUIT,
    };

    fn screen_rect(rect: RECT) -> ScreenRect {
        ScreenRect {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        }
    }

    /// 只读查询：嵌入条可见、矩形完全落在所在显示器内、光标在矩形内。
    fn point_on_strip(strip: HWND, point: POINT) -> bool {
        unsafe {
            if !IsWindowVisible(strip).as_bool() {
                return false;
            }
            let mut rect = RECT::default();
            if GetWindowRect(strip, &mut rect).is_err() {
                return false;
            }
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(
                MonitorFromWindow(strip, MONITOR_DEFAULTTONEAREST),
                &mut info,
            )
            .as_bool()
            {
                return false;
            }
            strip_clickable(
                screen_rect(rect),
                screen_rect(info.rcMonitor),
                (point.x, point.y),
            )
        }
    }

    fn strip_is_top_child(strip: HWND) -> bool {
        unsafe {
            GetParent(strip)
                .and_then(|tray| GetWindow(tray, GW_CHILD))
                .is_ok_and(|top| top == strip)
        }
    }

    /// 返回 true 表示吞掉该消息。
    fn handle_button(button: Button, point: POINT) -> bool {
        let strip_value = STRIP.load(Ordering::SeqCst);
        if strip_value == 0 {
            return false;
        }
        let strip = HWND(strip_value as *mut _);
        let inside = point_on_strip(strip, point);
        let decision = decide(PRESSED.load(Ordering::SeqCst), button, inside);
        PRESSED.store(decision.pressed, Ordering::SeqCst);
        if button == Button::Down && decision.pressed {
            STRIP_ON_TOP_AT_PRESS.store(strip_is_top_child(strip), Ordering::SeqCst);
        }
        if decision.toggle {
            on_toggle(STRIP_ON_TOP_AT_PRESS.load(Ordering::SeqCst));
        }
        decision.swallow
    }

    unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let button = match wparam.0 as u32 {
                WM_LBUTTONDOWN => Some(Button::Down),
                WM_LBUTTONUP => Some(Button::Up),
                _ => None,
            };
            if let Some(button) = button {
                if ACTIVE_THREAD.load(Ordering::SeqCst) == unsafe { GetCurrentThreadId() } {
                    let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
                    if handle_button(button, info.pt) {
                        return LRESULT(1);
                    }
                }
            }
        }
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    fn run(ready: mpsc::Sender<Result<u32, String>>) {
        let thread = unsafe { GetCurrentThreadId() };
        let mut msg = MSG::default();
        // 先建好线程消息队列，stop 才能投递 WM_QUIT。
        let _ = unsafe { PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE) };
        let module = unsafe { GetModuleHandleW(PCWSTR::null()) }
            .ok()
            .map(Into::into);
        let hook = match unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0) } {
            Ok(hook) => hook,
            Err(error) => {
                let _ = ready.send(Err(format!("安装嵌入条点击钩子失败：{error}")));
                return;
            }
        };
        let _ = ready.send(Ok(thread));
        // 低级鼠标钩子只在本线程取消息时被回调；GetMessage 返回 0（WM_QUIT）或 -1 时退出。
        while unsafe { GetMessageW(&mut msg, None, 0, 0) }.0 > 0 {}
        let _ = unsafe { UnhookWindowsHookEx(hook) };
    }

    pub(super) fn start() -> Result<(), String> {
        if ACTIVE_THREAD.load(Ordering::SeqCst) != 0 {
            return Ok(());
        }
        let (ready, receive) = mpsc::channel();
        std::thread::Builder::new()
            .name("taskbar-click-hook".to_string())
            .spawn(move || run(ready))
            .map_err(|error| format!("启动嵌入条点击钩子线程失败：{error}"))?;
        match receive.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(thread)) => {
                ACTIVE_THREAD.store(thread, Ordering::SeqCst);
                tracing::info!("[taskbar] 嵌入条点击钩子已安装");
                Ok(())
            }
            Ok(Err(error)) => Err(error),
            Err(_) => Err("等待嵌入条点击钩子安装超时".to_string()),
        }
    }

    pub(super) fn stop(thread: u32) {
        if let Err(error) = unsafe { PostThreadMessageW(thread, WM_QUIT, WPARAM(0), LPARAM(0)) } {
            tracing::warn!("[taskbar] 卸下嵌入条点击钩子失败：{error}");
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub(super) fn start() -> Result<(), String> {
        Err("任务栏模式仅支持 Windows".to_string())
    }

    pub(super) fn stop(_thread: u32) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    const STRIP: ScreenRect = ScreenRect {
        left: 49,
        top: 1392,
        right: 189,
        bottom: 1440,
    };
    const MONITOR: ScreenRect = ScreenRect {
        left: 0,
        top: 0,
        right: 2560,
        bottom: 1440,
    };

    #[test]
    fn press_inside_is_swallowed_and_release_inside_toggles() {
        let down = decide(false, Button::Down, true);
        assert_eq!(
            down,
            Decision {
                pressed: true,
                swallow: true,
                toggle: false
            }
        );
        let up = decide(down.pressed, Button::Up, true);
        assert_eq!(
            up,
            Decision {
                pressed: false,
                swallow: true,
                toggle: true
            }
        );
    }

    #[test]
    fn release_outside_after_a_swallowed_press_is_swallowed_without_toggling() {
        assert_eq!(
            decide(true, Button::Up, false),
            Decision {
                pressed: false,
                swallow: true,
                toggle: false
            }
        );
    }

    #[test]
    fn clicks_that_start_outside_pass_through() {
        assert_eq!(
            decide(false, Button::Down, false),
            Decision {
                pressed: false,
                swallow: false,
                toggle: false
            }
        );
        assert_eq!(
            decide(false, Button::Up, true),
            Decision {
                pressed: false,
                swallow: false,
                toggle: false
            }
        );
        // 残留的按下标记不会吞掉后来在别处的按下。
        assert!(!decide(true, Button::Down, false).swallow);
    }

    #[test]
    fn only_a_fully_shown_strip_is_clickable() {
        assert!(strip_clickable(STRIP, MONITOR, (100, 1400)));
        // 右、下边界不含（与 PtInRect 一致）。
        assert!(!strip_clickable(STRIP, MONITOR, (189, 1400)));
        assert!(!strip_clickable(STRIP, MONITOR, (100, 1440)));
        assert!(!strip_clickable(STRIP, MONITOR, (40, 1400)));
        // 自动隐藏收起时嵌入条大部分在屏外：屏幕底边那 2px 不算点中。
        let hidden = ScreenRect {
            top: 1438,
            bottom: 1486,
            ..STRIP
        };
        assert!(!strip_clickable(hidden, MONITOR, (100, 1439)));
    }
}
