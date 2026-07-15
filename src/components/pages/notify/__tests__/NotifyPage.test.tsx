// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type { NotificationItem } from "../NotifyCard";

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

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: confirmMock }));
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
vi.mock("motion/react", async () => {
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div {...props}>{children}</div>
      ),
    },
  };
});

import { NotifyPage } from "../NotifyPage";
import { KEYS } from "@/lib/settings";

function item(index: number): NotificationItem {
  return {
    id: String(index),
    title: `通知 ${index}`,
    body: null,
    source: "custom",
    level: "info",
    priority: "normal",
    created_at: index,
    read: true,
    action: null,
  };
}

function button(root: ParentNode, name: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
}

async function click(target: HTMLElement) {
  await act(async () => target.click());
  await flushReactWork();
}

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

function emitIncoming(payload: NotificationItem): void {
  subscription("notify://incoming").callback({
    event: "notify://incoming",
    id: 1,
    payload,
  });
}

function allSubscriptions(): Array<EventSubscription | SettingsSubscription> {
  return [...eventSubscriptions, ...settingsSubscriptions];
}

describe("NotifyPage history management", () => {
  beforeEach(() => {
    eventSubscriptions.length = 0;
    settingsSubscriptions.length = 0;
    invokeMock.mockReset();
    confirmMock.mockReset();
    settingGetMock.mockReset();
    settingGetMock.mockResolvedValue("claude,codex,custom");
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("renders twenty items first and loads twenty more", async () => {
    invokeMock.mockResolvedValue(Array.from({ length: 45 }, (_, index) => item(index)));
    const tree = await mountReactTree(<NotifyPage compact={false} />);
    await flushReactWork();

    expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(20);
    await click(button(document, "加载更多"));
    expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(40);
    await click(button(document, "加载更多"));
    expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(45);
    expect(document.body.textContent).not.toContain("加载更多");

    await tree.unmount();
  });

  it("cancels clear without invoking the backend", async () => {
    invokeMock.mockResolvedValue([item(1)]);
    confirmMock.mockResolvedValue(false);
    const tree = await mountReactTree(<NotifyPage compact={false} />);
    await flushReactWork();

    await click(button(document, "清理历史"));

    expect(invokeMock).not.toHaveBeenCalledWith("notify_clear");
    expect(document.querySelectorAll("[data-notification-id]").length).toBeGreaterThan(0);
    await tree.unmount();
  });

  it("preserves items on failure and clears after backend success", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "notify_clear") return Promise.reject(new Error("database busy"));
      return Promise.resolve([item(1)]);
    });
    confirmMock.mockResolvedValue(true);
    const tree = await mountReactTree(<NotifyPage compact={false} />);
    await flushReactWork();

    await click(button(document, "清理历史"));
    expect(document.body.textContent).toContain("清理历史失败：database busy");
    expect(document.querySelectorAll("[data-notification-id]").length).toBeGreaterThan(0);

    invokeMock.mockImplementation((command: string) =>
      command === "notify_clear" ? Promise.resolve(1) : Promise.resolve([item(1)]),
    );
    await click(button(document, "清理历史"));
    expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(0);

    await tree.unmount();
  });

  it("registers incoming and settings subscriptions once", async () => {
    invokeMock.mockResolvedValue([]);
    const tree = await mountReactTree(<NotifyPage compact />);

    expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(1);
    expect(settingsSubscriptions).toHaveLength(1);
    await tree.unmount();
  });

  it("applies the initial source filter before incoming notifications", async () => {
    invokeMock.mockResolvedValue([]);
    settingGetMock.mockResolvedValue("custom");
    const tree = await mountReactTree(<NotifyPage compact={false} />);
    await flushReactWork();

    const filtered = {
      ...item(8_001),
      id: "initial-filtered",
      title: "初始过滤通知",
      source: "codex",
    };
    await dispatch(() => emitIncoming(filtered));

    expect(settingGetMock).toHaveBeenCalledOnce();
    expect(settingGetMock).toHaveBeenCalledWith(KEYS.notifyFilterSources);
    expect(document.body.textContent).not.toContain(filtered.title);
    await tree.unmount();
  });

  it("uses the latest source filter without rebuilding subscriptions", async () => {
    invokeMock.mockResolvedValue([]);
    const tree = await mountReactTree(<NotifyPage compact={false} />);
    await flushReactWork();

    const historyReadCount = invokeMock.mock.calls.filter(
      ([command]) => command === "notify_list",
    ).length;
    const settingsReadCount = settingGetMock.mock.calls.length;

    const filtered = {
      ...item(9_001),
      id: "incoming-filtered",
      title: "过滤缓存通知",
      source: "codex",
    };
    const visible = {
      ...item(9_002),
      id: "incoming-after-filter",
      title: "过滤后可见通知",
      source: "custom",
    };

    await dispatch(() => settingsSubscriptions[0].callback(KEYS.notifyFilterSources, "custom"));
    await dispatch(() => emitIncoming(filtered));
    expect(document.body.textContent).not.toContain(filtered.title);

    await dispatch(() => emitIncoming(visible));
    expect(document.body.textContent).toContain(visible.title);
    expect(document.body.textContent).toContain(filtered.title);
    expect(eventSubscriptions.filter((entry) => entry.name === "notify://incoming")).toHaveLength(1);
    expect(settingsSubscriptions).toHaveLength(1);
    expect(invokeMock.mock.calls.filter(([command]) => command === "notify_list")).toHaveLength(
      historyReadCount,
    );
    expect(settingGetMock).toHaveBeenCalledTimes(settingsReadCount);
    await tree.unmount();
  });

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
});
