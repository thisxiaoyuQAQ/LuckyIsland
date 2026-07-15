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

interface EventSubscription {
  name: string;
  callback: (event: Event<unknown>) => void;
  pending: Deferred<() => void>;
}

interface SettingsSubscription {
  callback: (key: string, value: string | null) => void;
  pending: Deferred<() => void>;
}

const { listeners, settingsSubscriptions, invokes, stockResponses, deferred } = vi.hoisted(() => {
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
    settingsSubscriptions: [] as SettingsSubscription[],
    invokes: [] as Array<{ command: string; args: unknown }>,
    stockResponses: [] as Quote[][],
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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: unknown) => {
    invokes.push({ command, args });
    if (command === "stock_get") return stockResponses.shift() ?? [];
    if (command === "setting_get") return null;
    return undefined;
  }),
}));

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    settingGet: vi.fn(async () => "true"),
    onSettingsChanged: vi.fn((callback: (key: string, value: string | null) => void) => {
      const pending = deferred<() => void>();
      settingsSubscriptions.push({ callback, pending });
      return pending.promise;
    }),
  };
});

vi.mock("../StockAdd", () => ({
  StockAdd: () => <div />,
}));

vi.mock("../StockDetail", () => ({
  StockDetail: ({ quote }: { quote: Quote }) => <div data-testid="stock-detail">{quote.name}</div>,
}));

vi.mock("@/lib/useReorder", () => ({
  useReorder: () => ({
    overIndex: null,
    itemProps: () => ({}),
  }),
}));

import { StockPage } from "../StockPage";
import { KEYS } from "@/lib/settings";

const firstQuote: Quote = {
  symbol: "sh600000",
  name: "浦发银行",
  code: "600000",
  current: 10.5,
  yesterday_close: 10,
  open: 10.1,
  high: 10.8,
  low: 9.9,
  change: 0.5,
  change_percent: 5,
  time: "20260715103000",
  volume: 1000,
  amount: 10_500,
  turnover_rate: 1.2,
  pe: 8.5,
  amplitude: 9,
  circ_market_cap: 100_000,
  total_market_cap: 120_000,
  pb: 1.1,
  limit_up: 11,
  limit_down: 9,
  volume_ratio: 1.3,
};

const secondQuote: Quote = {
  ...firstQuote,
  symbol: "sz000001",
  name: "平安银行",
  code: "000001",
  current: 12.25,
};

function subscription(name: string): EventSubscription {
  const found = listeners.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing subscription: ${name}`);
  return found;
}

function emit(name: string, payload: unknown): void {
  subscription(name).callback({ event: name, id: 1, payload });
}

function allSubscriptions(): Array<EventSubscription | SettingsSubscription> {
  return [...listeners, ...settingsSubscriptions];
}

async function dispatch(callback: () => void): Promise<void> {
  await act(async () => {
    callback();
    await Promise.resolve();
  });
}

describe("StockPage subscriptions", () => {
  beforeEach(() => {
    listeners.length = 0;
    settingsSubscriptions.length = 0;
    invokes.length = 0;
    stockResponses.length = 0;
    stockResponses.push([firstQuote]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("registers tick, import, and settings subscriptions once", async () => {
    const tree = await mountReactTree(<StockPage compact={false} />);

    expect(listeners.filter((entry) => entry.name === "stock://tick")).toHaveLength(1);
    expect(listeners.filter((entry) => entry.name === "config://imported")).toHaveLength(1);
    expect(settingsSubscriptions).toHaveLength(1);
    await tree.unmount();
  });

  it("updates quotes from stock ticks without rebuilding listeners", async () => {
    const tree = await mountReactTree(<StockPage compact={false} />);
    await flushReactWork();

    await dispatch(() => emit("stock://tick", [secondQuote]));

    expect(document.body.textContent).toContain(secondQuote.name);
    expect(document.body.textContent).not.toContain(firstQuote.name);
    expect(listeners.filter((entry) => entry.name === "stock://tick")).toHaveLength(1);
    expect(listeners.filter((entry) => entry.name === "config://imported")).toHaveLength(1);
    await tree.unmount();
  });

  it("refreshes after config import and clears an open detail view", async () => {
    stockResponses.push([secondQuote]);
    const tree = await mountReactTree(<StockPage compact={false} />);
    await flushReactWork();

    const row = Array.from(document.querySelectorAll("li")).find((entry) =>
      entry.textContent?.includes(firstQuote.name),
    );
    if (!(row instanceof HTMLElement)) throw new Error("stock row not found");
    await dispatch(() => row.click());
    expect(document.querySelector('[data-testid="stock-detail"]')).not.toBeNull();

    await dispatch(() => emit("config://imported", undefined));
    await flushReactWork();

    expect(document.querySelector('[data-testid="stock-detail"]')).toBeNull();
    expect(document.body.textContent).toContain(secondQuote.name);
    expect(invokes.filter((entry) => entry.command === "stock_get")).toHaveLength(2);
    await tree.unmount();
  });

  it("applies the latest stock red-up setting to quote colors", async () => {
    const tree = await mountReactTree(<StockPage compact={false} />);
    await flushReactWork();

    const price = Array.from(document.querySelectorAll("div")).find(
      (entry) => entry.textContent === firstQuote.current.toFixed(2),
    );
    if (!(price instanceof HTMLElement)) throw new Error("stock price not found");
    expect(price.className).toContain("text-red-500");

    await dispatch(() => settingsSubscriptions[0].callback(KEYS.stockRedUp, "false"));

    expect(price.className).toContain("text-green-500");
    expect(settingsSubscriptions).toHaveLength(1);
    await tree.unmount();
  });

  it("immediately disposes all subscriptions that resolve after unmount", async () => {
    const tree = await mountReactTree(<StockPage compact={false} />);
    const subscriptions = allSubscriptions();
    const disposers = subscriptions.map(() => vi.fn());

    await tree.unmount();
    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();

    expect(subscriptions).toHaveLength(3);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode subscription exactly once", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <StockPage compact={false} />
      </StrictMode>,
    );
    const subscriptions = allSubscriptions();
    const disposers = subscriptions.map(() => vi.fn());

    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(listeners.filter((entry) => entry.name === "stock://tick")).toHaveLength(2);
    expect(listeners.filter((entry) => entry.name === "config://imported")).toHaveLength(2);
    expect(settingsSubscriptions).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("diagnoses Tauri and settings subscription rejection with scoped labels", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountReactTree(<StockPage compact={false} />);

    subscription("stock://tick").pending.reject(new Error("tick rejected"));
    subscription("config://imported").pending.reject(new Error("import rejected"));
    settingsSubscriptions[0].pending.reject(new Error("settings rejected"));
    await flushReactWork();

    expect(error).toHaveBeenCalledWith(
      "[async-subscription] listen:stock://tick",
      expect.objectContaining({ message: "tick rejected" }),
    );
    expect(error).toHaveBeenCalledWith(
      "[async-subscription] listen:config://imported",
      expect.objectContaining({ message: "import rejected" }),
    );
    expect(error).toHaveBeenCalledWith(
      "[async-subscription] settings://changed:stock",
      expect.objectContaining({ message: "settings rejected" }),
    );
    await tree.unmount();
  });
});
