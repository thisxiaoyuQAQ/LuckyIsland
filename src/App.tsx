import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, ChevronUp, Moon, Settings, Sun } from "lucide-react";
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
  parsePagesEnabled,
  parsePagesOrder,
  settingGet,
  settingSetEmit,
  type PageId,
} from "@/lib/settings";
import { ISLAND_DURATION_MS, ISLAND_EASE, ISLAND_WINDOW_SHRINK_DELAY_MS } from "@/lib/anim";

type Theme = "light" | "dark";
type ThemeMode = Theme | "auto";
type IslandState = "hidden" | "compact" | "expanded";

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

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeThemeMode(v: string | null): ThemeMode | null {
  return v === "light" || v === "dark" || v === "auto" ? v : null;
}

function normalizeIslandState(v: string | null): IslandState | null {
  return v === "hidden" || v === "compact" || v === "expanded" ? v : null;
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme);
  const [islandState, setIslandState] = useState<IslandState>("compact");
  const [pageIndex, setPageIndex] = useState(0);
  const [pagesEnabled, setPagesEnabled] = useState(parsePagesEnabled(null));
  const [pagesOrder, setPagesOrder] = useState(parsePagesOrder(null));
  const [direction, setDirection] = useState(1);
  const prevIndexRef = useRef(0);

  const pages = useMemo(() => {
    const ordered = pagesOrder.map((id) => PAGE_BY_ID[id]).filter(Boolean);
    const visible = ordered.filter((p) => pagesEnabled[p.id]);
    return visible.length > 0 ? visible : [PAGE_BY_ID.time];
  }, [pagesEnabled, pagesOrder]);

  const expanded = islandState === "expanded";
  const effectiveTheme: Theme = themeMode === "auto" ? systemTheme : themeMode;
  const CurrentPage = pages[pageIndex]?.Component ?? TimePage;

  const setState = useCallback((s: IslandState) => {
    setIslandState(s);
    if (s === "compact") {
      // 收起：先让容器 CSS 收缩（在原窗口尺寸内，圆角不被裁剪），过渡完成后再缩小窗口，
      // 避免窗口先变小、容器仍大被窗口方形边界裁剪出无圆角的方框
      window.setTimeout(() => {
        void invoke("set_island_state", { state: s });
      }, ISLAND_WINDOW_SHRINK_DELAY_MS);
    } else {
      void invoke("set_island_state", { state: s });
    }
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

  const setThemeAndPersist = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    void settingSetEmit(KEYS.theme, mode);
  }, []);

  // settings KV 初始化：页面显隐/顺序、主题模式、启动默认态。
  useEffect(() => {
    (async () => {
      const [enabledRaw, orderRaw, themeRaw, defaultStateRaw] = await Promise.all([
        settingGet(KEYS.pagesEnabled),
        settingGet(KEYS.pagesOrder),
        settingGet(KEYS.theme),
        settingGet(KEYS.defaultState),
      ]);
      setPagesEnabled(parsePagesEnabled(enabledRaw));
      setPagesOrder(parsePagesOrder(orderRaw));
      setThemeMode(normalizeThemeMode(themeRaw) ?? "auto");
      const initialState = normalizeIslandState(defaultStateRaw);
      if (initialState) setIslandState(initialState);
    })();
  }, []);

  // settings://changed：设置窗口改写后即时重算页面与主题。
  useEffect(() => {
    let un: (() => void) | undefined;
    onSettingsChanged((key, value) => {
      if (key === KEYS.pagesEnabled) setPagesEnabled(parsePagesEnabled(value));
      if (key === KEYS.pagesOrder) setPagesOrder(parsePagesOrder(value));
      if (key === KEYS.theme) setThemeMode(normalizeThemeMode(value) ?? "auto");
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

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

  // 主题：跟随系统变化（仅在 themeMode=auto 时体现在 effectiveTheme）。
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // 监听 Rust 推送的状态变化。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<IslandState>("window://state-changed", (e) => setIslandState(e.payload)).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  // 通知到达：切通知页（若通知页未关闭）+ 展开灵动岛。
  useEffect(() => {
    let un: (() => void) | undefined;
    listen("notify://incoming", () => {
      const i = pages.findIndex((p) => p.id === "notify");
      if (i >= 0) setPage(i);
      setState("expanded");
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, [pages, setPage, setState]);

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
      <div
        className={cn(
          "flex w-full max-w-[700px] flex-col rounded-2xl border border-border/60 bg-card/70 px-4 shadow-2xl backdrop-blur-xl transition-[height] duration-[var(--island-duration)] ease-[var(--island-ease)]",
          expanded ? "h-[380px] py-3" : "h-14 py-0",
        )}
      >
        {/* 顶部条 */}
        <div data-tauri-drag-region className="flex h-14 shrink-0 items-center gap-3">
          {expanded ? (
            <div
              className="flex items-center gap-1"
              onWheel={(e) => {
                if (e.deltaY > 0) setPage(pageIndex + 1);
                else if (e.deltaY < 0) setPage(pageIndex - 1);
              }}
            >
              {pages.map((p, i) => (
                <button
                  key={p.id}
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
            <div
              className="flex items-center gap-1.5"
              onWheel={(e) => {
                if (e.deltaY > 0) setPage(pageIndex + 1);
                else if (e.deltaY < 0) setPage(pageIndex - 1);
              }}
            >
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

        {/* 展开内容 */}
        {expanded && (
          <div className="relative flex-1 overflow-hidden px-2 pb-1">
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
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
