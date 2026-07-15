# REF-10B-01 Stock Listener Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate only StockPage's tick, config-import, and settings subscriptions to the verified shared lifecycle hooks with real React lifecycle regressions.

**Architecture:** A happy-dom integration test mounts the real `StockPage` while mocking Tauri IPC, Tauri event registration, the settings adapter, drag behavior, and heavy child components. Production changes replace two direct Tauri listeners with `useTauriEvent` and the settings listener with `useAsyncSubscription`; initial IPC reads remain behaviorally unchanged.

**Tech Stack:** React 19, TypeScript 5.8, Tauri 2 API, Vitest 4, happy-dom, existing `mountReactTree` helper.

## Global Constraints

- Modify only `src/components/pages/stock/StockPage.tsx`, add its integration test, and update REF-10B-01 documentation.
- Do not modify `StockRow`, `StockDetail`, `StockAdd`, `StockChart`, drag/reorder behavior, or other pages.
- Do not address late completion of initial `stock_get`, compact-symbol, or `stock:red_up` reads.
- Do not mock `useAsyncSubscription` or `useTauriEvent`.
- Preserve current untracked shared-hook files exactly except for confirmed review fixes.
- Do not stage or commit unrelated concurrent work.
- Use an independent `CARGO_TARGET_DIR` for unified verification.
- Automated evidence is not GUI, installation-state, or real-device evidence.

## File Structure

- Create `src/components/pages/stock/__tests__/StockPage.test.tsx`: controlled integration and lifecycle regressions.
- Modify `src/components/pages/stock/StockPage.tsx`: replace exactly three subscriptions.
- Update `docs/superpowers/specs/2026-07-15-ref-10b-01-stock-listener-migration-design.md`, `vault/CURRENT.md`, and `vault/10b-工程基线与低风险重构.md` after verification.

---

### Task 1: Write StockPage RED Integration Tests

**Files:**
- Create: `src/components/pages/stock/__tests__/StockPage.test.tsx`
- Read: `src/components/pages/stock/StockPage.tsx`

**Interfaces:**
- Captures direct Tauri listeners as `{ name, callback, pending }`.
- Captures the settings adapter as `{ callback, pending }`.
- Supplies deterministic `stock_get`, compact-symbol, and setting reads.

- [ ] **Step 1: Build the test harness**

Create a happy-dom test that:

```tsx
// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type { Quote } from "../StockRow";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const { listeners, settingsSubscriptions, invokes, deferred } = vi.hoisted(() => {
  function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  }
  return {
    listeners: [] as Array<{ name: string; callback: (event: Event<unknown>) => void; pending: Deferred<() => void> }>,
    settingsSubscriptions: [] as Array<{ callback: (key: string, value: string | null) => void; pending: Deferred<() => void> }>,
    invokes: [] as Array<{ command: string; args: unknown }>,
    deferred: createDeferred,
  };
});
```

Mock `@tauri-apps/api/event.listen`, `@tauri-apps/api/core.invoke`, and `@/lib/settings.onSettingsChanged`. Use real `StockRow`; mock `StockAdd`, `StockDetail`, and `useReorder` only to remove unrelated behavior. Provide a complete positive-change `Quote` fixture.

- [ ] **Step 2: Add behavior and lifecycle tests**

Tests must assert:

```ts
it("registers tick, import, and settings subscriptions once");
it("updates quotes from stock ticks without rebuilding listeners");
it("refreshes after config import and clears an open detail view");
it("applies the latest stock red-up setting to quote colors");
it("immediately disposes all subscriptions that resolve after unmount");
it("cleans every StrictMode subscription exactly once");
it("diagnoses Tauri and settings subscription rejection with scoped labels");
```

Use `act()` around captured callbacks. For import refresh, return different quote arrays from successive `stock_get` calls and assert the second name appears. For color direction, assert a positive quote changes between `text-red-500` and `text-green-500` after `stock:red_up` changes.

- [ ] **Step 3: Verify RED**

Run:

```bash
pnpm exec vitest run src/components/pages/stock/__tests__/StockPage.test.tsx
```

Expected: old code fails late-resolve cleanup, StrictMode exact counts, rejection diagnostics, and listener stability assertions. Fix harness errors only until failures are behavioral.

---

### Task 2: Migrate Exactly Three StockPage Subscriptions

**Files:**
- Modify: `src/components/pages/stock/StockPage.tsx`
- Test: `src/components/pages/stock/__tests__/StockPage.test.tsx`

**Interfaces:**
- Consume existing `useTauriEvent<T>(eventName, handler, options?)`.
- Consume existing `useAsyncSubscription(subscribe, deps, options)`.

- [ ] **Step 1: Re-read StockPage and concurrent diff**

```bash
git diff -- src/components/pages/stock/StockPage.tsx
```

Expected: no unrelated Stock hunk. If one appears, preserve it with exact edits.

- [ ] **Step 2: Replace imports**

Remove the direct Tauri `listen` import. Add:

```ts
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";
import { useTauriEvent } from "@/lib/useTauriEvent";
```

- [ ] **Step 3: Keep initial reads in their effect**

The initial effect becomes:

```ts
useEffect(() => {
  void refresh();
  void invoke<string | null>("setting_get", { key: COMPACT_KEY }).then((symbol) => {
    if (symbol) setCompactSymbol(symbol);
  });
}, [refresh]);
```

Do not add mounted flags or request cancellation.

- [ ] **Step 4: Add stable Tauri event hooks**

```ts
useTauriEvent<Quote[]>("stock://tick", (event) => {
  setQuotes(event.payload);
});

useTauriEvent("config://imported", () => {
  setSelected(null);
  void refresh();
});
```

- [ ] **Step 5: Replace settings cleanup with the shared primitive**

Keep the initial `settingGet(KEYS.stockRedUp)` effect or call unchanged, and add:

```ts
useAsyncSubscription(
  () => onSettingsChanged((key, value) => {
    if (key === KEYS.stockRedUp) setRedUp(parseBool(value, true));
  }),
  [],
  { label: "settings://changed:stock" },
);
```

- [ ] **Step 6: Verify GREEN**

```bash
pnpm exec vitest run \
  src/components/pages/stock/__tests__/StockPage.test.tsx \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx
pnpm typecheck
```

Expected: all focused tests pass; TypeScript exits 0.

- [ ] **Step 7: Check scope**

```bash
git diff -- src/components/pages/stock/StockPage.tsx
git diff --name-only
```

Expected: only StockPage implementation, Stock test, existing shared-hook work, and audit documents are relevant to this batch. No child Stock component or other page is modified.

---

### Task 3: Independent Review, Unified Verification, Records, and Commit Gate

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-ref-10b-01-stock-listener-migration-design.md`
- Modify: `vault/CURRENT.md`
- Modify: `vault/10b-工程基线与低风险重构.md`
- Create: `docs/superpowers/plans/2026-07-15-ref-10b-01-stock-listener-migration.md`

- [ ] **Step 1: Run one independent read-only review**

Scope one review Agent to StockPage, its new test, and the two shared hooks. Require checks for behavior preservation, event stability, cleanup timing, rejection handling, and test observability. Fix confirmed findings only through RED/GREEN.

- [ ] **Step 2: Run unified verification**

```bash
pnpm test:frontend
pnpm build:frontend
PATH="/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH" \
CARGO_TARGET_DIR="E:/Code/Tauri/LuckyIsland/.superpowers/target-check" \
pnpm verify
```

Expected: all exit 0. Record exact test counts and existing build warnings.

- [ ] **Step 3: Update audit records**

Record migrated subscriptions, RED/GREEN evidence, review result, exact unified-gate counts, deferred initial-Promise behavior, untouched modules, and lack of GUI/installation/real-device evidence.

- [ ] **Step 4: Check exact change boundary**

```bash
git diff --check -- \
  src/components/pages/stock/StockPage.tsx \
  src/components/pages/stock/__tests__/StockPage.test.tsx \
  docs/superpowers/specs/2026-07-15-ref-10b-01-stock-listener-migration-design.md \
  docs/superpowers/plans/2026-07-15-ref-10b-01-stock-listener-migration.md \
  vault/CURRENT.md vault/10b-工程基线与低风险重构.md
```

- [ ] **Step 5: Request commit authorization if not already granted for this batch**

Do not infer App-batch commit authorization applies to Stock. If authorized, stage only the six Stock-batch paths above. Shared-hook files must be committed separately or explicitly included only with user authorization because they predate this batch and are already required by the committed App migration. Never stage unrelated work.

## Plan Self-Review

- Spec coverage: all three subscriptions, tick/import/settings behavior, lifecycle timings, StrictMode, errors, initial-read exclusion, review, unified verification, and scope protection are explicit.
- Placeholder scan: no unspecified implementation step remains.
- Type consistency: uses the existing exported hook signatures and existing `Quote` type.
- Scope: one independently testable StockPage migration; NotifyPage, Weather, and Terminal remain deferred.
