# AiHistoryPanel Dual Listener Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate AiHistoryPanel's action-result and provider-change Tauri listeners to the shared lifecycle hook without changing AI provider, model, prompt, request, or settings behavior.

**Architecture:** Both native listeners use `useTauriEvent`. Action-result history refresh uses a component-lifetime generation check so a refresh started before cleanup cannot update state when it settles; active rejection is diagnosed and leaves the current list unchanged. Provider-change remains synchronous and validates its payload before updating state.

**Tech Stack:** React 19, TypeScript 5.8, Tauri 2 event API, Vitest 4, happy-dom, pnpm 10.

## Global Constraints

- Modify only `src/settings/AiHistoryPanel.tsx`, `src/settings/__tests__/AiHistoryPanel.test.tsx`, the approved spec, this plan, and safely separable progress documentation.
- Do not alter the initial settings/history loading effect.
- Do not alter provider RPC, model, prompt, chat request, history search/clear, position reset, or Chat API settings behavior.
- Do not modify `VoicePanel`, `AiPalette`, `src/lib/ai.ts`, or shared hooks unless a new RED proves a shared defect.
- Use at most one independent read-only reviewer.
- Verify with the independent Cargo target, commit locally to `main`, do not push, and do not include unrelated working-tree changes.

---

### Task 1: Add AiHistoryPanel RED Tests

**Files:**
- Create: `src/settings/__tests__/AiHistoryPanel.test.tsx`

**Interfaces:**
- Mock deferred Tauri `listen` registrations for `ai://action-result` and `ai://provider-changed`.
- Mock deterministic initial settings and history reads.
- Record subsequent deferred `aiHistoryList(500)` refreshes separately from initial load.

- [ ] Build a happy-dom fixture that resolves initial settings/history and renders the panel.
- [ ] Add tests for stable one-time registration across provider/history rerenders.
- [ ] Add action-result tests for refresh success, active rejection diagnostics without list loss, stale callback after cleanup, and pre-cleanup refresh resolving/rejecting after cleanup.
- [ ] Add provider tests for three valid values, invalid payload, error clearing, and stale callback after cleanup.
- [ ] Add resolved/late disposer, StrictMode generation, scoped registration rejection, and initial-load contract tests.
- [ ] Run the AiHistoryPanel + shared-hook focused suite and record RED failures.

### Task 2: Implement the Minimal Migration

**Files:**
- Modify: `src/settings/AiHistoryPanel.tsx`

**Interfaces:**
- Consume `useTauriEvent` for both event names.
- Use a component-local lifecycle generation for action-result refresh continuations.

- [ ] Replace direct event import and both listener effects with `useTauriEvent`.
- [ ] On action-result, start `aiHistoryList(500)` and apply success/error only while the component generation remains current.
- [ ] On provider-change, validate the payload, update provider, and clear `providerError`.
- [ ] Keep the initial load and all AI/provider methods unchanged.
- [ ] Run the focused suite, typecheck, and scoped diff check.

### Task 3: Verify and Independently Review

**Files:**
- Read only outside the scoped component/test.

- [ ] Run AiHistoryPanel, GeneralPanel, SettingsApp, shared-hook, Stock, Notify, and Weather listener regression tests.
- [ ] Run full `pnpm verify` with `CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check` and stable MSVC Cargo on PATH; record exact totals.
- [ ] Dispatch one independent read-only reviewer restricted to the scoped diff, component, test, and shared hooks.
- [ ] Resolve any surviving finding through focused RED→GREEN before proceeding.

### Task 4: Document and Commit Precisely

**Files:**
- Include: `docs/superpowers/specs/2026-07-16-ai-history-panel-listener-design.md`
- Include: `docs/superpowers/plans/2026-07-16-ai-history-panel-listener-migration.md`
- Update only when safely separable: `docs/开发进度.md`, `vault/10b-工程基线与低风险重构.md`, `vault/CURRENT.md`

- [ ] Record exact RED/GREEN, regression, full verify, review, scope, and non-GUI evidence.
- [ ] Set the next read-only candidate to VoicePanel; keep AiPalette separate because of send/timer/request-state coupling.
- [ ] Re-run focused tests, typecheck, and scoped diff check immediately before commit.
- [ ] Precisely stage component, test, spec, and plan; leave mixed progress documents unstaged when they contain pre-existing unrelated hunks.
- [ ] Inspect cached names/stat and commit with `fix(M10): ...` plus the required co-author trailer. Do not push.
