import { useSyncExternalStore } from "react";
import { parseDockEdge, type DockEdge } from "@/lib/settings";

let current: DockEdge = "top";
const listeners = new Set<() => void>();

export function applyDockEdgeSetting(value: string | null): void {
  const next = parseDockEdge(value);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getDockEdge(): DockEdge {
  return current;
}

export function useDockEdge(): DockEdge {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getDockEdge);
}
