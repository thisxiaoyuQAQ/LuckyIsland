use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, State};

use crate::storage::Db;

pub const CLICK_THROUGH_KEY: &str = "window:click_through";
pub const HOVER_EXPAND_KEY: &str = "window:hover_expand";
pub const HIDE_IN_FULLSCREEN_KEY: &str = "window:hide_in_fullscreen";
pub const FLOATING_BALL_KEY: &str = "window:floating_ball";

/// 悬浮胶囊（浮球休眠投影）逻辑宽度；透明区域不拦截后方点击。
pub const CAPSULE_WIDTH_LOGICAL: f64 = 240.0;
/// 条状（compact/expanded）逻辑宽度。
pub const COMPACT_WIDTH_LOGICAL: f64 = 720.0;
const COMPACT_HEIGHT_LOGICAL: f64 = 80.0;
const EXPANDED_HEIGHT_LOGICAL: f64 = 400.0;

/// 各有效状态的窗口几何（逻辑宽 × 逻辑高），全局单一真源。
/// Hidden 无可见几何，返回 compact 尺寸仅供 clamp 兜底。
pub fn geometry_for(state: IslandState) -> (f64, f64) {
    match state {
        IslandState::Hidden | IslandState::Compact => {
            (COMPACT_WIDTH_LOGICAL, COMPACT_HEIGHT_LOGICAL)
        }
        IslandState::Capsule => (CAPSULE_WIDTH_LOGICAL, COMPACT_HEIGHT_LOGICAL),
        IslandState::Expanded => (COMPACT_WIDTH_LOGICAL, EXPANDED_HEIGHT_LOGICAL),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IslandState {
    Hidden,
    Capsule,
    Compact,
    Expanded,
}

impl IslandState {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "hidden" => Ok(Self::Hidden),
            "capsule" => Ok(Self::Capsule),
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
    /// 右侧悬停阶段：0=无，1=悬停到条状（胶囊→compact），2=持续悬停到完整面板（compact→expanded）。
    pub hover_stage: u8,
    pub floating_ball: bool,
    /// corner（左下角嵌入任务栏，模块 13a.2）：静息时 island 窗口整个隐藏、静息 UI 交给
    /// 嵌入任务栏的 `taskbar-strip` 窗口；悬停/点击才把 island 作为展开面板抬起来。
    pub corner: bool,
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
            hover_stage: 0,
            floating_ball: false,
            corner: false,
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
    // 悬停只产生 transient intent，绝不请求焦点；手动 Expanded 不被悬停改变。
    if !inputs.click_through && inputs.desired_state == IslandState::Compact {
        if inputs.hover_stage >= 2 && inputs.hover_expand {
            return WindowDecision {
                effective_state: IslandState::Expanded,
                focus: FocusIntent::Preserve,
            };
        }
        if inputs.hover_stage == 1 && (inputs.floating_ball || inputs.corner) {
            return WindowDecision {
                effective_state: IslandState::Compact,
                focus: FocusIntent::Preserve,
            };
        }
    }
    // corner（13a.2 真嵌入任务栏）：静息 UI 是嵌入任务栏的 `taskbar-strip` 窗口，
    // island 窗口在静息时整个隐藏；只有悬停/点击把 hover_stage 抬上来或显式 Expanded
    // 时它才作为「展开面板」出现在任务栏正上方。判定放在浮球之前——两者同开时以 corner 为准。
    if inputs.corner && inputs.desired_state == IslandState::Compact {
        return WindowDecision {
            effective_state: IslandState::Hidden,
            focus: FocusIntent::Preserve,
        };
    }
    // 浮球开启时 compact 意图的休眠投影是 240×80 胶囊。
    if inputs.floating_ball && inputs.desired_state == IslandState::Compact {
        return WindowDecision {
            effective_state: IslandState::Capsule,
            focus: requested_focus,
        };
    }
    WindowDecision {
        effective_state: inputs.desired_state,
        focus: requested_focus,
    }
}

/// 13a.2：嵌入任务栏的静息条是否应显示。
///
/// 它与 island 窗口的可见性互补——corner 模式静息时只有条、展开时两者同在（条留在
/// 任务栏里不动）。Alt+X 隐藏与「全屏时隐藏」对两个窗口一视同仁。
pub fn strip_visible(inputs: WindowPolicyInputs) -> bool {
    inputs.corner
        && inputs.desired_state != IslandState::Hidden
        && !(inputs.hide_in_fullscreen && inputs.fullscreen_block)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WindowOp {
    Resize(IslandState),
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
            visible => vec![WindowOp::Resize(visible), WindowOp::Show],
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
    pub floating_ball: bool,
    pub hover_stage: u8,
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
            next.hover_stage = 0;
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
        floating_ball: inputs.floating_ball,
        hover_stage: inputs.hover_stage,
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
        next.hover_stage = 0;
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

/// 调整窗口到目标状态几何。顶部居中模式以「当前顶部中心」为锚点重设水平位置（避免 240↔720
/// 切换横向跳动）；corner（嵌入任务栏的展开面板）以「当前左下角」为锚点（x 左对齐不变、y 使底边不变，
/// 面板向上生长）。读取旧几何失败时仅改尺寸、不移动。
fn resize_window(window: &tauri::WebviewWindow, state: IslandState) -> Result<(), String> {
    let (width, height) = geometry_for(state);
    let anchor = window
        .outer_size()
        .and_then(|size| window.outer_position().map(|position| (size, position)))
        .ok()
        .and_then(|(size, position)| {
            window
                .scale_factor()
                .ok()
                .map(|scale| (size, position, scale))
        });
    window
        .set_size(Size::Logical(LogicalSize { width, height }))
        .map_err(|error| format!("调整灵动岛窗口尺寸失败：{error}"))?;
    if let Some((old_size, old_position, scale)) = anchor {
        let new_width_px = (width * scale).round().max(1.0) as i32;
        let new_height_px = (height * scale).round().max(1.0) as i32;
        let (new_x, new_y) = if window_is_corner(window) {
            // 保左下角：x 左对齐不变，y 使底边不变（新面板向上生长）。
            (
                old_position.x,
                old_position.y + old_size.height as i32 - new_height_px,
            )
        } else {
            // 保顶部中心：y 顶部不变，x 按宽度差重算水平居中。
            let dx = (old_size.width as i32 - new_width_px) / 2;
            (old_position.x + dx, old_position.y)
        };
        if (new_x, new_y) != (old_position.x, old_position.y) {
            window
                .set_position(PhysicalPosition::new(new_x, new_y))
                .map_err(|error| format!("重设灵动岛窗口位置失败：{error}"))?;
        }
    }
    Ok(())
}

/// 当前是否 corner 模式：读 `window:ui_mode` KV。resize 时决定锚定左下角还是顶部居中。
fn window_is_corner(window: &tauri::WebviewWindow) -> bool {
    window
        .app_handle()
        .try_state::<Db>()
        .map(|db| crate::monitor::ui_mode_is_corner(db.inner()))
        .unwrap_or(false)
}

fn apply_effects(
    window: &tauri::WebviewWindow,
    previous: Option<WindowDecision>,
    decision: WindowDecision,
) -> Result<(), String> {
    for op in EffectPlan::between(previous, decision).ops {
        match op {
            WindowOp::Resize(state) => resize_window(window, state)?,
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
    let (previous, previous_inputs, inputs, generation) = {
        let mut runtime = policy.0.lock().map_err(|error| error.to_string())?;
        let previous = runtime.last_applied;
        let previous_inputs = runtime.inputs;
        mutate(&mut runtime.inputs);
        runtime.operation_generation = runtime.operation_generation.wrapping_add(1);
        (
            previous,
            previous_inputs,
            runtime.inputs,
            runtime.operation_generation,
        )
    };

    let decision = reduce(inputs, focus);
    let Some(window) = app.get_webview_window("island") else {
        let mut runtime = policy.0.lock().map_err(|error| error.to_string())?;
        if runtime.operation_generation == generation {
            runtime.inputs = previous_inputs;
        }
        return Err("找不到灵动岛窗口".to_string());
    };
    if let Err(error) = apply_effects(&window, previous, decision) {
        let mut runtime = policy
            .0
            .lock()
            .map_err(|lock_error| lock_error.to_string())?;
        if runtime.operation_generation == generation {
            runtime.inputs = previous_inputs;
        }
        return Err(error);
    }
    // 13a.2：嵌入条与 island 窗口同一个裁决点同步。它失败不回滚 island 效果——静息 UI
    // 缺失只是观感降级，回滚窗口状态反而会放大故障；看门狗会在下一次轮询重试。
    if let Err(error) = crate::taskbar::sync_strip(app, inputs.corner, strip_visible(inputs)) {
        tracing::warn!("[taskbar] 同步嵌入条失败：{error}");
    }

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

fn apply_explicit_state(inputs: &mut WindowPolicyInputs, state: IslandState) {
    inputs.desired_state = state;
    inputs.hover_stage = 0;
}

pub fn set_desired_state(
    app: &AppHandle,
    state: IslandState,
    focus: FocusIntent,
) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(app, |inputs| apply_explicit_state(inputs, state), focus)
}

/// hover_stage 合法性归一：穿透或未开启任何悬停能力时归零；
/// hover_expand 关闭时封顶在阶段 1（胶囊→条状不需要该开关）。
fn coerce_hover_stage(inputs: &mut WindowPolicyInputs) {
    if inputs.click_through || (!inputs.floating_ball && !inputs.corner && !inputs.hover_expand) {
        inputs.hover_stage = 0;
    } else if inputs.hover_stage > 2 {
        inputs.hover_stage = 2;
    } else if inputs.hover_stage == 2 && !inputs.hover_expand {
        inputs.hover_stage = 1;
    }
}

fn apply_hover_stage_report(inputs: &mut WindowPolicyInputs, stage: u8) {
    inputs.hover_stage = stage;
    coerce_hover_stage(inputs);
}

fn apply_hover_expand_setting(inputs: &mut WindowPolicyInputs, enabled: bool) {
    inputs.hover_expand = enabled;
    coerce_hover_stage(inputs);
}

fn apply_floating_ball_setting(inputs: &mut WindowPolicyInputs, enabled: bool) {
    inputs.floating_ball = enabled;
    coerce_hover_stage(inputs);
}

fn apply_corner_setting(inputs: &mut WindowPolicyInputs, enabled: bool) {
    inputs.corner = enabled;
    coerce_hover_stage(inputs);
}

fn apply_notification_intent(
    inputs: &mut WindowPolicyInputs,
    elevated_priority: bool,
) -> Option<u64> {
    if inputs.desired_state == IslandState::Hidden {
        return None;
    }
    if inputs.hide_in_fullscreen && inputs.fullscreen_block {
        if !elevated_priority {
            return None;
        }
        inputs.priority_override_generation = inputs.priority_override_generation.wrapping_add(1);
        inputs.priority_override_active = true;
        return Some(inputs.priority_override_generation);
    }
    inputs.desired_state = IslandState::Expanded;
    None
}

fn priority_override_expired(inputs: &mut WindowPolicyInputs, generation: u64) -> bool {
    if !inputs.priority_override_active || inputs.priority_override_generation != generation {
        return false;
    }
    inputs.priority_override_active = false;
    true
}

pub fn present_notification(
    app: &AppHandle,
    elevated_priority: bool,
) -> Result<(WindowPolicySnapshot, Option<u64>), String> {
    let mut override_generation = None;
    match update_and_apply(
        app,
        |inputs| override_generation = apply_notification_intent(inputs, elevated_priority),
        FocusIntent::Preserve,
    ) {
        Ok(snapshot) => Ok((snapshot, override_generation)),
        Err(error) => {
            if let Some(generation) = override_generation {
                cancel_priority_override(app, generation);
            }
            Err(error)
        }
    }
}

fn cancel_priority_override(app: &AppHandle, generation: u64) {
    let policy = app.state::<WindowPolicy>();
    if let Ok(mut runtime) = policy.0.lock() {
        if priority_override_expired(&mut runtime.inputs, generation) {
            runtime.operation_generation = runtime.operation_generation.wrapping_add(1);
        }
    }
    let _ = reapply(app);
}

pub fn expire_priority_override(
    app: &AppHandle,
    generation: u64,
) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(
        app,
        |inputs| {
            priority_override_expired(inputs, generation);
        },
        FocusIntent::Preserve,
    )
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

fn apply_fullscreen_block(inputs: &mut WindowPolicyInputs, blocked: bool) {
    inputs.fullscreen_block = blocked;
    if !blocked && inputs.priority_override_active {
        inputs.priority_override_active = false;
        inputs.priority_override_generation = inputs.priority_override_generation.wrapping_add(1);
    }
}

fn apply_fullscreen_setting(inputs: &mut WindowPolicyInputs, enabled: bool) {
    inputs.hide_in_fullscreen = enabled;
    if !enabled {
        apply_fullscreen_block(inputs, false);
    }
}

pub fn set_fullscreen_block(
    app: &AppHandle,
    blocked: bool,
) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(
        app,
        |inputs| apply_fullscreen_block(inputs, blocked),
        FocusIntent::Preserve,
    )
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

pub fn restore_floating_ball(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String> {
    let enabled = db
        .setting_get(FLOATING_BALL_KEY)
        .map(|value| value == "true")
        .unwrap_or(false);
    update_and_apply(
        app,
        |inputs| apply_floating_ball_setting(inputs, enabled),
        FocusIntent::Preserve,
    )
}

/// 从 `window:ui_mode` 载入 corner 输入（corner 静息隐藏 island、由嵌入条承担静息 UI）。
/// 启动与模式切换后调用；同一次 update_and_apply 里顺带创建/销毁嵌入条窗口。
pub fn restore_ui_mode(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String> {
    let corner = crate::monitor::ui_mode_is_corner(db);
    update_and_apply(
        app,
        |inputs| apply_corner_setting(inputs, corner),
        FocusIntent::Preserve,
    )
}

pub fn restore_hide_in_fullscreen(
    app: &AppHandle,
    db: &Db,
) -> Result<WindowPolicySnapshot, String> {
    let enabled = db
        .setting_get(HIDE_IN_FULLSCREEN_KEY)
        .map(|value| value == "true")
        .unwrap_or(false);
    let snapshot = update_and_apply(
        app,
        |inputs| apply_fullscreen_setting(inputs, enabled),
        FocusIntent::Preserve,
    )?;
    app.state::<crate::fullscreen::FullscreenController>()
        .set_enabled(enabled && cfg!(windows));
    Ok(snapshot)
}

pub fn reload_persisted_settings(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String> {
    restore_click_through(app, db)?;
    restore_hover_expand(app, db)?;
    restore_floating_ball(app, db)?;
    restore_ui_mode(app, db)?;
    restore_hide_in_fullscreen(app, db)
}

#[tauri::command]
pub fn window_hide_in_fullscreen_set(
    app: AppHandle,
    db: State<'_, Db>,
    enabled: bool,
) -> Result<WindowPolicySnapshot, String> {
    let previous_inputs = {
        let policy = app.state::<WindowPolicy>();
        let runtime = policy.0.lock().map_err(|error| error.to_string())?;
        runtime.inputs
    };
    let snapshot = update_and_apply(
        &app,
        |inputs| apply_fullscreen_setting(inputs, enabled),
        FocusIntent::Preserve,
    )?;
    if let Err(error) = db.setting_set(
        HIDE_IN_FULLSCREEN_KEY,
        if enabled { "true" } else { "false" },
    ) {
        let _ = update_and_apply(
            &app,
            |inputs| *inputs = previous_inputs,
            FocusIntent::Preserve,
        );
        return Err(error);
    }
    app.state::<crate::fullscreen::FullscreenController>()
        .set_enabled(enabled && cfg!(windows));
    Ok(snapshot)
}

#[tauri::command]
pub fn window_hover_stage_set(app: AppHandle, stage: u8) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(
        &app,
        |inputs| apply_hover_stage_report(inputs, stage),
        FocusIntent::Preserve,
    )
}

#[tauri::command]
pub fn window_floating_ball_set(
    app: AppHandle,
    db: State<'_, Db>,
    enabled: bool,
) -> Result<WindowPolicySnapshot, String> {
    let previous = window_policy_snapshot(&app)?.floating_ball;
    let snapshot = update_and_apply(
        &app,
        |inputs| apply_floating_ball_setting(inputs, enabled),
        FocusIntent::Preserve,
    )?;
    if let Err(error) = db.setting_set(FLOATING_BALL_KEY, if enabled { "true" } else { "false" }) {
        let _ = update_and_apply(
            &app,
            |inputs| apply_floating_ball_setting(inputs, previous),
            FocusIntent::Preserve,
        );
        return Err(error);
    }
    Ok(snapshot)
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

/// 点是否落在矩形内（物理像素，右/下开区间）。
fn point_in_rect(x: f64, y: f64, left: i32, top: i32, width: u32, height: u32) -> bool {
    x >= left as f64
        && y >= top as f64
        && x < (left + width as i32) as f64
        && y < (top + height as i32) as f64
}

/// 指针此刻是否落在 island 窗口上。读不到光标或窗口几何时按 false 处理
/// （宁可收起也不要卡住一个收不掉的面板）。
fn cursor_over_island(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("island") else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    let (Ok(cursor), Ok(position), Ok(size)) = (
        app.cursor_position(),
        window.outer_position(),
        window.outer_size(),
    ) else {
        return false;
    };
    point_in_rect(
        cursor.x,
        cursor.y,
        position.x,
        position.y,
        size.width,
        size.height,
    )
}

/// 13a.2：嵌入条报告「指针离开条」。
///
/// 两个窗口不共享 DOM 的 mouseenter/mouseleave：指针从任务栏里的条移到上方的面板时，
/// 条只看到 leave、面板看不到任何 enter。若无条件清零 hover 阶段，面板会在鼠标移过去的
/// 半路上消失。因此先看指针是否已经落在 island 面板上——是就交给面板自己的 leave 收起。
#[tauri::command]
pub fn window_strip_hover_release(app: AppHandle) -> Result<WindowPolicySnapshot, String> {
    if cursor_over_island(&app) {
        return window_policy_snapshot(&app);
    }
    update_and_apply(
        &app,
        |inputs| apply_hover_stage_report(inputs, 0),
        FocusIntent::Preserve,
    )
}

#[tauri::command]
pub fn window_policy_get(policy: State<'_, WindowPolicy>) -> Result<WindowPolicySnapshot, String> {
    let runtime = policy.0.lock().map_err(|error| error.to_string())?;
    let decision = reduce(runtime.inputs, FocusIntent::Preserve);
    Ok(snapshot(runtime.inputs, decision))
}

/// 当前有效状态的逻辑几何（宽 × 高），供 monitor 定位/clamp/恢复使用实际窗口尺寸。
pub fn current_geometry(app: &AppHandle) -> (f64, f64) {
    let policy = app.state::<WindowPolicy>();
    let Ok(runtime) = policy.0.lock() else {
        return geometry_for(IslandState::Compact);
    };
    let decision = reduce(runtime.inputs, FocusIntent::Preserve);
    geometry_for(decision.effective_state)
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
            vec![
                WindowOp::Resize(IslandState::Expanded),
                WindowOp::Show,
                WindowOp::Focus
            ]
        );
    }

    #[test]
    fn compact_to_capsule_resizes_to_capsule_geometry() {
        assert_eq!(
            EffectPlan::between(
                Some(decision(IslandState::Compact)),
                decision(IslandState::Capsule),
            )
            .ops,
            vec![WindowOp::Resize(IslandState::Capsule), WindowOp::Show]
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
    fn capsule_state_parses_and_geometry_is_240_by_80() {
        assert_eq!(IslandState::parse("capsule").unwrap(), IslandState::Capsule);
        assert_eq!(geometry_for(IslandState::Capsule), (240.0, 80.0));
        assert_eq!(geometry_for(IslandState::Compact), (720.0, 80.0));
        assert_eq!(geometry_for(IslandState::Expanded), (720.0, 400.0));
    }

    #[test]
    fn floating_ball_projects_compact_intent_to_capsule() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.floating_ball = true;

        let decision = reduce(policy_inputs, FocusIntent::Focus);
        assert_eq!(decision.effective_state, IslandState::Capsule);
        // 投影不是 hover：显式请求的 Focus 仍然保留（单实例唤起等路径）。
        assert_eq!(decision.focus, FocusIntent::Focus);
    }

    #[test]
    fn corner_hides_island_at_rest_because_strip_is_the_resting_ui() {
        // 13a.2：corner 静息 UI 是嵌入任务栏的独立条窗口，island 窗口整个隐藏
        // （13a.1 的「静息=胶囊」已作废）。焦点不跟随——隐藏不该抢焦点。
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.corner = true;

        let decision = reduce(policy_inputs, FocusIntent::Focus);
        assert_eq!(decision.effective_state, IslandState::Hidden);
        assert_eq!(decision.focus, FocusIntent::Preserve);
        // 但嵌入条要显示。
        assert!(strip_visible(policy_inputs));
    }

    #[test]
    fn corner_overrides_floating_ball_capsule_projection() {
        // 两个开关同开时以 corner 为准（静息交给嵌入条），不退回胶囊。
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.corner = true;
        policy_inputs.floating_ball = true;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Hidden
        );
    }

    #[test]
    fn corner_hover_stage_one_shows_island_as_strip_panel() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.corner = true;
        policy_inputs.hover_stage = 1;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Compact
        );
        // 展开时嵌入条仍留在任务栏里。
        assert!(strip_visible(policy_inputs));
    }

    #[test]
    fn corner_click_expands_island_to_full_panel() {
        // 点击嵌入条 → set_island_state("expanded")：面板出现在任务栏正上方。
        let mut policy_inputs = inputs(IslandState::Expanded, false, false);
        policy_inputs.corner = true;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Expanded
        );
        assert!(strip_visible(policy_inputs));
    }

    #[test]
    fn cursor_hit_test_uses_right_open_bounds() {
        // 面板 720×400 落在 (0, 632)：左上角命中、右下边界外。
        assert!(point_in_rect(0.0, 632.0, 0, 632, 720, 400));
        assert!(point_in_rect(719.0, 1031.0, 0, 632, 720, 400));
        assert!(!point_in_rect(720.0, 700.0, 0, 632, 720, 400));
        assert!(!point_in_rect(100.0, 1032.0, 0, 632, 720, 400));
        // 任务栏里的条（y=1050）不在面板矩形内——指针回到条上时不算「在面板上」。
        assert!(!point_in_rect(100.0, 1050.0, 0, 632, 720, 400));
        assert!(!point_in_rect(-1.0, 700.0, 0, 632, 720, 400));
    }

    #[test]
    fn hiding_or_fullscreen_block_hides_the_strip_too() {
        // Alt+X 隐藏：两个窗口一起消失。
        let mut hidden = inputs(IslandState::Hidden, false, false);
        hidden.corner = true;
        assert!(!strip_visible(hidden));
        // 同屏全屏且开启「全屏时隐藏」：同样一起消失。
        let mut blocked = inputs(IslandState::Compact, false, false);
        blocked.corner = true;
        blocked.hide_in_fullscreen = true;
        blocked.fullscreen_block = true;
        assert!(!strip_visible(blocked));
        // 非 corner 模式永远没有嵌入条。
        let mut island_mode = inputs(IslandState::Compact, false, false);
        island_mode.corner = false;
        assert!(!strip_visible(island_mode));
    }

    #[test]
    fn corner_enables_hover_stage_and_clearing_it_zeroes_stage() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        // 仅 corner：允许阶段 1（胶囊→条状）。
        apply_corner_setting(&mut policy_inputs, true);
        apply_hover_stage_report(&mut policy_inputs, 1);
        assert_eq!(policy_inputs.hover_stage, 1);
        // 关闭 corner 且无其它悬停能力：归零。
        apply_corner_setting(&mut policy_inputs, false);
        assert_eq!(policy_inputs.hover_stage, 0);
        apply_hover_stage_report(&mut policy_inputs, 1);
        assert_eq!(policy_inputs.hover_stage, 0);
    }

    #[test]
    fn floating_ball_does_not_project_expanded_or_hidden() {
        let mut expanded = inputs(IslandState::Expanded, false, false);
        expanded.floating_ball = true;
        assert_eq!(
            reduce(expanded, FocusIntent::Preserve).effective_state,
            IslandState::Expanded
        );

        let mut hidden = inputs(IslandState::Hidden, false, false);
        hidden.floating_ball = true;
        assert_eq!(
            reduce(hidden, FocusIntent::Preserve).effective_state,
            IslandState::Hidden
        );
    }

    #[test]
    fn hover_stage_one_lifts_capsule_to_strip_only_with_floating_ball() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.floating_ball = true;
        policy_inputs.hover_stage = 1;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Compact
        );

        // 浮球关闭时阶段 1 无视觉效果，保持条状。
        policy_inputs.floating_ball = false;
        policy_inputs.hover_expand = true;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Compact
        );
    }

    #[test]
    fn hover_stage_two_expands_only_with_hover_expand() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.hover_expand = true;
        policy_inputs.hover_stage = 2;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Expanded
        );

        // 未开启悬停自动展开时阶段 2 归约不到完整面板。
        policy_inputs.hover_expand = false;
        policy_inputs.floating_ball = true;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Capsule
        );
    }

    #[test]
    fn hover_stages_never_request_focus() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.hover_expand = true;
        policy_inputs.floating_ball = true;
        policy_inputs.hover_stage = 2;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Focus),
            WindowDecision {
                effective_state: IslandState::Expanded,
                focus: FocusIntent::Preserve,
            }
        );

        policy_inputs.hover_stage = 1;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Focus),
            WindowDecision {
                effective_state: IslandState::Compact,
                focus: FocusIntent::Preserve,
            }
        );
    }

    #[test]
    fn click_through_suppresses_hover_stages() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.hover_expand = true;
        policy_inputs.hover_stage = 2;
        policy_inputs.click_through = true;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Compact
        );
    }

    #[test]
    fn overrides_beat_capsule_projection_and_hover() {
        let mut policy_inputs = inputs(IslandState::Compact, true, true);
        policy_inputs.floating_ball = true;
        policy_inputs.hover_expand = true;
        policy_inputs.hover_stage = 1;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Expanded
        );

        policy_inputs.priority_override_active = false;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Hidden
        );
    }

    #[test]
    fn manual_expanded_is_not_changed_by_hover_stages() {
        let mut policy_inputs = inputs(IslandState::Expanded, false, false);
        policy_inputs.floating_ball = true;
        policy_inputs.hover_stage = 1;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Expanded
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
    fn fullscreen_setting_controls_block_and_clears_override_on_exit() {
        let mut policy_inputs = inputs(IslandState::Compact, true, true);

        apply_fullscreen_setting(&mut policy_inputs, false);
        assert!(!policy_inputs.hide_in_fullscreen);
        assert!(!policy_inputs.fullscreen_block);

        policy_inputs.hide_in_fullscreen = true;
        policy_inputs.priority_override_active = true;
        let generation = policy_inputs.priority_override_generation;
        apply_fullscreen_block(&mut policy_inputs, false);
        assert!(!policy_inputs.priority_override_active);
        assert_eq!(
            policy_inputs.priority_override_generation,
            generation.wrapping_add(1)
        );
    }

    #[test]
    fn hover_stage_reports_are_coerced_by_click_through_and_switches() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);

        // 两个开关都关：任何 stage 归零。
        apply_hover_stage_report(&mut policy_inputs, 2);
        assert_eq!(policy_inputs.hover_stage, 0);

        // 仅浮球：允许阶段 1，阶段 2 封顶到 1。
        policy_inputs.floating_ball = true;
        apply_hover_stage_report(&mut policy_inputs, 1);
        assert_eq!(policy_inputs.hover_stage, 1);
        apply_hover_stage_report(&mut policy_inputs, 2);
        assert_eq!(policy_inputs.hover_stage, 1);

        // 双开：允许阶段 2；超界值钳到 2。
        policy_inputs.hover_expand = true;
        apply_hover_stage_report(&mut policy_inputs, 2);
        assert_eq!(policy_inputs.hover_stage, 2);
        apply_hover_stage_report(&mut policy_inputs, 9);
        assert_eq!(policy_inputs.hover_stage, 2);

        // 穿透开启：归零。
        policy_inputs.click_through = true;
        apply_hover_stage_report(&mut policy_inputs, 2);
        assert_eq!(policy_inputs.hover_stage, 0);
    }

    #[test]
    fn disabling_switches_caps_or_clears_hover_stage() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.floating_ball = true;
        policy_inputs.hover_expand = true;
        policy_inputs.hover_stage = 2;

        // 关闭悬停自动展开：阶段 2 → 1（条状仍由浮球悬停支持）。
        apply_hover_expand_setting(&mut policy_inputs, false);
        assert_eq!(policy_inputs.hover_stage, 1);

        // 再关闭浮球：无任何悬停能力，归零。
        apply_floating_ball_setting(&mut policy_inputs, false);
        assert_eq!(policy_inputs.hover_stage, 0);
    }

    #[test]
    fn fullscreen_notification_priority_uses_generation_without_mutating_desired_state() {
        let mut normal = inputs(IslandState::Compact, true, false);
        assert_eq!(apply_notification_intent(&mut normal, false), None);
        assert_eq!(normal.desired_state, IslandState::Compact);
        assert!(!normal.priority_override_active);

        let mut high = inputs(IslandState::Compact, true, false);
        let first = apply_notification_intent(&mut high, true).unwrap();
        assert!(high.priority_override_active);
        assert_eq!(high.desired_state, IslandState::Compact);
        assert_eq!(
            reduce(high, FocusIntent::Focus),
            WindowDecision {
                effective_state: IslandState::Expanded,
                focus: FocusIntent::Preserve,
            }
        );
        let second = apply_notification_intent(&mut high, true).unwrap();
        assert_ne!(first, second);
        assert!(!priority_override_expired(&mut high, first));
        assert!(priority_override_expired(&mut high, second));
        assert!(!high.priority_override_active);
    }

    #[test]
    fn hidden_user_intent_rejects_priority_override() {
        let mut policy_inputs = inputs(IslandState::Hidden, true, false);
        assert_eq!(apply_notification_intent(&mut policy_inputs, true), None);
        assert!(!policy_inputs.priority_override_active);
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Focus).effective_state,
            IslandState::Hidden
        );
    }

    #[test]
    fn notification_from_compact_expands_without_focus() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        apply_notification_intent(&mut policy_inputs, false);
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
        apply_notification_intent(&mut policy_inputs, false);
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
    fn enabling_click_through_clears_hover_stage_before_reduce() {
        let mut harness = ClickThroughHarness::compact();
        harness.inputs.hover_expand = true;
        harness.inputs.hover_stage = 2;

        let snapshot = apply_click_through_transaction(&mut harness, true).unwrap();

        assert_eq!(snapshot.hover_stage, 0);
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
    fn explicit_user_state_clears_transient_hover_stage_before_reduce() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.hover_expand = true;
        policy_inputs.hover_stage = 2;

        apply_explicit_state(&mut policy_inputs, IslandState::Compact);

        assert_eq!(policy_inputs.hover_stage, 0);
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Focus).effective_state,
            IslandState::Compact
        );
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
