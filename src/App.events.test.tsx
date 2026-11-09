// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type { IslandState, WindowPolicySnapshot } from "@/lib/window-policy";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface SettingsSubscription {
  callback: (key: string, value: string | null) => void;
  pending: Deferred<() => void>;
}

interface EventSubscription {
  name: string;
  callback: (event: Event<unknown>) => void;
  pending: Deferred<() => void>;
}

const { settingsSubscriptions, eventSubscriptions, deferred, settingsStore, dragController, hoverController } = vi.hoisted(() => {
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
    settingsSubscriptions: [] as SettingsSubscription[],
    eventSubscriptions: [] as EventSubscription[],
    deferred: createDeferred,
    // 模块 14 T2：透明度改为「事件触发重读 KV」，测试用一个内存 KV 让事件载荷落库，
    // settingGet 据此返回——贴合生产「写键→广播→岛窗口重读」的链路。
    settingsStore: new Map<string, string | null>(),
    dragController: {
      setDragging: undefined as ((active: boolean) => void) | undefined,
      onMouseDown: vi.fn(),
      onSettled: vi.fn(),
      dispose: vi.fn(),
    },
    hoverController: {
      resetAfterDrag: vi.fn(),
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: Event<unknown>) => void) => {
    const pending = deferred<() => void>();
    eventSubscriptions.push({ name, callback, pending });
    return pending.promise;
  }),
}));

vi.mock("@/components/pages/time/TimePage", () => ({
  TimePage: ({ compact }: { compact: boolean }) => <div data-testid="page-time" data-compact={compact} />,
}));
vi.mock("@/components/pages/calendar/CalendarPage", () => ({
  CalendarPage: ({ compact }: { compact: boolean }) => <div data-testid="page-calendar" data-compact={compact} />,
}));
vi.mock("@/components/pages/weather/WeatherPage", () => ({
  WeatherPage: ({ compact }: { compact: boolean }) => <div data-testid="page-weather" data-compact={compact} />,
}));
vi.mock("@/components/pages/stock/StockPage", () => ({
  StockPage: ({ compact }: { compact: boolean }) => <div data-testid="page-stock" data-compact={compact} />,
}));
vi.mock("@/components/pages/todo/TodoPage", () => ({
  TodoPage: ({ compact }: { compact: boolean }) => <div data-testid="page-todo" data-compact={compact} />,
}));
vi.mock("@/components/pages/notify/NotifyPage", () => ({
  NotifyPage: ({ compact }: { compact: boolean }) => <div data-testid="page-notify" data-compact={compact} />,
}));
vi.mock("@/components/pages/terminal/TerminalPage", () => ({
  TerminalPage: ({ compact }: { compact: boolean }) => <div data-testid="page-terminal" data-compact={compact} />,
}));

vi.mock("motion/react", async () => {
  const React = await import("react");
  const MotionDiv = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>>(
    (props, ref) => {
      const animate = props.animate as Record<string, unknown> | undefined;
      const {
        animate: _animate,
        custom: _custom,
        exit: _exit,
        initial: _initial,
        transition: _transition,
        variants: _variants,
        ...domProps
      } = props;
      return (
        <div
          ref={ref}
          data-animate={JSON.stringify(props.animate)}
          // 模块 14 T2：背景透明度随 visualPhase 作为 animate 目标（不再在静态 style 上）。
          data-background-color={animate?.backgroundColor as string | undefined}
          {...domProps}
        />
      );
    },
  );
  MotionDiv.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: { div: MotionDiv },
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
    settingGet: vi.fn(async (key: string) => settingsStore.get(key) ?? null),
    settingSetEmit: vi.fn(async (key: string, value: string | null) => {
      settingsStore.set(key, value);
    }),
    onSettingsChanged: vi.fn((callback: (key: string, value: string | null) => void) => {
      const pending = deferred<() => void>();
      settingsSubscriptions.push({
        callback: (key, value) => {
          settingsStore.set(key, value);
          callback(key, value);
        },
        pending,
      });
      return pending.promise;
    }),
  };
});

const compactSnapshot: WindowPolicySnapshot = {
  desiredState: "compact",
  effectiveState: "compact",
  shouldFocus: false,
  clickThrough: false,
  hoverExpand: false,
  floatingBall: false,
  hoverStage: 0,
  hideInFullscreen: false,
  fullscreenSupported: true,
  fullscreenBlock: false,
  priorityOverrideActive: false,
  priorityOverrideGeneration: 0,
};
const expandedSnapshot = {
  ...compactSnapshot,
  desiredState: "expanded",
  effectiveState: "expanded",
} satisfies WindowPolicySnapshot;
const capsuleSnapshot = {
  ...compactSnapshot,
  effectiveState: "capsule",
  floatingBall: true,
} satisfies WindowPolicySnapshot;

vi.mock("@/lib/island-drag-controller", () => ({
    createIslandDragController: vi.fn((options: {
      setDragging: (active: boolean) => void;
      recoverAfterSettleFailure?: () => void | Promise<void>;
    }) => {
      dragController.setDragging = options.setDragging;
      Object.assign(dragController, { recoverAfterSettleFailure: options.recoverAfterSettleFailure });
      return dragController;
    }),
}));

vi.mock("@/lib/window-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/window-policy")>();
  return {
    ...actual,
    windowPolicyGet: vi.fn(async () => compactSnapshot),
    setIslandState: vi.fn(async () => compactSnapshot),
    windowHoverStageSet: vi.fn(async () => compactSnapshot),
    createHoverStageController: vi.fn(() => ({
      enter: vi.fn(),
      leave: vi.fn(),
      suppressCurrentCycle: vi.fn(),
      cancelPendingLeave: vi.fn(),
      resumeStage: vi.fn(),
      setPromotionEnabled: vi.fn(),
      setStageOneEnabled: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      dispose: vi.fn(),
      resetAfterDrag: hoverController.resetAfterDrag,
    })),
    createIslandTransitionController: vi.fn(() => ({
      request: vi.fn(async () => undefined),
      cancel: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

import App from "@/App";
import { KEYS, phaseOpacityKey } from "@/lib/settings";

function emit(name: string, payload: unknown) {
  const subscription = eventSubscriptions.find((entry) => entry.name === name);
  if (!subscription) throw new Error(`missing subscription: ${name}`);
  subscription.callback({ event: name, id: 1, payload });
}

function islandContainer(): HTMLElement {
  const container = document.querySelector("[data-island-container]");
  if (!(container instanceof HTMLElement)) throw new Error("island container not found");
  return container;
}

async function dispatch(callback: () => void) {
  await act(async () => {
    callback();
    await Promise.resolve();
  });
}

function allSubscriptions() {
  return [...eventSubscriptions, ...settingsSubscriptions];
}

describe("App event subscriptions", () => {
  beforeEach(() => {
    settingsSubscriptions.length = 0;
    eventSubscriptions.length = 0;
    settingsStore.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps notify registration stable while using the latest enabled pages", async () => {
    const tree = await mountReactTree(<App />);
    allSubscriptions().forEach((entry) => entry.pending.resolve(vi.fn()));
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

    await dispatch(() => {
      settingsSubscriptions[0].callback(KEYS.theme, "dark");
      settingsSubscriptions[0].callback(KEYS.blur, "false");
      // 模块 14 T2：透明度拆为展开/收起两相位键；紧凑相位默认相位即收起值。
      settingsSubscriptions[0].callback(phaseOpacityKey("island", "compact"), "0.5");
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(islandContainer().className).not.toContain("backdrop-blur-xl");
    expect(islandContainer().dataset.backgroundColor).toContain("50%");

    // 另一个模式的透明度不能影响当前（island）模式——「两模式共享」回归护栏。
    await dispatch(() => {
      settingsSubscriptions[0].callback(phaseOpacityKey("classisland", "compact"), "0.9");
    });
    expect(islandContainer().dataset.backgroundColor).toContain("50%");

    await dispatch(() => emit("window://state-changed", "hidden" satisfies IslandState));
    expect(islandContainer().dataset.animate).toContain('"opacity":0');

    await dispatch(() => emit("window://state-changed", "compact" satisfies IslandState));
    expect(islandContainer().dataset.animate).toContain('"opacity":1');

    await dispatch(() => emit("window://state-changed", expandedSnapshot));
    expect(document.querySelector('[data-testid="page-time"][data-compact="false"]')).not.toBeNull();
    await tree.unmount();
  });

  it("replaces expanded content with the independent drag capsule", async () => {
    const tree = await mountReactTree(<App />);
    dragController.setDragging?.(true);
    await flushReactWork();
    const container = islandContainer();
    expect(container.dataset.presentation).toBe("dragging");
    expect(container.querySelector("[data-drag-presentation]")?.textContent).toContain("拖动调整位置");
    expect(container.querySelector('[data-testid="page-time"]')).toBeNull();
    expect(container.querySelector('button[aria-label="展开/收起"]')).toBeNull();
    await tree.unmount();
  });

  it("forwards well-formed drag-settled events to the drag controller", async () => {
    const tree = await mountReactTree(<App />);
    allSubscriptions().forEach((entry) => entry.pending.resolve(vi.fn()));
    await flushReactWork();

    const settled = { id: 3, ok: true, edge: "left", error: null };
    await dispatch(() => emit("window://drag-settled", settled));
    await dispatch(() => emit("window://drag-settled", { id: "bad" }));

    expect(dragController.onSettled).toHaveBeenCalledTimes(1);
    expect(dragController.onSettled).toHaveBeenCalledWith(settled);
    await tree.unmount();
  });

  it("resets hover presentation after drag completion", async () => {
    const tree = await mountReactTree(<App />);
    await dispatch(() => {
      dragController.setDragging?.(true);
      dragController.setDragging?.(false);
    });
    expect(hoverController.resetAfterDrag).toHaveBeenCalledTimes(1);
    await tree.unmount();
  });

  it("capsule renders only compact content and hides all action buttons", async () => {
    const tree = await mountReactTree(<App />);
    allSubscriptions().forEach((entry) => entry.pending.resolve(vi.fn()));
    await flushReactWork();

    const settingsButton = () => document.querySelector('button[aria-label="打开设置"]');
    const expandButton = () => document.querySelector('button[aria-label="展开/收起"]');

    expect(settingsButton()).not.toBeNull();
    expect(expandButton()).not.toBeNull();

    await dispatch(() => emit("window://state-changed", capsuleSnapshot));
    // 胶囊态：右侧 hover/action 命中区整体不渲染（无展开钮、无设置钮）。
    expect(settingsButton()).toBeNull();
    expect(expandButton()).toBeNull();
    // 胶囊态仍渲染当前页紧凑内容。
    expect(document.querySelector('[data-testid="page-time"][data-compact="true"]')).not.toBeNull();

    await dispatch(() => emit("window://state-changed", compactSnapshot));
    expect(settingsButton()).not.toBeNull();
    expect(expandButton()).not.toBeNull();
    await tree.unmount();
  });

  it("immediately disposes subscriptions that resolve after unmount", async () => {
    const tree = await mountReactTree(<App />);
    const subscriptions = allSubscriptions();
    const disposers = subscriptions.map(() => vi.fn());

    await tree.unmount();
    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();

    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode subscription exactly once", async () => {
    const tree = await mountReactTree(<StrictMode><App /></StrictMode>);
    const subscriptions = allSubscriptions();
    const disposers = subscriptions.map(() => vi.fn());

    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(settingsSubscriptions).toHaveLength(2);
    expect(eventSubscriptions.filter((entry) => entry.name === "window://state-changed")).toHaveLength(2);
    expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });
});
