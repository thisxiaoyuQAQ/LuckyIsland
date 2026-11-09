import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

/**
 * 展开页签栏在该容器宽度下是否需要换行（模块 14：岛长度可变）。
 * 页签需约 90px/个，外加紧凑时钟与内边距。容器过窄时所有页签挤成一行会溢出/被裁，
 * 此时返回 true——IslandTopBar 改把页签换行显示，避免短岛展开时页签挤爆。
 */
export function expandedTabsWrap(containerWidthPx: number, pageCount: number): boolean {
  if (pageCount <= 0) return false;
  const tabsNeeded = pageCount * 90;
  const overhead = 200; // 紧凑时钟 + 容器内边距 + 右侧操作钮留白
  return tabsNeeded + overhead > containerWidthPx;
}

/**
 * 展开页签栏是否处于「换行显示」状态（供 App/TopBar 一致判定）。
 * 换行只在 expanded 相位、非胶囊、且容器过窄时发生。
 */
export function shouldWrapExpandedTabs(
  visualPhase: IslandVisualPhase,
  capsule: boolean,
  containerWidthPx: number,
  pageCount: number,
): boolean {
  return visualPhase === "expanded" && !capsule && expandedTabsWrap(containerWidthPx, pageCount);
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
  taskbarMode?: boolean;
  taskbarAvailable?: boolean;
  taskbarExpanded?: boolean;
  taskbarReason?: string | null;
  /** 右侧悬停阶段：0=无，1=悬停到条状，2=持续悬停到完整面板。 */
  hoverStage: number;
  hideInFullscreen: boolean;
  fullscreenSupported: boolean;
  fullscreenBlock: boolean;
  priorityOverrideActive: boolean;
  priorityOverrideGeneration: number;
}

export interface TaskbarSnapshot {
  available: boolean;
  expanded: boolean;
  reason: string | null;
  taskbar: { left: number; top: number; right: number; bottom: number } | null;
  client: { left: number; top: number; right: number; bottom: number } | null;
  workArea: { left: number; top: number; right: number; bottom: number } | null;
  strip: { left: number; top: number; right: number; bottom: number } | null;
  dpi: number;
  explorerPid: number | null;
}

export function taskbarAvailability(): Promise<{ available: boolean; reason: string | null; explorerPid: number | null }> {
  return invoke("taskbar_availability");
}

export function taskbarEnter(): Promise<TaskbarSnapshot> {
  return invoke("taskbar_enter_command");
}

export function taskbarLeave(): Promise<void> {
  return invoke("taskbar_leave_command");
}

export function taskbarReapply(): Promise<TaskbarSnapshot> {
  return invoke("taskbar_reapply_command");
}

export function taskbarStripToggle(): Promise<boolean> {
  return invoke("taskbar_strip_toggle_command");
}

export function taskbarStateChanged(onState: (snapshot: TaskbarSnapshot) => void): Promise<() => void> {
  return listen<TaskbarSnapshot>("window://taskbar-state-changed", (event) => onState(event.payload));
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

/** 模块 14 岛长度（横向逻辑像素）默认/边界，与后端 window_policy 常量对齐。
 * 各 UiMode（含 taskbar）通过独立 `window:width:<mode>` 键读取；缺键统一回退默认值。 */
export const ISLAND_WIDTH_DEFAULT_PX = 720;
export const ISLAND_WIDTH_MIN_PX = 420;
export const ISLAND_WIDTH_MAX_PX = 1600;

/** 模块 14：设置当前界面模式的岛长度；后端 clamp + 落盘 + 重放窗口策略（从中间两侧伸缩）
 *  + 广播 settings://changed。返回落盘后的实际宽度。 */
export function windowWidthSet(width: number): Promise<number> {
  return invoke<number>("window_width_set", { width });
}

/** 胶囊逻辑宽度（与 src-tauri window_policy.rs CAPSULE_WIDTH_LOGICAL 对齐）。固定 240。 */
export const CAPSULE_WIDTH_PX = 240;

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
  /** 当前待决 timer 的种类：右侧区 enter 的晋升，或整岛 leave 的收起。 */
  let pending: "enter" | "leave" | null = null;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = null;
  };

  const enter = () => {
    if (!enabled || suppressed) return;
    const currentGeneration = ++generation;
    clearTimer();
    if (activeStage !== 0) return; // 已有阶段：仅取消待决的 stage 0。
    pending = "enter";
    timer = setTimeout(() => {
      timer = undefined;
      pending = null;
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
    pending = "leave";
    timer = setTimeout(() => {
      timer = undefined;
      pending = null;
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

  /**
   * 指针回到岛内任意位置（不限右侧区）：只取消待决的收起，不触发晋升——
   * 左侧悬停绝不展开的冻结决策不变（BUG-20261108-01 #3）。
   */
  const cancelPendingLeave = () => {
    if (pending !== "leave") return;
    generation += 1;
    clearTimer();
  };

  /**
   * 收起提交前被撤销时恢复本周期持有的阶段（原生窗口仍处于该阶段），
   * 使下一次 leave 仍能收起，而不必等新的 enter 周期重新晋升。
   */
  const resumeStage = (stage: HoverStage) => {
    generation += 1;
    clearTimer();
    activeStage = stage;
    suppressed = false;
  };

  const resetAfterDrag = () => {
    generation += 1;
    clearTimer();
    activeStage = 0;
    suppressed = false;
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
    cancelPendingLeave,
    resumeStage,
    resetAfterDrag,
    setPromotionEnabled,
    setStageOneEnabled,
    enable,
    disable,
    dispose,
  };
}

/** 悬停阶段提交的处理方式（BUG-20261108-01 #2）。 */
export type HoverSubmitPlan =
  | "expand"
  | "collapse-expanded"
  | "collapse-strip"
  | "sync"
  | "report"
  | "ignore";

/**
 * 按后端 desiredState 决定悬停提交怎么落地。手动或通知展开（desired=expanded）时
 * Rust 不响应悬停阶段（reduce 只在 desired=compact 时投影悬停），前端若照常播收起动画，
 * 会先缩再被快照弹回；此时 stage 0 只同步后端阶段，stage 1/2 不提交。
 */
export function planHoverSubmit(
  stage: HoverStage,
  previous: HoverStage,
  desiredState: IslandState,
): HoverSubmitPlan {
  if (desiredState === "expanded") return stage === 0 ? "sync" : "ignore";
  if (stage === 2) return "expand";
  if (stage === 0 && previous === 2) return "collapse-expanded";
  if (stage === 0 && previous === 1) return "collapse-strip";
  return "report";
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
      // 收起：先进入 "collapsing" 相位（保留 expanded 内容 + 让容器 height 开始折叠），
      // 待动画时长结束后再切到 "compact" 并提交原生 resize。否则内容会在 width/height
      // 还在动时就被卸载，出现「元素突然消失 + 容器还在缩」的跳变（11a.4 修复）。
      setVisualPhase("collapsing");
      if (!reducedMotion()) {
        await wait(collapseDelay);
        if (currentGeneration !== generation) return;
      }
      setVisualPhase("compact");
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
  const cancel = (): boolean => {
    // 只撤销仍在折叠延迟内的请求：已提交原生 resize 的请求保持有效，
    // 由其快照收尾（否则快照被丢弃，视觉相位停在收起中途）。
    if (timer === undefined) return false;
    generation += 1;
    clearPendingDelay();
    return true;
  };

  const dispose = () => {
    generation += 1;
    clearPendingDelay();
  };

  return { request, cancel, dispose };
}
