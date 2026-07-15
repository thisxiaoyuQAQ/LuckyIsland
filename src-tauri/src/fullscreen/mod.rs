use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;

#[cfg(windows)]
mod windows;

pub const FULLSCREEN_EDGE_TOLERANCE_PX: i32 = 2;
pub const FULLSCREEN_SAMPLE_INTERVAL: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PhysicalRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

pub fn covers_monitor(window: PhysicalRect, monitor: PhysicalRect, tolerance: i32) -> bool {
    if window.right <= window.left
        || window.bottom <= window.top
        || monitor.right <= monitor.left
        || monitor.bottom <= monitor.top
    {
        return false;
    }
    let tolerance = tolerance.max(0);
    (window.left - monitor.left).abs() <= tolerance
        && (window.top - monitor.top).abs() <= tolerance
        && (window.right - monitor.right).abs() <= tolerance
        && (window.bottom - monitor.bottom).abs() <= tolerance
}

#[derive(Default)]
pub struct StableSample {
    pending: Option<bool>,
    committed: Option<bool>,
}

impl StableSample {
    pub fn push(&mut self, value: bool) -> Option<bool> {
        if self.committed == Some(value) {
            self.pending = None;
            return None;
        }
        if self.pending == Some(value) {
            self.pending = None;
            self.committed = Some(value);
            Some(value)
        } else {
            self.pending = Some(value);
            None
        }
    }

    pub fn push_unknown(&mut self) {}

    pub fn retry_committed(&mut self, value: bool) {
        if self.committed == Some(value) {
            self.committed = None;
            self.pending = Some(value);
        }
    }

    fn reset(&mut self) {
        self.pending = None;
        self.committed = None;
    }
}

#[derive(Clone)]
pub struct FullscreenController {
    enabled: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
}

impl Default for FullscreenController {
    fn default() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl FullscreenController {
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
    }

    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Release);
    }
}

pub fn start(app: AppHandle, controller: FullscreenController) {
    std::thread::spawn(move || {
        let mut stable = StableSample::default();
        let mut was_enabled = false;
        while !controller.shutdown.load(Ordering::Acquire) {
            let enabled = controller.enabled.load(Ordering::Acquire);
            if !enabled {
                if was_enabled {
                    stable.reset();
                    if let Err(error) = crate::window_policy::set_fullscreen_block(&app, false) {
                        eprintln!("[fullscreen] clear block failed: {error}");
                    }
                    was_enabled = false;
                }
                std::thread::sleep(FULLSCREEN_SAMPLE_INTERVAL);
                continue;
            }
            was_enabled = true;

            #[cfg(windows)]
            let sample = windows::sample(&app);
            #[cfg(not(windows))]
            let sample = Some(false);

            match sample {
                Some(value) => {
                    if let Some(blocked) = stable.push(value) {
                        if let Err(error) =
                            crate::window_policy::set_fullscreen_block(&app, blocked)
                        {
                            stable.retry_committed(blocked);
                            eprintln!("[fullscreen] apply sample failed: {error}");
                        }
                    }
                }
                None => stable.push_unknown(),
            }
            std::thread::sleep(FULLSCREEN_SAMPLE_INTERVAL);
        }
    });
}

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
    fn exact_monitor_rect_is_fullscreen() {
        assert!(covers_monitor(
            rect(0, 0, 1920, 1080),
            rect(0, 0, 1920, 1080),
            FULLSCREEN_EDGE_TOLERANCE_PX,
        ));
    }

    #[test]
    fn edge_tolerance_accepts_two_pixels_but_not_three() {
        let monitor = rect(0, 0, 1920, 1080);
        assert!(covers_monitor(rect(-2, 2, 1918, 1082), monitor, 2));
        assert!(!covers_monitor(rect(-3, 2, 1918, 1082), monitor, 2));
    }

    #[test]
    fn maximized_work_area_with_taskbar_gap_is_not_fullscreen() {
        assert!(!covers_monitor(
            rect(0, 0, 1920, 1040),
            rect(0, 0, 1920, 1080),
            FULLSCREEN_EDGE_TOLERANCE_PX,
        ));
    }

    #[test]
    fn window_on_different_monitor_is_not_fullscreen() {
        assert!(!covers_monitor(
            rect(1920, 0, 3840, 1080),
            rect(0, 0, 1920, 1080),
            FULLSCREEN_EDGE_TOLERANCE_PX,
        ));
    }

    #[test]
    fn invalid_or_empty_rect_is_not_fullscreen() {
        let monitor = rect(0, 0, 1920, 1080);
        assert!(!covers_monitor(rect(0, 0, 0, 1080), monitor, 2));
        assert!(!covers_monitor(rect(0, 0, 1920, 0), monitor, 2));
    }

    #[test]
    fn stable_sample_requires_two_equal_observations() {
        let mut sample = StableSample::default();
        assert_eq!(sample.push(true), None);
        assert_eq!(sample.push(true), Some(true));
        assert_eq!(sample.push(true), None);
        assert_eq!(sample.push(false), None);
        assert_eq!(sample.push(false), Some(false));
    }

    #[test]
    fn failed_commit_can_retry_after_one_more_matching_sample() {
        let mut sample = StableSample::default();
        assert_eq!(sample.push(true), None);
        assert_eq!(sample.push(true), Some(true));
        sample.retry_committed(true);
        assert_eq!(sample.push(true), Some(true));
    }

    #[test]
    fn unknown_sample_preserves_pending_and_committed_state() {
        let mut sample = StableSample::default();
        assert_eq!(sample.push(true), None);
        sample.push_unknown();
        assert_eq!(sample.push(true), Some(true));
        sample.push_unknown();
        assert_eq!(sample.push(false), None);
        assert_eq!(sample.push(false), Some(false));
    }
}
