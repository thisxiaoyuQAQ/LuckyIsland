# LuckyIsland Multi-Monitor Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent monitor selector that immediately moves the LuckyIsland window to the chosen display's top center, restores that choice after restart, and temporarily falls back to the current primary display when a saved display is unavailable.

**Architecture:** A new Rust `monitor` module is the single authority for monitor enumeration, stable IDs, selection resolution, physical positioning, SQLite persistence, and Tauri commands. `lib.rs` only wires commands and startup restoration; the settings frontend consumes typed invoke wrappers and renders the selector in `GeneralPanel`.

**Tech Stack:** Rust 2021, Tauri 2.11, serde, rusqlite-backed existing `Db`, React 19, TypeScript 5.8, existing shadcn/Tailwind settings UI.

## Global Constraints

- Scope is only module 02 multi-monitor selection and position persistence; do not modify module 07 animation/performance work.
- Do not change AI, voice, ASR, KWS, VAD, terminal, notification, weather, or stock behavior.
- Persist the selection under SQLite setting key `window:monitor`.
- The special value `primary` is dynamic: resolve the current Windows primary monitor each time the app starts or the option is selected.
- Selecting a monitor moves the `island` window immediately and persists only after the move succeeds.
- If the database write fails after moving, restore the previous physical window position and return an error.
- A saved concrete monitor that is offline temporarily resolves to the primary monitor without overwriting the saved selection.
- Do not implement runtime display hot-plug or primary-monitor change listeners; F1.4 remains P1.
- The island remains top-centered with a physical top gap of 16 px.
- Use target-monitor DPI to convert the 720 logical-pixel island width into physical pixels before centering.
- Do not run Cargo commands while the user's `pnpm tauri dev` owns `src-tauri/target`; ask the user to stop it first or use the existing hot-recompile output. Cargo executable: `/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe`.
- Match the repository's Chinese comments/copy and existing naming style.

---

## File Structure

- Create `src-tauri/src/monitor.rs` — monitor DTOs, pure selection/coordinate logic, runtime monitor capture, window movement, persistence commands, startup restoration, and Rust unit tests.
- Modify `src-tauri/src/lib.rs` — declare the module, import/register monitor commands, reuse the monitor width constant, and call startup restoration.
- Modify `src/lib/settings.ts` — add the `window:monitor` key, monitor DTOs, and typed Tauri invoke wrappers.
- Modify `src/settings/GeneralPanel.tsx` — load monitor state, render the display selector, apply changes, and show fallback/errors.
- Modify `vault/02-灵动岛外壳.md` — record actual interfaces, implementation output, non-goal, and pending true-machine acceptance.
- Modify `docs/开发进度.md` — record implementation/automation status while leaving module 02 in progress until multi-display acceptance is complete.

---

### Task 1: Build and test the pure monitor domain model

**Files:**
- Create: `src-tauri/src/monitor.rs`
- Modify: `src-tauri/src/lib.rs:1-8`
- Test: inline `#[cfg(test)]` module in `src-tauri/src/monitor.rs`

**Interfaces:**
- Consumes: `tauri::PhysicalPosition<i32>` and `tauri::PhysicalSize<u32>` value semantics only.
- Produces:
  - `pub const ISLAND_WIDTH_LOGICAL: f64 = 720.0`
  - `pub const TOP_GAP_PHYSICAL: i32 = 16`
  - `pub struct MonitorInfo`
  - `pub struct MonitorSelectionState`
  - Pure helpers used by the runtime code in Task 2: `normalize_selection`, `fallback_monitor_id`, `resolve_selection`, `validate_selection`, `physical_window_width`, and `top_center_position`.

- [ ] **Step 1: Declare the module and write failing pure-logic tests**

Add this declaration near the other modules in `src-tauri/src/lib.rs`:

```rust
mod monitor;
```

Create `src-tauri/src/monitor.rs` with the DTO declarations and tests below, leaving the helper bodies as `unimplemented!()` so the first run proves the tests reach the new module:

```rust
use serde::Serialize;

pub const MONITOR_SETTING_KEY: &str = "window:monitor";
pub const PRIMARY_SELECTION: &str = "primary";
pub const ISLAND_WIDTH_LOGICAL: f64 = 720.0;
pub const TOP_GAP_PHYSICAL: i32 = 16;

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
    unimplemented!()
}

fn fallback_monitor_id(position: &MonitorPoint, size: &MonitorSize) -> String {
    unimplemented!()
}

fn resolve_selection(
    monitors: &[MonitorInfo],
    primary_id: &str,
    selected: &str,
) -> Result<MonitorSelectionState, String> {
    unimplemented!()
}

fn validate_selection(selection: &str, monitors: &[MonitorInfo]) -> Result<(), String> {
    unimplemented!()
}

fn physical_window_width(logical_width: f64, scale_factor: f64) -> u32 {
    unimplemented!()
}

fn top_center_position(monitor: &MonitorInfo, window_width: u32) -> MonitorPoint {
    unimplemented!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(
        id: &str,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        is_primary: bool,
    ) -> MonitorInfo {
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
                &MonitorSize { width: 1920, height: 1080 },
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
            top_center_position(
                &info("LEFT", -2560, -200, 2560, 1440, false),
                1080,
            ),
            MonitorPoint { x: -1820, y: -184 }
        );
    }
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

First ensure `pnpm tauri dev` is stopped. Then run:

```bash
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test \
  --manifest-path src-tauri/Cargo.toml monitor::tests:: -- --nocapture
```

Expected: FAIL because the new helper functions reach `unimplemented!()`.

- [ ] **Step 3: Implement the pure helpers minimally**

Replace the six `unimplemented!()` bodies with:

```rust
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
```

- [ ] **Step 4: Run the focused test and verify it passes**

```bash
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test \
  --manifest-path src-tauri/Cargo.toml monitor::tests:: -- --nocapture
```

Expected: `7 passed; 0 failed` for `monitor::tests`.

- [ ] **Step 5: Commit the tested domain model**

```bash
git add src-tauri/src/monitor.rs src-tauri/src/lib.rs
git commit -m "feat(M1): 添加多屏选择领域逻辑" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add Tauri monitor commands and startup restoration

**Files:**
- Modify: `src-tauri/src/monitor.rs`
- Modify: `src-tauri/src/lib.rs:9-60,163-221,264-313`
- Test: inline `monitor::tests` plus Rust compile validation

**Interfaces:**
- Consumes: Task 1 DTOs and pure helpers; existing `Db::setting_get`, `Db::setting_set`; Tauri `AppHandle::{available_monitors,primary_monitor}`, `WebviewWindow::{outer_position,set_position}`.
- Produces:
  - `#[tauri::command] pub fn monitor_list(app: AppHandle) -> Result<Vec<MonitorInfo>, String>`
  - `#[tauri::command] pub fn monitor_get_selection(app: AppHandle, db: State<Db>) -> Result<MonitorSelectionState, String>`
  - `#[tauri::command] pub fn monitor_select(app: AppHandle, db: State<Db>, selection: String) -> Result<MonitorSelectionState, String>`
  - `pub fn restore_island_monitor(app: &AppHandle, db: &Db) -> Result<MonitorSelectionState, String>`

- [ ] **Step 1: Add a failing serialization contract test**

Append this test inside `monitor::tests` before writing the runtime functions:

```rust
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
```

Temporarily remove `#[serde(rename_all = "camelCase")]` from `MonitorInfo` and run the test to prove the contract test detects `is_primary`.

- [ ] **Step 2: Run the serialization test and verify it fails**

```bash
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test \
  --manifest-path src-tauri/Cargo.toml \
  monitor::tests::monitor_dtos_serialize_with_frontend_camel_case_fields -- --nocapture
```

Expected: FAIL because `value["isPrimary"]` is null while the serialized field is `is_primary`.

- [ ] **Step 3: Restore camelCase serialization and add the runtime implementation**

Restore `#[serde(rename_all = "camelCase")]` on both public DTOs. Add these imports and runtime helpers above the tests in `src-tauri/src/monitor.rs`:

```rust
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, State};

use crate::storage::Db;

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

fn move_island_to_monitor(
    app: &AppHandle,
    monitor: &RuntimeMonitor,
) -> Result<(), String> {
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

pub fn restore_island_monitor(
    app: &AppHandle,
    db: &Db,
) -> Result<MonitorSelectionState, String> {
    let set = capture_monitors(app)?;
    let state = selection_state(&set, &current_selection(db))?;
    let target = resolved_monitor(&set, &state)?;
    move_island_to_monitor(app, target)?;
    Ok(state)
}
```

- [ ] **Step 4: Wire commands and startup restoration in `lib.rs`**

Change the Tauri imports at `src-tauri/src/lib.rs:9-13` so `PhysicalPosition` is removed:

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalSize, Manager, Size, WindowEvent,
};
```

Add the monitor imports after the AI imports:

```rust
use monitor::{
    monitor_get_selection, monitor_list, monitor_select, restore_island_monitor,
    ISLAND_WIDTH_LOGICAL,
};
```

Delete the old constant and old current-monitor-based function:

```rust
const WIN_W: f64 = 720.0;

fn position_top_center(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    // delete the entire old function
}
```

Update both width assignments in `apply_state`:

```rust
width: ISLAND_WIDTH_LOGICAL,
```

Register the commands immediately after `set_island_state` in `tauri::generate_handler!`:

```rust
set_island_state,
monitor_list,
monitor_get_selection,
monitor_select,
```

Replace the startup positioning block at `src-tauri/src/lib.rs:309-313` with:

```rust
// 恢复所选显示器位置，再按设置面板的启动默认态显示。
// 已保存的具体显示器缺失时只临时回退主屏，不覆盖用户选择。
if let Err(error) = restore_island_monitor(app.handle(), app.state::<storage::Db>().inner()) {
    eprintln!("[monitor] 启动恢复显示器失败：{error}");
}
if let Some(window) = app.get_webview_window("island") {
    let _ = apply_state(&window, &default_state);
}
```

- [ ] **Step 5: Run Rust verification**

With `pnpm tauri dev` stopped:

```bash
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test \
  --manifest-path src-tauri/Cargo.toml monitor::tests:: -- --nocapture
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe check \
  --manifest-path src-tauri/Cargo.toml
```

Expected:

- `monitor::tests`: `8 passed; 0 failed`.
- `cargo check`: exit code 0 with no Rust errors.

If the user keeps `pnpm tauri dev` running, do not start a second Cargo process. Save the files and use the existing Tauri dev terminal's successful hot-recompile as the compile check; run the focused unit test only after the user stops dev.

- [ ] **Step 6: Commit the native monitor lifecycle**

```bash
git add src-tauri/src/monitor.rs src-tauri/src/lib.rs
git commit -m "feat(M1): 接入多屏定位与启动恢复" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add typed frontend APIs and the General settings selector

**Files:**
- Modify: `src/lib/settings.ts:3-37,162-176`
- Modify: `src/settings/GeneralPanel.tsx:1-120`
- Test: TypeScript compiler contract via `npx tsc --noEmit`

**Interfaces:**
- Consumes: Task 2 commands and camelCase DTO fields.
- Produces:
  - `KEYS.windowMonitor`
  - `MonitorInfo`, `MonitorSelectionState`
  - `monitorList()`, `monitorGetSelection()`, `monitorSelect(selection)`
  - A GeneralPanel selector with immediate apply, disabled pending state, error display, and offline fallback option.

- [ ] **Step 1: Add the frontend consumer first so TypeScript exposes the missing API**

Update the import in `src/settings/GeneralPanel.tsx` to request the not-yet-defined monitor API:

```tsx
import {
  KEYS,
  parseBool,
  settingGet,
  settingSetEmit,
  autostartGet,
  autostartSet,
  monitorGetSelection,
  monitorList,
  monitorSelect,
  type MonitorInfo,
  type MonitorSelectionState,
} from "@/lib/settings";
```

Run:

```bash
npx tsc --noEmit
```

Expected: FAIL with missing exports for the monitor functions/types. This is the compile-time contract failure for the frontend boundary.

- [ ] **Step 2: Define the typed invoke API in `src/lib/settings.ts`**

Add the key inside `KEYS`:

```ts
windowMonitor: "window:monitor",
```

Add these DTOs and wrappers after `DEFAULTS`:

```ts
export interface MonitorPoint {
  x: number;
  y: number;
}

export interface MonitorSize {
  width: number;
  height: number;
}

export interface MonitorInfo {
  id: string;
  label: string;
  isPrimary: boolean;
  position: MonitorPoint;
  size: MonitorSize;
}

export interface MonitorSelectionState {
  selected: string;
  resolved: string;
  fallback: boolean;
}

export async function monitorList(): Promise<MonitorInfo[]> {
  return invoke<MonitorInfo[]>("monitor_list");
}

export async function monitorGetSelection(): Promise<MonitorSelectionState> {
  return invoke<MonitorSelectionState>("monitor_get_selection");
}

export async function monitorSelect(selection: string): Promise<MonitorSelectionState> {
  return invoke<MonitorSelectionState>("monitor_select", { selection });
}
```

Do not use generic `settingSetEmit` for this field: movement and persistence must stay atomic behind `monitor_select`.

- [ ] **Step 3: Add monitor state and initialization to `GeneralPanel`**

Add these states after the existing theme state:

```tsx
const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
const [monitorState, setMonitorState] = useState<MonitorSelectionState>({
  selected: "primary",
  resolved: "",
  fallback: false,
});
const [monitorSwitching, setMonitorSwitching] = useState(false);
const [monitorError, setMonitorError] = useState<string | null>(null);
```

Replace the current initialization effect with:

```tsx
useEffect(() => {
  let disposed = false;
  void (async () => {
    const monitorLoad = Promise.all([monitorList(), monitorGetSelection()])
      .then(([list, state]) => {
        if (disposed) return;
        setMonitors(list);
        setMonitorState(state);
      })
      .catch((error) => {
        if (!disposed) {
          setMonitorError(error instanceof Error ? error.message : String(error));
        }
      });

    const [auto, ds, t, th] = await Promise.all([
      autostartGet().catch(() => false),
      settingGet(KEYS.defaultState),
      settingGet(KEYS.toast),
      settingGet(KEYS.theme),
    ]);
    if (disposed) return;
    setAutostart(auto);
    if (ds === "compact" || ds === "expanded" || ds === "hidden") setDefaultState(ds);
    setToast(parseBool(t, true));
    if (th === "light" || th === "dark" || th === "auto") setTheme(th);
    await monitorLoad;
    if (!disposed) setLoading(false);
  })().catch((error) => {
    if (!disposed) {
      console.error("加载总体设置失败", error);
      setLoading(false);
    }
  });
  return () => {
    disposed = true;
  };
}, []);
```

Add the selection handler before the loading guard:

```tsx
const changeMonitor = async (selection: string) => {
  if (monitorSwitching || selection === monitorState.selected) return;
  setMonitorSwitching(true);
  setMonitorError(null);
  try {
    const state = await monitorSelect(selection);
    setMonitorState(state);
    setMonitors(await monitorList());
  } catch (error) {
    setMonitorError(error instanceof Error ? error.message : String(error));
  } finally {
    setMonitorSwitching(false);
  }
};

const primaryMonitor = monitors.find((monitor) => monitor.isPrimary);
const selectedMonitorAvailable = monitors.some(
  (monitor) => monitor.id === monitorState.selected,
);
```

- [ ] **Step 4: Render the monitor selector and fallback/error messages**

Insert this row immediately after the “启动默认态” row:

```tsx
<Row label="显示器" desc="选择灵动岛显示的屏幕；修改后立即移动并在重启后恢复">
  <div className="flex min-w-56 flex-col items-end gap-1">
    <select
      className={selectCls + " w-56"}
      value={monitorState.selected}
      disabled={monitorSwitching || monitors.length === 0}
      onChange={(event) => void changeMonitor(event.target.value)}
    >
      <option value="primary">
        主显示器{primaryMonitor ? `（当前：${primaryMonitor.label}）` : ""}
      </option>
      {monitors.map((monitor) => (
        <option key={monitor.id} value={monitor.id}>
          {monitor.label}{monitor.isPrimary ? "（当前主屏）" : ""}
        </option>
      ))}
      {monitorState.fallback &&
        monitorState.selected !== "primary" &&
        !selectedMonitorAvailable && (
          <option value={monitorState.selected}>
            {monitorState.selected}（当前不可用，暂用主显示器）
          </option>
        )}
    </select>
    {monitorState.fallback && (
      <p className="text-right text-xs text-amber-600 dark:text-amber-400">
        已保存的显示器当前不可用，本次暂时显示在主显示器；重新连接后重启即可恢复。
      </p>
    )}
    {monitorError && (
      <p className="text-right text-xs text-destructive">
        显示器设置失败：{monitorError}
      </p>
    )}
  </div>
</Row>
```

Keep all existing autostart/default-state/toast/theme behavior unchanged.

- [ ] **Step 5: Run the TypeScript compiler**

```bash
npx tsc --noEmit
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 6: Commit the settings UI**

```bash
git add src/lib/settings.ts src/settings/GeneralPanel.tsx
git commit -m "feat(M1): 增加显示器选择设置" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Run integrated checks and prepare true-machine acceptance

**Files:**
- Modify: `vault/02-灵动岛外壳.md`
- Modify: `docs/开发进度.md`
- Verify: all changed Rust/TypeScript files through the real Tauri dev app

**Interfaces:**
- Consumes: completed backend and frontend implementation.
- Produces: implementation record, verification evidence, and a concise user acceptance script. Module 02 remains `🚧` until the user completes the multi-display scenarios.

- [ ] **Step 1: Run formatting and static checks**

If `pnpm tauri dev` is stopped:

```bash
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe fmt \
  --manifest-path src-tauri/Cargo.toml -- --check
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test \
  --manifest-path src-tauri/Cargo.toml monitor::tests:: -- --nocapture
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe check \
  --manifest-path src-tauri/Cargo.toml
npx tsc --noEmit
git diff --check
```

Expected:

- Rust format check exits 0.
- `monitor::tests`: 8 passed, 0 failed.
- Cargo check exits 0.
- TypeScript check exits 0.
- `git diff --check` has no whitespace errors; LF→CRLF warnings are acceptable.

If `pnpm tauri dev` is active, do not run the Cargo commands concurrently. Use the existing dev process's hot-recompile result, run `npx tsc --noEmit` and `git diff --check`, then run focused Rust tests/check after the user stops dev.

- [ ] **Step 2: Drive the running app's basic surface before asking for full dual-screen acceptance**

With the user running `pnpm tauri dev`:

1. Open Settings → General and confirm the “显示器” selector renders.
2. Select “主显示器” and confirm the island moves to the top center without an error.
3. Toggle compact → expanded → hidden → visible using the normal UI/Alt+X and confirm it remains visible and centered.
4. Close and reopen Settings and confirm the selected value is still shown.
5. Restart LuckyIsland and confirm the selector and island restore to the same selection.

Capture the user's observed result. GUI behavior cannot be claimed from code inspection.

- [ ] **Step 3: Update the module vault with implementation state**

Append these sections to `vault/02-灵动岛外壳.md`:

```markdown
## 多屏选择与持久化增量（2026-07-11）

### 新增接口
- `monitor_list() -> MonitorInfo[]`
- `monitor_get_selection() -> MonitorSelectionState`
- `monitor_select(selection) -> MonitorSelectionState`
- SQLite key：`window:monitor`，值为 `primary` 或具体显示器 ID。

### 已实现
- Rust `monitor` 模块统一处理显示器枚举、动态主屏、具体屏选择、目标 DPI 物理居中、立即移动和启动恢复。
- 设置页总体开关增加显示器选择，调用期间禁用，失败时保留旧选择并显示错误。
- 具体显示器缺失时临时回退主屏但保留选择；运行时热插拔自动迁移仍为 F1.4/P1。

### 验证状态
- 自动化：显示器选择解析、缺失回退、未知选择拒绝、回退 ID、DPI 宽度和正/负坐标居中测试已覆盖。
- 待真机：副屏即时移动、重启恢复、断开副屏回退、重新连接恢复、动态主屏语义和三态/热键回归。
```

- [ ] **Step 4: Update development progress without prematurely closing module 02**

Change module 02's row in `docs/开发进度.md` from:

```markdown
| 02 | 灵动岛外壳 | 🚧 | 01 | 块1✅ 块2✅(三态/主题跟随)；块3 多屏/配置持久化 |
```

to:

```markdown
| 02 | 灵动岛外壳 | 🚧 | 01 | 块1✅ 块2✅；块3 多屏选择/立即移动/启动恢复/缺失回退已实现并通过自动化，待双屏真机验收；运行时热插拔跟随保留 P1 |
```

Add a dated progress section:

```markdown
### 2026-07-11 多屏选择与位置持久化
- 新增 Rust monitor 模块与 `monitor_list` / `monitor_get_selection` / `monitor_select` 命令，`window:monitor` 保存动态主屏或具体显示器 ID。
- 设置页选择后立即移动；启动恢复所选屏；具体屏缺失时临时回退主屏并保留原选择。
- 自动化覆盖解析、回退、未知 ID、无名称 ID、DPI 宽度和正/负坐标居中；完整双屏真机验收待用户执行。
- 明确不包含 F1.4 运行时热插拔自动迁移，也未处理模块 07 动画/性能。
```

- [ ] **Step 5: Review the exact diff and commit documentation**

```bash
git diff --check
git diff --stat
git diff -- vault/02-灵动岛外壳.md docs/开发进度.md
git add vault/02-灵动岛外壳.md docs/开发进度.md
git commit -m "docs(M1): 记录多屏实现与验收状态" \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git status --short --branch
```

Expected: documentation commit succeeds and the working tree is clean.

- [ ] **Step 6: Hand the user the full dual-screen acceptance checklist**

Ask the user to verify in this order:

```text
1. 设置页是否列出“主显示器”和所有启用中的具体显示器。
2. 选择副屏后，灵动岛是否立即移动到副屏顶部中央。
3. 紧凑、展开、隐藏再显示后是否仍在副屏。
4. 重启后是否恢复到副屏。
5. 断开副屏并重启后，灵动岛是否在主屏可见，设置页是否保留原副屏并提示临时回退。
6. 重新连接副屏并重启后，是否恢复到原副屏。
7. 选择“主显示器”，更改 Windows 主显示器并重启后，是否跟随新主屏。
8. Alt+X、托盘显示/隐藏、主题和三态是否无回归。
```

Only after all eight pass:

- change module 02 to `✅` in `docs/开发进度.md`;
- add the true-machine evidence to `vault/02-灵动岛外壳.md`;
- commit the acceptance docs separately as `docs(M1): 完成多屏真机验收`.

---

## Plan Self-Review

- Spec coverage: enumeration, dynamic primary, concrete display persistence, immediate movement, restart restoration, temporary fallback, original-selection retention, DPI-aware centering, failure rollback, frontend pending/error state, automation, and true-machine acceptance all map to explicit tasks.
- Scope: no module 07 work, no hot-plug listener, no AI/voice changes, and no AI palette position refactor.
- Placeholder scan: no TBD/TODO/“implement later” instructions; every implementation step includes exact code or exact replacement text.
- Type consistency: Rust `MonitorInfo` camelCase serialization matches TypeScript `isPrimary`; command names and `MonitorSelectionState` fields are identical across Tasks 2 and 3.
- Completion gate: implementation docs leave module 02 in progress until dual-screen runtime observation is supplied.
