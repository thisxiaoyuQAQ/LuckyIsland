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

  it("settles the active city's inflight state when its response arrives", async () => {
    const core = await import("@tauri-apps/api/core");
    const invokeMock = core.invoke as ReturnType<typeof vi.fn>;
    const original = invokeMock.getMockImplementation();
    const response = deferred<WeatherBundle>();
    compactSetting.value = "北京";
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      invokes.push({ command, args });
      if (command === "weather_cities_list") return ["北京"];
      if (command === "setting_get") return compactSetting.value;
      if (command === "weather_get") return response.promise;
      return undefined;
    });

    try {
      const tree = await mountReactTree(<WeatherPage compact={false} />);
      await flushReactWork();
      expect(document.querySelector(".animate-spin")).not.toBeNull();

      response.resolve(weatherBundle("北京"));
      await flushReactWork();

      expect(document.querySelector(".animate-spin")).toBeNull();
      expect(document.querySelector(".text-3xl")?.textContent).toBe("26");
      await tree.unmount();
    } finally {
      invokeMock.mockImplementation(original ?? (() => undefined));
    }
  });

  it("does not cache a deleted city's late response", async () => {
    const core = await import("@tauri-apps/api/core");
    const invokeMock = core.invoke as ReturnType<typeof vi.fn>;
    const original = invokeMock.getMockImplementation();
    const firstBeijing = deferred<WeatherBundle>();
    const secondBeijing = deferred<WeatherBundle>();
    let currentCities = ["北京", "上海"];
    let beijingRequests = 0;
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      invokes.push({ command, args });
      if (command === "weather_cities_list") return currentCities;
      if (command === "setting_get") return compactSetting.value;
      if (command === "weather_cities_remove") {
        currentCities = ["上海"];
        return undefined;
      }
      if (command === "weather_get") {
        const city = (args as { city: string }).city;
        if (city === "北京") {
          beijingRequests += 1;
          return beijingRequests === 1 ? firstBeijing.promise : secondBeijing.promise;
        }
        return weatherBundle(city);
      }
      return undefined;
    });

    try {
      const tree = await mountReactTree(<WeatherPage compact={false} />);
      await flushReactWork();

      const removeBeijing = document.querySelector('button[aria-label="删除北京"]');
      if (!(removeBeijing instanceof HTMLButtonElement)) throw new Error("Beijing remove button not found");
      await dispatch(() => removeBeijing.click());
      await flushReactWork();

      firstBeijing.resolve(weatherBundle("北京"));
      await flushReactWork();

      currentCities = ["北京", "上海"];
      await dispatch(() => importSubscription().callback({
        event: "config://imported",
        id: 4,
        payload: undefined,
      }));
      await flushReactWork();

      const beijing = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "北京",
      );
      if (!(beijing instanceof HTMLButtonElement)) throw new Error("Beijing button not found");
      await dispatch(() => beijing.click());
      await flushReactWork();

      expect(beijingRequests).toBe(2);
      expect(document.querySelector(".text-3xl")).toBeNull();
      await tree.unmount();
    } finally {
      invokeMock.mockImplementation(original ?? (() => undefined));
    }
  });

  it("dedupes a refetch for a city whose request is still inflight", async () => {
    // 让初次挂载的 weather_get 全部挂起（永不 resolve），保持「在途」。
    // mockImplementation 会污染后续用例（restoreAllMocks 不恢复 vi.fn 实现），故结尾显式还原。
    const core = await import("@tauri-apps/api/core");
    const invokeMock = core.invoke as ReturnType<typeof vi.fn>;
    const original = invokeMock.getMockImplementation();
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      invokes.push({ command, args });
      if (command === "weather_cities_list") return ["北京", "上海"];
      if (command === "setting_get") return compactSetting.value;
      if (command === "weather_get") return new Promise<WeatherBundle>(() => undefined);
      return undefined;
    });

    try {
      const tree = await mountReactTree(<WeatherPage compact={false} />);
      await flushReactWork();
      // 初次在途请求已发出（北京 + 紧凑上海）。
      expect(weatherRequests()).toEqual(["北京", "上海"]);
      const before = weatherRequests().length;

      // 两次 import 期间 北京/上海 均在途 → 全部去重，无新增 weather_get。
      cityResponses.push(["北京", "上海"], ["北京", "上海"]);
      await dispatch(() => importSubscription().callback({ event: "config://imported", id: 2, payload: undefined }));
      await dispatch(() => importSubscription().callback({ event: "config://imported", id: 3, payload: undefined }));
      await flushReactWork();

      expect(weatherRequests().slice(before)).toEqual([]);
      await tree.unmount();
    } finally {
      invokeMock.mockImplementation(original ?? (() => undefined));
    }
  });

  it("reconfigures the refresh timer without rebuilding the settings subscription", async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const tree = await mountReactTree(<WeatherPage compact={false} />);
    // 充分等初次挂载的 weather_get settle（真实 Promise 微任务），
    // 否则 interval 触发的刷新会因初次仍在途而被按城市去重。
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const initialRequests = weatherRequests().length;

    await dispatch(() => settingsSubscriptions[0].callback(KEYS.weatherRefreshMin, "5"));
    expect(settingsSubscriptions).toHaveLength(1);
    expect(clearIntervalSpy).toHaveBeenCalled();

    // 未到一个周期：无刷新。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 1000);
    });
    expect(weatherRequests()).toHaveLength(initialRequests);

    // 跨过 5 分钟周期：触发一轮按城市刷新（active 北京 + compact 上海）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 1000);
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
