import { useSyncExternalStore } from "react";
import { resolvePhaseOpacity } from "@/lib/settings";

/**
 * 岛背景透明度模块级 store（岛窗口内单例，模块 14 T2）。
 * 保存「展开」「收起」两个相位的独立透明度；由 useIslandSettings 的初始读取与
 * settings://changed 驱动（applyIslandOpacity），组件经 useIslandOpacity 按当前
 * visualPhase 消费其一。未读取完成前两相位都保持契约默认值 0.7（对齐原 bg-card/70）。
 * 设置窗口是独立 JS 上下文，不共享本 store（AppearancePanel 自行读键+订阅）。
 */

export interface IslandOpacity {
  expanded: number;
  compact: number;
}

let current: IslandOpacity = { expanded: 0.7, compact: 0.7 };
const listeners = new Set<() => void>();

/**
 * 应用一对相位原始值（含 null）：各自走 resolvePhaseOpacity 三级回退
 * （相位专属键 → 该模式旧裸键 → 0.7），返回值已 clamp。任一相位变化才广播。
 */
export function applyIslandOpacity(
  expandedPhase: string | null,
  expandedMode: string | null,
  compactPhase: string | null,
  compactMode: string | null,
): void {
  const next: IslandOpacity = {
    expanded: resolvePhaseOpacity(expandedPhase, expandedMode),
    compact: resolvePhaseOpacity(compactPhase, compactMode),
  };
  if (next.expanded === current.expanded && next.compact === current.compact) return;
  current = next;
  for (const listener of listeners) listener();
}

export function getIslandOpacity(): IslandOpacity {
  return current;
}

export function useIslandOpacity(): IslandOpacity {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getIslandOpacity);
}
