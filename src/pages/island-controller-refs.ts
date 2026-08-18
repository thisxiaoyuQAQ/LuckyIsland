import type { MutableRefObject } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  IslandVisualPhase,
  WindowPolicySnapshot,
} from "@/lib/window-policy";

/** App 主组件的共享 refs/state，供过渡、悬停与拖拽控制器闭包使用（14-T5 拆分，控 App.tsx 行数）。 */
export interface IslandControllerRefs {
  visualPhaseRef: MutableRefObject<IslandVisualPhase>;
  floatingBallRef: MutableRefObject<boolean>;
  hoverCollapseRef: MutableRefObject<IslandVisualPhase | null>;
  setVisualPhase: (phase: IslandVisualPhase) => void;
  setPolicy: Dispatch<SetStateAction<WindowPolicySnapshot | null>>;
  setCollapsingToCapsule: Dispatch<SetStateAction<boolean>>;
  setDragging: Dispatch<SetStateAction<boolean>>;
}

/** 从后端快照推导视觉相位：expanded → expanded，其余 → compact。 */
export function phaseFromSnapshot(snapshot: WindowPolicySnapshot): IslandVisualPhase {
  return snapshot.effectiveState === "expanded" ? "expanded" : "compact";
}

/** 接受一份策略快照：复位胶囊收起标记并写入 ref/state（transition acceptSnapshot / recover 共用）。 */
export function acceptPolicySnapshot(
  refs: Pick<
    IslandControllerRefs,
    "visualPhaseRef" | "setVisualPhase" | "setPolicy" | "setCollapsingToCapsule"
  >,
  snapshot: WindowPolicySnapshot,
): void {
  refs.setCollapsingToCapsule(false);
  refs.setPolicy(snapshot);
  const phase = phaseFromSnapshot(snapshot);
  refs.visualPhaseRef.current = phase;
  refs.setVisualPhase(phase);
}
