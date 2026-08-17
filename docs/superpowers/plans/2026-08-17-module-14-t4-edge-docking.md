# Module 14 T4 Edge Docking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four-edge docking, robust Alt+left-drag persistence, vertical edge geometry/layout, and manual appearance controls while preserving the existing T1 width and T2 opacity behavior.

**Architecture:** Rust remains the source of truth for physical window geometry, monitor rectangles, docking edge parsing, edge selection, thresholding, clamping, offset conversion, persistence, and repositioning. TypeScript owns the `DockEdge` parser/store and a generation-safe drag controller that starts native dragging, observes movement stability, suppresses hover/click side effects, and invokes the Rust drop command. React consumes the store to express vertical layout semantics without rotating the DOM.

**Tech Stack:** Tauri 2, Rust 2021, serde, SQLite KV storage, React 19, TypeScript 5.8, Vitest 4, Tailwind CSS, existing `@tauri-apps/api` window/event APIs.

## Global Constraints

- Work directly on the existing dirty `main` tree; preserve all pre-existing T1/T2/T3 and user changes.
- Do not reset, stash, checkout, discard, overwrite unrelated changes, commit, push, tag, or publish.
- `window:dock_edge:<mode>` values are exactly `top|bottom|left|right`; missing, empty, or invalid values normalize to `top`.
- Alt+left drag uses Tauri native `startDragging`; ordinary clicks, hover, wheel, and page interaction remain unchanged.
- Snap threshold is exactly 48 physical pixels and uses the outer window rectangle against the target monitor physical rectangle.
- Corner selection is nearest edge; an exact tie retains the current edge; remaining ties use `top,bottom,left,right` order.
- Snapping saves the edge, clears current-mode x/y offsets, and repositions. Unsnap saves edge `top`, converts the current position to top-baseline offsets, clamps, persists, and does not jump to the top.
- Top/bottom are horizontal. Left/right are vertical. Capsule is `80x240`; compact is `80xlength`; expanded is `400xlength`, expanding inward.
- Island gap is 16 physical pixels; classisland gap is 0. Centering perpendicular to the edge has no extra gap.
- Manual edge switching clears offsets and repositions. Resetting current appearance restores edge `top`.
- Existing `window:` whitelist must continue to cover import/export. No dependencies, DB migrations, taskbar/T5, AI, voice, plugin, terminal, or unrelated refactors.
- Use independent Cargo target conventions with `SHERPA_ONNX_LIB_DIR` and `CARGO_HTTP_CHECK_REVOKE=false`; do not use a dev-owned `src-tauri/target`.

---

### Task 1: Add the shared DockEdge domain and pure geometry/drop logic

**Files:**
- Create: `src-tauri/src/dock_edge.rs`
- Modify: `src-tauri/src/monitor.rs:1-365, 386-575, 654-end`
- Modify: `src-tauri/src/window_policy.rs:34-43, 364-395, 850-908, tests`
- Test: Rust unit tests in `src-tauri/src/dock_edge.rs`, `monitor.rs`, and `window_policy.rs`

**Interfaces:**
- Produces Rust `DockEdge` with `Top`, `Bottom`, `Left`, `Right`, `parse`, `as_str`, `is_vertical`, and `mode_key(mode) -> String` behavior for later commands.
- Produces pure monitor helpers for edge baseline position, orientation-aware clamp, nearest-edge selection, and top-baseline offset conversion.
- `window_policy::geometry_for(state, width, edge)` returns logical `(width,height)` with horizontal and vertical dimensions described by the frozen contract.

- [ ] **Step 1: Write failing Rust tests** for parsing, mode key naming, horizontal/vertical geometry, four edge baseline positions on positive and negative monitor coordinates, gap 16/0, clamp with oversized dimensions, exact 48px boundary, corner nearest-edge selection, current-edge tie retention, stable-order fallback, snapped zero offsets, and unsnapped top-baseline conversion.

```rust
#[test]
fn dock_edge_parses_invalid_values_to_top() {
    assert_eq!(DockEdge::parse(None), DockEdge::Top);
    assert_eq!(DockEdge::parse(Some("garbage")), DockEdge::Top);
    assert_eq!(DockEdge::parse(Some(" left ")), DockEdge::Left);
}

#[test]
fn geometry_rotates_only_the_window_axes_for_vertical_edges() {
    assert_eq!(geometry_for(IslandState::Capsule, 720.0, DockEdge::Left), (80.0, 240.0));
    assert_eq!(geometry_for(IslandState::Compact, 720.0, DockEdge::Right), (80.0, 720.0));
    assert_eq!(geometry_for(IslandState::Expanded, 720.0, DockEdge::Left), (400.0, 720.0));
}

#[test]
fn snap_threshold_includes_48_and_excludes_49() {
    assert_eq!(select_dock_edge(rect(48, 100, 300, 200), monitor(), DockEdge::Top), DockEdge::Left);
    assert_eq!(select_dock_edge(rect(49, 100, 300, 200), monitor(), DockEdge::Top), None);
}
```

- [ ] **Step 2: Run the focused Rust tests and confirm the new symbols/tests fail**.

Run: `set CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.omc/cargo-t4-target && set SHERPA_ONNX_LIB_DIR=E:/Code/Tauri/LuckyIsland/src-tauri/target/sherpa-onnx-prebuilt/sherpa-onnx-v1.13.4-win-x64-shared-MT-Release-lib/lib && set CARGO_HTTP_CHECK_REVOKE=false && /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib dock_edge monitor window_policy`

Expected: FAIL because `DockEdge` and orientation-aware geometry/drop helpers are not yet defined.

- [ ] **Step 3: Implement `DockEdge` and pure helpers**.

```rust
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge { #[default] Top, Bottom, Left, Right }

impl DockEdge {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("bottom") => Self::Bottom,
            Some("left") => Self::Left,
            Some("right") => Self::Right,
            _ => Self::Top,
        }
    }
    pub const fn as_str(self) -> &'static str { match self { Self::Top => "top", Self::Bottom => "bottom", Self::Left => "left", Self::Right => "right" } }
    pub const fn is_vertical(self) -> bool { matches!(self, Self::Left | Self::Right) }
    pub fn mode_key(self, mode: &str) -> String { format!("window:dock_edge:{mode}") }
}
```

Implement `geometry_for(state, width, edge)` by returning `(80,width)` for vertical compact, `(400,width)` for vertical expanded, and `(80,240)` for vertical capsule; preserve existing horizontal results. Generalize baseline position to use outer physical width/height: top and bottom center horizontally with gap; left and right center vertically with gap. Generalize clamp using the actual `(window_width, window_height)` and a stable one-sided clamp when a window axis exceeds the monitor axis. Add pure `select_dock_edge` and `offsets_from_drop` helpers that use monitor/window rectangles, exact threshold 48, current-edge tie retention, then stable edge order.

- [ ] **Step 4: Thread the edge through every positioning path** (`monitor_select`, startup restore, runtime monitor recovery, offset apply, width changes, UI mode changes) and through window-policy resize/reapply. Read `window:dock_edge:<current mode>` with invalid values normalized to top. Ensure resize preserves the edge-side coordinate and centers the perpendicular axis: top/bottom preserve top/bottom boundary; left/right preserve left/right boundary. Ensure expanded grows inward: left fixes x, right fixes right edge, top fixes y, bottom fixes bottom edge.

- [ ] **Step 5: Run the focused Rust tests and format the touched Rust files**.

Run: `set CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.omc/cargo-t4-target && set SHERPA_ONNX_LIB_DIR=E:/Code/Tauri/LuckyIsland/src-tauri/target/sherpa-onnx-prebuilt/sherpa-onnx-v1.13.4-win-x64-shared-MT-Release-lib/lib && set CARGO_HTTP_CHECK_REVOKE=false && /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib dock_edge monitor window_policy`; ` /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe fmt --manifest-path src-tauri/Cargo.toml --all`

Expected: PASS; `cargo fmt --check` is clean for touched Rust files.

### Task 2: Add native T4 commands and frontend DockEdge/settings synchronization

**Files:**
- Modify: `src-tauri/src/lib.rs:42-45,184-200`
- Modify: `src-tauri/src/monitor.rs` command boundary near `window_offset_apply`/`window_ui_mode_set`
- Modify: `src/lib/settings.ts`
- Create: `src/lib/island-dock-edge.ts`
- Modify: `src/pages/useIslandSettings.ts`
- Test: `src/lib/__tests__/island-dock-edge.test.ts` and relevant settings hook tests

**Interfaces:**
- Rust commands: `window_dock_edge_set(mode: String, edge: String) -> Result<String,String>` and `window_drag_drop_settle() -> Result<...>` (or the exact command names selected by the existing implementation, consistently used by TypeScript).
- TypeScript: `type DockEdge = "top" | "bottom" | "left" | "right"`; `parseDockEdge(value)`, `dockEdgeKey(mode)`, `applyDockEdgeSetting(value)`, `getDockEdge()`, `useDockEdge()`; `windowDockEdgeSet(edge)`.

- [ ] **Step 1: Write failing frontend tests** for parser fallback, key naming/whitelist, store updates, settings event reload by current mode, and command wrapper payloads.

```ts
it("normalizes missing and invalid dock edges to top", () => {
  expect(parseDockEdge(null)).toBe("top");
  expect(parseDockEdge("diagonal")).toBe("top");
  expect(parseDockEdge("right")).toBe("right");
});

it("keeps dock edge keys independent per UI mode", () => {
  expect(dockEdgeKey("island")).toBe("window:dock_edge:island");
  expect(dockEdgeKey("classisland")).toBe("window:dock_edge:classisland");
});
```

- [ ] **Step 2: Run the focused Vitest file and confirm failure**.

Run: `pnpm vitest run src/lib/__tests__/island-dock-edge.test.ts`

Expected: FAIL because the DockEdge module and settings key are absent.

- [ ] **Step 3: Implement the parser/store/settings API** using the existing module-level store pattern (`ui-mode.ts`, `island-width.ts`, `island-opacity.ts`). Add `KEYS.windowDockEdge` and a default `top` without changing the two-value `UiMode` contract. The store must synchronously expose the current normalized edge and notify subscribers after updates.

- [ ] **Step 4: Implement the Rust command transaction**: normalize the requested edge, save the current-mode key, delete current-mode offset x/y, call the unified restore path, and emit `settings://changed` only after success. On reposition failure, attempt to restore the previous edge/offset values and return an error. Register both required Tauri commands in `lib.rs`.

- [ ] **Step 5: Extend `useIslandSettings` initialization and `settings://changed` handling** so it applies `window:dock_edge:<current mode>` after applying `window:ui_mode`, rereads on current-mode edge changes, and rereads after mode changes. Keep the existing T1/T2 reads and fallback behavior intact.

- [ ] **Step 6: Run focused frontend tests and typecheck**.

Run: `pnpm vitest run src/lib/__tests__/island-dock-edge.test.ts src/lib/island-width.test.ts src/lib/island-opacity.test.ts && pnpm typecheck`

Expected: PASS with no regression in existing T1/T2 store tests.

### Task 3: Replace the temporary drag helper with a robust generation-safe native drag chain

**Files:**
- Modify: `src/lib/island-drag.ts`
- Modify: `src/lib/island-drag-controller.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/IslandTopBar.tsx`
- Test: `src/lib/__tests__/island-drag.test.ts`, `src/lib/__tests__/island-drag-controller.test.ts`, `src/App.events.test.tsx`

**Interfaces:**
- `offsetFromWindowPosition` remains available for unsnapped top-baseline conversion and accepts physical monitor/window geometry.
- `createIslandDragController(options)` returns `onMouseDown`, `onMouseUp`, `dispose`, and a drag suppression state/callback; it must use a generation counter and cancel all timers/listeners on disposal or a new drag.

- [ ] **Step 1: Write failing tests** for Alt+left only, ordinary button/link clicks not starting drag, native `startDragging`, suppression during drag, cleanup after movement stability, late callbacks ignored by generation, and suppression restored after start/settle failure or unmount.

```ts
it("does not start native dragging for ordinary clicks", () => {
  const controller = createIslandDragController(harness);
  controller.onMouseDown(new MouseEvent("mousedown", { button: 0, altKey: false }));
  expect(startDragging).not.toHaveBeenCalled();
});

it("invalidates a previous settle callback when a new drag starts", async () => {
  const controller = createIslandDragController(harness);
  startAltDrag(controller);
  controller.dispose();
  startAltDrag(controller);
  await flushTimers();
  expect(windowDragDropSettle).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused drag tests and confirm failure**.

Run: `pnpm vitest run src/lib/__tests__/island-drag.test.ts src/lib/__tests__/island-drag-controller.test.ts`

Expected: FAIL for missing robust lifecycle behavior.

- [ ] **Step 3: Implement movement/stability-based settling**. Start native drag only for an Alt+left `mousedown` outside interactive controls; call `preventDefault` and suppress hover/click side effects for the gesture. Listen for window movement/position updates (and retain mouseup as an early settle hint), poll/ debounce position until stable, then invoke the Rust drop-settle command exactly once per generation. Always clear listeners/timers and call `setDragging(false)` in success, failure, timeout, disposal, and a rejected `startDragging` path.

- [ ] **Step 4: Wire App and IslandTopBar** so drag suppression blocks the existing hover stage controller and click/page side effects, while non-drag behavior remains unchanged. Pass current dock edge and vertical layout state through the existing island settings/UI state without introducing a third UI mode.

- [ ] **Step 5: Run focused drag/event tests and typecheck**.

Run: `pnpm vitest run src/lib/__tests__/island-drag.test.ts src/lib/__tests__/island-drag-controller.test.ts src/App.events.test.tsx src/App.layout.test.ts && pnpm typecheck`

Expected: PASS; ordinary interaction and T1/T2 event behavior remain green.

### Task 4: Implement vertical React layout and manual AppearancePanel edge controls

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/pages/IslandTopBar.tsx`
- Modify: `src/settings/AppearancePanel.tsx`
- Modify: `src/pages/useIslandSettings.ts` if handler/state wiring requires it
- Test: `src/App.layout.test.ts`, `src/settings/__tests__/AppearancePanel.test.tsx` (or the existing appearance test location), and new DockEdge UI tests

**Interfaces:**
- React derives `isVerticalDock = edge === "left" || edge === "right"` and uses semantic flex direction/constraints; it must never apply a whole-DOM CSS rotation.
- AppearancePanel exposes four choices (top/bottom/left/right), writes through `windowDockEdgeSet`, handles request sequencing and rollback using existing error UI, and reset writes edge top plus existing current-mode appearance defaults.

- [ ] **Step 1: Add failing UI tests** for vertical orientation classes/attributes, no rotate transform, manual edge choice invoking the command, rapid selection sequence protection, failed selection rollback, and reset restoring top while preserving T1/T2 reset semantics.

```tsx
it("renders vertical layout semantics without rotating content", () => {
  render(<App ... />);
  expect(screen.getByTestId("island-root")).toHaveAttribute("data-dock-edge", "left");
  expect(screen.getByTestId("island-root")).not.toHaveClass("rotate-90");
});
```

- [ ] **Step 2: Run the focused UI tests and confirm failure**.

Run: `pnpm vitest run src/App.layout.test.ts src/settings/__tests__/AppearancePanel.test.tsx`

Expected: FAIL for absent orientation/manual edge behavior.

- [ ] **Step 3: Implement semantic vertical layout**. For left/right, set outer dimensions consistent with Rust, arrange top bar controls and compact strip vertically, preserve readable text/icon orientation, and make expanded content open inward. Adjust only T4-required container constraints and edge-specific radius/border classes; preserve horizontal top/bottom and existing T1/T2 animation behavior.

- [ ] **Step 4: Add the AppearancePanel four-edge switch** with Chinese labels 顶部/底部/左侧/右侧, request sequence protection, success normalization from backend, failure rollback, and reset-to-top. Manual switching must clear offsets and immediately reposition through the backend command.

- [ ] **Step 5: Run focused UI tests, all frontend tests, and typecheck**.

Run: `pnpm vitest run src/App.layout.test.ts src/App.events.test.tsx src/settings/__tests__/AppearancePanel.test.tsx src/lib/__tests__/island-dock-edge.test.ts src/lib/__tests__/island-drag-controller.test.ts && pnpm typecheck`

Expected: PASS.

### Task 5: Update documentation and perform full verification

**Files:**
- Modify: `docs/开发进度.md` (only the module 14 row)
- Modify: `vault/14-位置外观增强需求包.md` only if the public interface/type details need recording
- Create: `docs/superpowers/plans/2026-08-17-module-14-t4-edge-docking.md`

- [ ] **Step 1: Self-review the diff** and confirm only T4 files, the approved plan, and the module 14 progress row are changed. Remove the clearly leftover `[width-debug]` logging from `window_policy.rs` because it is in a touched T4 path and is T1 diagnosis-only.

- [ ] **Step 2: Run targeted Rust verification with an independent target**.

Run: `set CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.omc/cargo-t4-target && set SHERPA_ONNX_LIB_DIR=E:/Code/Tauri/LuckyIsland/src-tauri/target/sherpa-onnx-prebuilt/sherpa-onnx-v1.13.4-win-x64-shared-MT-Release-lib/lib && set CARGO_HTTP_CHECK_REVOKE=false && /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib`

Expected: all Rust library tests pass with no new failures.

- [ ] **Step 3: Run complete project verification using the same independent Cargo target/environment**.

Run: `set CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.omc/cargo-t4-target && set SHERPA_ONNX_LIB_DIR=E:/Code/Tauri/LuckyIsland/src-tauri/target/sherpa-onnx-prebuilt/sherpa-onnx-v1.13.4-win-x64-shared-MT-Release-lib/lib && set CARGO_HTTP_CHECK_REVOKE=false && pnpm verify`

Expected: typecheck, frontend Vitest, frontend build, Rust format, strict clippy, Rust tests, and cargo check all pass.

- [ ] **Step 4: Run whitespace validation**.

Run: `git diff --check`

Expected: no whitespace errors. Existing unrelated line-ending-only noise must not be rewritten.

- [ ] **Step 5: Update only the module 14 progress row** with the verified automated result and “待 Windows 真机验收” status; do not rewrite unrelated historical progress. Keep vault/14 complete and placeholder-free if changed.

- [ ] **Step 6: Final review**: inspect `git status --short` and `git diff --stat`, verify no commit/push/tag occurred, and report exact changed files, commands/results, evidence pointers, blockers, and recommended next action. Do not claim GUI behavior verified; mark it for user Windows real-device acceptance.

---

## Coverage Check

- DockEdge parsing/key/store: Tasks 1–2.
- Four-edge physical geometry, gap, clamp, orientation, edge-fixed resize: Tasks 1 and 4.
- 48px threshold, nearest-edge/tie/stable-order rules: Task 1.
- Snap/unsnap persistence and top-baseline conversion: Tasks 1–3.
- Native Alt drag, suppression, movement stability, cleanup/generation: Task 3.
- Settings synchronization/import/export whitelist: Task 2 and Task 5.
- Manual four-edge UI and reset: Task 4.
- T1/T2 regressions and full verification: Tasks 4–5.
- T5/taskbar exclusion and no dependencies: Global Constraints and Task 5.

## Placeholder and Type Review

This plan contains no TBD/TODO/implementation-later placeholders. All named interfaces are defined before downstream use, all command names are referenced consistently, and every requirement in the approved design has a task and explicit test/verification step.
