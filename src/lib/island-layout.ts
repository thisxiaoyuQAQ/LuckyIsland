import { useEffect, useState } from "react";
import { ISLAND_EXPAND_DURATION_MS, ISLAND_LAYERED_EASE } from "@/lib/anim";
import type { DockEdge } from "@/lib/settings";
import { CAPSULE_WIDTH_PX } from "@/lib/window-policy";

/** 紧凑态容器厚度：原生窗口 80 内留出 12 逻辑像素贴屏侧间距与另一侧阴影余量。 */
const STRIP_THICKNESS_PX = 56;
/** 展开态容器厚度：原生窗口 400 内同理。 */
const PANEL_THICKNESS_PX = 380;
/** 沿停靠边方向两端各留 10 逻辑像素阴影余量（v0.4.1：720 窗口内 700 容器）。 */
const LENGTH_SHADOW_INSET_PX = 20;
/** 拖动胶囊铺满 240×80 原生拖动窗口（2026-08-18 T4 真机修复规格）。 */
const DRAG_HEIGHT_PX = 80;

const EDGE_ALIGN: Record<DockEdge, string> = {
  top: "items-start justify-center",
  bottom: "items-end justify-center",
  left: "items-center justify-start",
  right: "items-center justify-end",
};

const EDGE_GAP: Record<DockEdge, string> = {
  top: "pt-3",
  bottom: "pb-3",
  left: "pl-3",
  right: "pr-3",
};

const EDGE_FLUSH_SHAPE: Record<DockEdge, string> = {
  top: "rounded-b-2xl rounded-t-none border-t-0",
  bottom: "rounded-t-2xl rounded-b-none border-b-0",
  left: "rounded-r-2xl rounded-l-none border-l-0",
  right: "rounded-l-2xl rounded-r-none border-r-0",
};

export interface IslandShellInput {
  dockEdge: DockEdge;
  /** classisland：沿停靠边零间距、贴屏一侧取消圆角；island：保留间距与四角圆角。 */
  docked: boolean;
  dragging: boolean;
  /** visualPhase 为 expanding / expanded。 */
  expanded: boolean;
  /** 胶囊稳定态或正在收起到胶囊。 */
  capsuleLike: boolean;
  islandWidth: number;
  taskbar: boolean;
}

export interface IslandShellLayout {
  /** 外层（铺满原生窗口）对齐与贴屏侧间距。 */
  wrapperClass: string;
  /** 容器圆角与贴屏侧边框。 */
  shapeClass: string;
  widthPx: number;
  heightPx: number;
}

/**
 * 岛容器在原生窗口内的几何与对齐（BUG-20261108-01 #4/#5/#7）。
 *
 * 原生窗口尺寸变化时 Rust 固定停靠边（见 window_policy.rs `anchored_bounds`），
 * 容器必须贴同一条边，否则展开/收起会跳动、贴底/贴右时与屏幕边留出异常空隙。
 * 左右停靠是横向布局旋转 90°（vault/14「宽高互换」）：厚度 56/380、长度 = 岛长度 − 阴影余量。
 */
export function islandShellLayout(input: IslandShellInput): IslandShellLayout {
  const thickness = input.expanded ? PANEL_THICKNESS_PX : STRIP_THICKNESS_PX;
  if (input.taskbar) {
    // T5：面板左缘需对齐任务栏条，原生面板恒为横向，几何保持原样。
    return {
      wrapperClass: `${EDGE_ALIGN.top} ${EDGE_GAP.top}`,
      shapeClass: "rounded-2xl",
      widthPx: input.capsuleLike ? CAPSULE_WIDTH_PX : input.islandWidth,
      heightPx: thickness,
    };
  }
  if (input.dragging) {
    return {
      wrapperClass: "items-center justify-center",
      shapeClass: "rounded-2xl",
      widthPx: CAPSULE_WIDTH_PX,
      heightPx: DRAG_HEIGHT_PX,
    };
  }
  const edge = input.dockEdge;
  const length = input.capsuleLike
    ? CAPSULE_WIDTH_PX
    : input.islandWidth - LENGTH_SHADOW_INSET_PX;
  const vertical = edge === "left" || edge === "right";
  return {
    wrapperClass: input.docked ? EDGE_ALIGN[edge] : `${EDGE_ALIGN[edge]} ${EDGE_GAP[edge]}`,
    shapeClass: input.docked ? EDGE_FLUSH_SHAPE[edge] : "rounded-2xl",
    widthPx: vertical ? thickness : length,
    heightPx: vertical ? length : thickness,
  };
}

/**
 * 容器宽高过渡。减少动态效果时立即到位；进入拖动胶囊时原生窗口同步切到 240×80，
 * 容器若仍从原尺寸动画收缩，会在小窗口里被裁成直角块，因此同样立即到位。
 * 退出拖动（dragging=false）照常动画，从胶囊长回停靠几何。
 */
export function shellSizeTransition(options: { reducedMotion: boolean; dragging: boolean }) {
  return options.reducedMotion || options.dragging
    ? { duration: 0 }
    : { duration: ISLAND_EXPAND_DURATION_MS / 1000, ease: ISLAND_LAYERED_EASE };
}

/**
 * 容器尺寸是否立即到位：拖动中，以及拖动结束后的一帧（审查 #8）。
 * 落点结算在拖动结束前已把原生窗口改回停靠几何；若容器此时从 240×80 动画长回，
 * 外层已切到停靠对齐（如 pt-3），80px 高的容器会溢出窗口约 240ms，底边与阴影被裁。
 */
export function useDragSizeSnap(dragging: boolean): boolean {
  const [settling, setSettling] = useState(false);
  const [previous, setPrevious] = useState(dragging);
  if (previous !== dragging) {
    setPrevious(dragging);
    if (!dragging) setSettling(true);
  }
  useEffect(() => {
    if (!settling) return;
    const frame = requestAnimationFrame(() => setSettling(false));
    return () => cancelAnimationFrame(frame);
  }, [settling]);
  return dragging || settling;
}
