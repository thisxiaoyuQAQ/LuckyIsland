// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type { WeatherBundle } from "../model";

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
  listeners,
  settingsSubscriptions,
  invokes,
  cityResponses,
  compactSetting,
  refreshSetting,
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
    listeners: [] as EventSubscription[],
    settingsSubscriptions: [] as SettingsSubscription[],
    invokes: [] as Array<{ command: string; args: unknown }>,
    cityResponses: [] as string[][],
    compactSetting: { value: "上海" as string | null },
    refreshSetting: { value: "10" as string | null },
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
    if (command === "weather_cities_list") return cityResponses.shift() ?? ["北京", "上海"];
    if (command === "setting_get") return compactSetting.value;
    if (command === "weather_get") {
      const city = (args as { city: string }).city;
      return weatherBundle(city);
    }
    return undefined;
  }),
}));

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    settingGet: vi.fn(async () => refreshSetting.value),
    onSettingsChanged: vi.fn((callback: (key: string, value: string | null) => void) => {
      const pending = deferred<() => void>();
      settingsSubscriptions.push({ callback, pending });
      return pending.promise;
    }),
  };
});

vi.mock("@/lib/useReorder", () => ({
  useReorder: () => ({
    overIndex: null,
    itemProps: () => ({}),
  }),
}));

import { WeatherPage } from "../WeatherPage";
import { KEYS, settingGet } from "@/lib/settings";

function weatherBundle(city: string): WeatherBundle {
  return {
    now: {
      province: "测试省",
      city,
      district: null,
      weather: "晴",
      weatherIcon: "100",
      temperature: 26,
      windDirection: "东风",
      windPower: "2级",
      humidity: 50,
      reportTime: "2026-07-16 12:00",
      alerts: [],
      offline: false,
      fetchedAt: 1_752_643_200,
    },
    forecast: [],
    source: {
      current: "fixture",
      forecast: "fixture",
      attribution: null,
      attributionUrl: null,
      license: null,
    },
    location: {
      queryName: city,
      displayName: city,
      province: "测试省",
      country: "中国",
      latitude: 0,
      longitude: 0,
      timezone: "Asia/Shanghai",
      providerId: city,
    },
    timezone: "Asia/Shanghai",
    offline: false,
    partial: false,
    fetchedAt: 1_752_643_200,
  };
}

function importSubscription(): EventSubscription {
  const found = listeners.find((entry) => entry.name === "config://imported");
  if (!found) throw new Error("missing config import subscription");
  return found;
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

function weatherRequests(): string[] {
  return invokes
    .filter((entry) => entry.command === "weather_get")
    .map((entry) => (entry.args as { city: string }).city);
}

describe("WeatherPage subscriptions", () => {
  beforeEach(() => {
    listeners.length = 0;
    settingsSubscriptions.length = 0;
    invokes.length = 0;
    cityResponses.length = 0;
    cityResponses.push(["北京", "上海"]);
    compactSetting.value = "上海";
    refreshSetting.value = "10";
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("registers import and refresh-setting subscriptions once", async () => {
    const tree = await mountReactTree(<WeatherPage compact={false} />);
    await flushReactWork();

    expect(listeners.filter((entry) => entry.name === "config://imported")).toHaveLength(1);
    expect(settingsSubscriptions).toHaveLength(1);
    expect(settingGet).toHaveBeenCalledTimes(1);
    expect(settingGet).toHaveBeenCalledWith(KEYS.weatherRefreshMin);
    await tree.unmount();
  });

  it("uses the latest cities on import without rebuilding the listener", async () => {
    const tree = await mountReactTree(<WeatherPage compact={false} />);
    await flushReactWork();

    const shanghai = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "上海",
    );
    if (!(shanghai instanceof HTMLButtonElement)) throw new Error("Shanghai button not found");
    await dispatch(() => shanghai.click());

    expect(listeners.filter((entry) => entry.name === "config://imported")).toHaveLength(1);

    cityResponses.push(["广州", "上海"]);
    const beforeImport = weatherRequests().length;
    await dispatch(() => importSubscription().callback({
      event: "config://imported",
      id: 1,
      payload: undefined,
    }));
    await flushReactWork();

    expect(weatherRequests().slice(beforeImport)).toEqual(["上海"]);
    expect(listeners.filter((entry) => entry.name === "config://imported")).toHaveLength(1);
    await tree.unmount();
  });

  it("reconfigures the refresh timer without rebuilding the settings subscription", async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const tree = await mountReactTree(<WeatherPage compact={false} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const initialRequests = weatherRequests().length;

    await dispatch(() => settingsSubscriptions[0].callback(KEYS.weatherRefreshMin, "5"));
    expect(settingsSubscriptions).toHaveLength(1);
    expect(clearIntervalSpy).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000 - 1);
      await Promise.resolve();
    });
    expect(weatherRequests()).toHaveLength(initialRequests);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(weatherRequests().slice(initialRequests)).toEqual(["北京", "上海"]);

    await tree.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it("disposes subscriptions that resolve before unmount exactly once", async () => {
    const tree = await mountReactTree(<WeatherPage compact={false} />);
    const subscriptions = allSubscriptions();
    const disposers = subscriptions.map(() => vi.fn());

    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(subscriptions).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes subscriptions that resolve after unmount", async () => {
    const tree = await mountReactTree(<WeatherPage compact={false} />);
    const subscriptions = allSubscriptions();
    const disposers = subscriptions.map(() => vi.fn());

    await tree.unmount();
    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();

    expect(subscriptions).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode subscription exactly once", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <WeatherPage compact={false} />
      </StrictMode>,
    );
    const subscriptions = allSubscriptions();
    const disposers = subscriptions.map(() => vi.fn());

    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(listeners.filter((entry) => entry.name === "config://imported")).toHaveLength(2);
    expect(settingsSubscriptions).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("diagnoses import and settings subscription rejection with scoped labels", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountReactTree(<WeatherPage compact={false} />);

    importSubscription().pending.reject(new Error("import rejected"));
    settingsSubscriptions[0].pending.reject(new Error("settings rejected"));
    await flushReactWork();

    expect(error).toHaveBeenCalledWith(
      "[async-subscription] listen:config://imported",
      expect.objectContaining({ message: "import rejected" }),
    );
    expect(error).toHaveBeenCalledWith(
      "[async-subscription] settings://changed:weather",
      expect.objectContaining({ message: "settings rejected" }),
    );
    await tree.unmount();
  });
});
