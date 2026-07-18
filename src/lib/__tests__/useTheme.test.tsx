// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountReactTree } from "@/test/mountReactTree";

interface MediaQueryListenerRef {
  (event: { matches: boolean }): void;
}
interface FakeMediaQueryListRef {
  matches: boolean;
  listeners: Set<MediaQueryListenerRef>;
  addEventListener: (type: string, listener: MediaQueryListenerRef) => void;
  removeEventListener: (type: string, listener: MediaQueryListenerRef) => void;
}

const { mediaQueries, systemDarkState, matchMediaMock, resetMediaQueries } = vi.hoisted(() => {
  const queries: FakeMediaQueryListRef[] = [];
  const systemDark = { dark: false };
  return {
    mediaQueries: queries,
    systemDarkState: systemDark,
    matchMediaMock: vi.fn((_query: string) => {
      const listeners = new Set<MediaQueryListenerRef>();
      const mq: FakeMediaQueryListRef = {
        matches: systemDark.dark,
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
      systemDark.dark = false;
    },
  };
});

import { useTheme, type ThemeMode } from "@/lib/theme";

function ThemeProbe({ onRender }: { onRender: (r: { themeMode: ThemeMode; resolved: string }) => void }) {
  const { themeMode, resolvedTheme } = useTheme();
  onRender({ themeMode, resolved: resolvedTheme });
  return <span data-testid="resolved">{resolvedTheme}</span>;
}

function latestMq(): FakeMediaQueryListRef {
  const found = mediaQueries[mediaQueries.length - 1];
  if (!found) throw new Error("no media query registered");
  return found as unknown as FakeMediaQueryListRef;
}

function setSystem(matches: boolean) {
  systemDarkState.dark = matches;
  for (const mq of mediaQueries) {
    (mq as unknown as { matches: boolean }).matches = matches;
  }
}

function emitChange(matches: boolean) {
  setSystem(matches);
  for (const mq of mediaQueries) {
    for (const listener of [...(mq as unknown as FakeMediaQueryListRef).listeners]) {
      listener({ matches });
    }
  }
}

beforeEach(() => {
  resetMediaQueries();
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", matchMediaMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("useTheme", () => {
  it("defaults to auto resolved against the system theme", async () => {
    setSystem(true);
    const seen: Array<{ themeMode: ThemeMode; resolved: string }> = [];
    const tree = await mountReactTree(<ThemeProbe onRender={(r) => seen.push(r)} />);

    expect(seen[seen.length - 1]).toEqual({ themeMode: "auto", resolved: "dark" });
    await tree.unmount();
  });

  it("resolves an explicit mode without consulting the system", async () => {
    setSystem(true);
    function Explicit() {
      const { resolvedTheme, setThemeMode } = useTheme();
      return (
        <button data-testid="set" onClick={() => setThemeMode("light")}>
          {resolvedTheme}
        </button>
      );
    }
    const tree = await mountReactTree(<Explicit />);
    expect(document.querySelector("[data-testid='set']")!.textContent).toBe("dark");

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='set']")!.click();
    });
    expect(document.querySelector("[data-testid='set']")!.textContent).toBe("light");
    await tree.unmount();
  });

  it("tracks system theme changes while in auto mode", async () => {
    setSystem(false);
    const tree = await mountReactTree(<ThemeProbe onRender={() => undefined} />);
    expect(document.querySelector("[data-testid='resolved']")!.textContent).toBe("light");

    await act(async () => {
      emitChange(true);
    });
    expect(document.querySelector("[data-testid='resolved']")!.textContent).toBe("dark");

    await act(async () => {
      emitChange(false);
    });
    expect(document.querySelector("[data-testid='resolved']")!.textContent).toBe("light");
    await tree.unmount();
  });

  it("removes the media listener on unmount", async () => {
    const tree = await mountReactTree(<ThemeProbe onRender={() => undefined} />);
    expect(latestMq().listeners.size).toBe(1);

    await tree.unmount();
    expect(latestMq().listeners.size).toBe(0);
  });

  it("cleans both StrictMode generations and keeps the active one live", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <ThemeProbe onRender={() => undefined} />
      </StrictMode>,
    );
    // StrictMode 双挂载：两代的 effect 各注册一次监听。
    const totalListeners = mediaQueries.reduce(
      (sum, mq) => sum + (mq as unknown as FakeMediaQueryListRef).listeners.size,
      0,
    );
    expect(totalListeners).toBe(1);

    await act(async () => {
      emitChange(true);
    });
    expect(document.querySelector("[data-testid='resolved']")!.textContent).toBe("dark");

    await tree.unmount();
    const remaining = mediaQueries.reduce(
      (sum, mq) => sum + (mq as unknown as FakeMediaQueryListRef).listeners.size,
      0,
    );
    expect(remaining).toBe(0);
  });
});
