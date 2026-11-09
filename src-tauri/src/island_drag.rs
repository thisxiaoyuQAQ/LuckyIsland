//! Alt+拖动的结束判定（BUG-20261108-01 真机反馈 2026-11-09）。
//!
//! Windows 上 `start_dragging` 只是投递一条 `WM_NCLBUTTONDOWN` 就返回，真正的拖动在主线程的
//! 系统移动循环里进行；网页收不到松手的 mouseup。若在循环进行中结算落点，循环会按它开始时的
//! 矩形（240×80 拖动胶囊）持续重设窗口，结算恢复的尺寸被冲掉，吸附也按错误时刻判定。
//!
//! 因此由后台线程观测「主线程是否仍在系统移动循环」与「主按钮是否按下」，确认真正松手后
//! 再投递到主线程结算，并广播 [`DRAG_SETTLED_EVENT`] 让前端退出拖动态。

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const DRAG_SETTLED_EVENT: &str = "window://drag-settled";

const POLL_INTERVAL: Duration = Duration::from_millis(15);
/// 系统移动循环由投递消息启动：给主线程留出处理时间，避免循环开始前误判为已结束。
const START_GRACE: Duration = Duration::from_millis(120);
/// 连续多少次观测到「已松开且不在循环内」才结算，过滤循环退出瞬间的抖动。
const RELEASE_CONFIRMATIONS: u8 = 2;
/// 观测异常时的上限，保证窗口不会一直停在拖动态。
const MAX_DRAG: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Observation {
    in_move_loop: bool,
    button_down: bool,
}

/// 连续「已松开」计数：启动宽限期内、系统移动循环内或按钮按下时清零。
fn next_release_count(count: u8, elapsed: Duration, observation: Observation) -> u8 {
    if elapsed < START_GRACE || observation.in_move_loop || observation.button_down {
        0
    } else {
        count.saturating_add(1)
    }
}

fn should_settle(release_count: u8, elapsed: Duration) -> bool {
    release_count >= RELEASE_CONFIRMATIONS || elapsed >= MAX_DRAG
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ActiveDrag {
    pub id: u64,
    /// 拖动胶囊起点（物理像素左上角），结算时判断是否真的移动过。
    pub origin: (i32, i32),
}

/// 当前拖动的唯一持有者：结算与取消只有一方能拿到，新拖动会取代旧拖动。
struct DragRegistry {
    next_id: u64,
    active: Option<ActiveDrag>,
}

impl DragRegistry {
    const fn new() -> Self {
        Self {
            next_id: 0,
            active: None,
        }
    }

    fn start(&mut self, origin: (i32, i32)) -> u64 {
        self.next_id = self.next_id.wrapping_add(1);
        self.active = Some(ActiveDrag {
            id: self.next_id,
            origin,
        });
        self.next_id
    }

    fn is_active(&self, id: u64) -> bool {
        self.active.is_some_and(|drag| drag.id == id)
    }

    fn take_if(&mut self, id: u64) -> Option<ActiveDrag> {
        if self.is_active(id) {
            self.active.take()
        } else {
            None
        }
    }

    fn take(&mut self) -> Option<ActiveDrag> {
        self.active.take()
    }
}

static REGISTRY: Mutex<DragRegistry> = Mutex::new(DragRegistry::new());

fn with_registry<T>(run: impl FnOnce(&mut DragRegistry) -> T) -> Option<T> {
    REGISTRY.lock().ok().map(|mut registry| run(&mut registry))
}

/// 结算结果，经 [`DRAG_SETTLED_EVENT`] 广播；`id` 与 `window_drag_begin` 的返回值对应。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragSettled {
    pub id: u64,
    pub ok: bool,
    pub edge: Option<String>,
    pub error: Option<String>,
}

#[cfg(windows)]
fn window_thread_id(window: &tauri::WebviewWindow) -> Result<u32, String> {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("读取灵动岛窗口句柄失败：{error}"))?;
    Ok(unsafe { GetWindowThreadProcessId(hwnd, None) })
}

#[cfg(not(windows))]
fn window_thread_id(_window: &tauri::WebviewWindow) -> Result<u32, String> {
    Ok(0)
}

#[cfg(windows)]
fn observe(thread_id: u32) -> Observation {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetGUIThreadInfo, GetSystemMetrics, GUITHREADINFO, GUI_INMOVESIZE, SM_SWAPBUTTON,
    };
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    let in_move_loop = unsafe { GetGUIThreadInfo(thread_id, &mut info) }.is_ok()
        && info.flags.0 & GUI_INMOVESIZE.0 != 0;
    // 左右键互换时主按钮是物理右键。
    let primary = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
        VK_RBUTTON
    } else {
        VK_LBUTTON
    };
    let button_down = unsafe { GetAsyncKeyState(i32::from(primary.0)) } as u16 & 0x8000 != 0;
    Observation {
        in_move_loop,
        button_down,
    }
}

#[cfg(not(windows))]
fn observe(_thread_id: u32) -> Observation {
    Observation {
        in_move_loop: false,
        button_down: false,
    }
}

/// 登记拖动并启动系统拖动与结束观测，返回拖动 id。须在主线程、拖动胶囊已就位后调用。
pub fn start(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    origin: (i32, i32),
) -> Result<u64, String> {
    let thread_id = window_thread_id(window)?;
    let id = with_registry(|registry| registry.start(origin))
        .ok_or_else(|| "拖动登记失败".to_string())?;
    if let Err(error) = window.start_dragging() {
        with_registry(|registry| registry.take_if(id));
        return Err(format!("开始拖动失败：{error}"));
    }
    let handle = app.clone();
    std::thread::spawn(move || watch(handle, id, thread_id));
    Ok(id)
}

/// 取消当前拖动（如有），返回被取消的拖动。观察线程随后发现自己已失效并退出。
pub fn cancel() -> Option<ActiveDrag> {
    with_registry(DragRegistry::take).flatten()
}

fn watch(app: AppHandle, id: u64, thread_id: u32) {
    let started = Instant::now();
    let mut released = 0u8;
    loop {
        std::thread::sleep(POLL_INTERVAL);
        if !with_registry(|registry| registry.is_active(id)).unwrap_or(false) {
            return;
        }
        let elapsed = started.elapsed();
        released = next_release_count(released, elapsed, observe(thread_id));
        if should_settle(released, elapsed) {
            break;
        }
    }
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || settle_on_main_thread(&handle, id)) {
        tracing::warn!("[island-drag] 投递拖动结算失败：{error}");
    }
}

fn settle_on_main_thread(app: &AppHandle, id: u64) {
    let Some(drag) = with_registry(|registry| registry.take_if(id)).flatten() else {
        return;
    };
    let result = crate::monitor::settle_drag(app.clone(), Some(drag.origin));
    let payload = match result {
        Ok(edge) => DragSettled {
            id,
            ok: true,
            edge: Some(edge),
            error: None,
        },
        Err(error) => {
            tracing::warn!("[island-drag] 拖动结算失败：{error}");
            DragSettled {
                id,
                ok: false,
                edge: None,
                error: Some(error),
            }
        }
    };
    if let Err(error) = app.emit(DRAG_SETTLED_EVENT, payload) {
        tracing::warn!("[island-drag] 广播拖动结算失败：{error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const MOVING: Observation = Observation {
        in_move_loop: true,
        button_down: true,
    };
    const HELD: Observation = Observation {
        in_move_loop: false,
        button_down: true,
    };
    const RELEASED: Observation = Observation {
        in_move_loop: false,
        button_down: false,
    };

    fn ms(value: u64) -> Duration {
        Duration::from_millis(value)
    }

    #[test]
    fn never_settles_during_the_start_grace_even_if_nothing_is_held() {
        assert_eq!(next_release_count(0, ms(10), RELEASED), 0);
        assert_eq!(next_release_count(1, ms(100), RELEASED), 0);
    }

    #[test]
    fn waits_while_the_system_move_loop_runs_or_the_button_is_held() {
        assert_eq!(next_release_count(1, ms(500), MOVING), 0);
        assert_eq!(next_release_count(1, ms(500), HELD), 0);
        // 系统循环已退出但按钮仍按着（循环还没开始或异常）：继续等。
        assert!(!should_settle(
            next_release_count(0, ms(500), HELD),
            ms(500)
        ));
    }

    #[test]
    fn settles_only_after_consecutive_released_observations() {
        let first = next_release_count(0, ms(500), RELEASED);
        assert!(!should_settle(first, ms(500)));
        let second = next_release_count(first, ms(515), RELEASED);
        assert!(should_settle(second, ms(515)));
        // 中途又观测到拖动循环：重新计数。
        assert_eq!(next_release_count(first, ms(515), MOVING), 0);
    }

    #[test]
    fn caps_the_wait_so_the_island_never_stays_in_drag_mode() {
        assert!(should_settle(0, MAX_DRAG));
        assert!(!should_settle(0, MAX_DRAG - ms(1)));
    }

    #[test]
    fn registry_hands_each_drag_to_exactly_one_owner() {
        let mut registry = DragRegistry::new();
        let first = registry.start((10, 20));
        assert!(registry.is_active(first));

        // 新拖动取代旧拖动：旧观察线程结算时拿不到。
        let second = registry.start((30, 40));
        assert_ne!(first, second);
        assert!(!registry.is_active(first));
        assert_eq!(registry.take_if(first), None);

        assert_eq!(
            registry.take_if(second),
            Some(ActiveDrag {
                id: second,
                origin: (30, 40)
            })
        );
        assert_eq!(registry.take_if(second), None);
    }

    #[test]
    fn cancel_takes_whatever_drag_is_active() {
        let mut registry = DragRegistry::new();
        assert_eq!(registry.take(), None);
        let id = registry.start((1, 2));
        assert_eq!(registry.take().map(|drag| drag.id), Some(id));
        assert!(!registry.is_active(id));
    }
}
