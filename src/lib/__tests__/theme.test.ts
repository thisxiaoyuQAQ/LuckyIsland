// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlistenFn } from "@tauri-apps/api/event";

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

interface MediaQueryListener {
  (event: { matches: boolean }): void;
}

const {
  settingGetMock,
  settingsChangedCallbacks,
  settingsSubscriptions,
  mediaQueries,
  systemDarkState,
  matchMediaMock,
  resetMediaQueries,
} = vi.hoisted(() => {
  interface DeferredRef<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
  }

  interface MediaQueryListenerRef {
    (event: { matches: boolean }): void;
  }
  interface FakeMediaQueryListRef {
    matches: boolean;
    listeners: Set<MediaQueryListenerRef>;
    addEventListener: (type: string, listener: MediaQueryListenerRef) => void;
    removeEventListener: (type: string, listener: MediaQueryListenerRef) => void;
  }

  // 稳定数组引用：helper 始终读这一个数组；reset 只清空不替换。
  const queries: FakeMediaQueryListRef[] = [];
  // 当前系统深浅（模块级）：matchMedia 新建的每个 MQ 都从这里取初始 matches，
  // setSystemDark 改它即可影响已建与后续新建的所有 MQ（贴近真实系统偏好的全局性）。
  const systemState = { dark: false };
  const settingGet = vi.fn<(key: string) => Promise<string | null>>();
  const callbacks: Array<(key: string, value: string | null) => void> = [];
  const subscriptions: Array<DeferredRef<UnlistenFn>> = [];

  return {
    settingGetMock: settingGet,
    settingsChangedCallbacks: callbacks,
    settingsSubscriptions: subscriptions,
    mediaQueries: queries,
    systemDarkState: systemState,
    matchMediaMock: vi.fn((_query: string) => {
      const listeners = new Set<MediaQueryListenerRef>();
      const mq: FakeMediaQueryListRef = {
        matches: systemState.dark,
        listeners,
        addEventListener: (_type, listener) => {
          listeners.add(listener);
        },
        removeEventListener: (_type, listener) => {
          listeners.delete(listener);
        },
      };
      queries.push(mq);
      return mq as unknown as MediaQueryList;
    }),
    resetMediaQueries: () => {
      queries.length = 0;
      systemState.dark = false;
    },
  };
});

vi.mock("@/lib/settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...original,
    settingGet: settingGetMock,
    onSettingsChanged: (cb: (key: string, value: string | null) => void) => {
      settingsChangedCallbacks.push(cb);
      const subscription = deferred<UnlistenFn>();
      settingsSubscriptions.push(subscription);
      return subscription.promise;
    },
  };
});

import {
  applyTheme,
  parseThemeMode,
  resolveTheme,
  startThemeSync,
  systemTheme,
} from "@/lib/theme";

/** 当前用例内注册了 change 监听器的 MQ（即 startThemeSync 持有的那个）。 */
function withListeners(): Array<{ mq: object; listeners: Set<MediaQueryListener> }> {
  return mediaQueries
    .map((mq) => mq as unknown as { matches: boolean; listeners: Set<MediaQueryListener> })
    .filter((entry) => entry.listeners.size > 0)
    .map((entry) => ({ mq: entry, listeners: entry.listeners }));
}

/** 设置系统深浅：改模块级状态 + 同步所有已建 MQ，后续新建 MQ 也会读到。 */
function setSystemDark(matches: boolean) {
  systemDarkState.dark = matches;
  for (const mq of mediaQueries) {
    (mq as unknown as { matches: boolean }).matches = matches;
  }
}

/** 触发系统主题变化：更新系统状态，并回调已注册的 change 监听器。 */
function emitSystemChange(matches: boolean) {
  setSystemDark(matches);
  for (const { listeners } of withListeners()) {
    for (const listener of [...listeners]) listener({ matches });
  }
}

function emitSettingsChanged(key: string, value: string | null) {
  for (const cb of settingsChangedCallbacks) cb(key, value);
}

beforeEach(() => {
  settingsChangedCallbacks.length = 0;
  settingsSubscriptions.length = 0;
  vi.clearAllMocks();
  resetMediaQueries();
  vi.stubGlobal("matchMedia", matchMediaMock);
  document.documentElement.removeAttribute("data-theme");
  settingGetMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.body.replaceChildren();
});

describe("parseThemeMode", () => {
  it("accepts the three supported modes", () => {
    expect(parseThemeMode("light")).toBe("light");
    expect(parseThemeMode("dark")).toBe("dark");
    expect(parseThemeMode("auto")).toBe("auto");
  });

  it.each([null, undefined, "", "blue", "DARK", 0])(
    "rejects invalid value %s",
    (value) => {
      expect(parseThemeMode(value as string | null | undefined)).toBeNull();
    },
  );
});

describe("systemTheme", () => {
  it("returns dark when the system prefers dark", () => {
    setSystemDark(true);
    expect(systemTheme()).toBe("dark");
  });

  it("returns light when the system does not prefer dark", () => {
    setSystemDark(false);
    expect(systemTheme()).toBe("light");
  });

  it("returns light when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(systemTheme()).toBe("light");
  });
});

describe("resolveTheme", () => {
  it("resolves auto against the current system theme", () => {
    setSystemDark(true);
    expect(resolveTheme("auto")).toBe("dark");
    setSystemDark(false);
    expect(resolveTheme("auto")).toBe("light");
  });

  it("passes explicit light and dark through", () => {
    setSystemDark(true);
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("writes data-theme synchronously on the document element", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("resolves auto to the current system theme", () => {
    setSystemDark(true);
    applyTheme("auto");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("startThemeSync", () => {
  it("applies the fallback theme synchronously before persistence resolves", async () => {
    const pending = deferred<string | null>();
    settingGetMock.mockReturnValue(pending.promise);
    setSystemDark(true);

    const dispose = startThemeSync({ fallback: "auto" });

    // render 前同步应用：不得等待异步 settingGet。
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    pending.resolve("light");
    await Promise.resolve();
    await Promise.resolve();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    dispose();
  });

  it("subscribes to settings changes and system theme changes", async () => {
    const dispose = startThemeSync({ fallback: "auto" });
    await Promise.resolve();

    expect(settingsChangedCallbacks).toHaveLength(1);
    expect(withListeners()).toHaveLength(1);
    dispose();
  });

  it("reacts to a theme settings change", async () => {
    const dispose = startThemeSync({ fallback: "light" });
    await Promise.resolve();
    setSystemDark(false);

    emitSettingsChanged("general:theme", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    emitSettingsChanged("general:theme", "not-a-theme");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    dispose();
  });

  it("ignores unrelated settings keys", async () => {
    const dispose = startThemeSync({ fallback: "light" });
    await Promise.resolve();
    setSystemDark(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    emitSettingsChanged("pages:enabled", "{}");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    dispose();
  });

  it("follows system theme changes only in auto mode", async () => {
    const dispose = startThemeSync({ fallback: "auto" });
    await Promise.resolve();
    setSystemDark(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    emitSystemChange(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    // 显式 dark 后，系统变化不再改变 data-theme。
    emitSettingsChanged("general:theme", "light");
    emitSystemChange(false);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    dispose();
  });

  it("disposes the settings subscription and media listener", async () => {
    const dispose = startThemeSync({ fallback: "auto" });
    await Promise.resolve();
    const unlisten = vi.fn();
    settingsSubscriptions[0].resolve(unlisten as unknown as UnlistenFn);
    await Promise.resolve();

    dispose();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(
      (mediaQueries[0] as unknown as { listeners: Set<MediaQueryListener> }).listeners.size,
    ).toBe(0);
  });

  it("stops applying changes after dispose", async () => {
    const dispose = startThemeSync({ fallback: "light" });
    await Promise.resolve();
    setSystemDark(false);
    dispose();

    emitSettingsChanged("general:theme", "dark");
    emitSystemChange(true);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
