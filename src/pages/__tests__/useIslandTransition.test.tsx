// @vitest-environment happy-dom

import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type {
  HoverStage,
  IslandState,
  IslandVisualPhase,
  WindowPolicySnapshot,
} from "@/lib/window-policy";

const { captured, ipc } = vi.hoisted(() => ({
  captured: {
    submit: undefined as ((stage: HoverStage, previous: HoverStage) => void) | undefined,
    hover: undefined as Record<string, ReturnType<typeof vi.fn>> | undefined,
    transition: undefined as Record<string, ReturnType<typeof vi.fn>> | undefined,
  },
  ipc: {
    windowHoverStageSet: vi.fn(),
    setIslandState: vi.fn(),
    windowPolicyGet: vi.fn(),
  },
}));

vi.mock("@/lib/window-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/window-policy")>();
  return {
    ...actual,
    windowHoverStageSet: ipc.windowHoverStageSet,
    setIslandState: ipc.setIslandState,
    windowPolicyGet: ipc.windowPolicyGet,
    createHoverStageController: vi.fn(
      (options: { submit: (stage: HoverStage, previous: HoverStage) => void }) => {
        captured.submit = options.submit;
        captured.hover = {
          enter: vi.fn(),
          leave: vi.fn(),
          suppressCurrentCycle: vi.fn(),
          cancelPendingLeave: vi.fn(),
          resumeStage: vi.fn(),
          resetAfterDrag: vi.fn(),
          setPromotionEnabled: vi.fn(),
          setStageOneEnabled: vi.fn(),
          enable: vi.fn(),
          disable: vi.fn(),
          dispose: vi.fn(),
        };
        return captured.hover;
      },
    ),
    createIslandTransitionController: vi.fn(() => {
      captured.transition = {
        request: vi.fn(async () => undefined),
        cancel: vi.fn(() => true),
        dispose: vi.fn(),
      };
      return captured.transition;
    }),
  };
});

import { useIslandTransition } from "@/pages/useIslandTransition";

function snapshot(desiredState: IslandState, effectiveState: IslandState): WindowPolicySnapshot {
  return {
    desiredState,
    effectiveState,
    shouldFocus: false,
    clickThrough: false,
    hoverExpand: true,
    floatingBall: true,
    taskbarMode: false,
    taskbarAvailable: false,
    taskbarExpanded: false,
    taskbarReason: null,
    hoverStage: 0,
    hideInFullscreen: false,
    fullscreenSupported: true,
    fullscreenBlock: false,
    priorityOverrideActive: false,
    priorityOverrideGeneration: 0,
  };
}

interface Exposed {
  phase: IslandVisualPhase;
  collapsingToCapsule: boolean;
  handleContainerEnter: () => void;
  handleRightZoneEnter: () => void;
}

const exposed: { current?: Exposed } = {};

function Harness({ desiredState }: { desiredState: IslandState }) {
  const reducedMotionRef = useRef<boolean | null>(false);
  const floatingBallRef = useRef(true);
  const draggingRef = useRef(false);
  const islandStateChangedRef = useRef(false);
  const desiredStateRef = useRef<IslandState>(desiredState);
  desiredStateRef.current = desiredState;
  const set = useIslandTransition({
    reducedMotionRef,
    setPolicy: vi.fn(),
    floatingBallRef,
    draggingRef,
    islandStateChangedRef,
    desiredStateRef,
  });
  exposed.current = {
    phase: set.visualPhase,
    collapsingToCapsule: set.collapsingToCapsule,
    handleContainerEnter: set.handleContainerEnter,
    handleRightZoneEnter: set.handleRightZoneEnter,
  };
  return null;
}

describe("useIslandTransition hover routing (BUG-20261108-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipc.windowHoverStageSet.mockResolvedValue(snapshot("expanded", "expanded"));
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("does not play the collapse when the island was expanded manually or by a notification", async () => {
    const tree = await mountReactTree(<Harness desiredState="expanded" />);

    captured.submit?.(0, 2);
    await flushReactWork();

    expect(captured.transition?.request).not.toHaveBeenCalled();
    expect(ipc.windowHoverStageSet).toHaveBeenCalledWith(0);
    expect(exposed.current?.collapsingToCapsule).toBe(false);
    await tree.unmount();
  });

  it("ignores hover promotion while the backend keeps a manual expanded", async () => {
    const tree = await mountReactTree(<Harness desiredState="expanded" />);

    captured.submit?.(2, 0);
    captured.submit?.(1, 0);
    await flushReactWork();

    expect(ipc.windowHoverStageSet).not.toHaveBeenCalled();
    expect(captured.transition?.request).not.toHaveBeenCalled();
    await tree.unmount();
  });

  it("still collapses a hover-driven expansion", async () => {
    ipc.windowHoverStageSet.mockResolvedValue(snapshot("compact", "capsule"));
    const tree = await mountReactTree(<Harness desiredState="compact" />);

    captured.submit?.(0, 2);
    await flushReactWork();

    expect(captured.transition?.request).toHaveBeenCalledWith("compact", expect.any(Function));
    await tree.unmount();
  });

  it("re-entering the container during the collapse delay restores the phase and the owned stage", async () => {
    ipc.windowHoverStageSet.mockResolvedValue(snapshot("compact", "capsule"));
    const tree = await mountReactTree(<Harness desiredState="compact" />);
    // 收起仍处于折叠延迟：request 未完成，hoverCollapseRef 保持待恢复相位。
    captured.transition?.request.mockReturnValue(new Promise(() => {}));

    captured.submit?.(0, 2);
    await flushReactWork();
    exposed.current?.handleContainerEnter();
    await flushReactWork();

    expect(captured.transition?.cancel).toHaveBeenCalledTimes(1);
    expect(captured.hover?.resumeStage).toHaveBeenCalledWith(2);
    expect(exposed.current?.phase).toBe("expanded");
    expect(exposed.current?.collapsingToCapsule).toBe(false);
    await tree.unmount();
  });

  it("does not roll the phase back once the native collapse was already submitted", async () => {
    ipc.windowHoverStageSet.mockResolvedValue(snapshot("compact", "capsule"));
    const tree = await mountReactTree(<Harness desiredState="compact" />);

    captured.transition?.request.mockReturnValue(new Promise(() => {}));
    captured.submit?.(0, 2);
    await flushReactWork();
    captured.transition?.cancel.mockReturnValue(false);
    exposed.current?.handleRightZoneEnter();
    await flushReactWork();

    expect(captured.transition?.cancel).toHaveBeenCalledTimes(1);
    expect(captured.hover?.resumeStage).not.toHaveBeenCalled();
    expect(exposed.current?.phase).not.toBe("expanded");
    expect(captured.hover?.enter).toHaveBeenCalledTimes(1);
    await tree.unmount();
  });

  it("container re-entry outside a collapse only cancels a pending leave", async () => {
    const tree = await mountReactTree(<Harness desiredState="compact" />);

    exposed.current?.handleContainerEnter();

    expect(captured.hover?.cancelPendingLeave).toHaveBeenCalledTimes(1);
    expect(captured.hover?.enter).not.toHaveBeenCalled();
    expect(captured.transition?.cancel).not.toHaveBeenCalled();
    await tree.unmount();
  });
});
