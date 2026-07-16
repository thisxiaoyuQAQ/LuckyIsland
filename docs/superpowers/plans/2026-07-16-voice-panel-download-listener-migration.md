# VoicePanel Download Listener Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate VoicePanel's download-progress Tauri listener to a stable shared-hook subscription that always reads the latest downloading model.

**Architecture:** Replace the dependency-driven direct listener effect with `useTauriEvent<DownloadProgress>`. The shared hook keeps one subscription while forwarding events to the latest committed handler, so KWS/ASR model changes update behavior without registration churn. Existing stage handling remains unchanged.

**Tech Stack:** React 19, TypeScript 5.8, Tauri 2 event API, Vitest 4, happy-dom, pnpm 10.

## Global Constraints

- Modify only `src/settings/VoicePanel.tsx`, `src/settings/__tests__/VoicePanel.test.tsx`, the approved spec, this plan, and safely separable progress documentation.
- Do not alter initial readiness/settings, download RPC, enable/disable behavior, keyword validation/debounce/hot reload, AiPalette, Rust voice code, or any AI API/provider/model/prompt behavior.
- Reuse shared hooks without modification unless a new RED proves a shared defect.
- Use one independent read-only reviewer, independent Cargo target verification, exact local main commit, and no push.
- Do not stage or commit unrelated working-tree changes.

---

### Task 1: Add VoicePanel RED Tests

**Files:**
- Create: `src/settings/__tests__/VoicePanel.test.tsx`

- [ ] Build deterministic mocks for settings, `invoke`, deferred Tauri registration, and a minimal observable VoicePanel UI.
- [ ] Protect initial readiness/settings call keys and values.
- [ ] Prove one registration at mount and expose current direct-listener re-registration when `downloadingModel` changes from KWS to ASR.
- [ ] Prove the same callback uses latest KWS/ASR selection for `done` readiness.
- [ ] Cover downloading, extracting, unknown, error, and done stage behavior.
- [ ] Cover stale callback, resolved/late disposer, StrictMode generation, and scoped registration rejection.
- [ ] Assert listener events/model changes do not spuriously invoke download, keyword-validation, or reload RPCs.
- [ ] Run VoicePanel + shared-hook tests and record RED.

### Task 2: Implement Minimal Stable Migration

**Files:**
- Modify: `src/settings/VoicePanel.tsx`

- [ ] Replace direct event import/effect with `useTauriEvent<DownloadProgress>`.
- [ ] Preserve the exact progress and readiness branch semantics.
- [ ] Do not add `downloadingModelRef`; rely on latest handler behavior.
- [ ] Run focused tests, typecheck, and scoped diff check.

### Task 3: Verify and Review

- [ ] Run VoicePanel plus all existing listener component/shared-hook regression tests.
- [ ] Run full independent-target `pnpm verify` and record exact totals.
- [ ] Run one independent read-only review restricted to VoicePanel, its test, shared hooks, and scoped diff.
- [ ] Resolve any finding by focused RED→GREEN.

### Task 4: Document and Commit

**Files:**
- Include spec and this plan.
- Update mixed progress documents only in working tree unless safely separable.

- [ ] Record exact RED/GREEN, regression, full verify, review, scope, and non-GUI evidence.
- [ ] Set AiPalette as the next separate read-only design candidate.
- [ ] Freshly rerun focused tests, typecheck, and scoped diff check.
- [ ] Precisely stage VoicePanel, test, spec, and plan; inspect cached names/stat.
- [ ] Commit locally with project `fix(M10): ...` convention and required co-author trailer. Do not push.
