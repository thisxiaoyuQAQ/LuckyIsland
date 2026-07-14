import { useSyncExternalStore } from "react";
import { createLocalDayStore } from "./localDayStore";

const localDayStore = createLocalDayStore({
  now: () => new Date(),
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (handle) => window.clearTimeout(handle as number),
  onVisibilityChange: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
  isVisible: () => document.visibilityState === "visible",
});

export function useLocalDay(): string {
  return useSyncExternalStore(localDayStore.subscribe, localDayStore.getSnapshot, localDayStore.getSnapshot);
}

export function currentLocalDay(): string {
  return localDayStore.getSnapshot();
}
