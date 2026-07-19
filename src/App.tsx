import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { TimePage } from "@/components/pages/time/TimePage";
import {
  KEYS,
  parsePagesEnabled,
  parsePagesOrder,
  settingSetEmit,
} from "@/lib/settings";
import {
  ISLAND_COLLAPSE_DURATION_MS,
  ISLAND_CONTENT_ENTER_DELAY_MS,
  ISLAND_CONTENT_ENTER_DURATION_MS,
  ISLAND_CONTENT_EXIT_DURATION_MS,
  ISLAND_DURATION_MS,
  ISLAND_EASE,
  ISLAND_EXPAND_DURATION_MS,
  ISLAND_LAYERED_EASE,
} from "@/lib/anim";
import {
  CAPSULE_WIDTH_PX,
  HOVER_ENTER_DELAY_MS,
  HOVER_LEAVE_DELAY_MS,
  ISLAND_STRIP_WIDTH_PX,
  containerExpandedForPhase,
  createHoverStageController,
  createIslandTransitionController,
  setIslandState as submitIslandState,
  windowHoverStageSet,
  windowPolicyGet,
  type IslandState,
  type IslandVisualPhase,
  type WindowPolicySnapshot,
} from "@/lib/window-policy";
import { useTheme } from "@/lib/theme";
import {
  scheduleAutoCheck,
  setUpdateFullscreenBlocked,
} from "@/lib/update-store";
import { IslandTopBar, pageVariants } from "@/pages/IslandTopBar";
import { PAGE_BY_ID } from "@/pages/registry";
import { useIslandSettings } from "@/pages/useIslandSettings";
import { useIslandEvents } from "@/pages/useIslandEvents";
import { useIslandNavigation } from "@/pages/useIslandNavigation";

function App() {
  const { resolvedTheme, setThemeMode } = useTheme();
  const [policy, setPolicy] = useState<WindowPolicySnapshot | null>(null);
  const [visualPhase, setVisualPhase] = useState<IslandVisualPhase>("compact");
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const [blur, setBlur] = useState(true);
  const [opacity, setOpacity] = useState(0.7);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [pagesEnabled, setPagesEnabled] = useState(parsePagesEnabled(null));
  const [pagesOrder, setPagesOrder] = useState(parsePagesOrder(null));
  const wheelZoneRef = useRef<HTMLDivElement>(null);
  const islandStateChangedRef = useRef(false);
  const transitionControllerRef = useRef<ReturnType<typeof createIslandTransitionController> | null>(null);
  const hoverControllerRef = useRef<ReturnType<typeof createHoverStageController> | null>(null);
  /** 待决悬停收起要恢复的视觉相位（stage 2→expanded、stage 1→compact）；null 表示无待决收起。 */
  const hoverCollapseRef = useRef<IslandVisualPhase | null>(null);
  /** 收起动画进行中且终点是胶囊：让宽度与高度同帧动画，遮住终点处的原生收窄跳变。 */
  const [collapsingToCapsule, setCollapsingToCapsule] = useState(false);
  const visualPhaseRef = useRef(visualPhase);
  const floatingBallRef = useRef(false);
  reducedMotionRef.current = reducedMotion;
  visualPhaseRef.current = visualPhase;
  floatingBallRef.current = policy?.floatingBall ?? false;

  if (transitionControllerRef.current === null) {
    transitionControllerRef.current = createIslandTransitionController({
      collapseDelay: ISLAND_COLLAPSE_DURATION_MS,
      reducedMotion: () => reducedMotionRef.current ?? false,
      setVisualPhase: (phase) => {
        visualPhaseRef.current = phase;
        setVisualPhase(phase);
      },
      submit: submitIslandState,
      acceptSnapshot: (snapshot) => {
        setCollapsingToCapsule(false);
        setPolicy(snapshot);
      },
      recover: async () => {
        const snapshot = await windowPolicyGet();
        setCollapsingToCapsule(false);
        setPolicy(snapshot);
        setVisualPhase(snapshot.effectiveState === "expanded" ? "expanded" : "compact");
      },
    });
  }

  if (hoverControllerRef.current === null) {
    hoverControllerRef.current = createHoverStageController({
      enterDelay: HOVER_ENTER_DELAY_MS,
      leaveDelay: HOVER_LEAVE_DELAY_MS,
      submit: (stage, previous) => {
        const transitions = transitionControllerRef.current;
        const fail = (error: unknown) =>
          console.error("[window-policy] 提交悬停阶段失败:", error);
        if (stage === 2) {
          // 条状→完整面板：走展开动画，再由策略层 resize（hover 不抢焦点）。
          void transitions
            ?.request("expanded", async () => windowHoverStageSet(2))
            .catch(fail);
        } else if (stage === 0 && previous === 2) {
          // 悬停展开后的移出：先播前端折叠动画再提交 stage 0；指针在延迟内回到
          // 右侧时由 handleRightZoneEnter 撤销。
          hoverCollapseRef.current = "expanded";
          if (floatingBallRef.current) setCollapsingToCapsule(true);
          void transitions
            ?.request("compact", async () => windowHoverStageSet(0))
            .catch(fail)
            .finally(() => {
              hoverCollapseRef.current = null;
            });
        } else if (stage === 0 && previous === 1) {
          // 条状→胶囊：先播前端收窄动画（终点才原生 resize），指针回到右侧可撤销。
          hoverCollapseRef.current = "compact";
          setCollapsingToCapsule(true);
          void transitions
            ?.request("compact", async () => windowHoverStageSet(0))
            .catch(fail)
            .finally(() => {
              hoverCollapseRef.current = null;
            });
        } else {
          // 胶囊→条状原生 resize 在动画起点提交，前端宽度动画跟随快照展开。
          void windowHoverStageSet(stage).then(setPolicy).catch(fail);
        }
      },
    });
  }

  const pages = useMemo(() => {
    const ordered = pagesOrder.map((id) => PAGE_BY_ID[id]).filter(Boolean);
    const visible = ordered.filter((p) => pagesEnabled[p.id]);
    return visible.length > 0 ? visible : [PAGE_BY_ID.time];
  }, [pagesEnabled, pagesOrder]);

  const islandState = policy?.effectiveState ?? "compact";
  const expanded = containerExpandedForPhase(visualPhase);
  const capsule = islandState === "capsule";
  // 胶囊进出过渡：宽度与高度同帧动画（展开/展开中立即放宽；收起到胶囊时随折叠收窄），
  // 原生 resize 的瞬时宽度跳变因此被前端动画遮住。
  const containerWidthPx =
    expanded || !(capsule || collapsingToCapsule)
      ? ISLAND_STRIP_WIDTH_PX
      : CAPSULE_WIDTH_PX;
  const effectiveTheme = resolvedTheme;

  const setState = useCallback((state: IslandState) => {
    islandStateChangedRef.current = true;
    hoverControllerRef.current?.suppressCurrentCycle();
    // 收起终点是胶囊（浮球开启）时，让宽度随高度一起动画到胶囊尺寸。
    setCollapsingToCapsule(state === "compact" && floatingBallRef.current);
    void transitionControllerRef.current
      ?.request(state)
      .catch((error) => console.error(`[window-policy] 切换 ${state} 失败:`, error));
  }, []);

  const handleEscape = useCallback(() => setState("compact"), [setState]);

  // 右侧命中区进入：撤销待决的悬停收起（原生仍是展开/条状，视觉相位同步恢复），再进入 hover 周期。
  const handleRightZoneEnter = useCallback(() => {
    const restorePhase = hoverCollapseRef.current;
    if (restorePhase !== null) {
      hoverCollapseRef.current = null;
      transitionControllerRef.current?.cancel();
      setCollapsingToCapsule(false);
      visualPhaseRef.current = restorePhase;
      setVisualPhase(restorePhase);
    }
    hoverControllerRef.current?.enter();
  }, []);

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
    setOpacity,
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
    };
  }, []);

  useEffect(() => {
    const hoverCapable =
      policy !== null &&
      !policy.clickThrough &&
      (policy.floatingBall || policy.hoverExpand);
    if (hoverCapable) {
      hoverControllerRef.current?.enable();
      return;
    }
    hoverControllerRef.current?.disable();
  }, [policy]);

  useEffect(() => {
    hoverControllerRef.current?.setPromotionEnabled(policy?.hoverExpand ?? false);
  }, [policy?.hoverExpand]);

  useEffect(() => {
    hoverControllerRef.current?.setStageOneEnabled(policy?.floatingBall ?? false);
  }, [policy?.floatingBall]);

  useEffect(() => scheduleAutoCheck(autoCheckUpdates), [autoCheckUpdates]);

  useEffect(() => {
    setUpdateFullscreenBlocked(policy?.fullscreenBlock ?? false);
  }, [policy?.fullscreenBlock]);

  // 主题：写入 data-theme。
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
  }, [effectiveTheme]);

  return (
    <div className="flex h-screen w-screen items-start justify-center pt-3">
      <motion.div
        onMouseLeave={() => hoverControllerRef.current?.leave()}
        className={cn(
          "flex w-full max-w-[700px] flex-col rounded-2xl border border-border/60 px-4 shadow-2xl",
          blur && "backdrop-blur-xl",
        )}
        style={{
          // 07a 窗口外观：背景透明度由 window:opacity 控制，不改窗口 transparent 标志、
          // 不动 motion 的 opacity（那是 hidden 态淡出动画）。color-mix 在 oklch 通道上把
          // var(--card) 与 transparent 混合，亮度/色度保留、只调 alpha，亮暗主题都生效。
          backgroundColor: `color-mix(in oklch, var(--card) ${(opacity * 100).toFixed(0)}%, transparent)`,
        }}
        animate={{
          width: containerWidthPx,
          height: expanded ? 380 : 56,
          opacity: islandState === "hidden" ? 0 : 1,
        }}
        transition={{
          width: reducedMotion
            ? { duration: 0 }
            : {
                duration: ISLAND_EXPAND_DURATION_MS / 1000,
                ease: ISLAND_LAYERED_EASE,
              },
          height: reducedMotion
            ? { duration: 0 }
            : {
                duration: ISLAND_EXPAND_DURATION_MS / 1000,
                ease: ISLAND_LAYERED_EASE,
              },
          opacity: {
            duration: reducedMotion ? 0 : ISLAND_DURATION_MS / 1000,
            ease: ISLAND_EASE,
          },
        }}
      >
        {/* 顶部条：11a.2 拆为左侧内容/wheel 区 + 右侧 hover/action 命中区 */}
        <IslandTopBar
          expanded={expanded}
          capsule={capsule}
          pages={pages}
          pageIndex={pageIndex}
          direction={direction}
          currentPage={CurrentPage}
          wheelZoneRef={wheelZoneRef}
          onRightZoneEnter={handleRightZoneEnter}
          onSetPage={setPage}
          onToggleExpanded={() => setState(expanded ? "compact" : "expanded")}
          onToggleTheme={() => setThemeAndPersist(effectiveTheme === "dark" ? "light" : "dark")}
          effectiveTheme={effectiveTheme}
        />

        {/* 展开内容：容器先获得空间，内容随后进入；收起时内容先退出。 */}
        <AnimatePresence initial={false}>
          {(visualPhase === "expanding" || visualPhase === "expanded") && (
            <motion.div
              key="island-body"
              initial={reducedMotion ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : {
                      delay:
                        visualPhase === "expanding"
                          ? ISLAND_CONTENT_ENTER_DELAY_MS / 1000
                          : 0,
                      duration:
                        visualPhase === "expanding"
                          ? ISLAND_CONTENT_ENTER_DURATION_MS / 1000
                          : ISLAND_CONTENT_EXIT_DURATION_MS / 1000,
                      ease: ISLAND_LAYERED_EASE,
                    }
              }
              className="relative flex-1 overflow-hidden px-2 pb-1"
            >
              <AnimatePresence mode="popLayout" custom={direction} initial={false}>
                <motion.div
                  key={pageIndex}
                  custom={direction}
                  variants={pageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: ISLAND_DURATION_MS / 1000, ease: ISLAND_EASE }}
                  className="h-full"
                >
                  <CurrentPage compact={false} />
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export default App;
