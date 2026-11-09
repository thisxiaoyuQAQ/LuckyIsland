import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { TimePage } from "@/components/pages/time/TimePage";
import {
  DRAG_SETTLED_EVENT,
  KEYS,
  dockEdgeKey,
  isDragSettled,
  parsePagesEnabled,
  parsePagesOrder,
  settingGet,
  settingSetEmit,
} from "@/lib/settings";
import {
  ISLAND_DURATION_MS,
  ISLAND_EASE,
  ISLAND_EXPAND_DURATION_MS,
  ISLAND_LAYERED_EASE,
} from "@/lib/anim";
import {
  windowPolicyGet,
  type IslandState,
  type WindowPolicySnapshot,
} from "@/lib/window-policy";
import { islandShellLayout, shellSizeTransition, useDragSizeSnap } from "@/lib/island-layout";
import { useTheme } from "@/lib/theme";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { useUiMode, getUiMode } from "@/lib/ui-mode";
import { useIslandWidth } from "@/lib/island-width";
import { useIslandOpacity } from "@/lib/island-opacity";
import { applyDockEdgeSetting, useDockEdge } from "@/lib/island-dock-edge";
import { createIslandDragController } from "@/lib/island-drag-controller";
import {
  scheduleAutoCheck,
  setUpdateFullscreenBlocked,
} from "@/lib/update-store";
import { IslandTopBar } from "@/pages/IslandTopBar";
import { DockNavigation } from "@/pages/DockNavigation";
import { PAGE_BY_ID } from "@/pages/registry";
import { useIslandSettings } from "@/pages/useIslandSettings";
import { useIslandEvents } from "@/pages/useIslandEvents";
import { useIslandNavigation } from "@/pages/useIslandNavigation";
import { useIslandTransition } from "@/pages/useIslandTransition";
import { DragPresentation } from "@/pages/DragPresentation";
import { IslandBody } from "@/pages/IslandBody";
import { acceptPolicySnapshot } from "@/pages/island-controller-refs";

function App() {
  const { resolvedTheme, setThemeMode } = useTheme();
  const uiMode = useUiMode();
  const taskbarMode = uiMode === "taskbar";
  const docked = uiMode === "classisland";
  const dockEdge = useDockEdge();
  // taskbar 面板恒为横向（原生几何由任务栏决定，不读停靠边）。
  const isVerticalDock = !taskbarMode && (dockEdge === "left" || dockEdge === "right");
  const islandWidth = useIslandWidth();
  const islandWidthRef = useRef(islandWidth);
  islandWidthRef.current = islandWidth;
  const [policy, setPolicy] = useState<WindowPolicySnapshot | null>(null);
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const [blur, setBlur] = useState(true);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [pagesEnabled, setPagesEnabled] = useState(parsePagesEnabled(null));
  const [pagesOrder, setPagesOrder] = useState(parsePagesOrder(null));
  const wheelZoneRef = useRef<HTMLDivElement>(null);
  const islandStateChangedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const dragControllerRef =
    useRef<ReturnType<typeof createIslandDragController> | null>(null);
  const floatingBallRef = useRef(false);
  const desiredStateRef = useRef<IslandState>("compact");
  const dockedRef = useRef(docked);
  const taskbarModeRef = useRef(taskbarMode);
  taskbarModeRef.current = taskbarMode;
  const draggingRef = useRef(dragging);
  reducedMotionRef.current = reducedMotion;
  floatingBallRef.current = policy?.floatingBall ?? false;
  // 手动/通知展开（desired=expanded）与全屏优先级通知覆盖期间，Rust 都不响应悬停阶段：
  // 对悬停而言两者等同于手动展开（BUG-20261108-01 #2）。
  const hoverLocked =
    policy?.desiredState === "expanded" || (policy?.priorityOverrideActive ?? false);
  desiredStateRef.current = hoverLocked ? "expanded" : (policy?.desiredState ?? "compact");
  dockedRef.current = docked;
  draggingRef.current = dragging;

  const {
    transitionRef: transitionControllerRef,
    hoverRef: hoverControllerRef,
    visualPhase,
    visualPhaseRef,
    collapsingToCapsule,
    setCollapsingToCapsule,
    setVisualPhase,
    setState,
    handleRightZoneEnter,
    handleContainerEnter,
  } = useIslandTransition({
    reducedMotionRef,
    setPolicy,
    floatingBallRef,
    draggingRef,
    islandStateChangedRef,
    desiredStateRef,
  });

  const snapshotRefs = {
    visualPhaseRef,
    setVisualPhase,
    setPolicy,
    setCollapsingToCapsule,
  };
  if (dragControllerRef.current === null) {
    dragControllerRef.current = createIslandDragController({
      canDrag: () => !taskbarModeRef.current,
      recoverAfterSettleFailure: async () => {
        const [snapshot, dockEdgeValue] = await Promise.all([
          windowPolicyGet(),
          settingGet(dockEdgeKey(getUiMode())).catch((error) => {
            console.error("[island-drag] 重读停靠边失败:", error);
            return undefined;
          }),
        ]);
        if (dockEdgeValue !== undefined) applyDockEdgeSetting(dockEdgeValue);
        acceptPolicySnapshot(snapshotRefs, snapshot);
        hoverControllerRef.current?.resetAfterDrag();
      },
      setDragging: (active) => {
        if (active) {
          hoverControllerRef.current?.suppressCurrentCycle();
        } else {
          hoverControllerRef.current?.resetAfterDrag();
        }
        setDragging(active);
      },
    });
  }

  // Rust 判定系统拖动结束并结算后广播；控制器按拖动 id 退出拖动态。
  useTauriEvent<unknown>(DRAG_SETTLED_EVENT, (event) => {
    if (isDragSettled(event.payload)) dragControllerRef.current?.onSettled(event.payload);
  });

  const pages = useMemo(() => {
    const ordered = pagesOrder.map((id) => PAGE_BY_ID[id]).filter(Boolean);
    const visible = ordered.filter((p) => pagesEnabled[p.id]);
    return visible.length > 0 ? visible : [PAGE_BY_ID.time];
  }, [pagesEnabled, pagesOrder]);

  const islandState = policy?.effectiveState ?? "compact";
  const expanded = visualPhase === "expanding" || visualPhase === "expanded";
  const presentation = dragging ? "dragging" : "normal";
  const islandOpacity = useIslandOpacity();
  const backgroundOpacity = expanded ? islandOpacity.expanded : islandOpacity.compact;
  const capsule = islandState === "capsule" && visualPhase === "compact";
  // 容器几何与对齐：贴住 Rust 固定的同一条停靠边，非贴边侧保留阴影余量（BUG-20261108-01 #4/#5/#7）。
  const shell = islandShellLayout({
    dockEdge,
    docked,
    dragging,
    expanded,
    capsuleLike: capsule || collapsingToCapsule,
    islandWidth,
    taskbar: taskbarMode,
  });
  const containerWidthPx = shell.widthPx;
  const heightTargetPx = shell.heightPx;
  const snapSize = useDragSizeSnap(dragging);
  const sizeTransition = shellSizeTransition({
    reducedMotion: reducedMotion ?? false,
    dragging: snapSize,
  });
  const effectiveTheme = resolvedTheme;

  const handleEscape = useCallback(() => setState("compact"), [setState]);

  const { pageIndex, direction, setPage } = useIslandNavigation(
    pages,
    expanded,
    wheelZoneRef,
    handleEscape,
  );

  const CurrentPage = pages[pageIndex]?.Component ?? TimePage;

  useIslandSettings({
    setPagesEnabled,
    setPagesOrder,
    setThemeMode,
    setBlur,
    setAutoCheckUpdates,
  });

  useIslandEvents({
    pages,
    setPage,
    setPolicy,
    setVisualPhase,
    visualPhaseRef,
    islandStateChangedRef,
  });

  const setThemeAndPersist = useCallback((mode: "light" | "dark" | "auto") => {
    setThemeMode(mode);
    void settingSetEmit(KEYS.theme, mode);
  }, [setThemeMode]);

  useEffect(() => {
    return () => {
      transitionControllerRef.current?.dispose();
      hoverControllerRef.current?.dispose();
      dragControllerRef.current?.dispose();
    };
  }, [transitionControllerRef, hoverControllerRef]);

  useEffect(() => {
    const hoverCapable =
      !dragging &&
      !taskbarMode &&
      policy !== null &&
      !policy.clickThrough &&
      // 手动/通知展开期间不跑悬停周期（BUG-20261108-01 #2）；disable 归还的 stage 0 只同步后端。
      !hoverLocked &&
      (policy.floatingBall || policy.hoverExpand);
    if (hoverCapable) {
      hoverControllerRef.current?.enable();
      return;
    }
    hoverControllerRef.current?.disable();
  }, [dragging, hoverLocked, policy, taskbarMode, hoverControllerRef]);

  useEffect(() => {
    hoverControllerRef.current?.setPromotionEnabled(policy?.hoverExpand ?? false);
  }, [policy?.hoverExpand, hoverControllerRef]);

  useEffect(() => {
    hoverControllerRef.current?.setStageOneEnabled(policy?.floatingBall ?? false);
  }, [policy?.floatingBall, hoverControllerRef]);

  useEffect(() => scheduleAutoCheck(autoCheckUpdates), [autoCheckUpdates]);

  useEffect(() => {
    setUpdateFullscreenBlocked(policy?.fullscreenBlock ?? false);
  }, [policy?.fullscreenBlock]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
  }, [effectiveTheme]);

  return (
    <div
      data-taskbar-mode={taskbarMode ? "true" : "false"}
      data-taskbar-expanded={
        taskbarMode && (policy?.taskbarExpanded ?? expanded) ? "true" : "false"
      }
      className={cn("flex h-screen w-screen", shell.wrapperClass)}
    >
      <motion.div
        data-island-container
        data-taskbar-panel={taskbarMode ? "true" : "false"}
        data-dock-edge={dockEdge}
        data-presentation={presentation}
        onMouseDown={(event) => dragControllerRef.current?.onMouseDown(event.nativeEvent)}
        onMouseEnter={handleContainerEnter}
        onMouseLeave={() => {
          if (!dragging) hoverControllerRef.current?.leave();
        }}
        className={cn(
          "flex w-full border border-border/60 shadow-2xl",
          dragging && "flex-row items-center justify-center px-4",
          !dragging && (isVerticalDock ? "flex-row p-0" : "flex-col px-4"),
          !dragging && dockEdge === "right" && isVerticalDock && "flex-row-reverse",
          taskbarMode && "border-border/50 px-4",
          shell.shapeClass,
          blur && "backdrop-blur-xl",
        )}
        animate={{
          width: containerWidthPx,
          height: heightTargetPx,
          opacity:
            taskbarMode && !(policy?.taskbarExpanded ?? false)
              ? 0
              : islandState === "hidden"
                ? 0
                : 1,
          backgroundColor: `color-mix(in oklch, var(--card) ${(backgroundOpacity * 100).toFixed(0)}%, transparent)`,
        }}
        transition={{
          width: sizeTransition,
          height: sizeTransition,
          opacity: {
            duration: reducedMotion ? 0 : ISLAND_DURATION_MS / 1000,
            ease: ISLAND_EASE,
          },
          backgroundColor: reducedMotion
            ? { duration: 0 }
            : {
                duration: ISLAND_EXPAND_DURATION_MS / 1000,
                ease: ISLAND_LAYERED_EASE,
              },
        }}
      >
        {dragging ? (
          <DragPresentation />
        ) : isVerticalDock ? (
          <>
            <DockNavigation
              edge={dockEdge}
              expanded={expanded}
              pages={pages}
              pageIndex={pageIndex}
              onSetPage={setPage}
              onToggleExpanded={() => setState(expanded ? "compact" : "expanded")}
            />
            {expanded && (
              <IslandBody
                vertical
                reducedMotion={reducedMotion}
                visualPhase={visualPhase}
                direction={direction}
                pageIndex={pageIndex}
                currentPage={CurrentPage}
              />
            )}
          </>
        ) : (
          <>
            {/* 顶部条：11a.2 拆为左侧内容/wheel 区 + 右侧 hover/action 命中区；
                胶囊判定包含 collapsingToCapsule —— 收起到胶囊的过渡中也按胶囊形态渲染，
                否则收窄过程中右区按钮/页点等条状元素仍会在 240px 容器里溢出。 */}
            <IslandTopBar
              expanded={visualPhase === "expanded"}
              capsule={capsule || collapsingToCapsule}
              collapsing={collapsingToCapsule}
              pages={pages}
              pageIndex={pageIndex}
              direction={direction}
              currentPage={CurrentPage}
              wheelZoneRef={wheelZoneRef}
              containerWidthPx={containerWidthPx}
              islandWidthRef={islandWidthRef}
              dockEdge={dockEdge}
              vertical={isVerticalDock}
              dragging={dragging}
              onRightZoneEnter={handleRightZoneEnter}
              onSetPage={setPage}
              onToggleExpanded={() => setState(expanded ? "compact" : "expanded")}
              onToggleTheme={() =>
                setThemeAndPersist(effectiveTheme === "dark" ? "light" : "dark")
              }
              effectiveTheme={effectiveTheme}
            />

            {(visualPhase === "expanding" || visualPhase === "expanded") && (
              <IslandBody
                reducedMotion={reducedMotion}
                visualPhase={visualPhase}
                direction={direction}
                pageIndex={pageIndex}
                currentPage={CurrentPage}
                vertical={false}
              />
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

export default App;
