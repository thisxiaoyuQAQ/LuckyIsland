import { useCallback, useRef, useState } from "react";
import { ISLAND_COLLAPSE_DURATION_MS } from "@/lib/anim";
import {
  HOVER_ENTER_DELAY_MS,
  HOVER_LEAVE_DELAY_MS,
  createHoverStageController,
  createIslandTransitionController,
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
}

export function useIslandTransition(options: {
  reducedMotionRef: React.RefObject<boolean | null>;
  setPolicy: React.Dispatch<React.SetStateAction<WindowPolicySnapshot | null>>;
  floatingBallRef: React.RefObject<boolean>;
  draggingRef: React.RefObject<boolean>;
  islandStateChangedRef: React.RefObject<boolean>;
}): IslandTransitionSet {
  const { reducedMotionRef, setPolicy, floatingBallRef, draggingRef, islandStateChangedRef } =
    options;
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
        if (stage === 2) {
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
        } else if (stage === 0 && previous === 2) {
          if (floatingBallRef.current) setCollapsingToCapsule(true);
          collapse("expanded");
        } else if (stage === 0 && previous === 1) {
          setCollapsingToCapsule(true);
          collapse("compact");
        } else {
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

  // 右侧命中区进入：撤销待决的悬停收起（原生仍是展开/条状，视觉相位同步恢复），再进入 hover 周期。
  const handleRightZoneEnter = useCallback(() => {
    if (draggingRef.current) return;
    const restorePhase = hoverCollapseRef.current;
    if (restorePhase !== null) {
      hoverCollapseRef.current = null;
      transitionRef.current?.cancel();
      setCollapsingToCapsule(false);
      setVisualPhase(restorePhase);
    }
    hoverRef.current?.enter();
  }, [draggingRef, setVisualPhase]);

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
  };
}
