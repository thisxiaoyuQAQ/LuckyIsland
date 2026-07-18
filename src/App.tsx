import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronUp, Download, Moon, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TimePage } from "@/components/pages/time/TimePage";
import {
  KEYS,
  openSettings,
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
  containerExpandedForPhase,
  createHoverController,
  createIslandTransitionController,
  setIslandState as submitIslandState,
  windowHoverSet,
  windowPolicyGet,
  type IslandState,
  type IslandVisualPhase,
  type WindowPolicySnapshot,
} from "@/lib/window-policy";
import { useTheme } from "@/lib/theme";
import {
  acknowledgeAvailableUpdate,
  getUpdateSnapshot,
  scheduleAutoCheck,
  setUpdateFullscreenBlocked,
  subscribeUpdate,
} from "@/lib/update-store";
import { PAGE_BY_ID } from "@/pages/registry";
import { useIslandSettings } from "@/pages/useIslandSettings";
import { useIslandEvents } from "@/pages/useIslandEvents";
import { useIslandNavigation } from "@/pages/useIslandNavigation";

/** 页面切换横向滑入/滑出变体；方向由 custom={direction} 决定（+1 新页从右滑入、-1 从左滑入） */
const pageVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? "-100%" : "100%", opacity: 0 }),
};

function App() {
  const { resolvedTheme, setThemeMode } = useTheme();
  const [policy, setPolicy] = useState<WindowPolicySnapshot | null>(null);
  const [visualPhase, setVisualPhase] = useState<IslandVisualPhase>("compact");
  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const [blur, setBlur] = useState(true);
  const [opacity, setOpacity] = useState(0.7);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [updateSnapshot, setUpdateSnapshot] = useState(getUpdateSnapshot);
  const [pagesEnabled, setPagesEnabled] = useState(parsePagesEnabled(null));
  const [pagesOrder, setPagesOrder] = useState(parsePagesOrder(null));
  const islandRef = useRef<HTMLDivElement>(null);
  const islandStateChangedRef = useRef(false);
  const transitionControllerRef = useRef<ReturnType<typeof createIslandTransitionController> | null>(null);
  const hoverControllerRef = useRef<ReturnType<typeof createHoverController> | null>(null);
  const visualPhaseRef = useRef(visualPhase);
  reducedMotionRef.current = reducedMotion;
  visualPhaseRef.current = visualPhase;

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
        setPolicy(snapshot);
      },
      recover: async () => {
        const snapshot = await windowPolicyGet();
        setPolicy(snapshot);
        setVisualPhase(snapshot.effectiveState === "expanded" ? "expanded" : "compact");
      },
    });
  }

  if (hoverControllerRef.current === null) {
    hoverControllerRef.current = createHoverController({
      enterDelay: 180,
      leaveDelay: 300,
      submit: (hovered) => {
        const target = hovered ? "expanded" : "compact";
        void transitionControllerRef.current
          ?.request(target, async () => windowHoverSet(hovered))
          .catch((error) => console.error("[window-policy] 提交悬停状态失败:", error));
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
  const effectiveTheme = resolvedTheme;

  const setState = useCallback((state: IslandState) => {
    islandStateChangedRef.current = true;
    hoverControllerRef.current?.suppressCurrentCycle();
    void transitionControllerRef.current
      ?.request(state)
      .catch((error) => console.error(`[window-policy] 切换 ${state} 失败:`, error));
  }, []);

  const handleEscape = useCallback(() => setState("compact"), [setState]);

  const { pageIndex, direction, setPage } = useIslandNavigation(
    pages,
    expanded,
    islandRef,
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
    if (policy?.hoverExpand && !policy.clickThrough) {
      hoverControllerRef.current?.enable();
      return;
    }
    hoverControllerRef.current?.disable();
  }, [policy?.clickThrough, policy?.hoverExpand]);

  useEffect(() => scheduleAutoCheck(autoCheckUpdates), [autoCheckUpdates]);

  useEffect(() => subscribeUpdate(() => setUpdateSnapshot(getUpdateSnapshot())), []);

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
        ref={islandRef}
        onMouseEnter={() => hoverControllerRef.current?.enter()}
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
          height: expanded ? 380 : 56,
          opacity: islandState === "hidden" ? 0 : 1,
        }}
        transition={{
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
        {/* 顶部条 */}
        <div data-tauri-drag-region className="flex h-14 shrink-0 items-center gap-3">
          {expanded ? (
            <div className="flex items-center gap-1">
              {pages.map((p, i) => (
                <button
                  key={p.id}
                  data-island-wheel-page-switch
                  onClick={() => setPage(i)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    i === pageIndex
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {pages.map((p, i) => (
                <span
                  key={p.id}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === pageIndex ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/40",
                  )}
                />
              ))}
            </div>
          )}

          {!expanded && (
            <div className="relative ml-1 overflow-hidden">
              <AnimatePresence mode="popLayout" custom={direction} initial={false}>
                <motion.div
                  key={pageIndex}
                  custom={direction}
                  variants={pageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: ISLAND_DURATION_MS / 1000, ease: ISLAND_EASE }}
                >
                  <CurrentPage compact />
                </motion.div>
              </AnimatePresence>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1">
            {updateSnapshot.phase === "available" &&
              updateSnapshot.pendingAvailable &&
              !updateSnapshot.fullscreenBlocked && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    acknowledgeAvailableUpdate();
                    void openSettings("about");
                  }}
                  aria-label={`发现 LuckyIsland ${updateSnapshot.latestVersion ?? "新版本"}，打开关于页更新`}
                >
                  <Download />
                </Button>
              )}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                setState(expanded ? "compact" : "expanded");
              }}
              aria-label="展开/收起"
            >
              {expanded ? <ChevronUp /> : <ChevronDown />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                void openSettings();
              }}
              aria-label="打开设置"
            >
              <Settings />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                setThemeAndPersist(effectiveTheme === "dark" ? "light" : "dark");
              }}
              aria-label="切换主题"
            >
              {effectiveTheme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>

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
