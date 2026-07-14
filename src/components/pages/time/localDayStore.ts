import { localDateKey } from "./date";

export interface LocalDayEnvironment {
  now(): Date;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
  onVisibilityChange(callback: () => void): () => void;
  isVisible(): boolean;
}

export interface LocalDayStore {
  getSnapshot(): string;
  subscribe(listener: () => void): () => void;
}

function nextMidnightDelay(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
}

export function createLocalDayStore(environment: LocalDayEnvironment): LocalDayStore {
  let snapshot = localDateKey(environment.now());
  let timerHandle: unknown;
  let removeVisibilityListener: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const clearScheduledRefresh = () => {
    if (timerHandle !== undefined) {
      environment.clearTimer(timerHandle);
      timerHandle = undefined;
    }
  };

  const refreshSnapshot = () => {
    const next = localDateKey(environment.now());
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const refreshAndSchedule = () => {
    clearScheduledRefresh();
    const now = environment.now();
    refreshSnapshot();
    timerHandle = environment.setTimer(() => {
      timerHandle = undefined;
      refreshAndSchedule();
    }, nextMidnightDelay(now));
  };

  const start = () => {
    refreshAndSchedule();
    removeVisibilityListener = environment.onVisibilityChange(() => {
      if (environment.isVisible()) refreshAndSchedule();
    });
  };

  const stop = () => {
    clearScheduledRefresh();
    removeVisibilityListener?.();
    removeVisibilityListener = null;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) start();

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}
