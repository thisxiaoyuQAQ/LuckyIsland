// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type { WindowPolicySnapshot } from "@/lib/window-policy";
import type { MonitorInfo, MonitorSelectionState } from "@/lib/settings";

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

const { listeners, monitorLists, deferred } = vi.hoisted(() => {
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
    listeners: [] as EventSubscription[],
    monitorLists: [] as Array<Deferred<MonitorInfo[]>>,
    deferred: createDeferred,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: Event<unknown>) => void) => {
    const pending = deferred<() => void>();
    listeners.push({ name, callback, pending });
    return pending.promise;
  }),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, disabled }: { checked?: boolean; disabled?: boolean }) => (
    <button data-testid="switch" data-checked={String(Boolean(checked))} disabled={disabled} />
  ),
}));

const initialMonitor: MonitorInfo = {
  id: "primary-monitor",
  label: "Primary",
  isPrimary: true,
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
};

const externalMonitor: MonitorInfo = {
  id: "external-monitor",
  label: "External",
  isPrimary: false,
  position: { x: 1920, y: 0 },
  size: { width: 2560, height: 1440 },
};

const initialSelection: MonitorSelectionState = {
  selected: "primary",
  resolved: "primary-monitor",
  fallback: false,
};

const initialPolicy: WindowPolicySnapshot = {
  desiredState: "compact",
  effectiveState: "compact",
  shouldFocus: false,
  clickThrough: false,
  hoverExpand: false,
  hovered: false,
  hideInFullscreen: false,
  fullscreenSupported: true,
  fullscreenBlock: false,
  priorityOverrideActive: false,
  priorityOverrideGeneration: 0,
};

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    autostartGet: vi.fn(async () => false),
    autostartSet: vi.fn(async () => undefined),
    settingGet: vi.fn(async () => null),
    settingSetEmit: vi.fn(async () => undefined),
    monitorGetSelection: vi.fn(async () => initialSelection),
    monitorList: vi.fn(() => {
      const request = deferred<MonitorInfo[]>();
      monitorLists.push(request);
      return request.promise;
    }),
    monitorSelect: vi.fn(async () => initialSelection),
  };
});

vi.mock("@/lib/window-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/window-policy")>();
  return {
    ...actual,
    windowPolicyGet: vi.fn(async () => initialPolicy),
    windowClickThroughSet: vi.fn(async () => initialPolicy),
    windowHoverExpandSet: vi.fn(async () => initialPolicy),
    windowHideInFullscreenSet: vi.fn(async () => initialPolicy),
  };
});

import { GeneralPanel } from "../GeneralPanel";
import { monitorList } from "@/lib/settings";

function subscription(name: string, occurrence = 0): EventSubscription {
  const found = listeners.filter((entry) => entry.name === name)[occurrence];
  if (!found) throw new Error(`missing ${name} subscription ${occurrence}`);
  return found;
}

function emit<T>(entry: EventSubscription, payload: T): void {
  entry.callback({ event: entry.name, id: 1, payload });
}

async function mountPanel(element = <GeneralPanel />) {
  const tree = await mountReactTree(element);
  expect(monitorLists.length).toBeGreaterThan(0);
  const initialLoads = [...monitorLists];
  initialLoads.forEach((request) => request.resolve([initialMonitor, externalMonitor]));
  await flushReactWork();
  expect(document.body.textContent).toContain("总体开关");
  return tree;
}

function monitorSelect(): HTMLSelectElement {
  const found = Array.from(document.querySelectorAll("select")).find((select) =>
    Array.from(select.options).some((option) => option.value === "primary"),
  );
  if (!(found instanceof HTMLSelectElement)) throw new Error("monitor select not found");
  return found;
}

function switches(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="switch"]'));
}

describe("GeneralPanel event subscriptions", () => {
  beforeEach(() => {
    listeners.length = 0;
    monitorLists.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("registers both event listeners once across event-driven rerenders", async () => {
    const tree = await mountPanel();

    await act(async () => {
      emit(subscription("window://policy-changed"), {
        ...initialPolicy,
        clickThrough: true,
      });
    });

    expect(listeners.filter((entry) => entry.name === "monitor://changed")).toHaveLength(1);
    expect(listeners.filter((entry) => entry.name === "window://policy-changed")).toHaveLength(1);
    await tree.unmount();
  });

  it("applies monitor payload immediately and refreshes the monitor list", async () => {
    const tree = await mountPanel();
    const next: MonitorSelectionState = {
      selected: "external-monitor",
      resolved: "external-monitor",
      fallback: false,
    };

    await act(async () => emit(subscription("monitor://changed"), next));

    expect(monitorSelect().value).toBe("external-monitor");
    expect(monitorList).toHaveBeenCalledTimes(2);
    monitorLists[1].resolve([initialMonitor, externalMonitor]);
    await flushReactWork();
    expect(monitorSelect().querySelector('option[value="external-monitor"]')?.textContent).toContain(
      "External",
    );
    await tree.unmount();
  });

  it("shows monitor refresh failure without rolling back event state", async () => {
    const tree = await mountPanel();
    const next: MonitorSelectionState = {
      selected: "missing-monitor",
      resolved: "primary-monitor",
      fallback: true,
    };

    await act(async () => emit(subscription("monitor://changed"), next));
    monitorLists[1].reject(new Error("refresh failed"));
    await flushReactWork();

    expect(monitorSelect().value).toBe("missing-monitor");
    expect(document.body.textContent).toContain("显示器设置失败：refresh failed");
    await tree.unmount();
  });

  it("does not start monitor refresh from a stale callback after unmount", async () => {
    const tree = await mountPanel();
    const stale = subscription("monitor://changed");

    await tree.unmount();
    emit(stale, { selected: "external-monitor", resolved: "external-monitor", fallback: false });

    expect(monitorList).toHaveBeenCalledTimes(1);
    stale.pending.resolve(vi.fn());
    await flushReactWork();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores monitor refresh that %ss after unmount",
    async (settlement) => {
      const tree = await mountPanel();
      await act(async () => {
        emit(subscription("monitor://changed"), {
          selected: "external-monitor",
          resolved: "external-monitor",
          fallback: false,
        });
      });
      expect(monitorLists).toHaveLength(2);

      await tree.unmount();
      if (settlement === "resolve") monitorLists[1].resolve([initialMonitor, externalMonitor]);
      else monitorLists[1].reject(new Error("late refresh failure"));
      await flushReactWork();

      expect(document.body.textContent).toBe("");
    },
  );

  it("updates all four policy fields from one snapshot", async () => {
    const tree = await mountPanel();

    await act(async () => {
      emit(subscription("window://policy-changed"), {
        ...initialPolicy,
        clickThrough: true,
        hoverExpand: true,
        hideInFullscreen: true,
        fullscreenSupported: false,
      });
    });

    const controls = switches();
    expect(controls[1].dataset.checked).toBe("true");
    expect(controls[2].dataset.checked).toBe("true");
    expect(controls[3].dataset.checked).toBe("true");
    expect(controls[3].disabled).toBe(true);
    await tree.unmount();
  });

  it("ignores a stale policy callback after unmount", async () => {
    const tree = await mountPanel();
    const stale = subscription("window://policy-changed");

    await tree.unmount();
    emit(stale, { ...initialPolicy, clickThrough: true });
    stale.pending.resolve(vi.fn());
    await flushReactWork();

    expect(document.body.textContent).toBe("");
  });

  it("disposes both resolved listeners once", async () => {
    const tree = await mountPanel();
    const monitorDispose = vi.fn();
    const policyDispose = vi.fn();
    subscription("monitor://changed").pending.resolve(monitorDispose);
    subscription("window://policy-changed").pending.resolve(policyDispose);
    await flushReactWork();

    await tree.unmount();

    expect(monitorDispose).toHaveBeenCalledTimes(1);
    expect(policyDispose).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes both listeners when registration resolves after unmount", async () => {
    const tree = await mountPanel();
    const monitorEntry = subscription("monitor://changed");
    const policyEntry = subscription("window://policy-changed");
    const monitorDispose = vi.fn();
    const policyDispose = vi.fn();

    await tree.unmount();
    monitorEntry.pending.resolve(monitorDispose);
    policyEntry.pending.resolve(policyDispose);
    await flushReactWork();

    expect(monitorDispose).toHaveBeenCalledTimes(1);
    expect(policyDispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode listener generation and rejects stale callbacks", async () => {
    const tree = await mountPanel(
      <StrictMode>
        <GeneralPanel />
      </StrictMode>,
    );
    const monitorEntries = listeners.filter((entry) => entry.name === "monitor://changed");
    const policyEntries = listeners.filter((entry) => entry.name === "window://policy-changed");
    const entries = [...monitorEntries, ...policyEntries];
    const disposers = entries.map(() => vi.fn());

    expect(monitorEntries).toHaveLength(2);
    expect(policyEntries).toHaveLength(2);
    emit(monitorEntries[0], {
      selected: "external-monitor",
      resolved: "external-monitor",
      fallback: false,
    });
    emit(policyEntries[0], { ...initialPolicy, clickThrough: true });
    expect(monitorList).toHaveBeenCalledTimes(2);

    entries.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["monitor://changed", "window://policy-changed"])(
    "diagnoses %s registration rejection with a scoped label",
    async (eventName) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const tree = await mountPanel();

      subscription(eventName).pending.reject(new Error("registration rejected"));
      await flushReactWork();

      expect(error).toHaveBeenCalledWith(
        `[async-subscription] listen:${eventName}`,
        expect.objectContaining({ message: "registration rejected" }),
      );
      await tree.unmount();
    },
  );
});
