import { useCallback, useRef, useState } from "react";
import { ISLAND_COLLAPSE_DURATION_MS } from "@/lib/anim";
import {
  HOVER_ENTER_DELAY_MS,
  HOVER_LEAVE_DELAY_MS,
  createHoverStageController,
  createIslandTransitionController,
  planHoverSubmit,
  setIslandState as submitIslandState,
  windowHoverStageSet,
  windowPolicyGet,
  type IslandState,
  type IslandVisualPhase,
  type WindowPolicySnapshot,
} from "@/lib/window-policy";
import { acceptPolicySnapshot } from "@/pages/island-controller-refs";

/** 岛过渡/悬停控制器集合（14-T5 从 App.tsx 抽出，控制单文件行数；行为不变）。 */
export interface IslandTransitionSet {
  transitionRef: React.RefObject<ReturnType<
    typeof createIslandTransitionController
  > | null>;
  hoverRef: React.RefObject<ReturnType<typeof createHoverStageController> | null>;
  hoverCollapseRef: React.RefObject<IslandVisualPhase | null>;
  visualPhase: IslandVisualPhase;
  visualPhaseRef: React.RefObject<IslandVisualPhase>;
  collapsingToCapsule: boolean;
  setCollapsingToCapsule: React.Dispatch<React.SetStateAction<boolean>>;
  setVisualPhase: (phase: IslandVisualPhase) => void;
  setState: (state: IslandState) => void;
  handleRightZoneEnter: () => void;
  /** 指针进入岛容器任意位置：撤销待决/延迟中的悬停收起，不触发展开（BUG-20261108-01 #3）。 */
  handleContainerEnter: () => void;
}

export function useIslandTransition(options: {
  reducedMotionRef: React.RefObject<boolean | null>;
  setPolicy: React.Dispatch<React.SetStateAction<WindowPolicySnapshot | null>>;
  floatingBallRef: React.RefObject<boolean>;
  draggingRef: React.RefObject<boolean>;
  islandStateChangedRef: React.RefObject<boolean>;
  /** 悬停视角的 desiredState：手动/通知展开或优先级通知覆盖时为 expanded，悬停不得收起它。 */
  desiredStateRef: React.RefObject<IslandState>;
}): IslandTransitionSet {
  const {
    reducedMotionRef,
    setPolicy,
    floatingBallRef,
    draggingRef,
    islandStateChangedRef,
    desiredStateRef,
  } = options;
  const [visualPhase, setVisualPhaseState] = useState<IslandVisualPhase>("compact");
  const [collapsingToCapsule, setCollapsingToCapsule] = useState(false);
  const visualPhaseRef = useRef(visualPhase);
  visualPhaseRef.current = visualPhase;
  const transitionRef =
    useRef<ReturnType<typeof createIslandTransitionController> | null>(null);
  const hoverRef =
    useRef<ReturnType<typeof createHoverStageController> | null>(null);
  const hoverCollapseRef = useRef<IslandVisualPhase | null>(null);
  const setVisualPhase = useCallback((phase: IslandVisualPhase) => {
    visualPhaseRef.current = phase;
    setVisualPhaseState(phase);
  }, []);
  const snapshotRefs = { visualPhaseRef, setVisualPhase, setPolicy, setCollapsingToCapsule };

  if (transitionRef.current === null) {
    transitionRef.current = createIslandTransitionController({
      collapseDelay: ISLAND_COLLAPSE_DURATION_MS,
      reducedMotion: () => reducedMotionRef.current ?? false,
      setVisualPhase,
      submit: submitIslandState,
      acceptSnapshot: (snapshot) => acceptPolicySnapshot(snapshotRefs, snapshot),
      recover: async () => {
        acceptPolicySnapshot(snapshotRefs, await windowPolicyGet());
      },
    });
  }
  if (hoverRef.current === null) {
    hoverRef.current = createHoverStageController({
      enterDelay: HOVER_ENTER_DELAY_MS,
      leaveDelay: HOVER_LEAVE_DELAY_MS,
      submit: (stage, previous) => {
        const transitions = transitionRef.current;
        const fail = (error: unknown) =>
          console.error("[window-policy] 提交悬停阶段失败:", error);
        const collapse = (phase: IslandVisualPhase) => {
          hoverCollapseRef.current = phase;
          void transitions
            ?.request("compact", async () => windowHoverStageSet(0))
            .catch(fail)
            .finally(() => {
              hoverCollapseRef.current = null;
            });
        };
        const plan = planHoverSubmit(stage, previous, desiredStateRef.current ?? "compact");
        if (plan === "ignore") return;
        if (plan === "expand") {
          // 胶囊/条状→完整面板：先把原生 resize 提交（等 policy 切到 expanded），
          // 再进入 expanding 视觉相位，避免前端先把容器拉宽而原生窗口仍窄导致内容裁切。
          void (async () => {
            try {
              const snapshot = await windowHoverStageSet(2);
              setPolicy(snapshot);
              await transitions?.request("expanded", async () => snapshot);
            } catch (error) {
              fail(error);
            }
          })();
        } else if (plan === "collapse-expanded") {
          if (floatingBallRef.current) setCollapsingToCapsule(true);
          collapse("expanded");
        } else if (plan === "collapse-strip") {
          setCollapsingToCapsule(true);
          collapse("compact");
        } else {
          // report：上报阶段 1 等无视觉编排的阶段；sync：手动/通知展开时只归零后端阶段，
          // 不播收起动画（否则先缩再被 expanded 快照弹回，BUG-20261108-01 #2）。
          void windowHoverStageSet(stage).then(setPolicy).catch(fail);
        }
      },
    });
  }

  const setState = useCallback(
    (state: IslandState) => {
      islandStateChangedRef.current = true;
      hoverRef.current?.suppressCurrentCycle();
      setCollapsingToCapsule(state === "compact" && floatingBallRef.current);
      void transitionRef.current
        ?.request(state)
        .catch((error) => console.error(`[window-policy] 切换 ${state} 失败:`, error));
    },
    [floatingBallRef, islandStateChangedRef],
  );

  /**
   * 撤销仍在折叠延迟内的悬停收起：原生窗口尚未收起，视觉相位与悬停阶段一起恢复。
   * 收起已提交原生 resize 时不回滚（否则视觉展开而窗口已收，形成异常边界），返回 false。
   */
  const restorePendingCollapse = useCallback((): boolean => {
    const restorePhase = hoverCollapseRef.current;
    if (restorePhase === null) return false;
    if (!(transitionRef.current?.cancel() ?? false)) return false;
    hoverCollapseRef.current = null;
    setCollapsingToCapsule(false);
    setVisualPhase(restorePhase);
    hoverRef.current?.resumeStage(restorePhase === "expanded" ? 2 : 1);
    return true;
  }, [setVisualPhase]);

  // 右侧命中区进入：先撤销待决的悬停收起；没有可撤销的收起时进入新的 hover 周期。
  const handleRightZoneEnter = useCallback(() => {
    if (draggingRef.current) return;
    if (restorePendingCollapse()) return;
    hoverRef.current?.enter();
  }, [draggingRef, restorePendingCollapse]);

  const handleContainerEnter = useCallback(() => {
    if (draggingRef.current) return;
    if (restorePendingCollapse()) return;
    hoverRef.current?.cancelPendingLeave();
  }, [draggingRef, restorePendingCollapse]);

  return {
    transitionRef,
    hoverRef,
    hoverCollapseRef,
    visualPhase,
    visualPhaseRef,
    collapsingToCapsule,
    setCollapsingToCapsule,
    setVisualPhase,
    setState,
    handleRightZoneEnter,
    handleContainerEnter,
  };
}
