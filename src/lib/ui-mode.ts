import { useSyncExternalStore } from "react";
import { parseUiMode, type UiMode } from "@/lib/settings";

/**
 * 界面模式模块级 store（岛窗口内单例，模块 13）。
 * 由 useIslandSettings 的初始读取与 settings://changed 驱动（applyUiModeSetting），
 * 组件经 useUiMode 消费；未读取完成前保持契约默认值 "island"（悬浮灵动岛）。
 * taskbar 仅在正式 taskbar 集成接线后改变窗口策略；本 store 只承载已正规化的模式值。
 */
let current: UiMode = "island";
const listeners = new Set<() => void>();

/** 应用一条 window:ui_mode 设置值（含 null）；非法值按契约回退 island。 */
export function applyUiModeSetting(value: string | null): void {
  const next = parseUiMode(value);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getUiMode(): UiMode {
  return current;
}

export function useUiMode(): UiMode {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getUiMode);
}
