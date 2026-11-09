use std::sync::{Mutex, OnceLock};
use std::thread::ThreadId;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Size, State};

use crate::dock_edge::DockEdge;
use crate::storage::Db;

pub const CLICK_THROUGH_KEY: &str = "window:click_through";
pub const HOVER_EXPAND_KEY: &str = "window:hover_expand";
pub const HIDE_IN_FULLSCREEN_KEY: &str = "window:hide_in_fullscreen";
pub const FLOATING_BALL_KEY: &str = "window:floating_ball";

/// 悬浮胶囊（浮球休眠投影）逻辑宽度；透明区域不拦截后方点击。固定 240，不可自定义（模块 14）。
pub const CAPSULE_WIDTH_LOGICAL: f64 = 240.0;
/// 条状（compact/expanded）默认逻辑宽度；`window:width:<mode>` 缺键/非法时回退到它。
pub const COMPACT_WIDTH_LOGICAL: f64 = 720.0;
/// 岛长度下限（逻辑像素）：再小紧凑态内容（时钟 + 页签/组件条）会溢出。模块 14 冻结。
pub const MIN_STRIP_WIDTH_LOGICAL: f64 = 420.0;
/// 岛长度上限（逻辑像素）。模块 14 冻结；超出 4K 物理宽经 DPI 换算后仍居中。
pub const MAX_STRIP_WIDTH_LOGICAL: f64 = 1600.0;
const COMPACT_HEIGHT_LOGICAL: f64 = 80.0;
const EXPANDED_HEIGHT_LOGICAL: f64 = 400.0;

/// 解析 `window:width:<mode>` 的岛长度（逻辑像素，纯函数便于单测）。
/// 缺键/非法/越界一律回退 `COMPACT_WIDTH_LOGICAL`（老用户无感）；合法值 clamp 到
/// [`MIN_STRIP_WIDTH_LOGICAL`, `MAX_STRIP_WIDTH_LOGICAL`]。宽度只影响横向，高度不变。
pub fn parse_island_width(value: Option<&str>) -> f64 {
    value
        .and_then(|raw| raw.trim().parse::<f64>().ok())
        .filter(|width| width.is_finite())
        .map(|width| width.clamp(MIN_STRIP_WIDTH_LOGICAL, MAX_STRIP_WIDTH_LOGICAL))
        .unwrap_or(COMPACT_WIDTH_LOGICAL)
}

/// 各有效状态的窗口几何（逻辑宽 × 逻辑高），全局单一真源。
/// Hidden 无可见几何，返回 compact 尺寸仅供 clamp 兜底。
/// 条状/展开宽度由 `width` 参数给出（来自 `window:width:<mode>`，模块 14）；
/// 胶囊恒为 [`CAPSULE_WIDTH_LOGICAL`]，高度恒为 80/400。
pub fn geometry_for(state: IslandState, width: f64, edge: DockEdge) -> (f64, f64) {
    let horizontal = match state {
        IslandState::Hidden | IslandState::Compact => (width, COMPACT_HEIGHT_LOGICAL),
        IslandState::Capsule => (CAPSULE_WIDTH_LOGICAL, COMPACT_HEIGHT_LOGICAL),
        IslandState::Expanded => (width, EXPANDED_HEIGHT_LOGICAL),
    };
    if edge.is_vertical() {
        (horizontal.1, horizontal.0)
    } else {
        horizontal
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
    pub click_through: bool,
    pub hide_in_fullscreen: bool,
    pub fullscreen_block: bool,
    pub priority_override_generation: u64,
    pub priority_override_active: bool,
    /// Alt+拖动进行中：原生窗口固定为 240×80 拖动胶囊，状态几何的 Resize 暂缓到落点结算。
    pub dragging: bool,
}

impl WindowPolicyInputs {
    pub fn new(desired_state: IslandState) -> Self {
        Self {
            desired_state,
            hover_expand: false,
            hover_stage: 0,
            floating_ball: false,
            click_through: false,
            hide_in_fullscreen: false,
            fullscreen_block: false,
            priority_override_generation: 0,
            priority_override_active: false,
            dragging: false,
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
        if inputs.hover_stage == 1 && inputs.floating_ball {
            return WindowDecision {
                effective_state: IslandState::Compact,
                focus: FocusIntent::Preserve,
            };
        }
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

    /// 拖动期间原生几何由拖动胶囊接管：保留显示/隐藏/聚焦，去掉状态 Resize。
    fn without_resize(self) -> Self {
        Self {
            ops: self
                .ops
                .into_iter()
                .filter(|op| !matches!(op, WindowOp::Resize(_)))
                .collect(),
        }
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
    pub taskbar_mode: bool,
    pub taskbar_available: bool,
    pub taskbar_expanded: bool,
    pub taskbar_reason: Option<String>,
    /** 右侧悬停阶段：0=无，1=悬停到条状，2=持续悬停到完整面板。 */
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

/// 当前界面模式对应的岛长度（逻辑像素）由 monitor::width_key 按模式读取。
/// taskbar 的独立宽度键缺失时仍回退默认值；本模块不把 taskbar 视为 island/classisland 的别名。
fn island_width(db: &Db) -> f64 {
    parse_island_width(db.setting_get(&crate::monitor::width_key(db)).as_deref())
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
        if let Err(error) = apply_effects(
            &window,
            self.previous,
            decision,
            island_width(self.db),
            crate::monitor::current_dock_edge(self.db),
            next.dragging,
        ) {
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
            // 平台效果按事务快照执行；事务期间其它线程写入的输入（如全屏阻断）保留下来，
            // 由它们投递的主线程重放补齐（审查 #3）。
            runtime.inputs = merge_click_through(runtime.inputs, inputs.click_through);
            runtime.operation_generation = runtime.operation_generation.wrapping_add(1);
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

fn taskbar_snapshot(app: &AppHandle) -> (bool, crate::taskbar::TaskbarSnapshot) {
    let taskbar_mode = crate::monitor::current_ui_mode(app.state::<Db>().inner()) == "taskbar";
    let snapshot = app
        .try_state::<crate::taskbar::TaskbarManager>()
        .map(|manager| crate::taskbar::taskbar_snapshot(manager.inner()))
        .unwrap_or_default();
    (taskbar_mode, snapshot)
}

fn snapshot_for_app(
    app: &AppHandle,
    inputs: WindowPolicyInputs,
    decision: WindowDecision,
) -> WindowPolicySnapshot {
    let (taskbar_mode, taskbar) = taskbar_snapshot(app);
    snapshot(inputs, decision, taskbar_mode, taskbar)
}

fn snapshot(
    inputs: WindowPolicyInputs,
    decision: WindowDecision,
    taskbar_mode: bool,
    taskbar: crate::taskbar::TaskbarSnapshot,
) -> WindowPolicySnapshot {
    WindowPolicySnapshot {
        desired_state: inputs.desired_state,
        effective_state: decision.effective_state,
        should_focus: decision.focus == FocusIntent::Focus,
        click_through: inputs.click_through,
        hover_expand: inputs.hover_expand,
        floating_ball: inputs.floating_ball,
        taskbar_mode,
        taskbar_available: taskbar.available,
        taskbar_expanded: taskbar_mode && taskbar.expanded,
        taskbar_reason: taskbar.reason,
        hover_stage: inputs.hover_stage,
        hide_in_fullscreen: inputs.hide_in_fullscreen,
        fullscreen_supported: cfg!(windows),
        fullscreen_block: inputs.fullscreen_block,
        priority_override_active: inputs.priority_override_active,
        priority_override_generation: inputs.priority_override_generation,
    }
}

trait ClickThroughTransactionContext {
    fn app(&self) -> Option<&AppHandle> {
        None
    }
    fn inputs(&self) -> WindowPolicyInputs;
    fn set_ignore_cursor_events(&mut self, enabled: bool) -> Result<(), String>;
    fn persist(&mut self, enabled: bool) -> Result<(), String>;
    fn commit(&mut self, inputs: WindowPolicyInputs);
    fn publish(&mut self, snapshot: WindowPolicySnapshot) -> Result<(), String>;
}

/// 穿透事务提交：只改穿透与悬停阶段，其余输入取当前值（审查 #3）。
fn merge_click_through(mut current: WindowPolicyInputs, enabled: bool) -> WindowPolicyInputs {
    current.click_through = enabled;
    if enabled {
        current.hover_stage = 0;
    }
    current
}

/// 穿透事务直接调用平台 API，必须在主线程执行（BUG-20261108-01 #9 / 审查 #3）：
/// 非主线程（如配置导入的 tokio worker）调用时投递到主线程，立即返回当前快照。
fn post_click_through(
    app: &AppHandle,
    run: impl FnOnce(&AppHandle, &Db) -> Result<WindowPolicySnapshot, String> + Send + 'static,
) -> Result<WindowPolicySnapshot, String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let db = handle.state::<Db>();
        if let Err(error) = run(&handle, db.inner()) {
            tracing::warn!("[window-policy] 主线程执行鼠标穿透事务失败：{error}");
        }
    })
    .map_err(|error| format!("投递鼠标穿透事务失败：{error}"))?;
    window_policy_snapshot(app)
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
    let snapshot = match context.app() {
        Some(app) => snapshot_for_app(app, next, reduce(next, FocusIntent::Preserve)),
        None => snapshot(
            next,
            reduce(next, FocusIntent::Preserve),
            false,
            Default::default(),
        ),
    };
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
            let snapshot = match context.app() {
                Some(app) => {
                    snapshot_for_app(app, fallback, reduce(fallback, FocusIntent::Preserve))
                }
                None => snapshot(
                    fallback,
                    reduce(fallback, FocusIntent::Preserve),
                    false,
                    Default::default(),
                ),
            };
            context.publish(snapshot.clone())?;
            Ok(snapshot)
        }
        Err(error) => Err(error),
    }
}

/// 物理像素窗口矩形（左上角 + 尺寸）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PhysicalBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// 尺寸变化时保持停靠边不动的新矩形：top/bottom 水平居中并固定顶/底边，
/// left/right 垂直居中并固定左/右边（纯函数，BUG-20261108-01 #4/#5 的原生侧真源）。
fn anchored_bounds(
    old: PhysicalBounds,
    next_width: i32,
    next_height: i32,
    edge: DockEdge,
) -> PhysicalBounds {
    let (dx, dy) = match edge {
        DockEdge::Top => ((old.width - next_width) / 2, 0),
        DockEdge::Bottom => ((old.width - next_width) / 2, old.height - next_height),
        DockEdge::Left => (0, (old.height - next_height) / 2),
        DockEdge::Right => (old.width - next_width, (old.height - next_height) / 2),
    };
    PhysicalBounds {
        x: old.x + dx,
        y: old.y + dy,
        width: next_width,
        height: next_height,
    }
}

fn logical_to_physical(value: f64, scale: f64) -> i32 {
    (value * scale).round().max(1.0) as i32
}

/// 拖动胶囊：横向 240×80，以光标为中心（BUG-20261108-01 #6；T4 真机修复规格：不随停靠边旋转）。
fn drag_bounds_at(cursor_x: i32, cursor_y: i32, scale: f64) -> PhysicalBounds {
    let width = logical_to_physical(CAPSULE_WIDTH_LOGICAL, scale);
    let height = logical_to_physical(COMPACT_HEIGHT_LOGICAL, scale);
    PhysicalBounds {
        x: cursor_x - width / 2,
        y: cursor_y - height / 2,
        width,
        height,
    }
}

/// 策略输入下的窗口逻辑几何：拖动中恒为拖动胶囊，否则为有效状态几何。
fn geometry_for_inputs(inputs: WindowPolicyInputs, width: f64, edge: DockEdge) -> (f64, f64) {
    if inputs.dragging {
        return (CAPSULE_WIDTH_LOGICAL, COMPACT_HEIGHT_LOGICAL);
    }
    geometry_for(
        reduce(inputs, FocusIntent::Preserve).effective_state,
        width,
        edge,
    )
}

fn current_bounds(window: &tauri::WebviewWindow) -> Option<(PhysicalBounds, f64)> {
    let size = window.outer_size().ok()?;
    let position = window.outer_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some((
        PhysicalBounds {
            x: position.x,
            y: position.y,
            width: size.width as i32,
            height: size.height as i32,
        },
        scale,
    ))
}

/// 一次系统调用同时设置位置与尺寸，避免「先改尺寸、再移位置」之间闪一帧（BUG-20261108-01 #8）。
#[cfg(windows)]
fn set_window_bounds(window: &tauri::WebviewWindow, bounds: PhysicalBounds) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("读取灵动岛窗口句柄失败：{error}"))?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    }
    .map_err(|error| format!("调整灵动岛窗口几何失败：{error}"))
}

#[cfg(not(windows))]
fn set_window_bounds(window: &tauri::WebviewWindow, bounds: PhysicalBounds) -> Result<(), String> {
    window
        .set_size(Size::Physical(tauri::PhysicalSize::new(
            bounds.width.max(1) as u32,
            bounds.height.max(1) as u32,
        )))
        .map_err(|error| format!("调整灵动岛窗口尺寸失败：{error}"))?;
    window
        .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|error| format!("重设灵动岛窗口位置失败：{error}"))
}

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x, point.y))
}

#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

/// 调整窗口到目标状态几何，停靠边保持不动（见 [`anchored_bounds`]），位置与尺寸一次提交。
/// 读取旧几何失败时仅改尺寸、不移动。条状/展开宽度取 `width`（`window:width:<mode>`），胶囊恒 240。
fn resize_window(
    window: &tauri::WebviewWindow,
    state: IslandState,
    width: f64,
    edge: DockEdge,
) -> Result<(), String> {
    let (new_width, new_height) = geometry_for(state, width, edge);
    let Some((old, scale)) = current_bounds(window) else {
        return window
            .set_size(Size::Logical(LogicalSize {
                width: new_width,
                height: new_height,
            }))
            .map_err(|error| format!("调整灵动岛窗口尺寸失败：{error}"));
    };
    let next = anchored_bounds(
        old,
        logical_to_physical(new_width, scale),
        logical_to_physical(new_height, scale),
        edge,
    );
    if next == old {
        return Ok(());
    }
    set_window_bounds(window, next)
}

fn apply_effects(
    window: &tauri::WebviewWindow,
    previous: Option<WindowDecision>,
    decision: WindowDecision,
    width: f64,
    edge: DockEdge,
    dragging: bool,
) -> Result<(), String> {
    let plan = EffectPlan::between(previous, decision);
    let plan = if dragging {
        plan.without_resize()
    } else {
        plan
    };
    for op in plan.ops {
        match op {
            WindowOp::Resize(state) => resize_window(window, state, width, edge)?,
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

/// taskbar 模式：expanded → 面板按任务栏几何定位后显示；其余（compact/capsule/hidden）→ 隐藏 island。
/// 嵌入条的展开标记随有效状态同步（Esc、通知、全屏等任何来源的收起/展开都一致，
/// BUG-20261109-01 #3），变化时广播给嵌入条窗口刷新「展开/收起」。
fn apply_taskbar_effects(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    db: &Db,
    decision: WindowDecision,
) -> Result<(), String> {
    let manager = app.state::<crate::taskbar::TaskbarManager>();
    let expanded = decision.effective_state == IslandState::Expanded;
    if expanded {
        crate::taskbar::apply_taskbar_panel_geometry(
            app,
            manager.inner(),
            island_width(db),
            EXPANDED_HEIGHT_LOGICAL,
        )?;
        window
            .show()
            .map_err(|error| format!("显示任务栏面板失败：{error}"))?;
    } else {
        window
            .hide()
            .map_err(|error| format!("隐藏任务栏面板失败：{error}"))?;
    }
    if crate::taskbar::set_strip_expanded(manager.inner(), expanded) {
        if let Err(error) = app.emit(
            "window://taskbar-state-changed",
            crate::taskbar::taskbar_snapshot(manager.inner()),
        ) {
            tracing::warn!("[window-policy] 广播任务栏状态失败：{error}");
        }
    }
    Ok(())
}

/// 任务栏嵌入条点击：以策略的有效状态为准在展开与收起之间切换。
pub fn toggle_taskbar_panel(app: &AppHandle) -> Result<WindowPolicySnapshot, String> {
    let current = window_policy_snapshot(app)?.effective_state;
    set_desired_state(
        app,
        crate::taskbar::strip_toggle_target(current),
        FocusIntent::Preserve,
    )
}

fn emit_snapshot(app: &AppHandle, snapshot: &WindowPolicySnapshot) -> Result<(), String> {
    app.emit("window://state-changed", snapshot)
        .map_err(|error| format!("广播灵动岛状态失败：{error}"))?;
    app.emit("window://policy-changed", snapshot)
        .map_err(|error| format!("广播窗口策略失败：{error}"))
}

static MAIN_THREAD: OnceLock<ThreadId> = OnceLock::new();

/// 在 Tauri setup（运行于主线程）中调用一次，登记主线程。
pub fn mark_main_thread() {
    let _ = MAIN_THREAD.set(std::thread::current().id());
}

/// 未登记（单测、极早期启动）时按主线程处理，保持内联执行。
fn on_main_thread() -> bool {
    MAIN_THREAD
        .get()
        .is_none_or(|id| *id == std::thread::current().id())
}

/// 非主线程（全屏轮询、通知服务、优先级到期计时器等）只更新策略输入，平台调用投递到主线程
/// 统一执行：非主线程的 `set_size` 异步排队，可能晚于主线程的同步调用落地，使原生几何与
/// `last_applied` 分叉（BUG-20261108-01 #9）。返回值是按新输入推导的快照；实际效果与广播由
/// 主线程上的重放完成。投递时不持有策略锁，避免与主线程互等。
fn update_and_defer(
    app: &AppHandle,
    mutate: impl FnOnce(&mut WindowPolicyInputs),
    focus: FocusIntent,
) -> Result<WindowPolicySnapshot, String> {
    let policy = app.state::<WindowPolicy>();
    let (inputs, decision) = {
        let mut runtime = policy.0.lock().map_err(|error| error.to_string())?;
        mutate(&mut runtime.inputs);
        runtime.operation_generation = runtime.operation_generation.wrapping_add(1);
        (runtime.inputs, reduce(runtime.inputs, focus))
    };
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = replay_on_main_thread(&handle, focus) {
            tracing::warn!("[window-policy] 主线程重放窗口策略失败：{error}");
        }
    })
    .map_err(|error| format!("投递窗口策略到主线程失败：{error}"))?;
    Ok(snapshot_for_app(app, inputs, decision))
}

fn keep_inputs(_: &mut WindowPolicyInputs) {}

/// 主线程上按最新输入重放平台效果。非泛型入口，避免 update_and_apply 经投递闭包无限单态化。
fn replay_on_main_thread(
    app: &AppHandle,
    focus: FocusIntent,
) -> Result<WindowPolicySnapshot, String> {
    update_and_apply(app, keep_inputs, focus)
}

fn update_and_apply(
    app: &AppHandle,
    mutate: impl FnOnce(&mut WindowPolicyInputs),
    focus: FocusIntent,
) -> Result<WindowPolicySnapshot, String> {
    if !on_main_thread() {
        return update_and_defer(app, mutate, focus);
    }
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
    let db = app.state::<Db>();
    let taskbar_mode = crate::monitor::current_ui_mode(db.inner()) == "taskbar";
    let applied = if taskbar_mode {
        apply_taskbar_effects(app, &window, db.inner(), decision)
    } else {
        let width = island_width(db.inner());
        let edge = crate::monitor::current_dock_edge(db.inner());
        apply_effects(&window, previous, decision, width, edge, inputs.dragging)
    };
    if let Err(error) = applied {
        let mut runtime = policy
            .0
            .lock()
            .map_err(|lock_error| lock_error.to_string())?;
        if runtime.operation_generation == generation {
            runtime.inputs = previous_inputs;
        }
        return Err(error);
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
            Some(snapshot_for_app(app, runtime.inputs, decision))
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
    if inputs.click_through || (!inputs.floating_ball && !inputs.hover_expand) {
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
    if !on_main_thread() {
        return post_click_through(app, move |app, db| set_click_through(app, db, enabled));
    }
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
    if !on_main_thread() {
        return post_click_through(app, toggle_click_through);
    }
    let enabled = !window_policy_snapshot(app)?.click_through;
    set_click_through(app, db, enabled)
}

fn window_policy_snapshot(app: &AppHandle) -> Result<WindowPolicySnapshot, String> {
    let policy = app.state::<WindowPolicy>();
    let runtime = policy.0.lock().map_err(|error| error.to_string())?;
    let decision = reduce(runtime.inputs, FocusIntent::Preserve);
    Ok(snapshot_for_app(app, runtime.inputs, decision))
}

pub fn restore_click_through(app: &AppHandle, db: &Db) -> Result<WindowPolicySnapshot, String> {
    if !on_main_thread() {
        return post_click_through(app, restore_click_through);
    }
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

#[tauri::command]
pub fn window_policy_get(
    app: AppHandle,
    policy: State<'_, WindowPolicy>,
) -> Result<WindowPolicySnapshot, String> {
    let runtime = policy.0.lock().map_err(|error| error.to_string())?;
    let decision = reduce(runtime.inputs, FocusIntent::Preserve);
    Ok(snapshot_for_app(&app, runtime.inputs, decision))
}

/// 当前有效状态的逻辑几何（宽 × 高），供 monitor 定位/clamp/恢复使用实际窗口尺寸。
/// 宽度取当前界面模式的 `window:width:<mode>`；策略不可用（极早期启动）时回退默认 compact。
pub fn current_geometry(app: &AppHandle) -> (f64, f64) {
    let db = app.state::<Db>();
    let width = island_width(db.inner());
    let policy = app.state::<WindowPolicy>();
    let Ok(runtime) = policy.0.lock() else {
        return geometry_for(IslandState::Compact, width, DockEdge::Top);
    };
    geometry_for_inputs(
        runtime.inputs,
        width,
        crate::monitor::current_dock_edge(db.inner()),
    )
}

/// 强制把窗口调整到当前有效状态的几何。
///
/// `reapply` 只在策略决策变化时生成 Resize；岛长度变化不改变 effective_state，因而不能靠
/// `reapply` 触发 set_size。此函数专供改变几何参数但不改变状态的路径调用。
fn resize_current_window(app: &AppHandle, db: &Db) -> Result<(), String> {
    let state = {
        let policy = app.state::<WindowPolicy>();
        let runtime = policy.0.lock().map_err(|error| error.to_string())?;
        if runtime.inputs.dragging {
            // 拖动胶囊期间不改几何；落点结算会按最新长度/停靠边恢复。
            return Ok(());
        }
        reduce(runtime.inputs, FocusIntent::Preserve).effective_state
    };
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    resize_window(
        &window,
        state,
        island_width(db),
        crate::monitor::current_dock_edge(db),
    )
}

pub(crate) fn resize_current_for_dock(app: &AppHandle, db: &Db) -> Result<(), String> {
    if crate::monitor::current_ui_mode(db) == "taskbar" {
        let manager = app.state::<crate::taskbar::TaskbarManager>();
        crate::taskbar::apply_taskbar_panel_geometry(
            app,
            manager.inner(),
            island_width(db),
            EXPANDED_HEIGHT_LOGICAL,
        )?;
        return Ok(());
    }
    resize_current_window(app, db)
}

/// 模块 14：设置当前界面模式的岛长度（横向逻辑像素，`window:width:<mode>`）。
///
/// 值经 clamp 到 [420, 1600] 后落盘，随后重放窗口策略——`resize_window` 保 y、按中心重锚 x，
/// 长度变化自动从中间向两侧伸缩。加宽超过屏内可居中范围时，横向 clamp 不再把窗口压回居中
/// （旧的 offset_x 会原样保留），窗口右侧可能伸出屏外被裁；此时补一次 `restore_island_monitor`
/// 按新宽度重新定位（clamp 偏移 + set_position），保证超宽也实时贴屏内居中。最后广播
/// `settings://changed` 让岛窗口容器宽度与设置滑块即时回显。返回落盘后的实际宽度。
#[tauri::command]
pub fn window_width_set(app: AppHandle, db: State<'_, Db>, width: f64) -> Result<f64, String> {
    let clamped = parse_island_width(Some(&width.to_string()));
    let key = crate::monitor::width_key(db.inner());
    let value = format!("{}", clamped as i64);
    db.setting_set(&key, &value)?;
    resize_current_window(&app, db.inner())?;
    if let Err(error) = crate::monitor::restore_island_monitor(&app, db.inner()) {
        tracing::warn!("[window-policy] 岛长度变更后重新定位失败：{error}");
    }
    app.emit(
        "settings://changed",
        crate::settings_window::SettingsChanged {
            key,
            value: Some(value),
        },
    )
    .map_err(|error| format!("广播岛长度变更失败：{error}"))?;
    Ok(clamped)
}

/// 拖动胶囊是否离开了起点；起点未知时按已移动处理（保持结算原有行为）。
pub fn drag_moved(origin: Option<(i32, i32)>, now: (i32, i32)) -> bool {
    origin != Some(now)
}

/// 进入拖动态：清除悬停阶段（拖动结束后不再残留悬停展开/条状，BUG-20261108-01 #1）。
fn begin_drag(inputs: &mut WindowPolicyInputs) {
    inputs.dragging = true;
    inputs.hover_stage = 0;
}

/// 结束拖动态并返回此前是否在拖动。只改输入，不做平台调用；调用方随后恢复几何与位置。
pub fn end_drag(app: &AppHandle) -> Result<bool, String> {
    let policy = app.state::<WindowPolicy>();
    let mut runtime = policy.0.lock().map_err(|error| error.to_string())?;
    let was_dragging = runtime.inputs.dragging;
    if was_dragging {
        runtime.inputs.dragging = false;
        runtime.operation_generation = runtime.operation_generation.wrapping_add(1);
    }
    Ok(was_dragging)
}

/// 退出拖动态并按已保存的停靠边/偏移恢复几何与位置（拖动未能开始或被取消时使用）。
fn abandon_drag(app: &AppHandle) {
    let db = app.state::<Db>();
    let _ = end_drag(app);
    if let Err(error) = resize_current_for_dock(app, db.inner()) {
        tracing::warn!("[window-policy] 退出拖动后恢复尺寸失败：{error}");
    }
    if let Err(error) = crate::monitor::restore_island_monitor(app, db.inner()) {
        tracing::warn!("[window-policy] 退出拖动后恢复位置失败：{error}");
    }
}

/// Alt+拖动开始：原生窗口改为以光标为中心的 240×80 拖动胶囊（吸附按可见胶囊判定），随后
/// 由 Rust 启动系统拖动并观测其结束，结算后广播 `window://drag-settled`（BUG-20261108-01
/// #1/#6 与 2026-11-09 真机反馈）。返回拖动 id；taskbar 模式面板几何由任务栏决定，不拖动，返回 None。
#[tauri::command]
pub fn window_drag_begin(app: AppHandle) -> Result<Option<u64>, String> {
    if crate::monitor::current_ui_mode(app.state::<Db>().inner()) == "taskbar" {
        return Ok(None);
    }
    update_and_apply(&app, begin_drag, FocusIntent::Preserve)?;
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    let bounds = match (current_bounds(&window), cursor_position()) {
        (Some((_, scale)), Some((x, y))) => Ok(drag_bounds_at(x, y, scale)),
        (Some((old, scale)), None) => Ok(anchored_bounds(
            old,
            logical_to_physical(CAPSULE_WIDTH_LOGICAL, scale),
            logical_to_physical(COMPACT_HEIGHT_LOGICAL, scale),
            DockEdge::Top,
        )),
        (None, _) => Err("读取灵动岛窗口几何失败".to_string()),
    };
    let started = bounds
        .and_then(|bounds| set_window_bounds(&window, bounds).map(|()| bounds))
        .and_then(|bounds| crate::island_drag::start(&app, &window, (bounds.x, bounds.y)));
    match started {
        Ok(id) => Ok(Some(id)),
        Err(error) => {
            abandon_drag(&app);
            let _ = reapply(&app);
            Err(error)
        }
    }
}

/// 取消当前拖动（前端兜底超时或卸载时调用）：不结算落点，回到拖动前的停靠位置。
#[tauri::command]
pub fn window_drag_cancel(app: AppHandle) -> Result<WindowPolicySnapshot, String> {
    crate::island_drag::cancel();
    abandon_drag(&app);
    reapply(&app)
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
    fn taskbar_snapshot_fields_roundtrip() {
        let decision = reduce(
            WindowPolicyInputs::new(IslandState::Expanded),
            FocusIntent::Preserve,
        );
        let inputs = WindowPolicyInputs::new(IslandState::Expanded);
        let policy_snapshot = snapshot(
            inputs,
            decision,
            true,
            crate::taskbar::TaskbarSnapshot {
                available: true,
                expanded: true,
                reason: None,
                ..Default::default()
            },
        );
        assert!(policy_snapshot.taskbar_mode);
        assert!(policy_snapshot.taskbar_available);
        assert!(policy_snapshot.taskbar_expanded);
        assert_eq!(policy_snapshot.taskbar_reason, None);

        let fallback = snapshot(
            inputs,
            decision,
            true,
            crate::taskbar::TaskbarSnapshot {
                available: false,
                reason: Some("未找到 Windows 任务栏".to_string()),
                ..Default::default()
            },
        );
        assert!(!fallback.taskbar_available);
        assert!(!fallback.taskbar_expanded);
        assert_eq!(
            fallback.taskbar_reason.as_deref(),
            Some("未找到 Windows 任务栏")
        );
    }

    #[test]
    fn capsule_state_parses_and_geometry_is_240_by_80() {
        assert_eq!(IslandState::parse("capsule").unwrap(), IslandState::Capsule);
        // 宽度参数化：条状/展开取参数宽度（模块 14 的 window:width:<mode>），胶囊恒 240。
        assert_eq!(
            geometry_for(IslandState::Capsule, 720.0, DockEdge::Top),
            (240.0, 80.0)
        );
        assert_eq!(
            geometry_for(IslandState::Compact, 720.0, DockEdge::Top),
            (720.0, 80.0)
        );
        assert_eq!(
            geometry_for(IslandState::Expanded, 720.0, DockEdge::Top),
            (720.0, 400.0)
        );
        // 自定义长度：compact/expanded 共用同一宽度，高度保持 80/400 不变；胶囊仍 240。
        assert_eq!(
            geometry_for(IslandState::Compact, 500.0, DockEdge::Top),
            (500.0, 80.0)
        );
        assert_eq!(
            geometry_for(IslandState::Expanded, 500.0, DockEdge::Top),
            (500.0, 400.0)
        );
        assert_eq!(
            geometry_for(IslandState::Capsule, 500.0, DockEdge::Top),
            (240.0, 80.0)
        );
        assert_eq!(
            geometry_for(IslandState::Expanded, 1200.0, DockEdge::Top),
            (1200.0, 400.0)
        );
        assert_eq!(
            geometry_for(IslandState::Capsule, 720.0, DockEdge::Left),
            (80.0, 240.0)
        );
        assert_eq!(
            geometry_for(IslandState::Compact, 720.0, DockEdge::Right),
            (80.0, 720.0)
        );
        assert_eq!(
            geometry_for(IslandState::Expanded, 720.0, DockEdge::Left),
            (400.0, 720.0)
        );
    }

    #[test]
    fn parse_island_width_falls_back_and_clamps() {
        // 缺键/空/非法/非有限一律回退默认 720（老用户无感）。
        assert_eq!(parse_island_width(None), COMPACT_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("")), COMPACT_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("   ")), COMPACT_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("abc")), COMPACT_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("NaN")), COMPACT_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("inf")), COMPACT_WIDTH_LOGICAL);
        // 合法值 clamp 到 [420, 1600]。
        assert_eq!(parse_island_width(Some("0")), MIN_STRIP_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("100")), MIN_STRIP_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("420")), MIN_STRIP_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("720")), 720.0);
        assert_eq!(parse_island_width(Some(" 640 ")), 640.0);
        assert_eq!(parse_island_width(Some("1600")), MAX_STRIP_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("99999")), MAX_STRIP_WIDTH_LOGICAL);
        assert_eq!(parse_island_width(Some("-50")), MIN_STRIP_WIDTH_LOGICAL);
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

    // ---- BUG-20261108-01 ----

    fn bounds(x: i32, y: i32, width: i32, height: i32) -> PhysicalBounds {
        PhysicalBounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn anchored_bounds_keep_the_dock_edge_fixed_in_one_rect() {
        let old = bounds(100, 0, 900, 100);
        // top：水平居中、顶边不动。
        assert_eq!(
            anchored_bounds(old, 300, 100, DockEdge::Top),
            bounds(400, 0, 300, 100)
        );
        // bottom：水平居中、底边不动（向上展开）。
        assert_eq!(
            anchored_bounds(old, 900, 500, DockEdge::Bottom),
            bounds(100, -400, 900, 500)
        );
        let vertical = bounds(0, 100, 100, 900);
        // left：垂直居中、左边不动。
        assert_eq!(
            anchored_bounds(vertical, 500, 900, DockEdge::Left),
            bounds(0, 100, 500, 900)
        );
        // right：垂直居中、右边不动（向屏内展开）。
        assert_eq!(
            anchored_bounds(vertical, 500, 300, DockEdge::Right),
            bounds(-400, 400, 500, 300)
        );
    }

    #[test]
    fn drag_capsule_is_240_by_80_centered_on_the_cursor() {
        assert_eq!(drag_bounds_at(1000, 500, 1.0), bounds(880, 460, 240, 80));
        assert_eq!(drag_bounds_at(1000, 500, 1.5), bounds(820, 440, 360, 120));
    }

    #[test]
    fn begin_drag_clears_hover_stage_so_the_island_cannot_stay_hover_expanded() {
        let mut policy_inputs = inputs(IslandState::Compact, false, false);
        policy_inputs.floating_ball = true;
        policy_inputs.hover_expand = true;
        policy_inputs.hover_stage = 2;
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Expanded
        );

        begin_drag(&mut policy_inputs);

        assert!(policy_inputs.dragging);
        assert_eq!(policy_inputs.hover_stage, 0);
        assert_eq!(
            reduce(policy_inputs, FocusIntent::Preserve).effective_state,
            IslandState::Capsule
        );
    }

    #[test]
    fn dragging_keeps_show_hide_focus_but_skips_state_resizes() {
        let plan = EffectPlan::between(
            Some(decision(IslandState::Expanded)),
            decision(IslandState::Capsule),
        );
        assert_eq!(
            plan.ops,
            vec![WindowOp::Resize(IslandState::Capsule), WindowOp::Show]
        );
        assert_eq!(plan.without_resize().ops, vec![WindowOp::Show]);
    }

    #[test]
    fn drag_geometry_overrides_state_geometry_while_dragging() {
        let mut policy_inputs = inputs(IslandState::Expanded, false, false);
        assert_eq!(
            geometry_for_inputs(policy_inputs, 720.0, DockEdge::Left),
            (400.0, 720.0)
        );
        policy_inputs.dragging = true;
        assert_eq!(
            geometry_for_inputs(policy_inputs, 720.0, DockEdge::Left),
            (240.0, 80.0)
        );
    }

    /// 审查 #3：穿透事务提交时只合并穿透相关字段，不能抹掉其它线程期间写入的输入。
    #[test]
    fn click_through_commit_keeps_concurrent_inputs() {
        let mut current = inputs(IslandState::Compact, true, false);
        current.hide_in_fullscreen = true;
        current.hover_stage = 1;
        let merged = merge_click_through(current, true);
        assert!(merged.click_through);
        assert_eq!(merged.hover_stage, 0);
        assert!(merged.fullscreen_block);
        assert!(merged.hide_in_fullscreen);

        let restored = merge_click_through(current, false);
        assert!(!restored.click_through);
        assert_eq!(restored.hover_stage, 1);
        assert!(restored.fullscreen_block);
    }

    /// 审查 #6：原地 Alt+点击（拖动胶囊没动）不应改变岛的位置；起点未知时按已移动处理。
    #[test]
    fn drag_moved_requires_a_known_origin_that_differs() {
        assert!(!drag_moved(Some((10, 20)), (10, 20)));
        assert!(drag_moved(Some((10, 20)), (11, 20)));
        assert!(drag_moved(None, (10, 20)));
    }

    #[test]
    fn main_thread_marker_defaults_to_inline_execution() {
        // 未登记主线程（单测/极早期启动）时一律按主线程内联执行，不投递。
        assert!(on_main_thread());
    }
}
