use std::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::types::{CancelStatus, ProviderKind};

#[derive(Clone)]
pub struct ActiveRequest {
    pub id: String,
    pub provider: ProviderKind,
    pub cancel: CancellationToken,
}

#[derive(Default)]
pub struct AiRuntime {
    active: Mutex<Option<ActiveRequest>>,
}

impl AiRuntime {
    pub fn register(&self, id: String, provider: ProviderKind) -> Result<ActiveRequest, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "AI 运行状态锁已损坏".to_string())?;
        if active.is_some() {
            return Err("已有 AI 请求正在运行，请先终止或等待完成".to_string());
        }
        let request = ActiveRequest {
            id,
            provider,
            cancel: CancellationToken::new(),
        };
        *active = Some(request.clone());
        Ok(request)
    }

    pub fn cancel(&self, id: &str) -> CancelStatus {
        let Ok(mut active) = self.active.lock() else {
            return CancelStatus::NotCurrent;
        };
        match active.as_ref() {
            None => CancelStatus::AlreadyFinished,
            Some(current) if current.id != id => CancelStatus::NotCurrent,
            Some(_) => {
                let request = active.take().expect("active request was checked");
                request.cancel.cancel();
                CancelStatus::Cancelled
            }
        }
    }

    pub fn is_current(&self, id: &str) -> bool {
        self.active
            .lock()
            .ok()
            .and_then(|active| active.as_ref().map(|request| request.id == id))
            .unwrap_or(false)
    }

    pub fn clear_if_current(&self, id: &str) -> bool {
        let Ok(mut active) = self.active.lock() else {
            return false;
        };
        if active.as_ref().is_some_and(|request| request.id == id) {
            active.take();
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::ProviderKind;

    #[test]
    fn cancel_a_releases_slot_and_late_clear_cannot_remove_b() {
        let runtime = AiRuntime::default();
        let a = runtime
            .register("A".into(), ProviderKind::CodexCli)
            .unwrap();
        assert_eq!(runtime.cancel("A"), CancelStatus::Cancelled);
        assert!(a.cancel.is_cancelled());
        runtime.register("B".into(), ProviderKind::ChatApi).unwrap();
        assert!(!runtime.clear_if_current("A"));
        assert!(runtime.is_current("B"));
    }

    #[test]
    fn cancel_statuses_and_busy_registration_are_distinct() {
        let runtime = AiRuntime::default();
        assert_eq!(runtime.cancel("A"), CancelStatus::AlreadyFinished);
        let a = runtime
            .register("A".into(), ProviderKind::ClaudeCli)
            .unwrap();
        assert_eq!(runtime.cancel("B"), CancelStatus::NotCurrent);
        assert!(!a.cancel.is_cancelled());
        assert!(runtime.register("B".into(), ProviderKind::ChatApi).is_err());
    }
}
