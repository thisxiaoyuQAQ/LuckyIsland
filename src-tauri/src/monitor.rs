use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, Size, State};

use crate::dock_edge::DockEdge;
use crate::storage::Db;
use crate::window_policy;

pub const MONITOR_SETTING_KEY: &str = "window:monitor";
pub const PRIMARY_SELECTION: &str = "primary";
pub const TOP_GAP_PHYSICAL: i32 = 16;
/// 界面模式 KV（模块 13）：classisland 贴顶（gap=0），其余悬浮（gap=TOP_GAP_PHYSICAL）。
pub const UI_MODE_KEY: &str = "window:ui_mode";
/// 偏移 KV key（07a 窗口外观）；存储为整数字符串，可为负。
pub const OFFSET_X_KEY: &str = "window:offset_x";
pub const OFFSET_Y_KEY: &str = "window:offset_y";
/// 背景透明度 KV key 前缀（07a）；取值在前端，Rust 侧只负责按模式命名与迁移。
pub const OPACITY_KEY: &str = "window:opacity";
/// 岛长度 KV key（模块 14）；横向逻辑像素整数，按界面模式独立（`window:width:<mode>`）。
/// 缺键/非法回退 `window_policy::COMPACT_WIDTH_LOGICAL`（720）；胶囊固定 240 不受它影响。
pub const WIDTH_KEY: &str = "window:width";
/// 当前界面模式的停靠边键（模块 14）。
pub const DOCK_EDGE_KEY: &str = "window:dock_edge";
pub const SNAP_THRESHOLD_PHYSICAL: i32 = 48;
/// 三种正式界面模式；缺键、非法值及历史 `corner` 均由 `normalize_ui_mode` 安全回退 `island`。
#[cfg(test)]
const UI_MODES: [&str; 3] = ["island", "classisland", "taskbar"];
/// 运行时显示器变化轮询间隔。副屏断开后最多延迟此时间即临时跳回主屏。
const RUNTIME_WATCH_INTERVAL: Duration = Duration::from_secs(2);

/// 当前有效状态的逻辑几何；策略不可用（如极早期启动）时回退 compact。
fn current_logical_geometry(app: &AppHandle) -> (f64, f64) {
    window_policy::current_geometry(app)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeWatchAction {
    None,
    RecoverPrimary,
    RestoreSaved,
}

fn runtime_watch_action(fell_back: bool, saved_available: bool) -> RuntimeWatchAction {
    match (fell_back, saved_available) {
        (false, false) => RuntimeWatchAction::RecoverPrimary,
        (true, true) => RuntimeWatchAction::RestoreSaved,
        _ => RuntimeWatchAction::None,
    }
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RecoveryOperation {
    ResizePolicyGeometry,
    Unminimize,
    Move,
    ReapplyPolicy,
}

#[cfg(test)]
const RECOVERY_OPERATIONS: &[RecoveryOperation] = &[
    RecoveryOperation::ResizePolicyGeometry,
    RecoveryOperation::Unminimize,
    RecoveryOperation::Move,
    RecoveryOperation::ReapplyPolicy,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorPoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub label: String,
    pub is_primary: bool,
    pub position: MonitorPoint,
    pub size: MonitorSize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSelectionState {
    pub selected: String,
    pub resolved: String,
    pub fallback: bool,
}

fn normalize_selection(value: Option<&str>) -> String {
    let value = value.unwrap_or_default().trim();
    if value.is_empty() || value == PRIMARY_SELECTION {
        PRIMARY_SELECTION.to_string()
    } else {
        value.to_string()
    }
}

fn fallback_monitor_id(position: &MonitorPoint, size: &MonitorSize) -> String {
    format!(
        "display:{}:{}:{}:{}",
        position.x, position.y, size.width, size.height
    )
}

fn resolve_selection(
    monitors: &[MonitorInfo],
    primary_id: &str,
    selected: &str,
) -> Result<MonitorSelectionState, String> {
    if !monitors.iter().any(|monitor| monitor.id == primary_id) {
        return Err("无法识别当前主显示器".to_string());
    }
    if selected == PRIMARY_SELECTION {
        return Ok(MonitorSelectionState {
            selected: PRIMARY_SELECTION.to_string(),
            resolved: primary_id.to_string(),
            fallback: false,
        });
    }
    if monitors.iter().any(|monitor| monitor.id == selected) {
        Ok(MonitorSelectionState {
            selected: selected.to_string(),
            resolved: selected.to_string(),
            fallback: false,
        })
    } else {
        Ok(MonitorSelectionState {
            selected: selected.to_string(),
            resolved: primary_id.to_string(),
            fallback: true,
        })
    }
}

fn validate_selection(selection: &str, monitors: &[MonitorInfo]) -> Result<(), String> {
    if selection == PRIMARY_SELECTION || monitors.iter().any(|monitor| monitor.id == selection) {
        Ok(())
    } else {
        Err(format!("显示器当前不可用：{selection}"))
    }
}

fn physical_window_width(logical_width: f64, scale_factor: f64) -> u32 {
    (logical_width * scale_factor).round().max(1.0) as u32
}

fn physical_window_height(logical_height: f64, scale_factor: f64) -> u32 {
    (logical_height * scale_factor).round().max(1.0) as u32
}

fn docked_position(
    monitor: &MonitorInfo,
    window_width: u32,
    window_height: u32,
    gap: i32,
    edge: DockEdge,
    offset_x: i32,
    offset_y: i32,
) -> MonitorPoint {
    let centered_x = monitor.position.x + (monitor.size.width as i32 - window_width as i32) / 2;
    let centered_y = monitor.position.y + (monitor.size.height as i32 - window_height as i32) / 2;
    let (x, y) = match edge {
        DockEdge::Top => (centered_x, monitor.position.y + gap),
        DockEdge::Bottom => (
            centered_x,
            monitor.position.y + monitor.size.height as i32 - gap - window_height as i32,
        ),
        DockEdge::Left => (monitor.position.x + gap, centered_y),
        DockEdge::Right => (
            monitor.position.x + monitor.size.width as i32 - gap - window_width as i32,
            centered_y,
        ),
    };
    MonitorPoint {
        x: x + offset_x,
        y: y + offset_y,
    }
}

struct RuntimeMonitor {
    raw: Monitor,
    info: MonitorInfo,
}

struct MonitorSet {
    monitors: Vec<RuntimeMonitor>,
    primary_id: String,
}

fn monitor_point(monitor: &Monitor) -> MonitorPoint {
    MonitorPoint {
        x: monitor.position().x,
        y: monitor.position().y,
    }
}

fn monitor_size(monitor: &Monitor) -> MonitorSize {
    MonitorSize {
        width: monitor.size().width,
        height: monitor.size().height,
    }
}

fn monitor_id(monitor: &Monitor) -> String {
    let position = monitor_point(monitor);
    let size = monitor_size(monitor);
    monitor
        .name()
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| fallback_monitor_id(&position, &size))
}

fn same_monitor(left: &Monitor, right: &Monitor) -> bool {
    left.name() == right.name()
        && left.position() == right.position()
        && left.size() == right.size()
}

fn capture_monitors(app: &AppHandle) -> Result<MonitorSet, String> {
    let primary = app
        .primary_monitor()
        .map_err(|error| format!("读取主显示器失败：{error}"))?
        .ok_or_else(|| "无法识别当前主显示器".to_string())?;
    let primary_id = monitor_id(&primary);
    let mut monitors = app
        .available_monitors()
        .map_err(|error| format!("枚举显示器失败：{error}"))?
        .into_iter()
        .map(|monitor| {
            let position = monitor_point(&monitor);
            let size = monitor_size(&monitor);
            let id = monitor_id(&monitor);
            RuntimeMonitor {
                info: MonitorInfo {
                    label: format!("{id} · {}×{}", size.width, size.height),
                    id,
                    is_primary: same_monitor(&monitor, &primary),
                    position,
                    size,
                },
                raw: monitor,
            }
        })
        .collect::<Vec<_>>();
    if monitors.is_empty() {
        return Err("系统未返回可用显示器".to_string());
    }
    monitors.sort_by(|left, right| {
        left.info
            .position
            .x
            .cmp(&right.info.position.x)
            .then(left.info.position.y.cmp(&right.info.position.y))
            .then(left.info.id.cmp(&right.info.id))
    });
    Ok(MonitorSet {
        monitors,
        primary_id,
    })
}

fn current_selection(db: &Db) -> String {
    normalize_selection(db.setting_get(MONITOR_SETTING_KEY).as_deref())
}

/// 界面模式串规范化：仅正式三值有效；缺键/空/非法（含历史 `corner`）一律 `island`。
pub fn normalize_ui_mode(value: Option<&str>) -> &'static str {
    match value.map(str::trim) {
        Some("classisland") => "classisland",
        Some("taskbar") => "taskbar",
        _ => "island",
    }
}

/// 当前界面模式串（缺键/非法回退 island）。
pub fn current_ui_mode(db: &Db) -> &'static str {
    normalize_ui_mode(db.setting_get(UI_MODE_KEY).as_deref())
}

/// 外观键按界面模式独立存储 —— `window:offset_x` → `window:offset_x:<mode>`。
/// 三种模式的透明度、偏移、长度与停靠边均互不影响；taskbar 不静默读取既有模式值。
pub fn mode_key(base: &str, mode: &str) -> String {
    format!("{base}:{mode}")
}

/// 当前界面模式的岛长度键（`window:width:<mode>`），模块 14。
/// 与 offset/opacity 同套 `mode_key`，供 window_policy 几何与设置面板统一取用。
pub fn width_key(db: &Db) -> String {
    mode_key(WIDTH_KEY, current_ui_mode(db))
}

pub fn dock_edge_key(db: &Db) -> String {
    mode_key(DOCK_EDGE_KEY, current_ui_mode(db))
}

pub fn current_dock_edge(db: &Db) -> DockEdge {
    DockEdge::parse(db.setting_get(&dock_edge_key(db)).as_deref())
}

/// 一次性迁移：把旧的全局外观键复制给 `island`，贴顶模式留默认值。
///
/// 幂等——只在目标键缺失且旧键存在时复制；旧键保留不动（老版本回滚仍可读）。
/// 启动时调用一次，成本是最多 3 次 KV 读 + 3 次写。
pub fn migrate_appearance_keys(db: &Db) {
    for base in [OFFSET_X_KEY, OFFSET_Y_KEY, OPACITY_KEY] {
        let target = mode_key(base, "island");
        if db.setting_get(&target).is_some() {
            continue;
        }
        let Some(legacy) = db.setting_get(base) else {
            continue;
        };
        if let Err(error) = db.setting_set(&target, &legacy) {
            tracing::warn!("[monitor] 迁移外观键 {base} 失败：{error}");
        }
    }
}

/// 读当前界面模式的偏移（`window:offset_x:<mode>`），无效回 0/0。
/// 供所有「定位灵动岛」路径统一取用。
fn read_offsets(db: &Db) -> (i32, i32) {
    let mode = current_ui_mode(db);
    let parse = |raw: Option<String>| -> i32 {
        raw.and_then(|v| v.trim().parse::<i32>().ok()).unwrap_or(0)
    };
    (
        parse(db.setting_get(&mode_key(OFFSET_X_KEY, mode))),
        parse(db.setting_get(&mode_key(OFFSET_Y_KEY, mode))),
    )
}

/// 界面模式 → 顶部间隙（纯函数，便于单测）：classisland 贴顶 0，其余（含缺键/非法）悬浮 16。
fn top_gap_for_mode(mode: Option<&str>) -> i32 {
    match mode {
        Some("classisland") => 0,
        _ => TOP_GAP_PHYSICAL,
    }
}

/// 读 `window:ui_mode` 决定顶部间隙。供所有「定位灵动岛」路径统一取用。
fn read_top_gap(db: &Db) -> i32 {
    top_gap_for_mode(db.setting_get(UI_MODE_KEY).as_deref())
}

/// 把偏移 clamp 到窗口仍留在 monitor 可视区内的范围：
/// 顶部不超出屏顶之上（可贴顶 offset_y 最负到 `-(屏顶-base_y)`）、
/// 左右不超出屏左右（窗口至少留 1px 在屏内，避免完全消失到屏外）。
/// 返回 clamp 后的 (offset_x, offset_y)。
#[cfg(test)]
fn top_center_position(
    monitor: &MonitorInfo,
    window_width: u32,
    top_gap: i32,
    offset_x: i32,
    offset_y: i32,
) -> MonitorPoint {
    docked_position(
        monitor,
        window_width,
        400,
        top_gap,
        DockEdge::Top,
        offset_x,
        offset_y,
    )
}

fn clamp_offsets_for_edge(
    monitor: &MonitorInfo,
    window_width: u32,
    window_height: u32,
    gap: i32,
    edge: DockEdge,
    offset_x: i32,
    offset_y: i32,
) -> (i32, i32) {
    let base = docked_position(monitor, window_width, window_height, gap, edge, 0, 0);
    let min_x = monitor.position.x + 1 - base.x;
    let max_x = monitor.position.x + monitor.size.width as i32 - 1 - window_width as i32 - base.x;
    let min_y = monitor.position.y - base.y;
    let max_y = monitor.position.y + monitor.size.height as i32 - window_height as i32 - base.y;
    let clamp_axis = |value: i32, min: i32, max: i32| {
        if min > max {
            min
        } else {
            value.max(min).min(max)
        }
    };
    (
        clamp_axis(offset_x, min_x, max_x),
        clamp_axis(offset_y, min_y, max_y),
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct WindowRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn edge_distances(rect: WindowRect, monitor: &MonitorInfo) -> [(DockEdge, i32); 4] {
    let monitor_right = monitor.position.x + monitor.size.width as i32;
    let monitor_bottom = monitor.position.y + monitor.size.height as i32;
    [
        (DockEdge::Top, (rect.y - monitor.position.y).abs()),
        (
            DockEdge::Bottom,
            (monitor_bottom - (rect.y + rect.height as i32)).abs(),
        ),
        (DockEdge::Left, (rect.x - monitor.position.x).abs()),
        (
            DockEdge::Right,
            (monitor_right - (rect.x + rect.width as i32)).abs(),
        ),
    ]
}

fn select_dock_edge(
    rect: WindowRect,
    monitor: &MonitorInfo,
    current: DockEdge,
) -> Option<DockEdge> {
    let distances = edge_distances(rect, monitor);
    let minimum = distances.iter().map(|(_, distance)| *distance).min()?;
    if minimum > SNAP_THRESHOLD_PHYSICAL {
        return None;
    }
    if distances
        .iter()
        .any(|(edge, distance)| *edge == current && *distance == minimum)
    {
        return Some(current);
    }
    distances
        .into_iter()
        .find_map(|(edge, distance)| (distance == minimum).then_some(edge))
}

fn top_offsets_for_position(
    monitor: &MonitorInfo,
    window_width: u32,
    window_height: u32,
    gap: i32,
    position: MonitorPoint,
) -> (i32, i32) {
    let base = docked_position(
        monitor,
        window_width,
        window_height,
        gap,
        DockEdge::Top,
        0,
        0,
    );
    (position.x - base.x, position.y - base.y)
}

#[cfg(test)]
fn clamp_offsets(
    monitor: &MonitorInfo,
    window_width: u32,
    window_height: u32,
    gap: i32,
    offset_x: i32,
    offset_y: i32,
) -> (i32, i32) {
    clamp_offsets_for_edge(
        monitor,
        window_width,
        window_height,
        gap,
        DockEdge::Top,
        offset_x,
        offset_y,
    )
}

fn selection_state(set: &MonitorSet, selected: &str) -> Result<MonitorSelectionState, String> {
    let infos = set
        .monitors
        .iter()
        .map(|monitor| monitor.info.clone())
        .collect::<Vec<_>>();
    resolve_selection(&infos, &set.primary_id, selected)
}

fn resolved_monitor<'a>(
    set: &'a MonitorSet,
    state: &MonitorSelectionState,
) -> Result<&'a RuntimeMonitor, String> {
    set.monitors
        .iter()
        .find(|monitor| monitor.info.id == state.resolved)
        .ok_or_else(|| format!("无法找到已解析显示器：{}", state.resolved))
}

fn move_island_to_monitor(
    app: &AppHandle,
    db: &Db,
    monitor: &RuntimeMonitor,
    top_gap: i32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), String> {
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    let scale_factor = monitor.raw.scale_factor();
    let edge = current_dock_edge(db);
    let (logical_width, logical_height) = current_logical_geometry(app);
    let width = physical_window_width(logical_width, scale_factor);
    let height = physical_window_height(logical_height, scale_factor);
    let (cx, cy) = clamp_offsets_for_edge(
        &monitor.info,
        width,
        height,
        top_gap,
        edge,
        offset_x,
        offset_y,
    );
    let position = docked_position(&monitor.info, width, height, top_gap, edge, cx, cy);
    window
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|error| format!("移动灵动岛窗口失败：{error}"))
}

/// 把灵动岛恢复并迁移到目标显示器（运行时显示器变化专用）。
///
/// Windows 在显示器断开时会把窗口移到 (-32000,-32000) 并缩到 160x28（最小化到屏外）。
/// 此时单纯的 `set_position` 不生效——必须先 `set_size` 恢复正常尺寸、`unminimize`
/// 解除最小化，再 `set_position`。最终可见性和焦点由窗口策略重放，不在恢复路径直接裁决。
fn recover_island_to_monitor(
    app: &AppHandle,
    db: &Db,
    monitor: &RuntimeMonitor,
    top_gap: i32,
    offset_x: i32,
    offset_y: i32,
) -> Result<(), String> {
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    let scale_factor = monitor.raw.scale_factor();
    let edge = current_dock_edge(db);
    let (logical_width, logical_height) = current_logical_geometry(app);
    let width = physical_window_width(logical_width, scale_factor);
    let height = physical_window_height(logical_height, scale_factor);
    let (cx, cy) = clamp_offsets_for_edge(
        &monitor.info,
        width,
        height,
        top_gap,
        edge,
        offset_x,
        offset_y,
    );
    let position = docked_position(&monitor.info, width, height, top_gap, edge, cx, cy);
    window
        .set_size(Size::Logical(LogicalSize {
            width: logical_width,
            height: logical_height,
        }))
        .map_err(|error| format!("恢复窗口尺寸失败：{error}"))?;
    let _ = window.unminimize();
    window
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|error| format!("移动灵动岛窗口失败：{error}"))?;
    crate::window_policy::reapply(app)?;
    Ok(())
}

#[tauri::command]
pub fn monitor_list(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    Ok(capture_monitors(&app)?
        .monitors
        .into_iter()
        .map(|monitor| monitor.info)
        .collect())
}

#[tauri::command]
pub fn monitor_get_selection(
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<MonitorSelectionState, String> {
    let set = capture_monitors(&app)?;
    selection_state(&set, &current_selection(db.inner()))
}

#[tauri::command]
pub fn monitor_select(
    app: AppHandle,
    db: State<'_, Db>,
    selection: String,
) -> Result<MonitorSelectionState, String> {
    let selection = normalize_selection(Some(&selection));
    let set = capture_monitors(&app)?;
    let infos = set
        .monitors
        .iter()
        .map(|monitor| monitor.info.clone())
        .collect::<Vec<_>>();
    validate_selection(&selection, &infos)?;
    let state = selection_state(&set, &selection)?;
    let target = resolved_monitor(&set, &state)?;
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    let previous_position = window
        .outer_position()
        .map_err(|error| format!("读取灵动岛窗口位置失败：{error}"))?;

    let (offset_x, offset_y) = read_offsets(db.inner());
    let top_gap = read_top_gap(db.inner());
    move_island_to_monitor(&app, db.inner(), target, top_gap, offset_x, offset_y)?;
    if let Err(error) = db.setting_set(MONITOR_SETTING_KEY, &selection) {
        let _ = window.set_position(previous_position);
        return Err(format!("保存显示器选择失败：{error}"));
    }
    Ok(state)
}

/// 恢复 island 的显示器定位；taskbar 模式下面板位置由任务栏矩形驱动，不走顶部/贴边定位。
pub fn restore_island_monitor(app: &AppHandle, db: &Db) -> Result<MonitorSelectionState, String> {
    let set = capture_monitors(app)?;
    let state = selection_state(&set, &current_selection(db))?;
    let target = resolved_monitor(&set, &state)?;
    if current_ui_mode(db) == "taskbar" {
        let manager = app.state::<crate::taskbar::TaskbarManager>();
        let width =
            crate::window_policy::parse_island_width(db.setting_get(&width_key(db)).as_deref());
        crate::taskbar::apply_taskbar_panel_geometry(app, manager.inner(), width, 400.0)?;
        return Ok(state);
    }
    let (offset_x, offset_y) = read_offsets(db);
    let top_gap = read_top_gap(db);
    move_island_to_monitor(app, db, target, top_gap, offset_x, offset_y)?;
    Ok(state)
}

/// 07a 实时应用偏移（不切屏）：写**当前界面模式**的 `window:offset_x/y:<mode>` KV +
/// 按当前 resolved monitor 重算 `set_position` 让灵动岛真正上屏。前端拖动偏移滑块时调用，
/// 值经 clamp 后落盘，这样持久化的是 clamp 后的安全值（用户重启后窗口不会跑到屏外）。
#[tauri::command]
pub fn window_offset_apply(
    app: AppHandle,
    db: State<'_, Db>,
    offset_x: i32,
    offset_y: i32,
) -> Result<(i32, i32), String> {
    let set = capture_monitors(&app)?;
    let state = selection_state(&set, &current_selection(db.inner()))?;
    let target = resolved_monitor(&set, &state)?;
    let scale_factor = target.raw.scale_factor();
    let top_gap = read_top_gap(db.inner());
    let edge = current_dock_edge(db.inner());
    let (logical_width, logical_height) = current_logical_geometry(&app);
    let width = physical_window_width(logical_width, scale_factor);
    let height = physical_window_height(logical_height, scale_factor);
    let (cx, cy) = clamp_offsets_for_edge(
        &target.info,
        width,
        height,
        top_gap,
        edge,
        offset_x,
        offset_y,
    );
    // 先落盘 clamp 后的值，再上屏——即使上屏失败也不会留下跑出屏的持久化值。
    let mode = current_ui_mode(db.inner());
    let x_key = mode_key(OFFSET_X_KEY, mode);
    let y_key = mode_key(OFFSET_Y_KEY, mode);
    if cx != 0 {
        db.setting_set(&x_key, &cx.to_string())?;
    } else {
        // 0 用删除表示「无偏移」，保持 settings 表干净
        db.setting_delete(&x_key)?;
    }
    if cy != 0 {
        db.setting_set(&y_key, &cy.to_string())?;
    } else {
        db.setting_delete(&y_key)?;
    }
    let position = docked_position(&target.info, width, height, top_gap, edge, cx, cy);
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    window
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|error| format!("应用偏移失败：{error}"))?;
    Ok((cx, cy))
}

fn restore_setting(db: &Db, key: &str, value: Option<&str>) -> Result<(), String> {
    match value {
        Some(value) => db.setting_set(key, value),
        None => db.setting_delete(key),
    }
}

fn restore_window_rect(
    window: &tauri::WebviewWindow,
    position: PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
) {
    let _ = window.set_size(Size::Physical(size));
    let _ = window.set_position(position);
}

fn restore_dock_settings(
    db: &Db,
    edge_key: &str,
    x_key: &str,
    y_key: &str,
    previous_edge: Option<&str>,
    previous_x: Option<&str>,
    previous_y: Option<&str>,
) {
    if let Err(error) = restore_setting(db, edge_key, previous_edge) {
        tracing::warn!("[monitor] 回滚停靠边失败：{error}");
    }
    if let Err(error) = restore_setting(db, x_key, previous_x) {
        tracing::warn!("[monitor] 回滚横向偏移失败：{error}");
    }
    if let Err(error) = restore_setting(db, y_key, previous_y) {
        tracing::warn!("[monitor] 回滚纵向偏移失败：{error}");
    }
}

#[tauri::command]
pub fn window_dock_edge_set(
    app: AppHandle,
    db: State<'_, Db>,
    edge: String,
) -> Result<String, String> {
    let edge = DockEdge::parse(Some(&edge));
    let mode = current_ui_mode(db.inner());
    let edge_key = mode_key(DOCK_EDGE_KEY, mode);
    let previous_edge = db.setting_get(&edge_key);
    let x_key = mode_key(OFFSET_X_KEY, mode);
    let y_key = mode_key(OFFSET_Y_KEY, mode);
    let previous_x = db.setting_get(&x_key);
    let previous_y = db.setting_get(&y_key);
    db.setting_set(&edge_key, edge.as_str())?;
    db.setting_delete(&x_key)?;
    db.setting_delete(&y_key)?;
    if let Err(error) = crate::window_policy::resize_current_for_dock(&app, db.inner())
        .and_then(|_| restore_island_monitor(&app, db.inner()))
    {
        restore_dock_settings(
            db.inner(),
            &edge_key,
            &x_key,
            &y_key,
            previous_edge.as_deref(),
            previous_x.as_deref(),
            previous_y.as_deref(),
        );
        return Err(error);
    }
    if let Err(error) = app.emit(
        "settings://changed",
        crate::settings_window::SettingsChanged {
            key: edge_key.clone(),
            value: Some(edge.as_str().to_string()),
        },
    ) {
        restore_dock_settings(
            db.inner(),
            &edge_key,
            &x_key,
            &y_key,
            previous_edge.as_deref(),
            previous_x.as_deref(),
            previous_y.as_deref(),
        );
        let _ = crate::window_policy::resize_current_for_dock(&app, db.inner());
        let _ = restore_island_monitor(&app, db.inner());
        return Err(format!("广播停靠边变更失败：{error}"));
    }
    Ok(edge.as_str().to_string())
}

#[tauri::command]
pub fn window_drag_drop_settle(app: AppHandle, db: State<'_, Db>) -> Result<String, String> {
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    let position = window
        .outer_position()
        .map_err(|error| format!("读取拖动落点失败：{error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("读取拖动窗口尺寸失败：{error}"))?;
    let monitor = window
        .current_monitor()
        .map_err(|error| format!("读取拖动目标显示器失败：{error}"))?
        .ok_or_else(|| "无法识别拖动目标显示器".to_string())?;
    let info = MonitorInfo {
        id: monitor_id(&monitor),
        label: String::new(),
        is_primary: false,
        position: monitor_point(&monitor),
        size: monitor_size(&monitor),
    };
    let previous_monitor = db.setting_get(MONITOR_SETTING_KEY);
    let current = current_dock_edge(db.inner());
    let rect = WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let mode = current_ui_mode(db.inner());
    let edge_key = mode_key(DOCK_EDGE_KEY, mode);
    let x_key = mode_key(OFFSET_X_KEY, mode);
    let y_key = mode_key(OFFSET_Y_KEY, mode);
    let previous_edge = db.setting_get(&edge_key);
    let previous_x = db.setting_get(&x_key);
    let previous_y = db.setting_get(&y_key);
    let result = (|| -> Result<DockEdge, String> {
        db.setting_set(MONITOR_SETTING_KEY, &info.id)?;
        let selected = select_dock_edge(rect, &info, current);
        let edge = if let Some(edge) = selected {
            db.setting_set(&edge_key, edge.as_str())?;
            db.setting_delete(&x_key)?;
            db.setting_delete(&y_key)?;
            crate::window_policy::resize_current_for_dock(&app, db.inner())?;
            restore_island_monitor(&app, db.inner())?;
            edge
        } else {
            let gap = read_top_gap(db.inner());
            let (offset_x, offset_y) = top_offsets_for_position(
                &info,
                size.width,
                size.height,
                gap,
                MonitorPoint {
                    x: position.x,
                    y: position.y,
                },
            );
            db.setting_set(&edge_key, DockEdge::Top.as_str())?;
            window_offset_apply(app.clone(), db.clone(), offset_x, offset_y)?;
            DockEdge::Top
        };
        app.emit(
            "settings://changed",
            crate::settings_window::SettingsChanged {
                key: edge_key.clone(),
                value: Some(edge.as_str().to_string()),
            },
        )
        .map_err(|error| format!("广播拖动落点失败：{error}"))?;
        let state = MonitorSelectionState {
            selected: info.id.clone(),
            resolved: info.id.clone(),
            fallback: false,
        };
        app.emit("monitor://changed", state)
            .map_err(|error| format!("广播显示器变更失败：{error}"))?;
        Ok(edge)
    })();
    match result {
        Ok(edge) => Ok(edge.as_str().to_string()),
        Err(error) => {
            if let Err(rollback_error) =
                restore_setting(db.inner(), MONITOR_SETTING_KEY, previous_monitor.as_deref())
            {
                tracing::warn!("[monitor] 回滚显示器选择失败：{rollback_error}");
            }
            restore_dock_settings(
                db.inner(),
                &edge_key,
                &x_key,
                &y_key,
                previous_edge.as_deref(),
                previous_x.as_deref(),
                previous_y.as_deref(),
            );
            let _ = crate::window_policy::resize_current_for_dock(&app, db.inner());
            let _ = restore_island_monitor(&app, db.inner());
            restore_window_rect(&window, position, size);
            Err(error)
        }
    }
}

/// 模块 14：切换界面模式（island 悬浮 | classisland 贴顶 | taskbar 任务栏）。
///
/// 写 `window:ui_mode` → 按新模式宽度调整窗口 → 按新模式偏移恢复显示器位置
/// → 广播 `settings://changed`。任一步失败都恢复旧模式、尺寸和位置。
#[tauri::command]
pub fn window_ui_mode_set(
    app: AppHandle,
    db: State<'_, Db>,
    mode: String,
) -> Result<String, String> {
    let normalized = normalize_ui_mode(Some(&mode));
    let previous_mode = db.setting_get(UI_MODE_KEY);
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    let previous_position = window
        .outer_position()
        .map_err(|error| format!("读取灵动岛窗口位置失败：{error}"))?;
    let previous_size = window
        .outer_size()
        .map_err(|error| format!("读取灵动岛窗口尺寸失败：{error}"))?;

    let result = (|| -> Result<(), String> {
        // 先切换到目标模式的窗口形态，再落盘 ui_mode；失败时下面整体回滚。
        let manager = app.state::<crate::taskbar::TaskbarManager>();
        if normalized == "taskbar" {
            if let Err(error) = crate::window_policy::set_desired_state(
                &app,
                crate::window_policy::IslandState::Compact,
                crate::window_policy::FocusIntent::Preserve,
            ) {
                tracing::warn!("[monitor] 切 taskbar 前收起 island 失败：{error}");
            }
            crate::taskbar::enter_taskbar_mode(&app, manager.inner(), db.inner())?;
        } else if previous_mode.as_deref() == Some("taskbar") {
            crate::taskbar::leave_taskbar_mode(&app, manager.inner())?;
        }
        db.setting_set(UI_MODE_KEY, normalized)?;
        crate::window_policy::resize_current_for_dock(&app, db.inner())?;
        restore_island_monitor(&app, db.inner())?;
        app.emit(
            "settings://changed",
            crate::settings_window::SettingsChanged {
                key: UI_MODE_KEY.to_string(),
                value: Some(normalized.to_string()),
            },
        )
        .map_err(|error| format!("广播界面模式变更失败：{error}"))
    })();

    if let Err(error) = result {
        if let Err(rollback_error) =
            restore_setting(db.inner(), UI_MODE_KEY, previous_mode.as_deref())
        {
            tracing::warn!("[monitor] 回滚界面模式失败：{rollback_error}");
        }
        // 窗口形态回滚：若原本在 taskbar，重新嵌入；否则确保 strip 已脱离并隐藏。
        let manager = app.state::<crate::taskbar::TaskbarManager>();
        if previous_mode.as_deref() == Some("taskbar") {
            if let Err(reenter) =
                crate::taskbar::enter_taskbar_mode(&app, manager.inner(), db.inner())
            {
                tracing::warn!("[monitor] 回滚到 taskbar 失败：{reenter}");
            }
        } else if let Err(leave) = crate::taskbar::leave_taskbar_mode(&app, manager.inner()) {
            tracing::warn!("[monitor] 回滚离开 taskbar 失败：{leave}");
        }
        let _ = crate::window_policy::resize_current_for_dock(&app, db.inner());
        let _ = restore_island_monitor(&app, db.inner());
        restore_window_rect(&window, previous_position, previous_size);
        return Err(error);
    }
    Ok(normalized.to_string())
}

/// 运行时显示器变化监听：周期性检查已保存的具体显示器是否还在线。
///
/// - 副屏断开：Windows 会把窗口移到 (-32000,-32000) 并缩到 160x28（最小化到屏外），
///   `recover_island_to_monitor` 恢复尺寸并迁移到主屏；emit `monitor://changed`
///   携带 `fallback=true`，让设置页显示「当前不可用，暂用主显示器」。
/// - 副屏恢复：主动迁移回已保存副屏，成功后才复位 `fell_back` 并 emit
///   `fallback=false`；失败则保留回退态供后续轮询重试。
///
/// 选中「主显示器」时不做任何事——主屏若消失应用本身已无法正常显示。
pub fn start_runtime_watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut fell_back = false;
        loop {
            tokio::time::sleep(RUNTIME_WATCH_INTERVAL).await;
            let Some(set) = capture_monitors(&app).ok() else {
                continue;
            };
            let saved = {
                let db = app.state::<Db>();
                current_selection(db.inner())
            };

            // taskbar 模式：显示器/Explorer/任务栏矩形变化后重新挂载 strip 并重定位面板。
            // 持久化的 ui_mode 保持 taskbar；任务栏不可用时只记录日志，等待下一轮恢复。
            {
                let db = app.state::<Db>();
                if current_ui_mode(db.inner()) == "taskbar" {
                    let manager = app.state::<crate::taskbar::TaskbarManager>();
                    if crate::taskbar::taskbar_needs_reattach(manager.inner()) {
                        match crate::taskbar::taskbar_reapply(&app, manager.inner(), db.inner()) {
                            Ok(snapshot) => {
                                let _ = app.emit("window://taskbar-state-changed", snapshot);
                            }
                            Err(error) => {
                                tracing::warn!("[taskbar] 运行时重挂任务栏失败：{error}");
                            }
                        }
                    }
                    continue;
                }
            }

            // 选中主显示器：无需运行时回退，复位标志即可。
            if saved == PRIMARY_SELECTION {
                fell_back = false;
                continue;
            }

            let saved_available = set.monitors.iter().any(|m| m.info.id == saved);
            match runtime_watch_action(fell_back, saved_available) {
                RuntimeWatchAction::RestoreSaved => {
                    let Some(target) = set.monitors.iter().find(|m| m.info.id == saved) else {
                        continue;
                    };
                    let db = app.state::<Db>();
                    let (offset_x, offset_y) = read_offsets(db.inner());
                    let top_gap = read_top_gap(db.inner());
                    if recover_island_to_monitor(
                        &app,
                        db.inner(),
                        target,
                        top_gap,
                        offset_x,
                        offset_y,
                    )
                    .is_ok()
                    {
                        fell_back = false;
                        let _ = app.emit(
                            "monitor://changed",
                            MonitorSelectionState {
                                selected: saved.clone(),
                                resolved: saved,
                                fallback: false,
                            },
                        );
                    }
                }
                RuntimeWatchAction::RecoverPrimary => {
                    let Some(primary) = set.monitors.iter().find(|m| m.info.id == set.primary_id)
                    else {
                        continue;
                    };
                    let db = app.state::<Db>();
                    let (offset_x, offset_y) = read_offsets(db.inner());
                    let top_gap = read_top_gap(db.inner());
                    if recover_island_to_monitor(
                        &app,
                        db.inner(),
                        primary,
                        top_gap,
                        offset_x,
                        offset_y,
                    )
                    .is_ok()
                    {
                        fell_back = true;
                        let _ = app.emit(
                            "monitor://changed",
                            MonitorSelectionState {
                                selected: saved,
                                resolved: set.primary_id.clone(),
                                fallback: true,
                            },
                        );
                    }
                }
                RuntimeWatchAction::None => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, x: i32, y: i32, width: u32, height: u32, is_primary: bool) -> MonitorInfo {
        MonitorInfo {
            id: id.to_string(),
            label: format!("{id} · {width}×{height}"),
            is_primary,
            position: MonitorPoint { x, y },
            size: MonitorSize { width, height },
        }
    }

    fn monitors() -> Vec<MonitorInfo> {
        vec![
            info("DISPLAY1", 0, 0, 1920, 1080, true),
            info("DISPLAY2", -2560, -200, 2560, 1440, false),
        ]
    }

    #[test]
    fn normalizes_empty_values_to_primary_and_preserves_concrete_ids() {
        assert_eq!(normalize_selection(None), PRIMARY_SELECTION);
        assert_eq!(normalize_selection(Some("")), PRIMARY_SELECTION);
        assert_eq!(normalize_selection(Some("   ")), PRIMARY_SELECTION);
        assert_eq!(normalize_selection(Some(" primary ")), PRIMARY_SELECTION);
        assert_eq!(normalize_selection(Some(" DISPLAY2 ")), "DISPLAY2");
    }

    #[test]
    fn fallback_id_uses_physical_geometry() {
        assert_eq!(
            fallback_monitor_id(
                &MonitorPoint { x: -1920, y: 0 },
                &MonitorSize {
                    width: 1920,
                    height: 1080
                },
            ),
            "display:-1920:0:1920:1080"
        );
    }

    #[test]
    fn resolves_dynamic_primary_and_available_concrete_monitor() {
        let list = monitors();
        assert_eq!(
            resolve_selection(&list, "DISPLAY1", PRIMARY_SELECTION).unwrap(),
            MonitorSelectionState {
                selected: PRIMARY_SELECTION.to_string(),
                resolved: "DISPLAY1".to_string(),
                fallback: false,
            }
        );
        assert_eq!(
            resolve_selection(&list, "DISPLAY1", "DISPLAY2").unwrap(),
            MonitorSelectionState {
                selected: "DISPLAY2".to_string(),
                resolved: "DISPLAY2".to_string(),
                fallback: false,
            }
        );
    }

    #[test]
    fn missing_saved_monitor_temporarily_falls_back_without_losing_selection() {
        assert_eq!(
            resolve_selection(&monitors(), "DISPLAY1", "DISPLAY9").unwrap(),
            MonitorSelectionState {
                selected: "DISPLAY9".to_string(),
                resolved: "DISPLAY1".to_string(),
                fallback: true,
            }
        );
    }

    #[test]
    fn interactive_selection_rejects_unknown_monitor() {
        assert!(validate_selection(PRIMARY_SELECTION, &monitors()).is_ok());
        assert!(validate_selection("DISPLAY2", &monitors()).is_ok());
        assert_eq!(
            validate_selection("DISPLAY9", &monitors()).unwrap_err(),
            "显示器当前不可用：DISPLAY9"
        );
    }

    #[test]
    fn converts_logical_width_using_target_scale_factor() {
        assert_eq!(physical_window_width(720.0, 1.0), 720);
        assert_eq!(physical_window_width(720.0, 1.25), 900);
        assert_eq!(physical_window_width(720.0, 1.5), 1080);
    }

    #[test]
    fn centers_on_positive_and_negative_monitor_coordinates() {
        assert_eq!(
            top_center_position(
                &info("MAIN", 0, 0, 1920, 1080, true),
                720,
                TOP_GAP_PHYSICAL,
                0,
                0
            ),
            MonitorPoint { x: 600, y: 16 }
        );
        assert_eq!(
            top_center_position(
                &info("LEFT", -2560, -200, 2560, 1440, false),
                1080,
                TOP_GAP_PHYSICAL,
                0,
                0,
            ),
            MonitorPoint { x: -1820, y: -184 }
        );
    }

    #[test]
    fn applies_offsets_on_top_of_top_center_baseline() {
        // 基准 (600, 16)，offset (50, -8) → (650, 8)
        assert_eq!(
            top_center_position(
                &info("MAIN", 0, 0, 1920, 1080, true),
                720,
                TOP_GAP_PHYSICAL,
                50,
                -8
            ),
            MonitorPoint { x: 650, y: 8 }
        );
    }

    #[test]
    fn classisland_gap_zero_docks_window_flush_to_screen_top() {
        // 贴顶模式 gap=0：窗口顶边对齐 monitor 顶部（y=0），横向仍居中。
        assert_eq!(
            top_center_position(&info("MAIN", 0, 0, 1920, 1080, true), 720, 0, 0, 0),
            MonitorPoint { x: 600, y: 0 }
        );
        // 负坐标副屏也贴该屏顶。
        assert_eq!(
            top_center_position(&info("LEFT", -2560, -200, 2560, 1440, false), 1080, 0, 0, 0),
            MonitorPoint { x: -1820, y: -200 }
        );
    }

    #[test]
    fn top_gap_for_mode_maps_only_classisland_to_zero() {
        assert_eq!(top_gap_for_mode(Some("classisland")), 0);
        assert_eq!(top_gap_for_mode(Some("island")), TOP_GAP_PHYSICAL);
        assert_eq!(top_gap_for_mode(None), TOP_GAP_PHYSICAL);
        assert_eq!(top_gap_for_mode(Some("garbage")), TOP_GAP_PHYSICAL);
        assert_eq!(top_gap_for_mode(Some("")), TOP_GAP_PHYSICAL);
    }

    #[test]
    fn appearance_keys_are_namespaced_per_ui_mode() {
        assert_eq!(
            mode_key(OFFSET_X_KEY, "classisland"),
            "window:offset_x:classisland"
        );
        assert_eq!(mode_key(OPACITY_KEY, "island"), "window:opacity:island");
        assert_eq!(mode_key(WIDTH_KEY, "taskbar"), "window:width:taskbar");
        assert_eq!(mode_key(OFFSET_X_KEY, "taskbar"), "window:offset_x:taskbar");
        // 归一化：缺键/空/非法一律 island，合法值原样通过。
        assert_eq!(normalize_ui_mode(None), "island");
        assert_eq!(normalize_ui_mode(Some("")), "island");
        assert_eq!(normalize_ui_mode(Some("garbage")), "island");
        assert_eq!(normalize_ui_mode(Some("classisland")), "classisland");
        assert_eq!(normalize_ui_mode(Some("taskbar")), "taskbar");
        assert_eq!(normalize_ui_mode(Some("corner")), "island");
        // 三种模式的键互不相同（「共享同一份偏移」的回归护栏）。
        let keys: std::collections::BTreeSet<String> = UI_MODES
            .iter()
            .map(|mode| mode_key(OFFSET_X_KEY, mode))
            .collect();
        assert_eq!(keys.len(), UI_MODES.len());
        // 后缀键必须仍以裸键开头：config_import 按 `window:offset_` 前缀判定是否需重新上屏。
        for mode in UI_MODES {
            assert!(mode_key(OFFSET_X_KEY, mode).starts_with(OFFSET_X_KEY));
            assert!(mode_key(OFFSET_Y_KEY, mode).starts_with(OFFSET_Y_KEY));
            // 可迁移设置白名单按 `window:` 前缀放行。
            assert!(mode_key(OPACITY_KEY, mode).starts_with("window:"));
        }
    }

    #[test]
    fn persisted_taskbar_mode_and_legacy_fallback_preserve_appearance_keys() {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .unwrap();
        let db = Db(std::sync::Mutex::new(connection));
        db.setting_set(UI_MODE_KEY, "taskbar").unwrap();
        db.setting_set(&mode_key(WIDTH_KEY, "taskbar"), "560")
            .unwrap();
        db.setting_set(&mode_key(OPACITY_KEY, "classisland"), "0.4")
            .unwrap();

        assert_eq!(current_ui_mode(&db), "taskbar");
        assert_eq!(db.setting_get(UI_MODE_KEY).as_deref(), Some("taskbar"));
        assert_eq!(
            db.setting_get(&mode_key(WIDTH_KEY, "taskbar")).as_deref(),
            Some("560")
        );

        db.setting_set(UI_MODE_KEY, "corner").unwrap();
        assert_eq!(current_ui_mode(&db), "island");
        assert_eq!(
            db.setting_get(&mode_key(WIDTH_KEY, "taskbar")).as_deref(),
            Some("560")
        );
        assert_eq!(
            db.setting_get(&mode_key(OPACITY_KEY, "classisland"))
                .as_deref(),
            Some("0.4")
        );
    }

    #[test]
    fn width_key_is_namespaced_per_ui_mode() {
        // 模块 14：岛长度与 offset/opacity 同套按模式命名。
        assert_eq!(mode_key(WIDTH_KEY, "island"), "window:width:island");
        assert_eq!(
            mode_key(WIDTH_KEY, "classisland"),
            "window:width:classisland"
        );
        // 两种模式的宽度键互不相同（「共享同一份长度」的回归护栏）。
        assert_ne!(
            mode_key(WIDTH_KEY, "island"),
            mode_key(WIDTH_KEY, "classisland")
        );
        // 命中 `window:` 前缀白名单，随配置导入导出迁移。
        assert!(mode_key(WIDTH_KEY, "island").starts_with("window:"));
    }

    #[test]
    fn clamp_offsets_uses_actual_window_width_for_horizontal_bounds() {
        let monitor = info("MAIN", 0, 0, 1920, 1080, true);
        // 自定义长度（模块 14）后 clamp 按实际窗口物理宽计算横向边界：
        // 宽 1000 时 base_x=(1920-1000)/2=460，右极限 460+offset_x+1000 ≤ 1919 → offset_x ≤ 459。
        assert_eq!(
            clamp_offsets(&monitor, 1000, 400, TOP_GAP_PHYSICAL, 9999, 9999),
            (459, 664)
        );
        // 窄条 420：base_x=(1920-420)/2=750，右极限 offset_x ≤ 1919-750-420 = 749。
        assert_eq!(
            clamp_offsets(&monitor, 420, 400, TOP_GAP_PHYSICAL, 9999, 9999),
            (749, 664)
        );
        // 区间内原值保留。
        assert_eq!(
            clamp_offsets(&monitor, 1000, 400, TOP_GAP_PHYSICAL, 50, -8),
            (50, -8)
        );
    }

    #[test]
    fn clamp_offsets_keeps_window_on_screen() {
        let monitor = info("MAIN", 0, 0, 1920, 1080, true);
        // 基准 x = (1920-720)/2 = 600, base_y = 16。窗口宽 720、保守高 400。
        // 横向：左极限 base_x 要 ≥ 1（屏左 1px）→ offset_x ≥ 1-600 = -599；
        //       右极限 窗口右端 ≤ 屏右-1 → 600+offset_x+720 ≤ 1919 → offset_x ≤ 599。
        // 纵向：顶部 ≥ 0 → offset_y ≥ -16；底部 ≤ 1080-400=680 → 16+offset_y ≤ 680 → offset_y ≤ 664。
        // 超界偏移被拉回边界。
        assert_eq!(
            clamp_offsets(&monitor, 720, 400, TOP_GAP_PHYSICAL, 9999, 9999),
            (599, 664)
        );
        assert_eq!(
            clamp_offsets(&monitor, 720, 400, TOP_GAP_PHYSICAL, -9999, -9999),
            (-599, -16)
        );
        // 区间内原值保留。
        assert_eq!(
            clamp_offsets(&monitor, 720, 400, TOP_GAP_PHYSICAL, 50, -8),
            (50, -8)
        );
        // 0,0 仍是 0,0。
        assert_eq!(
            clamp_offsets(&monitor, 720, 400, TOP_GAP_PHYSICAL, 0, 0),
            (0, 0)
        );
        // 150% DPI：展开态物理高度 600px，纵向下移上限随之收紧到 464。
        assert_eq!(
            clamp_offsets(&monitor, 1080, 600, TOP_GAP_PHYSICAL, 0, 9999),
            (0, 464)
        );
    }

    #[test]
    fn clamp_offsets_with_zero_gap_keeps_flush_top_reachable() {
        let monitor = info("MAIN", 0, 0, 1920, 1080, true);
        // 贴顶模式 base_y=0：向上偏移下限为 0（不能越过屏顶），负 offset_y 被拉回 0；
        // 横向极负 offset_x 仍拉回左极限 -599。
        assert_eq!(
            clamp_offsets(&monitor, 720, 400, 0, -9999, -9999),
            (-599, 0)
        );
        // 默认 0/0 仍贴顶。
        assert_eq!(clamp_offsets(&monitor, 720, 400, 0, 0, 0), (0, 0));
        // 向下偏移上限随 base_y=0 放宽到 屏高-窗口高 = 680。
        assert_eq!(clamp_offsets(&monitor, 720, 400, 0, 0, 9999), (0, 680));
    }

    #[test]
    fn runtime_watch_disconnects_then_returns_to_saved_monitor() {
        assert_eq!(
            runtime_watch_action(false, false),
            RuntimeWatchAction::RecoverPrimary
        );
        assert_eq!(
            runtime_watch_action(true, true),
            RuntimeWatchAction::RestoreSaved
        );
        assert_eq!(runtime_watch_action(false, true), RuntimeWatchAction::None);
    }

    #[test]
    fn automatic_recovery_never_requests_focus() {
        assert_eq!(
            RECOVERY_OPERATIONS,
            &[
                RecoveryOperation::ResizePolicyGeometry,
                RecoveryOperation::Unminimize,
                RecoveryOperation::Move,
                RecoveryOperation::ReapplyPolicy,
            ]
        );
    }

    #[test]
    fn monitor_dtos_serialize_with_frontend_camel_case_fields() {
        let monitor = info("DISPLAY1", 0, 0, 1920, 1080, true);
        let value = serde_json::to_value(monitor).unwrap();
        assert_eq!(value["id"], "DISPLAY1");
        assert_eq!(value["isPrimary"], true);
        assert_eq!(value["position"]["x"], 0);
        assert_eq!(value["size"]["width"], 1920);

        let state = serde_json::to_value(MonitorSelectionState {
            selected: "primary".to_string(),
            resolved: "DISPLAY1".to_string(),
            fallback: false,
        })
        .unwrap();
        assert_eq!(state["selected"], "primary");
        assert_eq!(state["resolved"], "DISPLAY1");
        assert_eq!(state["fallback"], false);
    }
}
