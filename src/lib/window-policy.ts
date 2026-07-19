import { invoke } from "@tauri-apps/api/core";
import type { VisualStyle } from "@/lib/settings";

export type IslandState = "hidden" | "capsule" | "compact" | "expanded";
export type IslandVisualPhase = "compact" | "expanding" | "expanded" | "collapsing";

/** 灵动岛外壳/紧凑内容的 legacy/new 样式配方（11a.3）。 */
export interface IslandStyleRecipe {
  /** 经典样式保留紧凑态 leading 页点容器；新样式不渲染。 */
  showLeadingDots: boolean;
  /** 紧凑时钟 className；两者都保留 font-medium tabular-nums，新样式仅放大字号。 */
  compactClockClass: string;
  /** 新样式渲染绑定页面 index/count 的动画滚动指示（固定于信息左侧）。 */
  showScrollIndicator: boolean;
}

/**
 * legacy：完整保持基线紧凑页点与 text-sm 时钟行为；
 * new：移除 leading 页点容器、放大紧凑时钟，并把滚动指示固定于信息左侧。
 */
export function islandStyleRecipe(style: VisualStyle): IslandStyleRecipe {
  if (style === "legacy") {
    return {
      showLeadingDots: true,
      compactClockClass: "text-sm font-medium tabular-nums",
      showScrollIndicator: false,
    };
  }
  return {
    showLeadingDots: false,
    compactClockClass: "text-lg font-medium tabular-nums",
    showScrollIndicator: true,
  };
}

export interface ScrollIndicatorGeometry {
  /** 指示滑块高度（px）。 */
  thumb: number;
  /** 指示滑块相对轨道顶部的偏移（px）。 */
  offset: number;
}

/**
 * 紧凑内容右侧滚动指示几何：滑块高度随页数均分轨道，偏移按 index/count-1 线性分布。
 * 单页（或无页）返回 null——不显示误导性的滚动提示。
 */
export function scrollIndicatorGeometry(
  index: number,
  count: number,
  trackHeight: number,
): ScrollIndicatorGeometry | null {
  if (count < 2) return null;
  const clampedIndex = Math.min(Math.max(index, 0), count - 1);
  const thumb = trackHeight / count;
  const offset = (clampedIndex / (count - 1)) * (trackHeight - thumb);
  return { thumb, offset };
}

export function containerExpandedForPhase(phase: IslandVisualPhase): boolean {
  return phase !== "compact";
}

export function shouldSyncExternalVisualPhase(phase: IslandVisualPhase): boolean {
  return phase === "compact" || phase === "expanded";
}

export interface WindowPolicySnapshot {
  desiredState: IslandState;
  effectiveState: IslandState;
  shouldFocus: boolean;
  clickThrough: boolean;
  hoverExpand: boolean;
  floatingBall: boolean;
  /** 右侧悬停阶段：0=无，1=悬停到条状，2=持续悬停到完整面板。 */
  hoverStage: number;
  hideInFullscreen: boolean;
  fullscreenSupported: boolean;
  fullscreenBlock: boolean;
  priorityOverrideActive: boolean;
  priorityOverrideGeneration: number;
}

export function windowPolicyGet(): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_policy_get");
}

export function setIslandState(state: IslandState): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("set_island_state", { state });
}

export function windowClickThroughSet(
  enabled: boolean,
): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_click_through_set", { enabled });
}

export function windowHoverStageSet(stage: number): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_hover_stage_set", { stage });
}

export function windowFloatingBallSet(
  enabled: boolean,
): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_floating_ball_set", { enabled });
}

export function windowHoverExpandSet(
  enabled: boolean,
): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_hover_expand_set", { enabled });
}

export function windowHideInFullscreenSet(
  enabled: boolean,
): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_hide_in_fullscreen_set", { enabled });
}

/** 胶囊逻辑宽度（与 src-tauri window_policy.rs CAPSULE_WIDTH_LOGICAL 对齐）。 */
export const CAPSULE_WIDTH_PX = 240;
/** 条状/展开内容宽度（App 容器 max-w-[700px]；窗口逻辑宽 720 留边）。 */
export const ISLAND_STRIP_WIDTH_PX = 700;

/** 右侧悬停阶段：0=无，1=悬停到条状（胶囊→compact），2=悬停到完整面板（→expanded）。 */
export type HoverStage = 0 | 1 | 2;

/** 悬停冻结延迟：移入约 180ms、移出约 300ms。 */
export const HOVER_ENTER_DELAY_MS = 180;
export const HOVER_LEAVE_DELAY_MS = 300;

interface HoverStageControllerOptions {
  enterDelay: number;
  leaveDelay: number;
  submit: (stage: HoverStage, previous: HoverStage) => void;
}

/**
 * 右侧 hover stage controller（2026-07-19 需求修改后语义）：
 * - 悬停展开开（promotionEnabled）：enter →enterDelay→ 直接 stage 2（胶囊/条状→完整面板，
 *   跳过条状中间态）；与浮球是否开启无关。
 * - 悬停展开关 + 浮球开（stageOneEnabled）：enter →enterDelay→ stage 1（胶囊→条状）。
 * - 双关：enter 无提交。leave →leaveDelay→ stage 0（携带来源 stage，供前端决定是否播折叠动画）。
 * 快速掠过/相反事件/手动动作/开关关闭/卸载都通过 generation + 可取消 timer 作废旧提交；
 * suppressCurrentCycle 同时归还本周期持有的 stage，避免后续 leave 收起手动展开。
 */
export function createHoverStageController({
  enterDelay,
  leaveDelay,
  submit,
}: HoverStageControllerOptions) {
  let generation = 0;
  let activeStage: HoverStage = 0;
  let enabled = true;
  let stageOneEnabled = false;
  let promotionEnabled = false;
  let suppressed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const enter = () => {
    if (!enabled || suppressed) return;
    const currentGeneration = ++generation;
    clearTimer();
    if (activeStage !== 0) return; // 已有阶段：仅取消待决的 stage 0。
    timer = setTimeout(() => {
      timer = undefined;
      if (currentGeneration !== generation) return;
      if (activeStage !== 0) return;
      if (promotionEnabled) {
        activeStage = 2;
        submit(2, 0);
      } else if (stageOneEnabled) {
        activeStage = 1;
        submit(1, 0);
      }
    }, enterDelay);
  };

  const leave = () => {
    if (suppressed) {
      suppressed = false;
      return;
    }
    const currentGeneration = ++generation;
    clearTimer();
    if (!enabled) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (currentGeneration !== generation) return;
      if (activeStage === 0) return;
      const previous = activeStage;
      activeStage = 0;
      submit(0, previous);
    }, leaveDelay);
  };

  const suppressCurrentCycle = () => {
    generation += 1;
    clearTimer();
    activeStage = 0;
    suppressed = true;
  };

  /** 悬停展开开关；下一 hover 周期生效（不中途改变已持有的 stage）。 */
  const setPromotionEnabled = (enabled_: boolean) => {
    promotionEnabled = enabled_;
  };

  /** 浮球开关：悬停展开关闭时 stage 1（胶囊→条状）生效。 */
  const setStageOneEnabled = (enabled_: boolean) => {
    stageOneEnabled = enabled_;
  };

  const enable = () => {
    enabled = true;
  };

  const disable = () => {
    enabled = false;
    generation += 1;
    clearTimer();
    if (activeStage !== 0) {
      const previous = activeStage;
      activeStage = 0;
      submit(0, previous);
    }
  };

  const dispose = () => {
    generation += 1;
    clearTimer();
  };

  return {
    enter,
    leave,
    suppressCurrentCycle,
    setPromotionEnabled,
    setStageOneEnabled,
    enable,
    disable,
    dispose,
  };
}

interface IslandTransitionControllerOptions {
  collapseDelay: number;
  reducedMotion: () => boolean;
  setVisualPhase: (phase: IslandVisualPhase) => void;
  submit: (state: IslandState) => Promise<WindowPolicySnapshot>;
  acceptSnapshot: (snapshot: WindowPolicySnapshot) => void;
  recover: () => void | Promise<void>;
}

export function createIslandTransitionController({
  collapseDelay,
  reducedMotion,
  setVisualPhase,
  submit,
  acceptSnapshot,
  recover,
}: IslandTransitionControllerOptions) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishDelay: (() => void) | undefined;

  const clearPendingDelay = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    finishDelay?.();
    finishDelay = undefined;
  };

  const wait = async (delay: number) => {
    await new Promise<void>((resolve) => {
      finishDelay = resolve;
      timer = setTimeout(() => {
        timer = undefined;
        finishDelay = undefined;
        resolve();
      }, delay);
    });
  };

  const request = async (
    state: IslandState,
    submitState: (state: IslandState) => Promise<WindowPolicySnapshot> = submit,
  ): Promise<void> => {
    const currentGeneration = ++generation;
    clearPendingDelay();
    if (state === "compact") {
      setVisualPhase("compact");
      if (!reducedMotion()) {
        await wait(collapseDelay);
        if (currentGeneration !== generation) return;
      }
    } else if (state === "expanded") {
      setVisualPhase("expanding");
    }

    try {
      const snapshot = await submitState(state);
      if (currentGeneration === generation) {
        acceptSnapshot(snapshot);
        setVisualPhase(snapshot.effectiveState === "expanded" ? "expanded" : "compact");
      }
    } catch (error) {
      if (currentGeneration === generation) await recover();
      throw error;
    }
  };

  /**
   * 撤销未到达平台提交的待决请求（如悬停收起的折叠延迟内指针回到右侧）。
   * 调用方负责把视觉相位恢复到与原生窗口一致的状态。
   */
  const cancel = () => {
    generation += 1;
    clearPendingDelay();
  };

  const dispose = () => {
    generation += 1;
    clearPendingDelay();
  };

  return { request, cancel, dispose };
}
