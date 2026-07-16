# GeneralPanel Dual Listener Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate GeneralPanel's monitor and window-policy Tauri listeners to `useTauriEvent` while preserving business behavior and safely handling asynchronous monitor refresh completion after cleanup.

**Architecture:** Both native listeners use the shared `useTauriEvent` lifecycle boundary. The monitor callback delegates its asynchronous refresh to a component-local generation guard so an in-flight `monitorList()` cannot write after cleanup; refresh rejection is surfaced through the existing `monitorError` UI without rolling back the event payload. The policy callback remains synchronous and updates its four snapshot fields together.

**Tech Stack:** React 19, TypeScript 5.8, Tauri 2 event API, Vitest 4, happy-dom, pnpm 10.

## Global Constraints

- Modify only `src/settings/GeneralPanel.tsx`, `src/settings/__tests__/GeneralPanel.test.tsx`, this plan, and existing module 10 progress documents needed for exact evidence.
- `GeneralPanel.tsx:68-114` initial settings/monitor loading effect remains out of scope.
- Do not change switch mutations, `monitorSelect`, persistence, loading UI, or existing copy.
- Reuse `useTauriEvent`; do not modify shared hooks without a new RED proving a shared defect.
- Preserve event payload state when monitor-list refresh fails; show the error through existing `monitorError`.
- Do not touch, stage, revert, clean, or commit unrelated working-tree changes.
- Verify with an independent Cargo target, use at most one independent read-only reviewer, commit locally to `main`, and do not push.

---

### Task 1: Build GeneralPanel Listener RED Tests

**Files:**
- Create: `src/settings/__tests__/GeneralPanel.test.tsx`

**Interfaces:**
- Mock `listen(name, callback)` as deferred subscriptions with recorded callbacks and disposers.
- Mock initial setting, monitor, autostart, and window-policy APIs so GeneralPanel exits loading deterministically.
- Produce helpers for emitting `monitor://changed` and `window://policy-changed` events and for resolving/rejecting deferred monitor-list refreshes.

- [ ] Add a deterministic happy-dom fixture that renders GeneralPanel after successful initial load.
- [ ] Add RED tests proving both event names register once and remain stable across event-driven rerenders.
- [ ] Add RED monitor tests: payload update plus list refresh; refresh rejection displays existing error without rollback; stale callback after cleanup starts no refresh; pre-cleanup refresh resolving/rejecting after cleanup writes nothing.
- [ ] Add RED policy tests: all four fields update from one snapshot; stale callback after cleanup writes nothing.
- [ ] Add RED lifecycle tests: resolved and late-resolving disposers, StrictMode generation isolation, and scoped rejection labels for both event names.
- [ ] Run `pnpm vitest run src/settings/__tests__/GeneralPanel.test.tsx src/lib/__tests__/useTauriEvent.test.tsx src/lib/__tests__/useAsyncSubscription.test.tsx` and record the expected failures against direct listeners.

### Task 2: Implement the Minimal Migration

**Files:**
- Modify: `src/settings/GeneralPanel.tsx`

**Interfaces:**
- Consume `useTauriEvent<T>(eventName, handler)`.
- Maintain a component-local committed activity ref for monitor refresh continuations; cleanup invalidates it, StrictMode setup reactivates only the mounted component lifetime while `useTauriEvent` rejects stale listener generations.

- [ ] Replace the two direct `listen` imports/effects with `useTauriEvent` calls.
- [ ] For monitor events: set payload state, clear `monitorError`, call `monitorList()`, update monitors only while active, and map active rejection to `monitorError`.
- [ ] Keep policy updates synchronous and set all four fields from the snapshot.
- [ ] Run the focused three-file suite and make all tests pass.
- [ ] Run `pnpm typecheck` and scoped `git diff --check`.

### Task 3: Regression, Full Verification, and Independent Review

**Files:**
- Read only beyond the two implementation files.

- [ ] Run GeneralPanel plus shared-hook and SettingsApp listener regression tests.
- [ ] Run `pnpm verify` with `CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check` and the stable MSVC toolchain on `PATH`; record exact totals and warnings.
- [ ] Dispatch one independent read-only reviewer restricted to GeneralPanel, its test, shared hooks, and the scoped diff.
- [ ] If a finding survives, add a focused RED and iterate before documenting completion.

### Task 4: Documentation and Exact Commit

**Files:**
- Modify when safely separable: `docs/开发进度.md`, `vault/10b-工程基线与低风险重构.md`, `vault/CURRENT.md`
- Include: `docs/superpowers/plans/2026-07-16-general-panel-dual-listener-migration.md`

- [ ] Record the migration boundary, RED/GREEN evidence, exact verification totals, review verdict, rejection semantics, non-goals, and lack of GUI/installed-app verification.
- [ ] Update the sole next action only after a read-only inventory of remaining settings/AI direct listeners.
- [ ] If an existing progress file contains inseparable pre-existing changes, leave its new lines unstaged rather than committing unrelated hunks.
- [ ] Re-run the focused suite and TypeScript check immediately before commit.
- [ ] Precisely stage only this batch, inspect `git diff --cached --name-only` and `--stat`, then commit with a project-conformant `fix(M10): ...` message. Do not push.
