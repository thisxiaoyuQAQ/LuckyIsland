import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronUp, Download, Moon, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TimePage } from "@/components/pages/time/TimePage";
import { CalendarPage } from "@/components/pages/calendar/CalendarPage";
import { WeatherPage } from "@/components/pages/weather/WeatherPage";
import { StockPage } from "@/components/pages/stock/StockPage";
import { TodoPage } from "@/components/pages/todo/TodoPage";
import { TerminalPage } from "@/components/pages/terminal/TerminalPage";
import { NotifyPage } from "@/components/pages/notify/NotifyPage";
import {
  KEYS,
  onSettingsChanged,
  openSettings,
  parseBool,
  parseOpacity,
  parsePagesEnabled,
  parsePagesOrder,
  settingGet,
  settingSetEmit,
  type PageId,
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
  shouldSyncExternalVisualPhase,
  windowHoverSet,
  windowPolicyGet,
  type IslandState,
  type IslandVisualPhase,
  type WindowPolicySnapshot,
} from "@/lib/window-policy";
import {
  getIslandWheelDirection,
  updateWheelGestureLock,
} from "@/lib/islandWheel";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { parseThemeMode, useTheme } from "@/lib/theme";
import {
  acknowledgeAvailableUpdate,
  getUpdateSnapshot,
  scheduleAutoCheck,
  setUpdateFullscreenBlocked,
  subscribeUpdate,
} from "@/lib/update-store";

interface PageMeta {
  id: PageId;
  label: string;
  Component: FC<{ compact: boolean }>;
}

const ALL_PAGES: PageMeta[] = [
  { id: "time", label: "时间", Component: TimePage },
  { id: "calendar", label: "日历", Component: CalendarPage },
  { id: "weather", label: "天气", Component: WeatherPage },
  { id: "stock", label: "股票", Component: StockPage },
  { id: "todo", label: "待办", Component: TodoPage },
  { id: "notify", label: "通知", Component: NotifyPage },
  { id: "terminal", label: "终端", Component: TerminalPage },
];

const PAGE_BY_ID = Object.fromEntries(ALL_PAGES.map((p) => [p.id, p])) as Record<PageId, PageMeta>;

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
  const [pageIndex, setPageIndex] = useState(0);
  const [pagesEnabled, setPagesEnabled] = useState(parsePagesEnabled(null));
  const [pagesOrder, setPagesOrder] = useState(parsePagesOrder(null));
  const [direction, setDirection] = useState(1);
  const prevIndexRef = useRef(0);
  const islandRef = useRef<HTMLDivElement>(null);
  const pageIndexRef = useRef(pageIndex);
  const wheelLockedUntilRef = useRef(0);
  const islandStateChangedRef = useRef(false);
  const transitionControllerRef = useRef<ReturnType<typeof createIslandTransitionController> | null>(null);
  const hoverControllerRef = useRef<ReturnType<typeof createHoverController> | null>(null);
  const visualPhaseRef = useRef(visualPhase);
  reducedMotionRef.current = reducedMotion;
  visualPhaseRef.current = visualPhase;
  pageIndexRef.current = pageIndex;

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
  const CurrentPage = pages[pageIndex]?.Component ?? TimePage;

  const setState = useCallback((state: IslandState) => {
    islandStateChangedRef.current = true;
    hoverControllerRef.current?.suppressCurrentCycle();
    void transitionControllerRef.current
      ?.request(state)
      .catch((error) => console.error(`[window-policy] 切换 ${state} 失败:`, error));
  }, []);

  const setPage = useCallback(
    (i: number) => {
      const n = pages.length;
      if (n === 0) return;
      const next = (((i % n) + n) % n);
      const prev = prevIndexRef.current;
      if (next !== prev) {
        // 取旋转最短方向：Alt+-> / 滚轮向下为 +1，Alt+<- 为 -1；跳转（Alt+数字）取较短旋转
        const forward = (next - prev + n) % n;
        const backward = (prev - next + n) % n;
        setDirection(forward <= backward ? 1 : -1);
        prevIndexRef.current = next;
      }
      setPageIndex(next);
    },
    [pages.length],
  );

  // 岛面非交互区域滚轮切页；局部控件/滚动区由分类器保留自身 wheel 语义。
  useEffect(() => {
    const island = islandRef.current;
    if (!island) return;

    const onWheel = (event: WheelEvent) => {
      const wheelDirection = getIslandWheelDirection(event, island);
      if (wheelDirection === 0 || pages.length < 2) return;

      const lock = updateWheelGestureLock(
        wheelLockedUntilRef.current,
        performance.now(),
        ISLAND_DURATION_MS,
      );
      wheelLockedUntilRef.current = lock.lockedUntil;
      if (!lock.consume) return;

      event.preventDefault();
      setPage(pageIndexRef.current + wheelDirection);
    };

    island.addEventListener("wheel", onWheel, { passive: false });
    return () => island.removeEventListener("wheel", onWheel);
  }, [pages.length, setPage]);

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

  // settings KV 初始化：各项独立应用，单个读取失败不影响其余设置。
  useEffect(() => {
    (async () => {
      const [enabled, order, theme, blurResult, opacityResult, updateAutoCheckResult] =
        await Promise.allSettled([
          settingGet(KEYS.pagesEnabled),
          settingGet(KEYS.pagesOrder),
          settingGet(KEYS.theme),
          settingGet(KEYS.blur),
          settingGet(KEYS.windowOpacity),
          settingGet(KEYS.updateAutoCheck),
        ]);

      const applySetting = (
        key: string,
        result: PromiseSettledResult<string | null>,
        apply: (value: string | null) => void,
      ) => {
        if (result.status === "fulfilled") {
          apply(result.value);
        } else {
          console.error(`[settings] 启动读取失败 ${key}:`, result.reason);
        }
      };

      applySetting(KEYS.pagesEnabled, enabled, (value) => {
        setPagesEnabled(parsePagesEnabled(value));
      });
      applySetting(KEYS.pagesOrder, order, (value) => {
        setPagesOrder(parsePagesOrder(value));
      });
      applySetting(KEYS.theme, theme, (value) => {
        setThemeMode(parseThemeMode(value) ?? "auto");
      });
      applySetting(KEYS.blur, blurResult, (value) => {
        setBlur(parseBool(value, true));
      });
      applySetting(KEYS.windowOpacity, opacityResult, (value) => {
        setOpacity(parseOpacity(value));
      });
      applySetting(KEYS.updateAutoCheck, updateAutoCheckResult, (value) => {
        setAutoCheckUpdates(parseBool(value, true));
      });
    })();
  }, []);

  // settings://changed：设置窗口改写后即时重算页面与主题。
  useAsyncSubscription(
    () => onSettingsChanged((key, value) => {
      if (key === KEYS.pagesEnabled) setPagesEnabled(parsePagesEnabled(value));
      if (key === KEYS.pagesOrder) setPagesOrder(parsePagesOrder(value));
      if (key === KEYS.theme) setThemeMode(parseThemeMode(value) ?? "auto");
      if (key === KEYS.blur) setBlur(parseBool(value, true));
      if (key === KEYS.windowOpacity) setOpacity(parseOpacity(value));
      if (key === KEYS.updateAutoCheck) setAutoCheckUpdates(parseBool(value, true));
    }),
    [],
    { label: "settings://changed" },
  );

  useEffect(() => scheduleAutoCheck(autoCheckUpdates), [autoCheckUpdates]);

  useEffect(() => subscribeUpdate(() => setUpdateSnapshot(getUpdateSnapshot())), []);

  useEffect(() => {
    setUpdateFullscreenBlocked(policy?.fullscreenBlock ?? false);
  }, [policy?.fullscreenBlock]);

  // 页面列表变化后，当前 index 超界则回到第一个可见页。
  useEffect(() => {
    if (pageIndex >= pages.length) {
      setPageIndex(0);
      prevIndexRef.current = 0;
    }
  }, [pageIndex, pages.length]);

  // 主题：写入 data-theme。
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
  }, [effectiveTheme]);

  // 系统深浅色跟踪由 useTheme 内部处理，resolvedTheme 已含系统解析。

  // 监听 Rust 推送的结构化策略快照；启动读取不得覆盖更新后的运行态。
  useEffect(() => {
    void windowPolicyGet()
      .then((snapshot) => {
        islandStateChangedRef.current = true;
        setPolicy(snapshot);
        setVisualPhase(snapshot.effectiveState === "expanded" ? "expanded" : "compact");
      })
      .catch((error) => console.error("[window-policy] 读取初始状态失败:", error));
  }, []);

  useTauriEvent<WindowPolicySnapshot | IslandState>("window://state-changed", (event) => {
    islandStateChangedRef.current = true;
    if (typeof event.payload === "string") {
      // Task 8 迁移通知展示前，通知后端仍可能发送旧字符串事件。
      setPolicy((current) => ({
        desiredState: event.payload as IslandState,
        effectiveState: event.payload as IslandState,
        shouldFocus: false,
        clickThrough: current?.clickThrough ?? false,
        hoverExpand: current?.hoverExpand ?? false,
        hovered: current?.hovered ?? false,
        hideInFullscreen: current?.hideInFullscreen ?? false,
        fullscreenSupported: current?.fullscreenSupported ?? true,
        fullscreenBlock: current?.fullscreenBlock ?? false,
        priorityOverrideActive: current?.priorityOverrideActive ?? false,
        priorityOverrideGeneration: current?.priorityOverrideGeneration ?? 0,
      }));
    } else {
      setPolicy(event.payload);
      if (shouldSyncExternalVisualPhase(visualPhaseRef.current)) {
        setVisualPhase(event.payload.effectiveState === "expanded" ? "expanded" : "compact");
      }
    }
  });

  // 通知到达：只切通知页；窗口显示由后端策略统一裁决。
  useTauriEvent("notify://incoming", () => {
    const index = pages.findIndex((page) => page.id === "notify");
    if (index >= 0) setPage(index);
  });

  // 局部快捷键（仅展开态，需窗口焦点）。
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape") {
        setState("compact");
        return;
      }
      if (typing) return;
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const i = parseInt(e.key, 10) - 1;
        if (i < pages.length) {
          e.preventDefault();
          setPage(i);
        }
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        setPage(pageIndex - 1);
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        setPage(pageIndex + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, pageIndex, pages.length, setPage, setState]);

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
