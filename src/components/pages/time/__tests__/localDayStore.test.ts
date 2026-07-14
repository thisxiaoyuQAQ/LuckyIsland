import { describe, expect, it, vi } from "vitest";
import { createLocalDayStore, type LocalDayEnvironment } from "../localDayStore";

function createFakeEnvironment(initialNow: Date) {
  let now = initialNow;
  let timer: { callback: () => void; delayMs: number } | null = null;
  let visibilityListener: (() => void) | null = null;
  let visible = true;
  let timerStarts = 0;
  let timerClears = 0;
  let visibilityStarts = 0;
  let visibilityClears = 0;

  const environment: LocalDayEnvironment = {
    now: () => new Date(now),
    setTimer: (callback, delayMs) => {
      timer = { callback, delayMs };
      timerStarts += 1;
      return timer;
    },
    clearTimer: () => {
      timer = null;
      timerClears += 1;
    },
    onVisibilityChange: (callback) => {
      visibilityListener = callback;
      visibilityStarts += 1;
      return () => {
        visibilityListener = null;
        visibilityClears += 1;
      };
    },
    isVisible: () => visible,
  };

  return {
    environment,
    setNow(value: Date) {
      now = value;
    },
    setVisible(value: boolean) {
      visible = value;
    },
    lastDelay() {
      return timer?.delayMs ?? null;
    },
    runTimer() {
      const callback = timer?.callback;
      timer = null;
      callback?.();
    },
    emitVisibilityChange() {
      visibilityListener?.();
    },
    activeTimers() {
      return timer ? 1 : 0;
    },
    activeVisibilityListeners() {
      return visibilityListener ? 1 : 0;
    },
    timerStarts() {
      return timerStarts;
    },
    timerClears() {
      return timerClears;
    },
    visibilityStarts() {
      return visibilityStarts;
    },
    visibilityClears() {
      return visibilityClears;
    },
  };
}

describe("localDayStore", () => {
  it("在本地午夜发布新日期并重新调度", () => {
    const fake = createFakeEnvironment(new Date(2026, 6, 13, 23, 59));
    const store = createLocalDayStore(fake.environment);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBe("2026-07-13");
    expect(fake.lastDelay()).toBe(60_000);

    fake.setNow(new Date(2026, 6, 14, 0, 0));
    fake.runTimer();

    expect(store.getSnapshot()).toBe("2026-07-14");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fake.activeTimers()).toBe(1);
    expect(fake.lastDelay()).toBe(86_400_000);
    unsubscribe();
  });

  it("恢复可见时补偿休眠期间错过的午夜", () => {
    const fake = createFakeEnvironment(new Date(2026, 6, 13, 23, 59));
    const store = createLocalDayStore(fake.environment);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    fake.setNow(new Date(2026, 6, 14, 8, 30));
    fake.setVisible(false);
    fake.emitVisibilityChange();
    expect(store.getSnapshot()).toBe("2026-07-13");

    fake.setVisible(true);
    fake.emitVisibilityChange();

    expect(store.getSnapshot()).toBe("2026-07-14");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fake.activeTimers()).toBe(1);
    expect(fake.lastDelay()).toBe(55_800_000);
    unsubscribe();
  });

  it("最后一个订阅者退出时清理并支持 StrictMode 式重新订阅", () => {
    const fake = createFakeEnvironment(new Date(2026, 6, 13, 12, 0));
    const store = createLocalDayStore(fake.environment);
    const listener = vi.fn();

    const firstUnsubscribe = store.subscribe(listener);
    expect(fake.activeTimers()).toBe(1);
    expect(fake.activeVisibilityListeners()).toBe(1);

    firstUnsubscribe();
    expect(fake.activeTimers()).toBe(0);
    expect(fake.activeVisibilityListeners()).toBe(0);
    expect(fake.timerClears()).toBe(1);
    expect(fake.visibilityClears()).toBe(1);

    const secondUnsubscribe = store.subscribe(listener);
    expect(fake.activeTimers()).toBe(1);
    expect(fake.activeVisibilityListeners()).toBe(1);
    expect(fake.timerStarts()).toBe(2);
    expect(fake.visibilityStarts()).toBe(2);

    secondUnsubscribe();
    expect(fake.timerClears()).toBe(2);
    expect(fake.visibilityClears()).toBe(2);
  });
});
