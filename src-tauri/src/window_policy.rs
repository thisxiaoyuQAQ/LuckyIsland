use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Size, State};

use crate::monitor::ISLAND_WIDTH_LOGICAL;
use crate::storage::Db;

pub const CLICK_THROUGH_KEY: &str = "window:click_through";
pub const HOVER_EXPAND_KEY: &str = "window:hover_expand";

const COMPACT_HEIGHT_LOGICAL: f64 = 80.0;
const EXPANDED_HEIGHT_LOGICAL: f64 = 400.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandState {
    Hidden,
    Compact,
    Expanded,
}

impl IslandState {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "hidden" => Ok(Self::Hidden),
            "compact" => Ok(Self::Compact),
            "expanded" => Ok(Self::Expanded),
            _ => Err(format!("未知灵动岛状态：{value}")),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FocusIntent {
    Preserve,
    Focus,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowPolicyInputs {
    pub desired_state: IslandState,
    pub hover_expand: bool,
    pub hovered: bool,
    pub click_through: bool,
    pub hide_in_fullscreen: bool,
    pub fullscreen_block: bool,
    pub priority_override_generation: u64,
    pub priority_override_active: bool,
}

impl WindowPolicyInputs {
    pub fn new(desired_state: IslandState) -> Self {
        Self {
            desired_state,
            hover_expand: false,
            hovered: false,
            click_through: false,
            hide_in_fullscreen: false,
            fullscreen_block: false,
            priority_override_generation: 0,
            priority_override_active: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowDecision {
    pub effective_state: IslandState,
    pub focus: FocusIntent,
}

pub fn reduce(inputs: WindowPolicyInputs, requested_focus: FocusIntent) -> WindowDecision {
    if inputs.desired_state == IslandState::Hidden {
        return WindowDecision {
            effective_state: IslandState::Hidden,
            focus: FocusIntent::Preserve,
        };
    }
    if inputs.priority_override_active {
        return WindowDecision {
            effective_state: IslandState::Expanded,
            focus: FocusIntent::Preserve,
        };
    }
    if inputs.hide_in_fullscreen && inputs.fullscreen_block {
        return WindowDecision {
            effective_state: IslandState::Hidden,
            focus: FocusIntent::Preserve,
        };
    }
    if inputs.desired_state == IslandState::Compact
        && inputs.hover_expand
        && inputs.hovered
        && !inputs.click_through
    {
        return WindowDecision {
            effective_state: IslandState::Expanded,
            focus: FocusIntent::Preserve,
        };
    }
    WindowDecision {
        effective_state: inputs.desired_state,
        focus: requested_focus,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WindowOp {
    ResizeCompact,
    ResizeExpanded,
    Show,
    Hide,
    Focus,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct EffectPlan {
    ops: Vec<WindowOp>,
}

impl EffectPlan {
    fn between(previous: Option<WindowDecision>, next: WindowDecision) -> Self {
        let Some(previous) = previous else {
            return Self::for_transition(next);
        };
        if previous.effective_state == next.effective_state {
            return if next.effective_state != IslandState::Hidden
                && next.focus == FocusIntent::Focus
            {
                Self {
                    ops: vec![WindowOp::Focus],
                }
            } else {
                Self::default()
            };
        }
        Self::for_transition(next)
    }

    fn for_transition(next: WindowDecision) -> Self {
        let mut ops = match next.effective_state {
            IslandState::Hidden => vec![WindowOp::Hide],
            IslandState::Compact => vec![WindowOp::ResizeCompact, WindowOp::Show],
            IslandState::Expanded => vec![WindowOp::ResizeExpanded, WindowOp::Show],
        };
        if next.effective_state != IslandState::Hidden && next.focus == FocusIntent::Focus {
            ops.push(WindowOp::Focus);
        }
        Self { ops }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPolicySnapshot {
    pub desired_state: IslandState,
    pub effective_state: IslandState,
    pub should_focus: bool,
    pub click_through: bool,
    pub hover_expand: bool,
    pub hovered: bool,
    pub hide_in_fullscreen: bool,
    pub fullscreen_supported: bool,
    pub fullscreen_block: bool,
    pub priority_override_active: bool,
    pub priority_override_generation: u64,
}

struct WindowPolicyRuntime {
    inputs: WindowPolicyInputs,
    last_applied: Option<WindowDecision>,
    operation_generation: u64,
}

pub struct WindowPolicy(Mutex<WindowPolicyRuntime>);

impl WindowPolicy {
    pub fn new(inputs: WindowPolicyInputs) -> Self {
        Self(Mutex::new(WindowPolicyRuntime {
            inputs,
            last_applied: None,
            operation_generation: 0,
        }))
    }
}

struct AppClickThroughContext<'a> {
    app: &'a AppHandle,
    db: &'a Db,
    inputs: WindowPolicyInputs,
    previous: Option<WindowDecision>,
}

impl ClickThroughTransactionContext for AppClickThroughContext<'_> {
    fn inputs(&self) -> WindowPolicyInputs {
        self.inputs
    }

    fn set_ignore_cursor_events(&mut self, enabled: bool) -> Result<(), String> {
        let window = self
            .app
            .get_webview_window("island")
            .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
        window
            .set_ignore_cursor_events(enabled)
            .map_err(|error| format!("设置鼠标穿透失败：{error}"))?;

        let mut next = self.inputs;
        next.click_through = enabled;
        if enabled {
            next.hovered = false;
        }
        let decision = reduce(next, FocusIntent::Preserve);
        if let Err(error) = apply_effects(&window, self.previous, decision) {
            let _ = window.set_ignore_cursor_events(self.inputs.click_through);
            return Err(error);
        }
        Ok(())
    }

    fn persist(&mut self, enabled: bool) -> Result<(), String> {
        self.db
            .setting_set(CLICK_THROUGH_KEY, if enabled { "true" } else { "false" })
    }

    fn commit(&mut self, inputs: WindowPolicyInputs) {
        self.inputs = inputs;
        let decision = reduce(inputs, FocusIntent::Preserve);
        if let Ok(mut runtime) = self.app.state::<WindowPolicy>().0.lock() {
            runtime.inputs = inputs;
            runtime.last_applied = Some(WindowDecision {
                effective_state: decision.effective_state,
                focus: FocusIntent::Preserve,
            });
        }
    }

    fn publish(&mut self, snapshot: WindowPolicySnapshot) -> Result<(), String> {
        emit_snapshot(self.app, &snapshot)
    }
}

fn snapshot(inputs: WindowPolicyInputs, decision: WindowDecision) -> WindowPolicySnapshot {
    WindowPolicySnapshot {
        desired_state: inputs.desired_state,
        effective_state: decision.effective_state,
        should_focus: decision.focus == FocusIntent::Focus,
        click_through: inputs.click_through,
        hover_expand: inputs.hover_expand,
        hovered: inputs.hovered,
        hide_in_fullscreen: inputs.hide_in_fullscreen,
        fullscreen_supported: cfg!(windows),
        fullscreen_block: inputs.fullscreen_block,
        priority_override_active: inputs.priority_override_active,
        priority_override_generation: inputs.priority_override_generation,
    }
}

trait ClickThroughTransactionContext {
    fn inputs(&self) -> WindowPolicyInputs;
    fn set_ignore_cursor_events(&mut self, enabled: bool) -> Result<(), String>;
    fn persist(&mut self, enabled: bool) -> Result<(), String>;
    fn commit(&mut self, inputs: WindowPolicyInputs);
    fn publish(&mut self, snapshot: WindowPolicySnapshot) -> Result<(), String>;
}

fn apply_click_through_transaction(
    context: &mut impl ClickThroughTransactionContext,
    enabled: bool,
) -> Result<WindowPolicySnapshot, String> {
    let previous = context.inputs();
    let mut next = previous;
    next.click_through = enabled;
    if enabled {
        next.hovered = false;
    }

    context.set_ignore_cursor_events(enabled)?;
    if let Err(error) = context.persist(enabled) {
        let _ = context.set_ignore_cursor_events(previous.click_through);
        return Err(error);
    }

    context.commit(next);
    let snapshot = snapshot(next, reduce(next, FocusIntent::Preserve));
    context.publish(snapshot.clone())?;
    Ok(snapshot)
}

fn restore_click_through_transaction(
    context: &mut impl ClickThroughTransactionContext,
    stored_enabled: bool,
) -> Result<WindowPolicySnapshot, String> {
    match apply_click_through_transaction(context, stored_enabled) {
        Ok(snapshot) => Ok(snapshot),
        Err(_) if stored_enabled => {
            let mut fallback = context.inputs();
            fallback.click_through = false;
            context.persist(false)?;
            context.commit(fallback);
            let snapshot = snapshot(fallback, reduce(fallback, FocusIntent::Preserve));
            context.publish(snapshot.clone())?;
            Ok(snapshot)
        }
        Err(error) => Err(error),
    }
}

fn apply_effects(
    window: &tauri::WebviewWindow,
    previous: Option<WindowDecision>,
    decision: WindowDecision,
) -> Result<(), String> {
    for op in EffectPlan::between(previous, decision).ops {
        match op {
            WindowOp::ResizeCompact => window
                .set_size(Size::Logical(LogicalSize {
                    width: ISLAND_WIDTH_LOGICAL,
                    height: COMPACT_HEIGHT_LOGICAL,
                }))
                .map_err(|error| format!("收起灵动岛窗口失败：{error}"))?,
            WindowOp::ResizeExpanded => window
                .set_size(Size::Logical(LogicalSize {
                    width: ISLAND_WIDTH_LOGICAL,
                    height: EXPANDED_HEIGHT_LOGICAL,
                }))
                .map_err(|error| format!("展开灵动岛窗口失败：{error}"))?,
            WindowOp::Show => window
                .show()
                .map_err(|error| format!("显示灵动岛窗口失败：{error}"))?,
            WindowOp::Hide => window
                .hide()
                .map_err(|error| format!("隐藏灵动岛窗口失败：{error}"))?,
            WindowOp::Focus => window
                .set_focus()
                .map_err(|error| format!("聚焦灵动岛窗口失败：{error}"))?,
        }
    }
    Ok(())
}

fn emit_snapshot(app: &AppHandle, snapshot: &WindowPolicySnapshot) -> Result<(), String> {
    app.emit("window://state-changed", snapshot)
        .map_err(|error| format!("广播灵动岛状态失败：{error}"))?;
    app.emit("window://policy-changed", snapshot)
        .map_err(|error| format!("广播窗口策略失败：{error}"))
}

fn update_and_apply(
    app: &AppHandle,
    mutate: impl FnOnce(&mut WindowPolicyInputs),
    focus: FocusIntent,
) -> Result<WindowPolicySnapshot, String> {
    let policy = app.state::<WindowPolicy>();
    let (previous, inputs, generation) = {
        let mut runtime = policy.0.lock().map_err(|error| error.to_string())?;
        let previous = runtime.last_applied;
        mutate(&mut runtime.inputs);
        runtime.operation_generation = runtime.operation_generation.wrapping_add(1);
        (previous, runtime.inputs, runtime.operation_generation)
    };

    let decision = reduce(inputs, focus);
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    apply_effects(&window, previous, decision)?;

    let current = {
        let mut runtime = policy.0.lock().map_err(|error| error.to_string())?;
        if runtime.operation_generation != generation {
            None
        } else {
            // Focus is an operation request, not durable visual state. Storing Preserve lets a
            // later explicit user action focus an already-visible window again.
            runtime.last_applied = Some(WindowDecision {
                effective_state: decision.effective_state,
                focus: FocusIntent::Preserve,
            });
            Some(snapshot(runtime.inputs, decision))
        }
    };

    if let Some(snapshot) = current {
        emit_snapshot(app, &snapshot)?;
        Ok(snapshot)
    } else {
        reapply(app)
    }
}

pub fn set_desired_state(
    app: &AppHandle,
    state: IslandState,
    focus: FocusIntent,
) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(app, |inputs| inputs.desired_state = state, focus)
}

fn apply_hover_report(inputs: &mut WindowPolicyInputs, hovered: bool) {
    inputs.hovered = hovered && inputs.hover_expand && !inputs.click_through;
}

fn apply_hover_expand_setting(inputs: &mut WindowPolicyInputs, enabled: bool) {
    inputs.hover_expand = enabled;
    if !enabled || inputs.click_through {
        inputs.hovered = false;
    }
}

fn apply_notification_intent(inputs: &mut WindowPolicyInputs) {
    if inputs.desired_state != IslandState::Hidden {
        inputs.desired_state = IslandState::Expanded;
    }
}

pub fn present_notification(app: &AppHandle) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(app, apply_notification_intent, FocusIntent::Preserve)
}

pub fn toggle_visibility(app: &AppHandle) -> Result<WindowPolicySnapshot, String> {
    let desired = {
        let policy = app.state::<WindowPolicy>();
        let runtime = policy.0.lock().map_err(|error| error.to_string())?;
        if runtime.inputs.desired_state == IslandState::Hidden {
            IslandState::Compact
        } else {
            IslandState::Hidden
        }
    };
    set_desired_state(app, desired, FocusIntent::Focus)
}

pub fn reapply(app: &AppHandle) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(app, |_| {}, FocusIntent::Preserve)
}

pub fn set_click_through(
    app: &AppHandle,
    db: &Db,
    enabled: bool,
) -> Result<WindowPolicySnapshot, String> {
    let (inputs, previous) = {
        let policy = app.state::<WindowPolicy>();
        let runtime = policy.0.lock().map_err(|error| error.to_string())?;
        (runtime.inputs, runtime.last_applied)
    };
    apply_click_through_transaction(
        &mut AppClickThroughContext {
            app,
            db,
            inputs,
            previous,
        },
        enabled,
    )
}

pub fn toggle_click_through(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String> {
    let enabled = !window_policy_snapshot(app)?.click_through;
    set_click_through(app, db, enabled)
}

fn window_policy_snapshot(app: &AppHandle) -> Result<WindowPolicySnapshot, String> {
    let policy = app.state::<WindowPolicy>();
    let runtime = policy.0.lock().map_err(|error| error.to_string())?;
    let decision = reduce(runtime.inputs, FocusIntent::Preserve);
    Ok(snapshot(runtime.inputs, decision))
}

pub fn restore_click_through(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String> {
    let stored_enabled = db
        .setting_get(CLICK_THROUGH_KEY)
        .map(|value| value == "true")
        .unwrap_or(false);
    let (inputs, previous) = {
        let policy = app.state::<WindowPolicy>();
        let runtime = policy.0.lock().map_err(|error| error.to_string())?;
        (runtime.inputs, runtime.last_applied)
    };
    restore_click_through_transaction(
        &mut AppClickThroughContext {
            app,
            db,
            inputs,
            previous,
        },
        stored_enabled,
    )
}

#[tauri::command]
pub fn window_click_through_set(
    app: AppHandle,
    db: State<'_, Db>,
    enabled: bool,
) -> Result<WindowPolicySnapshot, String> {
    set_click_through(&app, db.inner(), enabled)
}

pub fn restore_hover_expand(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String> {
    let enabled = db
        .setting_get(HOVER_EXPAND_KEY)
        .map(|value| value == "true")
        .unwrap_or(false);
    update_and_apply(
        app,
        |inputs| apply_hover_expand_setting(inputs, enabled),
        FocusIntent::Preserve,
    )
}

pub fn reload_persisted_settings(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String> {
    restore_click_through(app, db)?;
    restore_hover_expand(app, db)
}

#[tauri::command]
pub fn window_hover_set(app: AppHandle, hovered: bool) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(
        &app,
        |inputs| apply_hover_report(inputs, hovered),
        FocusIntent::Preserve,
    )
}

#[tauri::command]
pub fn window_hover_expand_set(
    app: AppHandle,
    db: State<'_, Db>,
    enabled: bool,
) -> Result<WindowPolicySnapshot, String> {
    let previous = window_policy_snapshot(&app)?.hover_expand;
    let snapshot = update_and_apply(
        &app,
        |inputs| apply_hover_expand_setting(inputs, enabled),
        FocusIntent::Preserve,
    )?;
    if let Err(error) = db.setting_set(HOVER_EXPAND_KEY, if enabled { "true" } else { "false" }) {
        let _ = update_and_apply(
            &app,
            |inputs| apply_hover_expand_setting(inputs, previous),
            FocusIntent::Preserve,
        );
        return Err(error);
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn window_policy_get(policy: State<'_, WindowPolicy>) -> Result<WindowPolicySnapshot, String> {
    let runtime = policy.0.lock().map_err(|error| error.to_string())?;
    let decision = reduce(runtime.inputs, FocusIntent::Preserve);
    Ok(snapshot(runtime.inputs, decision))
}

#[tauri::command]
pub fn set_island_state(app: AppHandle, state: String) -> Result<WindowPolicySnapshot, String> {
    let state = IslandState::parse(&state)?;
    set_desired_state(&app, state, FocusIntent::Focus)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs(
        desired_state: IslandState,
        fullscreen_block: bool,
        priority_override_active: bool,
    ) -> WindowPolicyInputs {
        let mut inputs = WindowPolicyInputs::new(desired_state);
        inputs.hide_in_fullscreen = true;
        inputs.fullscreen_block = fullscreen_block;
        inputs.priority_override_generation = u64::from(priority_override_active);
        inputs.priority_override_active = priority_override_active;
        inputs
    }

    fn decision(effective_state: IslandState) -> WindowDecision {
        WindowDecision {
            effective_state,
            focus: FocusIntent::Preserve,
        }
    }

    fn focused(effective_state: IslandState) -> WindowDecision {
        WindowDecision {
            effective_state,
            focus: FocusIntent::Focus,
        }
    }

    #[test]
    fn identical_effective_decision_has_no_platform_effects() {
        assert_eq!(
            EffectPlan::between(
                Some(decision(IslandState::Compact)),
                decision(IslandState::Compact),
            ),
            EffectPlan::default()
        );
    }

    #[test]
    fn hidden_to_expanded_orders_resize_show_then_focus() {
        assert_eq!(
            EffectPlan::between(
                Some(decision(IslandState::Hidden)),
                focused(IslandState::Expanded),
            )
            .ops,
            vec![WindowOp::ResizeExpanded, WindowOp::Show, WindowOp::Focus]
        );
    }

    #[test]
    fn explicit_focus_applies_when_state_is_already_visible() {
        assert_eq!(
            EffectPlan::between(
                Some(decision(IslandState::Compact)),
                focused(IslandState::Compact),
            )
            .ops,
            vec![WindowOp::Focus]
        );
    }

    #[test]
    fn repeated_explicit_focus_is_still_an_operation_request() {
        assert_eq!(
            EffectPlan::between(
                Some(focused(IslandState::Compact)),
                focused(IslandState::Compact),
            )
            .ops,
            vec![WindowOp::Focus]
        );
    }

    #[test]
    fn focus_is_not_repeated_when_only_non_visual_inputs_change() {
        let previous = focused(IslandState::Compact);
        let next = decision(IslandState::Compact);
        assert!(EffectPlan::between(Some(previous), next).ops.is_empty());
    }

    #[test]
    fn invalid_state_is_rejected_instead_of_silently_ignored() {
        assert_eq!(
            IslandState::parse("floating").unwrap_err(),
            "未知灵动岛状态：floating"
        );
    }

    #[test]
    fn user_hidden_beats_priority_override() {
        let decision = reduce(
            inputs(IslandState::Hidden, true, true),
            FocusIntent::Preserve,
        );
        assert_eq!(decision.effective_state, IslandState::Hidden);
        assert_eq!(decision.focus, FocusIntent::Preserve);
    }

    #[test]
    fn priority_override_beats_fullscreen_without_focus() {
        let decision = reduce(inputs(IslandState::Compact, true, true), FocusIntent::Focus);
        assert_eq!(
            decision,
            WindowDecision {
                effective_state: IslandState::Expanded,
                focus: FocusIntent::Preserve,
            }
        );
    }

    #[test]
    fn fullscreen_hides_normal_state_without_focus() {
        let decision = reduce(
            inputs(IslandState::Compact, true, false),
            FocusIntent::Focus,
        );
        assert_eq!(
            decision,
            WindowDecision {
                effective_state: IslandState::Hidden,
                focus: FocusIntent::Preserve,
            }
        );
    }

    #[test]
    fn hover_only_expands_compact_non_click_through() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.hover_expand = true;
        policy_inputs.hovered = true;

        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Expanded
        );

        policy_inputs.click_through = true;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Compact
        );
    }

    #[test]
    fn hover_reports_are_coerced_when_disabled_or_click_through() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);

        apply_hover_report(&mut policy_inputs, true);
        assert!(!policy_inputs.hovered);

        policy_inputs.hover_expand = true;
        apply_hover_report(&mut policy_inputs, true);
        assert!(policy_inputs.hovered);

        policy_inputs.click_through = true;
        apply_hover_report(&mut policy_inputs, true);
        assert!(!policy_inputs.hovered);
    }

    #[test]
    fn disabling_hover_expand_clears_transient_hover() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.hover_expand = true;
        policy_inputs.hovered = true;

        apply_hover_expand_setting(&mut policy_inputs, false);

        assert!(!policy_inputs.hover_expand);
        assert!(!policy_inputs.hovered);
    }

    #[test]
    fn notification_from_compact_expands_without_focus() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        apply_notification_intent(&mut policy_inputs);
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve),
            WindowDecision {
                effective_state: IslandState::Expanded,
                focus: FocusIntent::Preserve,
            }
        );
    }

    #[test]
    fn notification_does_not_override_user_hidden() {
        let mut policy_inputs = inputs(IslandState::Hidden, false, false);
        apply_notification_intent(&mut policy_inputs);
        assert_eq!(policy_inputs.desired_state, IslandState::Hidden);
    }

    struct ClickThroughHarness {
        inputs: WindowPolicyInputs,
        fail_ignore_cursor: bool,
        persisted: Vec<bool>,
        emitted: Vec<WindowPolicySnapshot>,
    }

    impl ClickThroughHarness {
        fn compact() -> Self {
            Self {
                inputs: WindowPolicyInputs::new(IslandState::Compact),
                fail_ignore_cursor: false,
                persisted: Vec::new(),
                emitted: Vec::new(),
            }
        }
    }

    impl ClickThroughTransactionContext for ClickThroughHarness {
        fn inputs(&self) -> WindowPolicyInputs {
            self.inputs
        }

        fn set_ignore_cursor_events(&mut self, _enabled: bool) -> Result<(), String> {
            if self.fail_ignore_cursor {
                Err("ignore cursor failed".to_string())
            } else {
                Ok(())
            }
        }

        fn persist(&mut self, enabled: bool) -> Result<(), String> {
            self.persisted.push(enabled);
            Ok(())
        }

        fn commit(&mut self, inputs: WindowPolicyInputs) {
            self.inputs = inputs;
        }

        fn publish(&mut self, snapshot: WindowPolicySnapshot) -> Result<(), String> {
            self.emitted.push(snapshot);
            Ok(())
        }
    }

    #[test]
    fn enabling_click_through_clears_hover_before_reduce() {
        let mut harness = ClickThroughHarness::compact();
        harness.inputs.hover_expand = true;
        harness.inputs.hovered = true;

        let snapshot = apply_click_through_transaction(&mut harness, true).unwrap();

        assert!(!snapshot.hovered);
        assert!(snapshot.click_through);
        assert_eq!(snapshot.effective_state, IslandState::Compact);
    }

    #[test]
    fn failed_ignore_cursor_does_not_persist_or_publish_enabled() {
        let mut harness = ClickThroughHarness::compact();
        harness.fail_ignore_cursor = true;

        assert!(apply_click_through_transaction(&mut harness, true).is_err());
        assert!(!harness.inputs.click_through);
        assert!(harness.persisted.is_empty());
        assert!(harness.emitted.is_empty());
    }

    #[test]
    fn startup_restore_failure_falls_back_to_false_snapshot() {
        let mut harness = ClickThroughHarness::compact();
        harness.fail_ignore_cursor = true;

        let snapshot = restore_click_through_transaction(&mut harness, true).unwrap();

        assert!(!snapshot.click_through);
        assert_eq!(harness.persisted, vec![false]);
        assert_eq!(harness.emitted.len(), 1);
    }

    #[test]
    fn pointer_leave_never_collapses_explicit_expanded() {
        let policy_inputs = inputs(IslandState::Expanded, false, false);
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Expanded
        );
    }

    #[test]
    fn normal_state_preserves_requested_focus_intent() {
        let policy_inputs = inputs(IslandState::Compact, false, false);
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Focus),
            WindowDecision {
                effective_state: IslandState::Compact,
                focus: FocusIntent::Focus,
            }
        );
    }
}
