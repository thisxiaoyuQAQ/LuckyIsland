# REF-10B-01 NotifyPage Listener Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate only NotifyPage's incoming-notification and source-filter settings subscriptions to the verified shared lifecycle hooks with observable React lifecycle regressions.

**Architecture:** Extend the existing happy-dom `NotifyPage` integration test with controlled deferred Tauri/settings subscriptions while continuing to mount the real page and use the real shared hooks. Production changes split initial history/settings reads from subscription effects, replace direct `listen` with `useTauriEvent`, and replace the settings cleanup with `useAsyncSubscription` without changing history-loader or filtering order.

**Tech Stack:** React 19, TypeScript 5.8, Tauri 2 API, Vitest 4, happy-dom, existing `mountReactTree` helper.

## Global Constraints

- Modify only `src/components/pages/notify/NotifyPage.tsx`, its existing integration test, and REF-10B-01 NotifyPage documentation.
- Preserve `NotifyCard`, animation, pagination, mark-read, clear confirmation/error, and compact rendering behavior.
- Preserve module-scope `historyLoader`, request deduplication, and the existing `prepend`-before-filter ordering.
- Do not address late completion of initial `historyLoader.load()` or `settingGet(KEYS.notifyFilterSources)`.
- Do not mock `useAsyncSubscription` or `useTauriEvent`.
- Do not migrate App, Weather, Terminal, settings-window, AI, or any other listener.
- Do not develop module 11 or plugin phase 1.
- Do not modify, format, stage, or clean unrelated concurrent work, including `src-tauri/src/settings_window.rs`.
- Use at most one independent read-only review Agent.
- Use an independent `CARGO_TARGET_DIR` for unified verification.
- Automated evidence is not GUI, installation-state, or real-device evidence.
- Commit is a separate user gate; do not infer authorization from earlier batches.

## File Structure

- Modify `src/components/pages/notify/__tests__/NotifyPage.test.tsx`: retain history-management coverage and add controlled listener behavior/lifecycle regressions.
- Modify `src/components/pages/notify/NotifyPage.tsx`: replace exactly two subscriptions while preserving initial reads and data-flow order.
- Update `docs/superpowers/specs/2026-07-15-ref-10b-01-notifypage-listener-migration-design.md`, `vault/CURRENT.md`, and `vault/10b-工程基线与低风险重构.md` after verification.
- Create this plan at `docs/superpowers/plans/2026-07-15-ref-10b-01-notifypage-listener-migration.md`.

---

### Task 1: Add NotifyPage RED Subscription Regressions

**Files:**
- Modify: `src/components/pages/notify/__tests__/NotifyPage.test.tsx`
- Read: `src/components/pages/notify/NotifyPage.tsx`
- Read: `src/lib/notification-history.ts`

**Interfaces:**
- Captures Tauri listeners as `{ name, callback, pending }`.
- Captures settings subscriptions as `{ callback, pending }`.
- Uses complete `NotificationItem` values with unique ids.
- Continues to use real `NotifyPage`, `useAsyncSubscription`, and `useTauriEvent`.

- [ ] **Step 1: Re-read current tests and verify no concurrent NotifyPage diff**

Run:

```bash
git diff -- src/components/pages/notify/NotifyPage.tsx \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx
```

Expected: no existing hunks. If a hunk appears, stop and preserve it through exact edits; do not overwrite it.

- [ ] **Step 2: Replace immediate subscription mocks with controlled deferred records**

Add the event type import and deferred interfaces:

```tsx
import { StrictMode, act } from "react";
import type { Event } from "@tauri-apps/api/event";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface EventSubscription {
  name: string;
  callback: (event: Event<unknown>) => void;
  pending: Deferred<() => void>;
}

interface SettingsSubscription {
  callback: (key: string, value: string | null) => void;
  pending: Deferred<() => void>;
}
```

Replace the hoisted state with records that include the existing mocks:

```tsx
const {
  invokeMock,
  confirmMock,
  eventSubscriptions,
  settingsSubscriptions,
  settingGetMock,
  deferred,
} = vi.hoisted(() => {
  function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  }

  return {
    invokeMock: vi.fn(),
    confirmMock: vi.fn(),
    eventSubscriptions: [] as EventSubscription[],
    settingsSubscriptions: [] as SettingsSubscription[],
    settingGetMock: vi.fn(),
    deferred: createDeferred,
  };
});
```

Use these controlled mocks:

```tsx
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: Event<unknown>) => void) => {
    const pending = deferred<() => void>();
    eventSubscriptions.push({ name, callback, pending });
    return pending.promise;
  }),
}));

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    settingGet: settingGetMock,
    onSettingsChanged: vi.fn((callback: (key: string, value: string | null) => void) => {
      const pending = deferred<() => void>();
      settingsSubscriptions.push({ callback, pending });
      return pending.promise;
    }),
  };
});
```

Do not mock `parseFilterSources`; use the real parser so source-filter assertions exercise production behavior.

- [ ] **Step 3: Make test setup deterministic without adding a production reset API**

Keep the existing complete item shape and make ids unique per test. In `beforeEach`, clear subscription records and reset mocks:

```tsx
beforeEach(() => {
  eventSubscriptions.length = 0;
  settingsSubscriptions.length = 0;
  invokeMock.mockReset();
  confirmMock.mockReset();
  settingGetMock.mockReset();
  settingGetMock.mockResolvedValue("claude,codex,custom");
});
```

Because `historyLoader` is module-scoped, each behavior test must use ids/names not used by another test and must assert for its own values rather than assume an empty global cache. Do not export or mutate the loader directly.

Add helpers:

```tsx
function subscription(name: string): EventSubscription {
  const found = eventSubscriptions.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing subscription: ${name}`);
  return found;
}

async function dispatch(callback: () => void): Promise<void> {
  await act(async () => {
    callback();
    await Promise.resolve();
  });
}

function emitIncoming(payload: ReturnType<typeof item>): void {
  subscription("notify://incoming").callback({
    event: "notify://incoming",
    id: 1,
    payload,
  });
}

function allSubscriptions(): Array<EventSubscription | SettingsSubscription> {
  return [...eventSubscriptions, ...settingsSubscriptions];
}
```

- [ ] **Step 4: Add observable registration, filtering, and stability tests**

Add tests with unique ids, for example `incoming-visible`, `incoming-filtered`, and `incoming-after-filter`:

```tsx
it("registers incoming and settings subscriptions once", async () => {
  invokeMock.mockResolvedValue([]);
  const tree = await mountReactTree(<NotifyPage compact />);

  expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(1);
  expect(settingsSubscriptions).toHaveLength(1);
  await tree.unmount();
});

it("uses the latest source filter without rebuilding subscriptions", async () => {
  invokeMock.mockResolvedValue([]);
  const tree = await mountReactTree(<NotifyPage compact={false} />);
  await flushReactWork();

  const filtered = { ...item(9_001), id: "incoming-filtered", title: "过滤缓存通知", source: "codex" };
  const visible = { ...item(9_002), id: "incoming-after-filter", title: "过滤后可见通知", source: "custom" };

  await dispatch(() => settingsSubscriptions[0].callback("notify:filter_sources", "custom"));
  await dispatch(() => emitIncoming(filtered));
  expect(document.body.textContent).not.toContain(filtered.title);

  await dispatch(() => emitIncoming(visible));
  expect(document.body.textContent).toContain(visible.title);
  expect(document.body.textContent).toContain(filtered.title);
  expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(1);
  expect(settingsSubscriptions).toHaveLength(1);
  await tree.unmount();
});
```

The second assertion that the filtered item becomes visible after a later accepted event protects the existing `historyLoader.prepend()` before filter-check ordering.

Also assert initial reads do not repeat after callbacks:

```tsx
expect(invokeMock.mock.calls.filter(([command]) => command === "notify_list")).toHaveLength(1);
expect(settingGetMock).toHaveBeenCalledTimes(1);
```

- [ ] **Step 5: Add late-resolve, StrictMode, and rejection tests**

```tsx
it("immediately disposes subscriptions that resolve after unmount", async () => {
  invokeMock.mockResolvedValue([]);
  const tree = await mountReactTree(<NotifyPage compact />);
  const subscriptions = allSubscriptions();
  const disposers = subscriptions.map(() => vi.fn());

  await tree.unmount();
  subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
  await flushReactWork();

  expect(subscriptions).toHaveLength(2);
  for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
});

it("cleans every StrictMode subscription exactly once", async () => {
  invokeMock.mockResolvedValue([]);
  const tree = await mountReactTree(
    <StrictMode>
      <NotifyPage compact />
    </StrictMode>,
  );
  const subscriptions = allSubscriptions();
  const disposers = subscriptions.map(() => vi.fn());

  subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
  await flushReactWork();
  await tree.unmount();

  expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(2);
  expect(settingsSubscriptions).toHaveLength(2);
  for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
});

it("diagnoses incoming and settings subscription rejection with scoped labels", async () => {
  invokeMock.mockResolvedValue([]);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const tree = await mountReactTree(<NotifyPage compact />);

  subscription("notify://incoming").pending.reject(new Error("incoming rejected"));
  settingsSubscriptions[0].pending.reject(new Error("settings rejected"));
  await flushReactWork();

  expect(error).toHaveBeenCalledWith(
    "[async-subscription] listen:notify://incoming",
    expect.objectContaining({ message: "incoming rejected" }),
  );
  expect(error).toHaveBeenCalledWith(
    "[async-subscription] settings://changed:notify",
    expect.objectContaining({ message: "settings rejected" }),
  );
  await tree.unmount();
});
```

Keep the existing pagination and clear-history tests unchanged except for deterministic setup required by the controlled mocks.

- [ ] **Step 6: Verify behavioral RED**

Run:

```bash
pnpm exec vitest run src/components/pages/notify/__tests__/NotifyPage.test.tsx
```

Expected: existing history tests and ordinary behavior tests pass, while old production code fails late-resolve cleanup, StrictMode exact cleanup, and scoped rejection diagnostics. Unhandled subscription rejections are expected evidence only in RED. Fix harness/type errors until remaining failures are caused by the old manual lifecycle code; do not edit production code before observing this RED.

---

### Task 2: Migrate Exactly Two NotifyPage Subscriptions

**Files:**
- Modify: `src/components/pages/notify/NotifyPage.tsx`
- Test: `src/components/pages/notify/__tests__/NotifyPage.test.tsx`

**Interfaces:**
- Consumes `useTauriEvent<T>(eventName, handler, options?)` from `@/lib/useTauriEvent`.
- Consumes `useAsyncSubscription(subscribe, deps, options)` from `@/lib/useAsyncSubscription`.
- Preserves `createNotificationHistoryLoader` and `NotificationItem` behavior exactly.

- [ ] **Step 1: Re-read concurrent diff immediately before editing**

Run:

```bash
git diff -- src/components/pages/notify/NotifyPage.tsx
```

Expected: no unrelated hunk. If one appears, stop and preserve it through exact edits.

- [ ] **Step 2: Replace imports only**

Remove:

```ts
import { listen } from "@tauri-apps/api/event";
```

Add:

```ts
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";
import { useTauriEvent } from "@/lib/useTauriEvent";
```

Do not change other imports or reorder unrelated code.

- [ ] **Step 3: Split initial settings read from its subscription**

Replace the existing combined effect with:

```ts
// 来源过滤：读 settings + 监听即时生效（listener 用 ref 避免闭包过期）
useEffect(() => {
  void settingGet(KEYS.notifyFilterSources).then((value) => {
    filterRef.current = parseFilterSources(value);
  });
}, []);

useAsyncSubscription(
  () =>
    onSettingsChanged((key, value) => {
      if (key === KEYS.notifyFilterSources) {
        filterRef.current = parseFilterSources(value);
      }
    }),
  [],
  { label: "settings://changed:notify" },
);
```

Do not add mounted flags or alter `filterRef`.

- [ ] **Step 4: Split initial history load from incoming subscription**

Replace the existing combined history/listener effect with:

```ts
useEffect(() => {
  void historyLoader.load().then(setItems);
}, []);

useTauriEvent<NotificationItem>("notify://incoming", (event) => {
  const next = historyLoader.prepend(event.payload);
  if (!filterRef.current[event.payload.source as NotifySource]) return; // 被过滤来源不弹卡片
  setItems(next);
});
```

The `prepend` call must remain before the filter check. Do not change loader construction, payload source casting, or state update semantics.

- [ ] **Step 5: Verify GREEN and existing behavior**

Run:

```bash
pnpm exec vitest run \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx
pnpm typecheck
```

Expected: all focused tests pass and TypeScript exits 0. No unhandled rejection should remain.

- [ ] **Step 6: Check exact production scope**

Run:

```bash
git diff -- src/components/pages/notify/NotifyPage.tsx
git status --short -- \
  src/components/pages/notify \
  src/lib/useAsyncSubscription.ts \
  src/lib/useTauriEvent.ts
```

Expected: only NotifyPage and its test are new for this batch; shared hooks are pre-existing REF-10B-01 work. No `NotifyCard`, Weather, Terminal, App, settings-window, or AI change belongs to this task.

---

### Task 3: Independent Review and Verification

**Files:**
- Review: `src/components/pages/notify/NotifyPage.tsx`
- Review: `src/components/pages/notify/__tests__/NotifyPage.test.tsx`
- Review: `src/lib/useAsyncSubscription.ts`
- Review: `src/lib/useTauriEvent.ts`

**Interfaces:**
- Review consumes the completed implementation and tests without modifying files.
- Verification produces exact test counts, warnings, and any range-external blockers for audit records.

- [ ] **Step 1: Run one independent read-only review**

Scope one review Agent to the four files above. Require checks for:

- initial read behavior preservation;
- `historyLoader.prepend()` before filter check;
- source filtering uses the latest ref value;
- stable subscription registration;
- cleanup before and after async resolve;
- StrictMode exact cleanup;
- scoped rejection diagnostics;
- tests assert rendered behavior and cache/filter order rather than merely mock calls.

Fix only confirmed findings through a new RED/GREEN cycle. Do not dispatch additional reviewers unless this single reviewer identifies an ambiguity that cannot be resolved from the code.

- [ ] **Step 2: Run complete frontend gates**

```bash
pnpm test:frontend
pnpm build:frontend
```

Expected: all frontend tests and all three Vite entries pass. Record exact file/test counts and existing chunk-size warnings.

- [ ] **Step 3: Run unified verification with isolated Cargo output**

```bash
PATH="/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH" \
CARGO_TARGET_DIR="E:/Code/Tauri/LuckyIsland/.superpowers/target-check" \
pnpm verify
```

Expected when the whole working tree is settled: exit 0 for TypeScript, frontend tests/build, Rust fmt, strict Clippy, Rust lib tests, and cargo check.

If verification is blocked by unrelated concurrent work, do not modify it. Record:

1. the exact failing gate and file;
2. all earlier gates that passed in the same run;
3. any remaining gates run independently afterward;
4. the latest prior complete-success evidence;
5. that the blocker is not fixed or claimed by this batch.

The currently known range-external candidate is `src-tauri/src/settings_window.rs` rustfmt; re-check rather than assuming it remains.

- [ ] **Step 4: Re-run focused evidence after any concurrent workspace change**

```bash
pnpm exec vitest run \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx
git diff --check -- \
  src/components/pages/notify/NotifyPage.tsx \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx
```

Expected: focused tests pass and boundary check exits 0.

---

### Task 4: Update Audit Records and Enforce Commit Gate

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-ref-10b-01-notifypage-listener-migration-design.md`
- Create: `docs/superpowers/plans/2026-07-15-ref-10b-01-notifypage-listener-migration.md`
- Modify: `vault/CURRENT.md`
- Modify: `vault/10b-工程基线与低风险重构.md`

**Interfaces:**
- Consumes RED/GREEN, independent review, full verification, and boundary evidence from Tasks 1–3.
- Produces the authoritative next-action record without authorizing another migration.

- [ ] **Step 1: Update the design implementation record**

Change the design status to implemented only if focused GREEN passes. Add exact bullets for:

- old-code RED test count and failing behaviors;
- focused GREEN file/test count;
- the two migrated subscription labels;
- independent review findings and fixes, if any;
- complete frontend and unified-gate counts;
- any range-external verification blocker;
- deferred initial history/settings Promise behavior;
- untouched modules and lack of GUI/install/real-device evidence.

Do not write “all gates pass” if the latest full command is blocked; distinguish prior successful evidence from current partial evidence.

- [ ] **Step 2: Update `vault/CURRENT.md`**

Record NotifyPage as completed only after focused GREEN and review. Set the unique next action to a separate read-only Weather listener evaluation; do not authorize Weather implementation in this batch.

Keep these boundaries explicit:

```markdown
- 初始 history/settings Promise 晚到行为未处理；
- historyLoader 缓存与 prepend-before-filter 语义未改变；
- 未迁移 Weather、Terminal、设置窗口或 AI listener；
- 未做 GUI、安装态或真机 Tauri 验证。
```

- [ ] **Step 3: Update the 10b execution record**

Append a NotifyPage-batch entry under REF-10B-01 with the same exact evidence. Preserve all earlier shared-hook, App, Stock, and concurrent-work records.

- [ ] **Step 4: Check the exact six-path boundary**

```bash
git diff --check -- \
  src/components/pages/notify/NotifyPage.tsx \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx \
  docs/superpowers/specs/2026-07-15-ref-10b-01-notifypage-listener-migration-design.md \
  docs/superpowers/plans/2026-07-15-ref-10b-01-notifypage-listener-migration.md \
  vault/CURRENT.md \
  'vault/10b-工程基线与低风险重构.md'

git status --short
```

Expected: six-path boundary check exits 0. The global status may contain unrelated concurrent work; list it as protected, not as part of NotifyPage.

- [ ] **Step 5: Request separate commit authorization**

Do not stage or commit automatically. If the user authorizes this batch, stage only the six NotifyPage-batch paths above. Shared-hook files predate this batch and may be included only under explicit authorization that names them. Never stage App, Stock, Weather, Terminal, module 11, plugin work, update work, or `src-tauri/src/settings_window.rs` by implication.

## Plan Self-Review

- Spec coverage: both subscriptions, filtering/cache order, initial-read exclusion, behavior regressions, lifecycle timings, StrictMode, errors, independent review, unified verification, records, and commit gate are mapped to tasks.
- Placeholder scan: no `TBD`, `TODO`, “similar to,” unspecified error handling, or deferred implementation instruction remains.
- Type consistency: event/settings subscription records, `NotificationItem`, hook signatures, settings key, and diagnostic labels match existing exports.
- Scope: one independently testable NotifyPage migration; Weather and Terminal remain separately gated.
