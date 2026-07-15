# REF-10B-01 App Listener Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate only App's settings, window-state, and incoming-notification subscriptions to the verified lifecycle hooks, protected by a real App happy-dom integration suite.

**Architecture:** A single integration-test harness mounts the real `App` while replacing heavy pages, animation, settings I/O, and window-policy infrastructure with controlled boundaries. `onSettingsChanged` remains the application adapter and is owned by `useAsyncSubscription`; the two direct Tauri channels use `useTauriEvent`, whose committed handler ref keeps the notification listener stable across page-setting changes.

**Tech Stack:** React 19, TypeScript 5.8, Tauri 2 API, Vitest 4, happy-dom, existing `mountReactTree` helper.

## Global Constraints

- Modify only `src/App.tsx`, add `src/App.events.test.tsx`, and update approved REF-10B-01 documentation.
- Preserve the existing uncommitted hover-controller hunk in `src/App.tsx` exactly.
- Do not migrate Stock, NotifyPage, Weather, Terminal, settings-window, or AI-palette listeners.
- Do not extract `useIslandEvents`, page registry, or other REF-10B-03 structure.
- Keep `windowPolicyGet()` in its independent startup effect and preserve legacy string payload handling.
- Do not mock `useAsyncSubscription` or `useTauriEvent`.
- Use exact-path staging; never stage unrelated concurrent changes.
- Use an independent `CARGO_TARGET_DIR` for unified verification.
- Automated evidence is not GUI, installation-state, or real-device evidence.

## File Structure

- Create `src/App.events.test.tsx`: App-level controlled integration harness and lifecycle/behavior regressions.
- Modify `src/App.tsx`: import shared hooks and replace exactly three subscription blocks.
- Update `docs/superpowers/specs/2026-07-15-ref-10b-01-app-listener-migration-design.md`, `vault/CURRENT.md`, and `vault/10b-工程基线与低风险重构.md` after verification.

---

### Task 1: App Event Integration Harness and RED Tests

**Files:**
- Create: `src/App.events.test.tsx`
- Read before editing: `src/App.tsx`

**Interfaces:**
- Consumes real default export `App`, real `useAsyncSubscription`, and real `useTauriEvent`.
- Produces controlled `settingsSubscriptions` and `eventSubscriptions` arrays, each containing a deferred disposer and captured callback.

- [ ] **Step 1: Create the App integration harness**

Create `src/App.events.test.tsx` with:

```tsx
// @vitest-environment happy-dom

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type { IslandState, WindowPolicySnapshot } from "@/lib/window-policy";

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

interface SettingsSubscription {
  callback: (key: string, value: string | null) => void;
  deferred: Deferred<() => void>;
}
interface EventSubscription {
  name: string;
  callback: (event: Event<unknown>) => void;
  deferred: Deferred<() => void>;
}

const settingsSubscriptions: SettingsSubscription[] = [];
const eventSubscriptions: EventSubscription[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: Event<unknown>) => void) => {
    const pending = deferred<() => void>();
    eventSubscriptions.push({ name, callback, deferred: pending });
    return pending.promise;
  }),
}));

const pageIds = ["time", "calendar", "weather", "stock", "todo", "notify", "terminal"];
for (const [path, id] of [
  ["@/components/pages/time/TimePage", "time"],
  ["@/components/pages/calendar/CalendarPage", "calendar"],
  ["@/components/pages/weather/WeatherPage", "weather"],
  ["@/components/pages/stock/StockPage", "stock"],
  ["@/components/pages/todo/TodoPage", "todo"],
  ["@/components/pages/notify/NotifyPage", "notify"],
  ["@/components/pages/terminal/TerminalPage", "terminal"],
] as const) {
  vi.doMock(path, () => ({
    [`${id[0].toUpperCase()}${id.slice(1)}Page`]: ({ compact }: { compact: boolean }) => (
      <div data-testid={`page-${id}`} data-compact={String(compact)} />
    ),
  }));
}

vi.mock("motion/react", async () => {
  const React = await import("react");
  const Div = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ children, ...props }, ref) => <div ref={ref} {...props}>{children}</div>,
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: { div: Div },
    useReducedMotion: () => true,
  };
});

vi.mock("@/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    openSettings: vi.fn(async () => undefined),
    settingGet: vi.fn(async () => null),
    settingSetEmit: vi.fn(async () => undefined),
    onSettingsChanged: vi.fn((callback: (key: string, value: string | null) => void) => {
      const pending = deferred<() => void>();
      settingsSubscriptions.push({ callback, deferred: pending });
      return pending.promise;
    }),
  };
});

const compactSnapshot: WindowPolicySnapshot = {
  desiredState: "compact", effectiveState: "compact", shouldFocus: false,
  clickThrough: false, hoverExpand: false, hovered: false,
  hideInFullscreen: false, fullscreenSupported: true, fullscreenBlock: false,
  priorityOverrideActive: false, priorityOverrideGeneration: 0,
};
const expandedSnapshot = { ...compactSnapshot, desiredState: "expanded", effectiveState: "expanded" } satisfies WindowPolicySnapshot;

vi.mock("@/lib/window-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/window-policy")>();
  return {
    ...actual,
    windowPolicyGet: vi.fn(async () => compactSnapshot),
    setIslandState: vi.fn(async () => compactSnapshot),
    windowHoverSet: vi.fn(async () => compactSnapshot),
    createHoverController: vi.fn(() => ({
      enter: vi.fn(), leave: vi.fn(), suppressCurrentCycle: vi.fn(),
      enable: vi.fn(), disable: vi.fn(), dispose: vi.fn(),
    })),
    createIslandTransitionController: vi.fn(() => ({ request: vi.fn(async () => undefined), dispose: vi.fn() })),
  };
});

import App from "@/App";
import { KEYS } from "@/lib/settings";

function emit(name: string, payload: unknown) {
  const subscription = eventSubscriptions.find((entry) => entry.name === name);
  if (!subscription) throw new Error(`missing subscription: ${name}`);
  subscription.callback({ event: name, id: 1, payload });
}

describe("App event subscriptions", () => {
  beforeEach(() => {
    settingsSubscriptions.length = 0;
    eventSubscriptions.length = 0;
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    });
  });
  afterEach(() => document.body.replaceChildren());

  it("keeps notify registration stable while using the latest enabled pages", async () => {
    const tree = await mountReactTree(<App />);
    eventSubscriptions.forEach((entry) => entry.deferred.resolve(vi.fn()));
    settingsSubscriptions[0].deferred.resolve(vi.fn());
    await flushReactWork();

    emit("notify://incoming", null);
    await flushReactWork();
    expect(document.querySelector('[data-testid="page-notify"]')).not.toBeNull();
    expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(1);

    settingsSubscriptions[0].callback(KEYS.pagesEnabled, JSON.stringify({ notify: false }));
    await flushReactWork();
    emit("notify://incoming", null);
    await flushReactWork();
    expect(document.querySelector('[data-testid="page-notify"]')).toBeNull();
    expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(1);

    await tree.unmount();
  });

  it("applies settings and both window-state payload forms", async () => {
    const tree = await mountReactTree(<App />);
    settingsSubscriptions[0].callback(KEYS.theme, "dark");
    settingsSubscriptions[0].callback(KEYS.blur, "false");
    settingsSubscriptions[0].callback(KEYS.windowOpacity, "0.5");
    emit("window://state-changed", "expanded" satisfies IslandState);
    await flushReactWork();
    expect(document.documentElement.dataset.theme).toBe("dark");

    emit("window://state-changed", expandedSnapshot);
    await flushReactWork();
    expect(document.querySelector('[data-testid="page-time"][data-compact="false"]')).not.toBeNull();
    await tree.unmount();
  });

  it("immediately disposes subscriptions that resolve after unmount", async () => {
    const tree = await mountReactTree(<App />);
    const disposers = [...eventSubscriptions, ...settingsSubscriptions].map(() => vi.fn());
    await tree.unmount();
    [...eventSubscriptions, ...settingsSubscriptions].forEach((entry, index) => entry.deferred.resolve(disposers[index]));
    await flushReactWork();
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode subscription exactly once", async () => {
    const tree = await mountReactTree(<StrictMode><App /></StrictMode>);
    const all = [...eventSubscriptions, ...settingsSubscriptions];
    const disposers = all.map(() => vi.fn());
    all.forEach((entry, index) => entry.deferred.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();
    expect(settingsSubscriptions).toHaveLength(2);
    expect(eventSubscriptions.filter((entry) => entry.name === "window://state-changed")).toHaveLength(2);
    expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
```

If Vitest rejects dynamic page-module naming, replace the loop with seven explicit `vi.mock()` declarations; do not change production code to accommodate the test.

- [ ] **Step 2: Run RED and confirm the intended failure**

Run:

```bash
pnpm exec vitest run src/App.events.test.tsx
```

Expected: the stable-notify assertion fails because current App re-registers `notify://incoming` when `pages` changes, and/or late-resolve cleanup fails because the old effects lose disposers. Fix only test-harness import/mock errors until at least one behavior assertion fails for this reason.

---

### Task 2: Migrate Exactly Three App Subscriptions

**Files:**
- Modify: `src/App.tsx:1-4,272-359`
- Test: `src/App.events.test.tsx`

**Interfaces:**
- Consumes `useAsyncSubscription()` and `useTauriEvent()` with their existing signatures.
- Preserves all existing callbacks and state transitions.

- [ ] **Step 1: Re-read concurrent App diff**

Run:

```bash
git diff -- src/App.tsx
```

Expected: note every pre-existing hunk, especially `hoverControllerRef.current?.enable()`; do not overwrite it.

- [ ] **Step 2: Replace imports only**

In `src/App.tsx`, remove:

```ts
import { listen } from "@tauri-apps/api/event";
```

and add:

```ts
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";
import { useTauriEvent } from "@/lib/useTauriEvent";
```

- [ ] **Step 3: Replace the settings subscription effect**

Replace only the `settings://changed` `useEffect` with:

```ts
  useAsyncSubscription(
    () => onSettingsChanged((key, value) => {
      if (key === KEYS.pagesEnabled) setPagesEnabled(parsePagesEnabled(value));
      if (key === KEYS.pagesOrder) setPagesOrder(parsePagesOrder(value));
      if (key === KEYS.theme) setThemeMode(normalizeThemeMode(value) ?? "auto");
      if (key === KEYS.blur) setBlur(parseBool(value, true));
      if (key === KEYS.windowOpacity) setOpacity(parseOpacity(value));
    }),
    [],
    { label: "settings://changed" },
  );
```

- [ ] **Step 4: Separate startup read from window event hook**

Keep this effect:

```ts
  useEffect(() => {
    void windowPolicyGet()
      .then((snapshot) => {
        islandStateChangedRef.current = true;
        setPolicy(snapshot);
        setVisualPhase(snapshot.effectiveState === "expanded" ? "expanded" : "compact");
      })
      .catch((error) => console.error("[window-policy] 读取初始状态失败:", error));
  }, []);
```

Immediately after it, add:

```ts
  useTauriEvent<WindowPolicySnapshot | IslandState>("window://state-changed", (event) => {
    islandStateChangedRef.current = true;
    if (typeof event.payload === "string") {
      setPolicy((current) => ({
        desiredState: event.payload as IslandState,
        effectiveState: event.payload as IslandState,
        shouldFocus: false,
        clickThrough: current?.clickThrough ?? false,
        hoverExpand: current?.hoverExpand ?? false,
        hovered: current?.hovered ?? false,
        hideInFullscreen: current?.hideInFullscreen ?? false,
        fullscreenSupported: current?.fullscreenSupported ?? true,
        fullscreenBlock: current?.fullscreenBlock ?? false,
        priorityOverrideActive: current?.priorityOverrideActive ?? false,
        priorityOverrideGeneration: current?.priorityOverrideGeneration ?? 0,
      }));
    } else {
      setPolicy(event.payload);
      if (shouldSyncExternalVisualPhase(visualPhaseRef.current)) {
        setVisualPhase(event.payload.effectiveState === "expanded" ? "expanded" : "compact");
      }
    }
  });
```

Preserve the legacy compatibility comment inside this branch.

- [ ] **Step 5: Replace notify subscription effect**

Replace only its effect with:

```ts
  useTauriEvent("notify://incoming", () => {
    const index = pages.findIndex((page) => page.id === "notify");
    if (index >= 0) setPage(index);
  });
```

- [ ] **Step 6: Run focused GREEN verification**

Run:

```bash
pnpm exec vitest run src/App.events.test.tsx src/lib/__tests__/useAsyncSubscription.test.tsx src/lib/__tests__/useTauriEvent.test.tsx
pnpm typecheck
```

Expected: App integration suite and shared-hook 17 tests pass; typecheck exits 0.

- [ ] **Step 7: Confirm concurrent hunk and scope**

Run:

```bash
git diff -- src/App.tsx
git diff --name-only
```

Expected: App diff contains the pre-existing hover enable hunk unchanged plus import and three subscription migrations. No other business listener file was changed by this task.

---

### Task 3: Review, Unified Verification, Records, and Commit

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-ref-10b-01-app-listener-migration-design.md`
- Modify: `vault/CURRENT.md`
- Modify: `vault/10b-工程基线与低风险重构.md`
- Commit allowlist: the files above, `src/App.tsx`, `src/App.events.test.tsx`, and this plan.

**Interfaces:**
- Consumes verified Task 2 implementation.
- Produces auditable evidence and one local commit without unrelated files.

- [ ] **Step 1: Run frontend and unified gates**

```bash
pnpm test:frontend
pnpm build:frontend
PATH="/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH" \
CARGO_TARGET_DIR="E:/Code/Tauri/LuckyIsland/.superpowers/target-check" \
pnpm verify
```

Expected: all exit 0; record exact current frontend/Rust counts rather than copying older counts.

- [ ] **Step 2: Run one independent review**

Use at most one read-only review Agent. Scope it to `src/App.tsx`, `src/App.events.test.tsx`, and the two shared hooks. Require checks for behavior preservation, concurrent hunk preservation, subscription identity, handler freshness, and meaningful tests. Fix confirmed findings through a new RED/GREEN cycle.

- [ ] **Step 3: Update records with exact evidence**

In the spec and vault files, record:

- three App subscriptions migrated;
- App test scenarios and exact pass counts;
- shared hooks still pass;
- review result and any fixes;
- exact `pnpm verify` evidence;
- no other business listener migration;
- no GUI, installation-state, or real-device evidence.

- [ ] **Step 4: Check whitespace and stage exact allowlist**

```bash
git diff --check -- \
  src/App.tsx src/App.events.test.tsx \
  docs/superpowers/specs/2026-07-15-ref-10b-01-app-listener-migration-design.md \
  docs/superpowers/plans/2026-07-15-ref-10b-01-app-listener-migration.md \
  vault/CURRENT.md vault/10b-工程基线与低风险重构.md
git add -- \
  src/App.tsx src/App.events.test.tsx \
  docs/superpowers/specs/2026-07-15-ref-10b-01-app-listener-migration-design.md \
  docs/superpowers/plans/2026-07-15-ref-10b-01-app-listener-migration.md \
  vault/CURRENT.md vault/10b-工程基线与低风险重构.md
git diff --cached --name-only
```

Expected: only these six paths are staged. If an unrelated path appears, unstage it and stop before commit.

- [ ] **Step 5: Commit the verified migration**

```bash
git commit -m "refactor(audit): migrate App event subscriptions" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Do not push.

## Plan Self-Review

- Coverage: settings adapter, two Tauri channels, lifecycle timings, StrictMode, latest pages, legacy payload, structured snapshot, rejection infrastructure, concurrent hunk, review, unified gate, exact commit allowlist.
- Scope: one App migration unit; every other listener remains deferred.
- Type consistency: uses existing exported hook and policy/settings types; no duplicate production interface.
- Placeholder scan: no unspecified implementation or test step remains.
