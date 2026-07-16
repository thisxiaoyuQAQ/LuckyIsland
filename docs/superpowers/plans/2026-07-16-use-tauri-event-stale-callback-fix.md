# useTauriEvent Stale Callback Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a Tauri event callback from reaching React business logic after its owning subscription effect has been cleaned up, including the pending-`listen()` and StrictMode generation windows.

**Architecture:** Give each `useAsyncSubscription` effect generation a synchronous `isActive(): boolean` capability that becomes false at cleanup. `useTauriEvent` captures that generation-specific capability and checks it before forwarding a native event to the latest committed handler ref. Keep disposer timing, rejection diagnostics, dependency replacement, and the migrated `SettingsApp` call site unchanged.

**Tech Stack:** React 19 hooks, TypeScript 5.8, Tauri 2 event API, Vitest 4, happy-dom, pnpm 10.

## Global Constraints

- Work only in `src/lib/useAsyncSubscription.ts`, `src/lib/useTauriEvent.ts`, `src/lib/__tests__/useAsyncSubscription.test.tsx`, `src/lib/__tests__/useTauriEvent.test.tsx`, and `src/settings/__tests__/SettingsApp.test.tsx` until implementation verification is complete.
- Do not change the migrated shape of `src/settings/SettingsApp.tsx`.
- Do not touch, stage, clean, revert, or commit unrelated working-tree changes.
- Do not commit this batch unless the user separately authorizes it.
- Preserve current late disposer cleanup, latest-handler behavior, scoped error reporting, and dependency replacement semantics.
- Use an independent Cargo target for `pnpm verify`; do not contend with the default Tauri development target.
- After implementation verification, update only the existing module 10 progress documents needed to record this batch and the next read-only design decision.
- The GeneralPanel follow-up is read-only design only; do not migrate either listener in this plan.

## File Structure

- `src/lib/useAsyncSubscription.ts`: owns generation lifetime, disposer cleanup, and error reporting; exposes generation activity only to the subscription factory.
- `src/lib/useTauriEvent.ts`: adapts the generation activity capability into a guard around native event forwarding.
- `src/lib/__tests__/useAsyncSubscription.test.tsx`: proves the activity capability is generation-specific and flips synchronously at cleanup.
- `src/lib/__tests__/useTauriEvent.test.tsx`: proves stale native callbacks do not reach business handlers after unmount or StrictMode replacement.
- `src/settings/__tests__/SettingsApp.test.tsx`: proves a stale `settings://navigate` callback cannot navigate or initiate an update check.
- `vault/10b-工程基线与低风险重构.md`, `vault/CURRENT.md`, `docs/开发进度.md`: record verified evidence and identify GeneralPanel as the next read-only candidate.

---

### Task 1: Add RED Coverage for Generation Activity

**Files:**
- Modify: `src/lib/__tests__/useAsyncSubscription.test.tsx`

**Interfaces:**
- Consumes current `useAsyncSubscription(subscribe, deps, options)`.
- Defines the expected new subscription-factory signature: `subscribe(isActive: () => boolean): Promise<Dispose>`.
- Produces tests proving cleanup invalidates only the effect generation that created the callback.

- [ ] **Step 1: Update the test probe to accept the generation capability**

Change its `subscribe` prop and call shape to:

```tsx
function SubscriptionProbe({
  identity = "first",
  subscribe,
  onError,
}: {
  identity?: string;
  subscribe: (isActive: () => boolean) => Promise<() => void>;
  onError: (error: unknown) => void;
}) {
  useAsyncSubscription(subscribe, [identity], { label: `probe:${identity}`, onError });
  return null;
}
```

Existing zero-argument callbacks remain structurally assignable in TypeScript and do not need behavior changes.

- [ ] **Step 2: Add an unmount activity test**

Add:

```tsx
it("marks the subscription generation inactive immediately on unmount", async () => {
  let isActive!: () => boolean;
  const subscription = deferred<() => void>();
  const tree = await mountReactTree(
    <SubscriptionProbe
      subscribe={(active) => {
        isActive = active;
        return subscription.promise;
      }}
      onError={vi.fn()}
    />,
  );

  expect(isActive()).toBe(true);
  await tree.unmount();
  expect(isActive()).toBe(false);

  subscription.resolve(vi.fn());
  await flushReactWork();
});
```

- [ ] **Step 3: Add a StrictMode generation-isolation test**

Add:

```tsx
it("keeps a cleaned StrictMode generation inactive after the next setup", async () => {
  const generations: Array<() => boolean> = [];
  const subscriptions: Array<Deferred<() => void>> = [];
  const tree = await mountReactTree(
    <StrictMode>
      <SubscriptionProbe
        subscribe={(isActive) => {
          generations.push(isActive);
          const subscription = deferred<() => void>();
          subscriptions.push(subscription);
          return subscription.promise;
        }}
        onError={vi.fn()}
      />
    </StrictMode>,
  );

  expect(generations).toHaveLength(2);
  expect(generations[0]()).toBe(false);
  expect(generations[1]()).toBe(true);

  subscriptions.forEach((subscription) => subscription.resolve(vi.fn()));
  await flushReactWork();
  await tree.unmount();
  expect(generations[1]()).toBe(false);
});
```

- [ ] **Step 4: Run the shared subscription test and verify RED**

Run:

```bash
pnpm vitest run src/lib/__tests__/useAsyncSubscription.test.tsx
```

Expected: TypeScript/runtime failure because `useAsyncSubscription` does not yet pass `isActive` to the factory, or `isActive` remains undefined.

---

### Task 2: Add RED Coverage for Tauri Event Forwarding

**Files:**
- Modify: `src/lib/__tests__/useTauriEvent.test.tsx`
- Modify: `src/settings/__tests__/SettingsApp.test.tsx`

**Interfaces:**
- Consumes mocked `listen(eventName, callback)` records already present in both files.
- Produces business-level assertions that stale callbacks are ignored even before the pending `listen()` promise yields its disposer.

- [ ] **Step 1: Add the plain-unmount hook test**

Add to `useTauriEvent.test.tsx`:

```tsx
it("ignores a pending listener callback after unmount", async () => {
  const onValue = vi.fn();
  const tree = await mountReactTree(
    <EventProbe prefix="value" onValue={onValue} />,
  );
  const stale = listenCalls[0];

  await tree.unmount();
  stale.handler(event("late"));

  expect(onValue).not.toHaveBeenCalled();
  stale.subscription.resolve(vi.fn());
  await flushReactWork();
});
```

- [ ] **Step 2: Add the StrictMode stale-generation hook test**

Add:

```tsx
it("never reactivates the first StrictMode listener generation", async () => {
  const onValue = vi.fn();
  const tree = await mountReactTree(
    <StrictMode>
      <EventProbe prefix="value" onValue={onValue} />
    </StrictMode>,
  );

  expect(listenCalls).toHaveLength(2);
  listenCalls[0].handler(event("stale"));
  listenCalls[1].handler(event("current"));

  expect(onValue).toHaveBeenCalledTimes(1);
  expect(onValue).toHaveBeenCalledWith("value:current");

  listenCalls.forEach((call) => call.subscription.resolve(vi.fn()));
  await flushReactWork();
  await tree.unmount();
});
```

- [ ] **Step 3: Add the SettingsApp stale-side-effect test**

Add to `SettingsApp.test.tsx`:

```tsx
it("ignores a pending navigation callback after unmount", async () => {
  const tree = await mountReactTree(<SettingsApp />);
  const stale = navigationSubscription();

  await tree.unmount();
  stale.callback({
    event: "settings://navigate",
    id: 1,
    payload: "about",
  });

  expect(getUpdateSnapshot).not.toHaveBeenCalled();
  expect(checkForUpdate).not.toHaveBeenCalled();

  stale.pending.resolve(vi.fn());
  await flushReactWork();
});
```

- [ ] **Step 4: Add a SettingsApp StrictMode duplicate-side-effect test**

Add:

```tsx
it("ignores the cleaned StrictMode navigation generation", async () => {
  const tree = await mountReactTree(
    <StrictMode>
      <SettingsApp />
    </StrictMode>,
  );
  const subscriptions = listeners.filter(
    (entry) => entry.name === "settings://navigate",
  );

  expect(subscriptions).toHaveLength(2);
  subscriptions[0].callback({ event: "settings://navigate", id: 1, payload: "about" });
  subscriptions[1].callback({ event: "settings://navigate", id: 2, payload: "about" });

  expect(getUpdateSnapshot).toHaveBeenCalledTimes(1);
  expect(checkForUpdate).toHaveBeenCalledTimes(1);
  expect(checkForUpdate).toHaveBeenCalledWith("manual");

  subscriptions.forEach((entry) => entry.pending.resolve(vi.fn()));
  await flushReactWork();
  await tree.unmount();
});
```

- [ ] **Step 5: Run the scoped tests and verify RED**

Run:

```bash
pnpm vitest run \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx \
  src/settings/__tests__/SettingsApp.test.tsx
```

Expected: new stale-callback tests fail because the existing wrapper always calls `handlerRef.current(incoming)`.

---

### Task 3: Implement the Minimal Shared Fix

**Files:**
- Modify: `src/lib/useAsyncSubscription.ts`
- Modify: `src/lib/useTauriEvent.ts`

**Interfaces:**
- Produces `export type IsSubscriptionActive = () => boolean`.
- Changes `useAsyncSubscription` factory input from `() => Promise<Dispose>` to `(isActive: IsSubscriptionActive) => Promise<Dispose>`.
- Keeps the hook's return type `void` and all current consumers source-compatible when they ignore the argument.

- [ ] **Step 1: Add the generation activity type and pass it to the factory**

Change the relevant parts of `useAsyncSubscription.ts` to:

```ts
export type Dispose = () => void;
export type IsSubscriptionActive = () => boolean;

export function useAsyncSubscription(
  subscribe: (isActive: IsSubscriptionActive) => Promise<Dispose>,
  deps: DependencyList,
  options: AsyncSubscriptionOptions,
): void {
```

Inside the effect, invoke the current factory with a closure over that effect's `disposed` variable:

```ts
const isActive: IsSubscriptionActive = () => !disposed;

try {
  void subscribeRef.current(isActive).then(
```

Do not use a component-wide ref for activity: a later StrictMode setup must not reactivate an older generation.

- [ ] **Step 2: Guard Tauri callback forwarding**

Change the subscription factory in `useTauriEvent.ts` to:

```ts
useAsyncSubscription(
  (isActive) => {
    if (!enabled) return Promise.resolve(() => undefined);
    return listen<T>(eventName, (incoming) => {
      if (isActive()) handlerRef.current(incoming);
    });
  },
  [eventName, enabled],
  { label: `listen:${eventName}`, onError: options.onError },
);
```

Do not add a guard in `SettingsApp`; the shared adapter owns this invariant.

- [ ] **Step 3: Run the three-file focused suite and verify GREEN**

Run:

```bash
pnpm vitest run \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx \
  src/settings/__tests__/SettingsApp.test.tsx
```

Expected: all tests pass; the count is the previous 31 plus the newly added cases.

- [ ] **Step 4: Run TypeScript validation**

Run:

```bash
pnpm typecheck
```

Expected: exit 0. Existing subscription factories across App, Stock, Notify, Weather, Terminal, and tests remain valid when they ignore the added parameter.

- [ ] **Step 5: Check only the scoped diff**

Run:

```bash
git diff --check -- \
  src/lib/useAsyncSubscription.ts \
  src/lib/useTauriEvent.ts \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx \
  src/settings/SettingsApp.tsx \
  src/settings/__tests__/SettingsApp.test.tsx
```

Expected: no whitespace errors and no unintended change to `SettingsApp.tsx` beyond its already reviewed migration.

---

### Task 4: Verify and Independently Review the Fix

**Files:**
- Read only during review: the five implementation/test files plus `src/settings/SettingsApp.tsx`.

**Interfaces:**
- Produces verification evidence for the progress documents.
- Produces an independent review verdict before the batch is described as complete.

- [ ] **Step 1: Run the listener regression group**

Run the previously used listener-related test set, including at minimum:

```bash
pnpm vitest run \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx \
  src/settings/__tests__/SettingsApp.test.tsx \
  src/components/pages/stock/__tests__/StockPage.test.tsx \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx \
  src/components/pages/weather/__tests__/WeatherPage.test.tsx
```

If a listed historical path differs in the current tree, use the actual existing test path found by file glob; do not create a duplicate test file.

Expected: all selected tests pass.

- [ ] **Step 2: Run full verification with an independent Cargo target**

Run:

```bash
CARGO_TARGET_DIR="E:/Code/Tauri/LuckyIsland/.superpowers/target-check" \
  PATH="/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH" \
  pnpm verify
```

Expected: TypeScript, full Vitest, frontend build, Rust formatting, strict Clippy, Rust library tests, and cargo check all exit 0. Record exact file/test totals and any pre-existing build warning.

- [ ] **Step 3: Run one independent read-only review**

Give the reviewer only:

- the scoped diff;
- `useAsyncSubscription.ts` and its tests;
- `useTauriEvent.ts` and its tests;
- `SettingsApp.tsx` and its tests;
- the invariant that callbacks from a cleaned generation must never reach the business handler.

Ask it to check plain unmount, pending `listen()`, dependency replacement, StrictMode generation isolation, latest committed handler behavior, rejection ownership, and disposer behavior. It must not modify files or inspect unrelated working-tree changes.

Expected: no confirmed or plausible correctness finding. If a finding survives, add a focused RED test and return to Task 3 rather than documenting completion.

---

### Task 5: Synchronize Existing Module 10 Documentation

**Files:**
- Modify: `vault/10b-工程基线与低风险重构.md`
- Modify: `vault/CURRENT.md`
- Modify: `docs/开发进度.md`

**Interfaces:**
- Consumes exact test totals, `pnpm verify` output, and independent review verdict from Task 4.
- Produces an accurate completion record without claiming GUI or installed-app validation.

- [ ] **Step 1: Add the SettingsApp/shared-hook batch evidence**

Record all of the following facts with actual observed totals instead of estimates:

```markdown
- SettingsApp 批将 `settings://navigate` 迁入 `useTauriEvent`，保持 payload 解析、侧栏行为与 About 更新检查规则不变。
- 初始专项验证通过后，独立只读审查发现 pending `listen()` cleanup 窗口内旧 callback 仍可执行；新增卸载与 StrictMode generation RED 测试，并在共享层以 effect-generation `isActive()` 修复，未在 SettingsApp 增加局部补丁。
- 共享 hook、SettingsApp 和 listener 回归测试通过；独立 Cargo target `pnpm verify` 全部通过；独立复审无剩余 finding。
- 未做 GUI、安装态或真机 Tauri 验证；未迁移 GeneralPanel 或 AI listener。
```

- [ ] **Step 2: Update the current entry and next action**

Set `vault/CURRENT.md` to state that the SettingsApp listener batch and shared stale-callback correction are complete only if Task 4 is fully green. Set the sole next action to read-only design of the two GeneralPanel listeners. Do not mark GeneralPanel migrated.

- [ ] **Step 3: Check the documentation diff without staging**

Run:

```bash
git diff --check -- \
  vault/10b-工程基线与低风险重构.md \
  vault/CURRENT.md \
  docs/开发进度.md
```

Expected: no whitespace errors. Do not stage or commit.

---

### Task 6: Produce the Read-Only GeneralPanel Dual-Listener Design

**Files:**
- Read: `src/settings/GeneralPanel.tsx`
- Read: relevant monitor and window-policy APIs/tests.
- Do not modify application or test files.

**Interfaces:**
- Analyzes `monitor://changed` and `window://policy-changed` independently.
- Produces a proposed next TDD batch, not an implementation.

- [ ] **Step 1: Map the two existing listener invariants**

Document:

```text
monitor://changed
- payload immediately replaces MonitorSelectionState
- monitorList() asynchronously refreshes available displays
- cleanup must block both stale event handling and late monitorList() state writes
- monitorList() rejection behavior must be made explicit before migration

window://policy-changed
- one payload atomically updates clickThrough, hoverExpand,
  hideInFullscreen, and fullscreenSupported
- cleanup must block stale callback writes
- no asynchronous follow-up currently exists
```

- [ ] **Step 2: Define the recommended batch boundary**

Recommend one GeneralPanel batch because both listeners live in the same component and share lifecycle infrastructure, while preserving separate tests for their different business behavior. State explicitly that the initial settings/monitor load effect at `GeneralPanel.tsx:68-114` remains out of scope.

- [ ] **Step 3: Define the TDD matrix**

The design must require:

```text
- stable registration across GeneralPanel rerenders
- valid monitor payload updates state and refreshes monitor list
- monitor event after cleanup causes no state write or monitorList call
- monitorList late resolve after cleanup causes no state write
- policy payload updates all four fields together
- policy event after cleanup causes no state write
- pending listener resolution is disposed after cleanup
- StrictMode cleans each listener generation once and rejects stale callbacks
- rejection diagnostics use listen:monitor://changed and
  listen:window://policy-changed labels
```

- [ ] **Step 4: Present the read-only design and stop**

Report whether the two listeners are a suitable next REF-10B-01 batch, the exact files/tests likely needed, risks, non-goals, and proposed verification commands. Do not edit GeneralPanel or start its RED tests without a new user approval.
