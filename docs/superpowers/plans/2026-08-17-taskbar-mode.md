# Taskbar Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the formal Windows `window:ui_mode = taskbar` mode with a real taskbar-embedded summary strip and a separate bottom-left panel that reuses the existing LuckyIsland island window and pages.

**Architecture:** Keep the existing `island` WebView as the single content surface and add a focused Rust taskbar manager plus a separate `taskbar-strip` WebView. The strip is parented into `Shell_TrayWnd`; the island window remains top-level and is independently positioned above the taskbar. `WindowPolicy` owns mode/state decisions, while `taskbar.rs` owns Win32 handles, taskbar geometry, reparenting, Explorer recovery, and platform rollback.

**Tech Stack:** Tauri 2, Rust, `windows` crate Win32 APIs, React 19, TypeScript, Motion, Tailwind v4, SQLite settings KV, Vitest, Cargo test/clippy/fmt.

## Global Constraints

- Preserve all existing uncommitted T1/T2 work; never reset, stash, overwrite, or clean unrelated changes.
- Existing `island` and `classisland` behavior must remain unchanged.
- The formal mode is `window:ui_mode = taskbar`; invalid mode values fall back to `island`.
- The taskbar strip and expanded panel are always separate windows; a `WS_CHILD` strip must never host the 400px panel.
- The strip is approximately 140px wide and no taller than the current taskbar client area; it displays time plus weather/todo summary.
- The panel expands from the bottom-left above the taskbar, with its left edge aligned to the strip left edge, using the existing pages and interactions.
- Expansion is click-driven only; collapse is a second strip click or `Esc`; do not use cross-window hover or blur as the state source.
- Win32 calls stay inside `src-tauri/src/taskbar.rs`; frontend code must use typed Tauri commands/events.
- All external/platform inputs (HWNDs, rectangles, DPI, dimensions, persisted values) are validated and clamped.
- No new network service, plugin runtime, AI capability, voice behavior, or plugin marketplace behavior.
- No push, tag, release, deployment, history rewrite, merge, or destructive cleanup; one local commit on `main` is allowed only after verification and L2 review.
- Verification uses the repository’s existing environment constraints, including `SHERPA_ONNX_LIB_DIR=<absolute-path>/lib` and `CARGO_HTTP_CHECK_REVOKE=false` when required by Cargo.

---

### Task 1: Freeze the taskbar-mode contract and migration surface

**Files:**
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/ui-mode.ts`
- Modify: `src/lib/window-policy.ts`
- Modify: `src-tauri/src/monitor.rs`
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `vault/14-位置外观增强需求包.md`
- Test: existing settings/window-policy test files plus new focused tests under `src/lib/__tests__/`

**Interfaces:**
- Produces `UiMode = "island" | "classisland" | "taskbar"`.
- Produces `parseUiMode(value: string | null | undefined): UiMode` with invalid/null fallback `"island"`.
- Produces a mode-key helper that safely returns the taskbar namespace for taskbar-only appearance settings without changing existing two-mode keys.
- Produces Rust normalization/serialization behavior matching the TypeScript parser.

- [ ] **Step 1: Add RED tests for the third mode and fallback semantics.**

Add tests that assert:

```ts
expect(parseUiMode("taskbar")).toBe("taskbar");
expect(parseUiMode("corner")).toBe("island");
expect(parseUiMode(null)).toBe("island");
```

Add tests that verify existing `island` and `classisland` mode keys remain unchanged and taskbar keys are isolated rather than silently reading either existing mode’s width/opacity/offset.

- [ ] **Step 2: Run the focused tests and confirm RED.**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/settings.test.ts src/lib/__tests__/window-policy.test.ts
```

Expected: failures because the parser and mode union do not yet accept `taskbar`.

- [ ] **Step 3: Implement the shared mode contract.**

Update the TypeScript union, parser, mode-key helpers, and store comments. Update Rust’s mode normalization and mode-key generation to accept only `island`, `classisland`, and `taskbar`, with `island` as the safe fallback. Keep old persisted `corner` values mapped to `island`; do not revive the canceled corner implementation.

- [ ] **Step 4: Add migration tests and implementation.**

Test that a persisted `window:ui_mode=taskbar` survives read/write and that an invalid/legacy `corner` value becomes `island` without modifying unrelated appearance keys. Test that exported settings include taskbar-prefixed portable keys while sensitive and runtime-only keys remain excluded.

- [ ] **Step 5: Run focused tests and TypeScript validation.**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/settings.test.ts src/lib/__tests__/window-policy.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Update the T5 interface section in the vault.**

Record the exact third-mode value, taskbar-specific key namespace, invalid-value fallback, and two-window rule in the existing T5 sections. Do not add a second competing source of truth.

---

### Task 2: Implement the isolated Win32 taskbar manager

**Files:**
- Create: `src-tauri/src/taskbar.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock` only if Cargo changes it
- Create or modify: `src-tauri/capabilities/taskbar-strip.json`
- Test: `src-tauri/src/taskbar.rs` unit tests

**Interfaces:**
- Produces a `TaskbarManager` managed by Tauri state.
- Produces a typed taskbar snapshot containing availability, taskbar rectangle, client rectangle, DPI, strip rectangle, and Explorer identity.
- Produces lifecycle functions equivalent to:

```rust
pub fn enter_taskbar_mode(app: &AppHandle, db: &Db) -> Result<TaskbarSnapshot, String>;
pub fn leave_taskbar_mode(app: &AppHandle) -> Result<(), String>;
pub fn taskbar_strip_toggle(app: &AppHandle) -> Result<bool, String>;
pub fn taskbar_reapply(app: &AppHandle, db: &Db) -> Result<TaskbarSnapshot, String>;
pub fn taskbar_is_available(app: &AppHandle) -> TaskbarAvailability;
```

- Produces pure helpers for taskbar rectangle validation, start-adjacent insertion point calculation, logical/physical conversion, and work-area clamping.

- [ ] **Step 1: Add RED tests for pure geometry and lifecycle invariants.**

Cover:

```rust
assert_eq!(start_adjacent_x(taskbar_left, start_width, gap), taskbar_left + start_width + gap);
assert_eq!(clamp_rect_to_client(rect, client), expected);
assert_eq!(panel_bottom(taskbar_visible_top, panel_height, gap), taskbar_visible_top - gap);
```

Also test that a strip rectangle cannot exceed the taskbar client height and that malformed/negative dimensions return a safe error rather than a zero-sized window.

- [ ] **Step 2: Run the focused Rust tests and confirm RED.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml taskbar::tests
```

Expected: compile failures because the module and helpers do not exist.

- [ ] **Step 3: Add the Windows dependency feature and module registration.**

Use the existing dependency conventions. Add only the Windows features needed for window parenting, window styles/positions, shell/taskbar discovery, process identity, DPI, and thread input attachment. Register `mod taskbar;`, manage `TaskbarManager`, and add only typed commands required by the frontend.

- [ ] **Step 4: Implement taskbar discovery and validated geometry.**

Implement `Shell_TrayWnd` discovery, taskbar client/work-area extraction, start-button-adjacent insertion calculation, current-taskbar DPI lookup, strip-size clamping, and bottom-left panel placement. Keep all HWND and Win32 error conversion local to this module.

- [ ] **Step 5: Implement reparenting with explicit rollback.**

For entry:

1. Locate and validate `Shell_TrayWnd`.
2. Create/show the strip window at a valid temporary size.
3. Apply child style and call `SetParent(strip, tray)`, using the correct thread-input feature if focus/z-order coordination requires it.
4. Set position and size with `SetWindowPos`.
5. Never pass zero move/size values when only changing z-order; use `SWP_NOMOVE | SWP_NOSIZE`.

If any step fails, restore the previous parent/style/visibility and return a diagnostic error.

- [ ] **Step 6: Implement Explorer/taskbar invalidation recovery.**

Store the current taskbar HWND and Explorer process identity. On reapply, verify both. If invalid, detach/hide the strip, rediscover the taskbar, and reparent/reposition it. If rediscovery fails, return an unavailable snapshot without showing a duplicate top island.

- [ ] **Step 7: Run Rust formatting, focused tests, and check.**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml taskbar::tests
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS on supported Windows; platform-gated tests must remain deterministic on non-Windows builds.

---

### Task 3: Add the independent taskbar-strip frontend entry

**Files:**
- Create: `src/taskbar-strip/main.tsx`
- Create: `src/taskbar-strip/TaskbarStrip.tsx`
- Create: `src/taskbar-strip/taskbar-strip.css` or the project-equivalent style entry
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/taskbar-strip.json`
- Modify: `vite.config.ts` or the existing multi-entry build configuration
- Test: `src/taskbar-strip/TaskbarStrip.test.tsx`

**Interfaces:**
- Produces a compact strip that subscribes to typed settings/state events and invokes the taskbar toggle command.
- The strip never imports or renders `CurrentPage`, terminal pages, or the full `App` component.
- The strip exposes stable `data-testid` hooks for mode, summary, and toggle behavior.

- [ ] **Step 1: Add RED component tests.**

Test that the strip renders time and a summary, invokes `taskbarStripToggle()` once per click, shows expanded/collapsed state from the event snapshot, and does not render the full panel.

- [ ] **Step 2: Run the focused frontend test and confirm RED.**

Run:

```bash
pnpm exec vitest run src/taskbar-strip/TaskbarStrip.test.tsx
```

Expected: failures because the entry and component do not exist.

- [ ] **Step 3: Implement the minimal strip component.**

Use the existing settings/event patterns. Keep the visual baseline: approximately 140px wide, taskbar-height-safe, status dot, time, weather/todo summary, and a clear pressed/expanded state. Handle command errors by showing a compact non-sensitive error state and emitting a diagnostic log; do not hide errors silently.

- [ ] **Step 4: Add the Tauri window entry and capability.**

Declare the new strip window with no decorations, transparent behavior matching the project’s current safe window configuration, and only the IPC permissions it needs. Do not grant filesystem, shell, plugin, or unrelated command permissions.

- [ ] **Step 5: Add the third build entry and run focused validation.**

Run:

```bash
pnpm exec vitest run src/taskbar-strip/TaskbarStrip.test.tsx
pnpm exec tsc --noEmit
pnpm build
```

Expected: PASS, including the new entry.

---

### Task 4: Integrate taskbar state into WindowPolicy and App

**Files:**
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/monitor.rs`
- Modify: `src/lib/window-policy.ts`
- Modify: `src/App.tsx`
- Modify: `src/pages/useIslandSettings.ts`
- Modify: `src/pages/useIslandEvents.ts`
- Modify: relevant App/layout/event tests

**Interfaces:**
- `WindowPolicySnapshot` includes taskbar mode and taskbar availability/expanded state without breaking existing consumers.
- Produces typed frontend wrappers for taskbar entry, exit, toggle, and reapply.
- `App.tsx` receives `uiMode === "taskbar"` and maps compact to hidden island + visible strip, expanded to visible bottom-left panel.

- [ ] **Step 1: Add RED policy tests.**

Cover:

```rust
assert_eq!(taskbar_compact_effects(), vec![HideIsland, ShowStrip]);
assert_eq!(taskbar_expanded_effects(), vec![ResizeIsland, PositionBottomLeft, ShowIsland]);
assert_eq!(taskbar_escape_effects(), vec![HideIsland, KeepStrip]);
```

Also assert existing island/classisland effect plans remain unchanged.

- [ ] **Step 2: Run the focused Rust and frontend tests and confirm RED.**

Run the relevant `window_policy` tests and `App.events.test.tsx`/layout tests. Expected failures identify the new state fields and branches.

- [ ] **Step 3: Implement taskbar-aware policy transitions.**

Keep `IslandState` semantics stable for existing modes. Add a taskbar-specific effect path that coordinates strip visibility with island visibility and calls the taskbar manager for geometry/reparenting. Make mode transitions transactional: apply platform state first, then persist and emit; on failure restore the previous mode and visibility.

- [ ] **Step 4: Implement bottom-left panel geometry.**

Use the taskbar manager’s validated taskbar-visible top and strip left edge. Apply current taskbar width/expanded opacity keys and clamp the panel to the taskbar monitor work area. Do not use the existing top-center offset calculation for taskbar mode.

- [ ] **Step 5: Integrate App rendering and interaction.**

In `App.tsx`:

- suppress the top-level island wrapper when taskbar mode is compact;
- render the existing body unchanged when taskbar mode is expanded;
- apply the clean rectangular taskbar style;
- keep page navigation and existing Escape handling;
- remove hover controller activation in taskbar mode;
- preserve existing island/classisland animation behavior.

- [ ] **Step 6: Wire strip click and Escape events.**

A strip click must toggle only taskbar panel state. `Esc` must collapse the panel while leaving the strip alive. Do not depend on mouseenter/mouseleave between the two windows.

- [ ] **Step 7: Run focused policy, event, layout, TypeScript, and build checks.**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml window_policy::tests
pnpm exec vitest run src/App.events.test.tsx src/App.layout.test.ts src/lib/__tests__
pnpm exec tsc --noEmit
pnpm build
```

Expected: PASS with existing mode regressions covered.

---

### Task 5: Add settings UI, independent appearance keys, and import/export support

**Files:**
- Modify: `src/settings/AppearancePanel.tsx`
- Modify: `src/pages/useIslandSettings.ts`
- Modify: `src/lib/settings.ts`
- Modify: `src/lib/island-width.ts`
- Modify: `src/lib/island-opacity.ts`
- Modify: `src-tauri/src/settings_window.rs`
- Modify: `src-tauri/src/monitor.rs`
- Modify: relevant settings/import/export tests

**Interfaces:**
- Settings UI exposes taskbar mode as the third mode and shows capability/fallback feedback.
- Width/opacity/offset settings use taskbar-specific mode keys while preserving existing keys.
- Import/export round trips taskbar settings and excludes secrets/cache/runtime data.

- [ ] **Step 1: Add RED settings tests.**

Test mode selection, taskbar key names, independent width/opacity values, reset-to-default behavior, import/export round trip, and invalid taskbar capability fallback.

- [ ] **Step 2: Run focused settings tests and confirm RED.**

Run the relevant AppearancePanel/settings/import tests; expected failures should be limited to the new taskbar behavior.

- [ ] **Step 3: Implement mode selection and taskbar defaults.**

Add taskbar to the mode selector. Define explicit taskbar defaults and use the existing parsers/clamps. Do not read island/classisland values as taskbar fallback values unless the shared contract explicitly defines a migration for that key.

- [ ] **Step 4: Implement live settings synchronization.**

Subscribe to `settings://changed` and taskbar state events. When mode or taskbar geometry changes, update the strip/panel without requiring a settings-window reopen. Preserve draft/persisted separation used by the existing panels.

- [ ] **Step 5: Implement import/export and reset.**

Ensure taskbar-prefixed appearance keys are portable, reset clears phase-specific taskbar values consistently, and import applies values atomically with existing settings broadcasts. Keep API keys, HTTP tokens, caches, monitor identity, and runtime state excluded.

- [ ] **Step 6: Run focused tests, TypeScript, and build.**

Run the settings/import suite, `pnpm exec tsc --noEmit`, and `pnpm build`. Expected: PASS.

---

### Task 6: Add system-change monitoring and recovery integration

**Files:**
- Modify: `src-tauri/src/taskbar.rs`
- Modify: `src-tauri/src/monitor.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/window_policy.rs`
- Modify: `src/lib/window-policy.ts`
- Test: taskbar/monitor/window-policy recovery tests

**Interfaces:**
- Produces a runtime watcher that can request taskbar reapply after Explorer/taskbar/display/DPI changes.
- Emits typed `window://taskbar-state-changed` snapshots with `available`, `recovered`, and diagnostic reason fields.
- Preserves the persisted taskbar mode while using an explicit temporary island fallback when the taskbar is unavailable.

- [ ] **Step 1: Add RED recovery tests.**

Cover stale HWND/Explorer identity, successful rediscovery, failed rediscovery, display change, DPI change, auto-hide rectangle change, and the invariant that recovery never leaves both top island and strip visible.

- [ ] **Step 2: Implement event-driven and periodic reapply.**

Integrate with the existing runtime monitor rather than creating an unbounded polling thread. Coalesce repeated changes, revalidate handles before every Win32 operation, and reapply only when taskbar mode is active or a pending persisted taskbar request needs recovery.

- [ ] **Step 3: Implement deterministic fallback and restoration.**

On unavailable taskbar:

1. hide/detach strip;
2. restore island mode as the temporary visible UI;
3. emit the reason;
4. retain persisted `taskbar` selection for retry.

On recovery, hide the temporary island, reparent/reposition strip, and restore the taskbar panel state.

- [ ] **Step 4: Run focused recovery tests and Rust checks.**

Run taskbar/monitor/window-policy tests, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, and `cargo check`. Expected: PASS under the repository’s documented environment.

---

### Task 7: Update documentation and progress evidence

**Files:**
- Modify: `vault/14-位置外观增强需求包.md`
- Modify: `docs/开发进度.md` only the module 14 row
- Modify: `vault/CURRENT.md` only the current action/summary needed for the new state
- Create or modify: `docs/superpowers/specs/2026-08-17-taskbar-mode-design.md`
- Create: `docs/superpowers/plans/2026-08-17-taskbar-mode.md`

**Interfaces:**
- Documentation becomes a single consistent source for the formal T5 contract, with implementation and verification evidence linked from the progress row.

- [ ] **Step 1: Update the vault contract.**

Replace the prototype-only T5 status with the approved formal scope, exact two-window interfaces, fallback rules, settings keys, and acceptance matrix. Keep the prior 13a cancellation facts as historical constraints; do not erase them.

- [ ] **Step 2: Update progress without adding a work log.**

Change only the module 14 row to reflect the actual T5 state and include one-line verification evidence. Keep `docs/开发进度.md` under 120 lines and preserve its required three-section structure.

- [ ] **Step 3: Update CURRENT to point to the next real action.**

After implementation is verified, point `vault/CURRENT.md` at the remaining module 14 work or close the current action only if all module 14 required work is actually complete. Do not claim true-machine acceptance without user evidence.

- [ ] **Step 4: Run documentation consistency checks.**

Search changed docs for forbidden placeholder words and verify all referenced paths exist. Run `git diff --check` over only the changed taskbar/documentation files.

---

### Task 8: Run the complete verification matrix and true-machine acceptance

**Files:**
- No new production files; update only evidence locations authorized by Task 7.

- [ ] **Step 1: Run the repository verification command.**

Run the existing `pnpm verify` with the documented Cargo environment. Confirm TypeScript, Vitest, all Vite entries including `taskbar-strip`, Rust fmt, strict clippy, Rust library tests, and cargo check all pass.

- [ ] **Step 2: Run targeted regression checks.**

Run the taskbar, window-policy, monitor, settings, import/export, App event/layout, and strip test suites separately so failures are attributable.

- [ ] **Step 3: Start the Tauri development app on Windows.**

Use the project’s existing Tauri development command. Verify:

1. taskbar mode selection creates the strip beside Start;
2. strip remains within the taskbar and is approximately 140px wide;
3. click expands the existing pages in the bottom-left panel;
4. the panel aligns with the strip and sits above the taskbar;
5. second click and `Esc` collapse it;
6. island/classisland still work after switching back;
7. Explorer restart, taskbar auto-hide, secondary monitor, DPI, app restart, notifications, fullscreen behavior, terminal page, and config import/export behave as specified.

- [ ] **Step 4: Record true-machine evidence separately from automation.**

Record only observed results and failures. If any acceptance item fails, keep the task incomplete and fix the implementation before review.

---

### Task 9: Independent L2 review and local commit

**Files:**
- Review all taskbar-related production and test changes; do not alter unrelated dirty files.

- [ ] **Step 1: Run an independent L2 review.**

Review the taskbar Win32 boundary, window-policy transitions, persistence/migration, capability permissions, fallback behavior, and regressions in existing modes. The reviewer must inspect the diff against the pre-Goal baseline while explicitly ignoring unrelated pre-existing modifications.

- [ ] **Step 2: Resolve every finding.**

For each finding, add or update a regression test before changing implementation. Re-run the affected focused suite and then the full verification command. Do not downgrade a contract/Windows/security finding to avoid the L2 gate.

- [ ] **Step 3: Re-check the working tree boundary.**

Confirm only Goal-authorized taskbar files, tests, and documentation are staged. Do not stage existing T1/T2 files merely because they are already modified.

- [ ] **Step 4: Create the authorized local commit.**

Use one commit on the current `main` branch after all checks pass:

```bash
git add <only-authorized-taskbar-files>
git commit -m "feat(14-T5): add taskbar mode"
```

Do not push, tag, release, merge, reset, rebase, or rewrite history.

- [ ] **Step 5: Verify the final state.**

Run `git status --short`, confirm the taskbar commit exists, confirm unrelated worktree changes remain untouched, and report automation plus true-machine evidence separately.

---

## Plan Self-Review

- **Spec coverage:** Covers the two-window split, Win32 SetParent lifecycle, bottom-left alignment, click/Esc behavior, taskbar mode contract, independent settings, import/export, display/DPI/auto-hide/Explorer recovery, fallback, automated tests, true-machine acceptance, L2 review, and authorized local commit.
- **Placeholder scan:** No step delegates an unspecified implementation; each task names files, interfaces, tests, commands, and expected outcomes.
- **Type consistency:** `UiMode` and `parseUiMode` are established in Task 1; taskbar lifecycle functions and snapshots are established in Task 2; strip IPC and policy integration consume those interfaces in Tasks 3–6.
- **Scope check:** The formal implementation is broad but is one coherent subsystem with independent testable boundaries: contract, Win32 manager, strip UI, policy integration, settings, recovery, docs, verification/review.
- **Dirty-worktree check:** The plan explicitly excludes staging or modifying pre-existing T1/T2 and unrelated changes.
