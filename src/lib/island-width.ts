import { useSyncExternalStore } from "react";
import { parseIslandWidth } from "@/lib/settings";

/**
 * 岛长度模块级 store（岛窗口内单例，模块 14）。
 * 由 useIslandSettings 的初始读取与 settings://changed 驱动（applyIslandWidthSetting），
 * 组件经 useIslandWidth 消费；未读取完成前保持契约默认值 720（对齐原窗口逻辑宽）。
 * 胶囊固定 240 不经此 store（见 window-policy.ts 的 CAPSULE_WIDTH_PX）。
 * 设置窗口是独立 JS 上下文，不共享本 store（AppearancePanel 自行读键+订阅）。
 */
let current = 720;
const listeners = new Set<() => void>();

/** 应用一条 window:width:<mode> 设置值（含 null）；非法值按契约回退 720，合法值 clamp 420~1600。 */
export function applyIslandWidthSetting(value: string | null): void {
  const next = parseIslandWidth(value);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getIslandWidth(): number {
  return current;
}

export function useIslandWidth(): number {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getIslandWidth);
}
