import { useSyncExternalStore } from "react";
import { parseVisualStyle, type VisualStyle } from "@/lib/settings";

/**
 * 灵动岛视觉样式模块级 store（岛窗口内单例）。
 * 由 useIslandSettings 的初始读取与 settings://changed 驱动（applyVisualStyleSetting），
 * 组件经 useVisualStyle 消费；未读取完成前保持契约默认值 "new"。
 * 设置窗口是独立 JS 上下文，不共享本 store（AppearancePanel 自行读键+订阅）。
 */
let current: VisualStyle = "new";
const listeners = new Set<() => void>();

/** 应用一条 window:visual_style 设置值（含 null）；非法值按契约回退 new。 */
export function applyVisualStyleSetting(value: string | null): void {
  const next = parseVisualStyle(value);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getVisualStyle(): VisualStyle {
  return current;
}

export function useVisualStyle(): VisualStyle {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getVisualStyle);
}
