use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, State};

use crate::storage::Db;

pub const MONITOR_SETTING_KEY: &str = "window:monitor";
pub const PRIMARY_SELECTION: &str = "primary";
pub const ISLAND_WIDTH_LOGICAL: f64 = 720.0;
pub const TOP_GAP_PHYSICAL: i32 = 16;
/// 运行时显示器变化轮询间隔。副屏断开后最多延迟此时间即临时跳回主屏。
const RUNTIME_WATCH_INTERVAL: Duration = Duration::from_secs(2);

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

fn top_center_position(monitor: &MonitorInfo, window_width: u32) -> MonitorPoint {
    MonitorPoint {
        x: monitor.position.x + (monitor.size.width as i32 - window_width as i32) / 2,
        y: monitor.position.y + TOP_GAP_PHYSICAL,
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

fn move_island_to_monitor(app: &AppHandle, monitor: &RuntimeMonitor) -> Result<(), String> {
    let window = app
        .get_webview_window("island")
        .ok_or_else(|| "找不到灵动岛窗口".to_string())?;
    let width = physical_window_width(ISLAND_WIDTH_LOGICAL, monitor.raw.scale_factor());
    let position = top_center_position(&monitor.info, width);
    window
        .set_position(PhysicalPosition::new(position.x, position.y))
        .map_err(|error| format!("移动灵动岛窗口失败：{error}"))
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

    move_island_to_monitor(&app, target)?;
    if let Err(error) = db.setting_set(MONITOR_SETTING_KEY, &selection) {
        let _ = window.set_position(previous_position);
        return Err(format!("保存显示器选择失败：{error}"));
    }
    Ok(state)
}

pub fn restore_island_monitor(app: &AppHandle, db: &Db) -> Result<MonitorSelectionState, String> {
    let set = capture_monitors(app)?;
    let state = selection_state(&set, &current_selection(db))?;
    let target = resolved_monitor(&set, &state)?;
    move_island_to_monitor(app, target)?;
    Ok(state)
}

/// 运行时显示器变化监听：周期性检查已保存的具体显示器是否还在线。
///
/// - 副屏断开：立即把灵动岛临时移到主屏（不改持久化选择），emit `monitor://changed`
///   携带 `fallback=true`，让设置页显示「当前不可用，暂用主显示器」。
/// - 副屏恢复：不自动把窗口跳回副屏（用户要求需重启或手动重选），但 emit
///   `fallback=false` 让设置页移除回退提示；同时复位 fell_back 标志，
///   以便再次断开时能重新触发回退。
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

            // 选中主显示器：无需运行时回退，复位标志即可。
            if saved == PRIMARY_SELECTION {
                fell_back = false;
                continue;
            }

            let still_available = set.monitors.iter().any(|m| m.info.id == saved);
            if still_available {
                // 副屏恢复：不自动跳回窗口，但复位标志并通知前端移除回退提示。
                if fell_back {
                    let _ = app.emit(
                        "monitor://changed",
                        MonitorSelectionState {
                            selected: saved.clone(),
                            resolved: saved,
                            fallback: false,
                        },
                    );
                }
                fell_back = false;
                continue;
            }

            // 副屏断开：每个断开周期只移动+通知一次，避免反复 set_position。
            if fell_back {
                continue;
            }
            let Some(primary) = set.monitors.iter().find(|m| m.info.id == set.primary_id) else {
                continue;
            };
            if move_island_to_monitor(&app, primary).is_ok() {
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
            top_center_position(&info("MAIN", 0, 0, 1920, 1080, true), 720),
            MonitorPoint { x: 600, y: 16 }
        );
        assert_eq!(
            top_center_position(&info("LEFT", -2560, -200, 2560, 1440, false), 1080,),
            MonitorPoint { x: -1820, y: -184 }
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
