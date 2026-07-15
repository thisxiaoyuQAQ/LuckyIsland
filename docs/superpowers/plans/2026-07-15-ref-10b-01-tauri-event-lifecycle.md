# REF-10B-01 Shared Tauri Event Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tested shared React hooks that safely own Promise-based subscriptions and Tauri event listeners without migrating any existing business listener.

**Architecture:** `useAsyncSubscription` is the lifecycle primitive: each effect instance owns its pending Promise, resolved disposer, disposed flag, and diagnostic path. `useTauriEvent` is a thin adapter that stores the latest event handler in a ref and delegates subscription ownership to the primitive, so handler renders do not create event gaps.

**Tech Stack:** React 19 hooks, TypeScript 5.8, Tauri 2 JavaScript API, Vitest 4, happy-dom, existing React 19 `act`/`createRoot` test helper.

## Global Constraints

- Only create the two shared hooks and their happy-dom tests; do not migrate `App`, Stock, Notify, Weather, Terminal, settings, or AI listeners.
- Do not modify module 11, plugin phase 1, navigation, window policy, theme synchronization, or page keep-alive behavior.
- Do not modify or stage the pre-existing Rust working-tree changes in `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/window_policy.rs`, or `src-tauri/src/fullscreen/`.
- `useAsyncSubscription` must cover resolve-before-unmount, resolve-after-unmount, StrictMode, dependency replacement, rejection diagnostics, and disposer failures.
- `useTauriEvent` must call the latest handler without rebuilding the listener when only the handler changes.
- Promise rejection must be consumed and diagnosed; do not add silent catches, retries, toast state, or backend logging.
- Node must remain `>=22 <23`; pnpm must remain `>=10 <11`; add no dependencies.
- Rust verification must use an independent `CARGO_TARGET_DIR`; never use or clean the default `src-tauri/target` during this audit batch.
- Automated tests do not constitute GUI, installation-state, or real-device Tauri evidence.

## File Structure

- Create `src/lib/useAsyncSubscription.ts`: generic React lifecycle ownership for `Promise<Dispose>` subscriptions and diagnostics.
- Create `src/lib/__tests__/useAsyncSubscription.test.tsx`: happy-dom tests for both subscription timing paths, StrictMode, dependency replacement, and error paths.
- Create `src/lib/useTauriEvent.ts`: typed Tauri `listen()` adapter with latest-handler ref and `enabled` gating.
- Create `src/lib/__tests__/useTauriEvent.test.tsx`: mocked Tauri boundary tests for stable registration, latest handler, identity changes, disable, lifecycle timing, StrictMode, and rejection labels.
- Do not edit any existing business source file.

---

### Task 1: Generic Async Subscription Lifecycle Hook

**Files:**
- Create: `src/lib/useAsyncSubscription.ts`
- Create: `src/lib/__tests__/useAsyncSubscription.test.tsx`

**Interfaces:**
- Consumes: React `DependencyList`, `useEffect`, and `useRef`; existing `mountReactTree()` and `flushReactWork()` from `src/test/mountReactTree.tsx`.
- Produces: `Dispose`, `AsyncSubscriptionOptions`, and `useAsyncSubscription(subscribe, deps, options): void` for Task 2.

- [ ] **Step 1: Create the failing lifecycle test suite**

Create `src/lib/__tests__/useAsyncSubscription.test.tsx` with the complete test harness and tests below. The import of `useAsyncSubscription` is intentionally unresolved for the RED run.

```tsx
// @vitest-environment happy-dom

import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function SubscriptionProbe({
  identity = "first",
  subscribe,
  onError,
}: {
  identity?: string;
  subscribe: () => Promise<() => void>;
  onError: (error: unknown) => void;
}) {
  useAsyncSubscription(subscribe, [identity], { label: `probe:${identity}`, onError });
  return null;
}

describe("useAsyncSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("disposes a subscription that resolves before unmount", async () => {
    const subscription = deferred<() => void>();
    const dispose = vi.fn();
    const onError = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={onError} />,
    );

    subscription.resolve(dispose);
    await flushReactWork();
    await tree.unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("immediately disposes a subscription that resolves after unmount", async () => {
    const subscription = deferred<() => void>();
    const dispose = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={vi.fn()} />,
    );

    await tree.unmount();
    subscription.resolve(dispose);
    await flushReactWork();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes every StrictMode subscription exactly once", async () => {
    const subscriptions: Array<Deferred<() => void>> = [];
    const subscribe = vi.fn(() => {
      const subscription = deferred<() => void>();
      subscriptions.push(subscription);
      return subscription.promise;
    });
    const tree = await mountReactTree(
      <StrictMode>
        <SubscriptionProbe subscribe={subscribe} onError={vi.fn()} />
      </StrictMode>,
    );
    const disposers = subscriptions.map(() => vi.fn());

    subscriptions.forEach((subscription, index) => subscription.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(subscriptions).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("replaces the subscription when an identity dependency changes", async () => {
    const subscriptions: Array<Deferred<() => void>> = [];
    const disposers = [vi.fn(), vi.fn()];
    const subscribe = vi.fn(() => {
      const subscription = deferred<() => void>();
      subscriptions.push(subscription);
      return subscription.promise;
    });
    let setIdentity!: (value: string) => void;
    function StatefulProbe() {
      const [identity, updateIdentity] = useState("first");
      setIdentity = updateIdentity;
      return <SubscriptionProbe identity={identity} subscribe={subscribe} onError={vi.fn()} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);

    subscriptions[0].resolve(disposers[0]);
    await flushReactWork();
    setIdentity("second");
    await flushReactWork();
    subscriptions[1].resolve(disposers[1]);
    await flushReactWork();
    await tree.unmount();

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    expect(disposers[1]).toHaveBeenCalledTimes(1);
  });

  it("disposes an old subscription that resolves after dependency replacement", async () => {
    const subscriptions: Array<Deferred<() => void>> = [];
    const subscribe = vi.fn(() => {
      const subscription = deferred<() => void>();
      subscriptions.push(subscription);
      return subscription.promise;
    });
    let setIdentity!: (value: string) => void;
    function StatefulProbe() {
      const [identity, updateIdentity] = useState("first");
      setIdentity = updateIdentity;
      return <SubscriptionProbe identity={identity} subscribe={subscribe} onError={vi.fn()} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);
    const oldDispose = vi.fn();
    const currentDispose = vi.fn();

    setIdentity("second");
    await flushReactWork();
    subscriptions[0].resolve(oldDispose);
    subscriptions[1].resolve(currentDispose);
    await flushReactWork();

    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(currentDispose).not.toHaveBeenCalled();

    await tree.unmount();
    expect(currentDispose).toHaveBeenCalledTimes(1);
  });

  it("diagnoses subscription rejection before unmount", async () => {
    const subscription = deferred<() => void>();
    const error = new Error("subscribe failed");
    const onError = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={onError} />,
    );

    subscription.reject(error);
    await flushReactWork();

    expect(onError).toHaveBeenCalledWith(error);
    await tree.unmount();
  });

  it("diagnoses subscription rejection after unmount", async () => {
    const subscription = deferred<() => void>();
    const error = new Error("late failure");
    const onError = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={onError} />,
    );

    await tree.unmount();
    subscription.reject(error);
    await flushReactWork();

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("diagnoses synchronous subscribe failures", async () => {
    const error = new Error("sync failure");
    const onError = vi.fn();
    const subscribe = () => {
      throw error;
    };

    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={subscribe} onError={onError} />,
    );

    expect(onError).toHaveBeenCalledWith(error);
    await tree.unmount();
  });

  it("diagnoses a disposer failure without invoking it twice", async () => {
    const subscription = deferred<() => void>();
    const error = new Error("dispose failed");
    const dispose = vi.fn(() => {
      throw error;
    });
    const onError = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={onError} />,
    );

    subscription.resolve(dispose);
    await flushReactWork();
    await tree.unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/useAsyncSubscription.test.tsx
```

Expected: FAIL during transform/module resolution because `@/lib/useAsyncSubscription` does not exist. This proves the new behavior has no implementation yet.

- [ ] **Step 3: Implement the minimal lifecycle primitive**

Create `src/lib/useAsyncSubscription.ts`:

```ts
import { useEffect, useRef, type DependencyList } from "react";

export type Dispose = () => void;

export interface AsyncSubscriptionOptions {
  label: string;
  onError?: (error: unknown) => void;
}

export function useAsyncSubscription(
  subscribe: () => Promise<Dispose>,
  deps: DependencyList,
  options: AsyncSubscriptionOptions,
): void {
  const subscribeRef = useRef(subscribe);
  const optionsRef = useRef(options);
  subscribeRef.current = subscribe;
  optionsRef.current = options;

  useEffect(() => {
    let disposed = false;
    let currentDispose: Dispose | undefined;

    const reportError = (error: unknown) => {
      const currentOptions = optionsRef.current;
      if (currentOptions.onError) {
        currentOptions.onError(error);
        return;
      }
      console.error(`[async-subscription] ${currentOptions.label}`, error);
    };

    const dispose = (candidate: Dispose) => {
      try {
        candidate();
      } catch (error) {
        reportError(error);
      }
    };

    try {
      void subscribeRef.current().then(
        (candidate) => {
          if (disposed) {
            dispose(candidate);
            return;
          }
          currentDispose = candidate;
        },
        (error: unknown) => {
          reportError(error);
        },
      );
    } catch (error) {
      reportError(error);
    }

    return () => {
      disposed = true;
      const candidate = currentDispose;
      currentDispose = undefined;
      if (candidate) dispose(candidate);
    };
  }, deps);
}
```

Implementation notes:

- Each effect execution owns its own `disposed` and `currentDispose`; StrictMode instances cannot overwrite one another.
- `subscribeRef` prevents a newly rendered callback identity from rebuilding the subscription unless an explicit dependency changes.
- Promise rejection uses the second argument of `.then()`, so the original subscription rejection is consumed without an empty catch.
- The disposer reference is cleared before invocation, preventing a throwing disposer from being retried by later cleanup.
- Do not add retry logic, state, AbortController, or deep dependency comparison.

- [ ] **Step 4: Run focused tests and typecheck to verify GREEN**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/useAsyncSubscription.test.tsx
pnpm typecheck
```

Expected: 9 focused tests PASS; TypeScript exits 0 with no diagnostics.

- [ ] **Step 5: Review the Task 1 diff boundary**

Run:

```bash
git diff -- src/lib/useAsyncSubscription.ts src/lib/__tests__/useAsyncSubscription.test.tsx
git status --short
```

Expected: Task 1 changes are limited to the two new frontend files. The pre-existing Rust modifications remain present but untouched and unstaged.

- [ ] **Step 6: Commit only Task 1 files after explicit commit authorization**

Do not commit automatically in the current dirty working tree. If the user separately authorizes a local commit, run exactly:

```bash
git add -- src/lib/useAsyncSubscription.ts src/lib/__tests__/useAsyncSubscription.test.tsx
git diff --cached --name-only
git commit -m "refactor(audit): add async subscription lifecycle hook"
```

Expected staged-name output contains only the two Task 1 files. If any Rust path appears, stop and unstage it before committing.

---

### Task 2: Tauri Event Hook with Latest Handler

**Files:**
- Create: `src/lib/useTauriEvent.ts`
- Create: `src/lib/__tests__/useTauriEvent.test.tsx`

**Interfaces:**
- Consumes: `useAsyncSubscription(subscribe: () => Promise<Dispose>, deps: DependencyList, options: AsyncSubscriptionOptions): void` from Task 1; Tauri `listen<T>(eventName, handler): Promise<UnlistenFn>` and `Event<T>`.
- Produces: `TauriEventOptions` and `useTauriEvent<T>(eventName, handler, options?): void` for later separately authorized migration batches.

- [ ] **Step 1: Create the mocked Tauri boundary test suite**

Create `src/lib/__tests__/useTauriEvent.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface ListenCall {
  eventName: string;
  handler: (event: Event<unknown>) => void;
  subscription: Deferred<() => void>;
}

const listenCalls: ListenCall[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, handler: (event: Event<unknown>) => void) => {
    const subscription = deferred<() => void>();
    listenCalls.push({ eventName, handler, subscription });
    return subscription.promise;
  }),
}));

import { useTauriEvent } from "@/lib/useTauriEvent";

function event<T>(payload: T): Event<T> {
  return { event: "test://event", id: 1, payload };
}

function EventProbe({
  eventName = "test://event",
  enabled = true,
  prefix,
  onValue,
  onError,
}: {
  eventName?: string;
  enabled?: boolean;
  prefix: string;
  onValue: (value: string) => void;
  onError?: (error: unknown) => void;
}) {
  useTauriEvent<string>(
    eventName,
    (incoming) => onValue(`${prefix}:${incoming.payload}`),
    { enabled, onError },
  );
  return null;
}

describe("useTauriEvent", () => {
  beforeEach(() => {
    listenCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("registers once and calls the latest handler after rerender", async () => {
    const onValue = vi.fn();
    let setPrefix!: (value: string) => void;
    function StatefulProbe() {
      const [prefix, updatePrefix] = useState("old");
      setPrefix = updatePrefix;
      return <EventProbe prefix={prefix} onValue={onValue} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);
    const dispose = vi.fn();
    listenCalls[0].subscription.resolve(dispose);
    await flushReactWork();

    setPrefix("new");
    await flushReactWork();
    listenCalls[0].handler(event("payload"));

    expect(listenCalls).toHaveLength(1);
    expect(onValue).toHaveBeenCalledWith("new:payload");

    await tree.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("replaces the listener when the event name changes", async () => {
    let setEventName!: (value: string) => void;
    function StatefulProbe() {
      const [eventName, updateEventName] = useState("test://first");
      setEventName = updateEventName;
      return <EventProbe eventName={eventName} prefix="value" onValue={vi.fn()} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    listenCalls[0].subscription.resolve(firstDispose);
    await flushReactWork();

    setEventName("test://second");
    await flushReactWork();
    listenCalls[1].subscription.resolve(secondDispose);
    await flushReactWork();

    expect(listenCalls.map((call) => call.eventName)).toEqual(["test://first", "test://second"]);
    expect(firstDispose).toHaveBeenCalledTimes(1);

    await tree.unmount();
    expect(secondDispose).toHaveBeenCalledTimes(1);
  });

  it("does not listen while disabled and disposes when disabled", async () => {
    let setEnabled!: (value: boolean) => void;
    function StatefulProbe() {
      const [enabled, updateEnabled] = useState(false);
      setEnabled = updateEnabled;
      return <EventProbe enabled={enabled} prefix="value" onValue={vi.fn()} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);

    expect(listenCalls).toHaveLength(0);

    setEnabled(true);
    await flushReactWork();
    const dispose = vi.fn();
    listenCalls[0].subscription.resolve(dispose);
    await flushReactWork();

    setEnabled(false);
    await flushReactWork();

    expect(listenCalls).toHaveLength(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    await tree.unmount();
  });

  it("immediately disposes a listener that resolves after unmount", async () => {
    const tree = await mountReactTree(
      <EventProbe prefix="value" onValue={vi.fn()} />,
    );
    const dispose = vi.fn();

    await tree.unmount();
    listenCalls[0].subscription.resolve(dispose);
    await flushReactWork();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode listener exactly once", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <EventProbe prefix="value" onValue={vi.fn()} />
      </StrictMode>,
    );
    const disposers = listenCalls.map(() => vi.fn());

    listenCalls.forEach((call, index) => call.subscription.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(listenCalls).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reports listen rejection through the supplied error handler", async () => {
    const error = new Error("listen failed");
    const onError = vi.fn();
    const tree = await mountReactTree(
      <EventProbe eventName="test://broken" prefix="value" onValue={vi.fn()} onError={onError} />,
    );

    listenCalls[0].subscription.reject(error);
    await flushReactWork();

    expect(onError).toHaveBeenCalledWith(error);
    await tree.unmount();
  });

  it("includes the event name in the default rejection diagnostic", async () => {
    const error = new Error("listen failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountReactTree(
      <EventProbe eventName="test://broken" prefix="value" onValue={vi.fn()} />,
    );

    listenCalls[0].subscription.reject(error);
    await flushReactWork();

    expect(consoleError).toHaveBeenCalledWith(
      "[async-subscription] listen:test://broken",
      error,
    );
    consoleError.mockRestore();
    await tree.unmount();
  });
});
```

- [ ] **Step 2: Run the focused Tauri hook tests to verify RED**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/useTauriEvent.test.tsx
```

Expected: FAIL during transform/module resolution because `@/lib/useTauriEvent` does not exist.

- [ ] **Step 3: Implement the minimal Tauri adapter**

Create `src/lib/useTauriEvent.ts`:

```ts
import { useRef } from "react";
import { listen, type Event } from "@tauri-apps/api/event";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

export interface TauriEventOptions {
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

export function useTauriEvent<T>(
  eventName: string,
  handler: (event: Event<T>) => void,
  options: TauriEventOptions = {},
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const enabled = options.enabled ?? true;

  useAsyncSubscription(
    () => {
      if (!enabled) return Promise.resolve(() => undefined);
      return listen<T>(eventName, (incoming) => handlerRef.current(incoming));
    },
    [eventName, enabled],
    { label: `listen:${eventName}`, onError: options.onError },
  );
}
```

Implementation notes:

- The disabled branch preserves unconditional hook ordering while avoiding a Tauri `listen()` call.
- The no-op disposer is internal and is never exposed to consumers.
- Only `eventName` and `enabled` identify a subscription. `handler` and `onError` are refreshed through refs and must not create event gaps.
- Do not expose Tauri target/options until a later migration has a demonstrated requirement and a test.

- [ ] **Step 4: Run both focused suites and typecheck**

Run:

```bash
pnpm exec vitest run src/lib/__tests__/useAsyncSubscription.test.tsx src/lib/__tests__/useTauriEvent.test.tsx
pnpm typecheck
```

Expected: 16 focused tests PASS; TypeScript exits 0 with no diagnostics.

- [ ] **Step 5: Run the full frontend regression layer**

Run:

```bash
pnpm test:frontend
pnpm build:frontend
```

Expected: all frontend tests PASS; all three Vite HTML entries build successfully. The existing main-chunk size warning may remain, but no new error or warning should be attributed to these hooks.

- [ ] **Step 6: Verify the change boundary before full verification**

Run:

```bash
git diff --name-only
git status --short
```

Expected new audit files are exactly:

```text
src/lib/useAsyncSubscription.ts
src/lib/__tests__/useAsyncSubscription.test.tsx
src/lib/useTauriEvent.ts
src/lib/__tests__/useTauriEvent.test.tsx
```

The design and plan documents may also be untracked. Existing Rust modifications may still appear because they predate this task, but their contents must not have changed during implementation. No `src/App.tsx`, Stock, Notify, Weather, Terminal, settings, or AI source path may appear as a new implementation change.

- [ ] **Step 7: Run the complete verification gate with an independent Rust target**

In Git Bash, run:

```bash
PATH="/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH" \
CARGO_TARGET_DIR="E:/Code/Tauri/LuckyIsland/.omc/ref-10b-01-target" \
pnpm verify
```

Expected: TypeScript passes; all frontend tests pass; three frontend entries build; Rust fmt, strict Clippy, Rust library tests, and cargo check exit 0. If a pre-existing module 11/12 Rust change fails verification, report the exact failure separately and do not alter that Rust work as part of REF-10B-01.

- [ ] **Step 8: Record verification without overstating evidence**

Update only the REF-10B-01 implementation record after all commands pass. Record exact date, focused test count, full frontend count, and `pnpm verify` result. State explicitly that no business listener was migrated and no GUI, installation-state, or real-device Tauri behavior was tested.

Do not mark later App/Stock/Notify/Weather/Terminal migration batches complete.

- [ ] **Step 9: Commit only the approved REF-10B-01 files after explicit commit authorization**

Do not commit automatically. If the user separately authorizes a local commit, stage an explicit allowlist:

```bash
git add -- \
  src/lib/useAsyncSubscription.ts \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/useTauriEvent.ts \
  src/lib/__tests__/useTauriEvent.test.tsx \
  docs/superpowers/specs/2026-07-15-ref-10b-01-tauri-event-lifecycle-design.md \
  docs/superpowers/plans/2026-07-15-ref-10b-01-tauri-event-lifecycle.md
git diff --cached --name-only
git commit -m "refactor(audit): add Tauri event lifecycle hooks"
```

Expected staged-name output contains only the six allowlisted files. Do not stage vault progress unless the user explicitly asks to include it, and never stage the unrelated Rust changes.

## Plan Self-Review

- Spec coverage: both hooks, all lifecycle timing cases, StrictMode, latest handler, identity replacement, enabled gating, rejection diagnostics, disposer failure, scope boundary, and verification evidence are mapped to explicit steps.
- Placeholder scan: no `TBD`, `TODO`, “similar to,” or unspecified error/test steps remain.
- Type consistency: Task 2 consumes the exact exported `Dispose`, `AsyncSubscriptionOptions`, and `useAsyncSubscription` signature produced by Task 1; Tauri uses the SDK-exported `Event<T>` type.
- Scope check: this plan creates one independently testable shared lifecycle facility and explicitly defers all business migrations.
