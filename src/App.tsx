import { useCallback, useEffect, useState, type FC } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, ChevronUp, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimePage } from "@/components/pages/time/TimePage";
import { CalendarPage } from "@/components/pages/calendar/CalendarPage";
import { WeatherPage } from "@/components/pages/weather/WeatherPage";
import { StockPage } from "@/components/pages/stock/StockPage";
import { TodoPage } from "@/components/pages/todo/TodoPage";
import { TerminalPage } from "@/components/pages/terminal/TerminalPage";

type Theme = "light" | "dark";
type IslandState = "hidden" | "compact" | "expanded";

interface PageMeta {
  id: string;
  label: string;
  Component: FC<{ compact: boolean }>;
}

const PAGES: PageMeta[] = [
  { id: "time", label: "时间", Component: TimePage },
  { id: "calendar", label: "日历", Component: CalendarPage },
  { id: "weather", label: "天气", Component: WeatherPage },
  { id: "stock", label: "股票", Component: StockPage },
  { id: "todo", label: "待办", Component: TodoPage },
  { id: "terminal", label: "终端", Component: TerminalPage },
];

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [islandState, setIslandState] = useState<IslandState>("compact");
  const [pageIndex, setPageIndex] = useState(0);

  const expanded = islandState === "expanded";
  const CurrentPage = PAGES[pageIndex].Component;

  const setState = useCallback((s: IslandState) => {
    setIslandState(s);
    void invoke("set_island_state", { state: s });
  }, []);

  const setPage = useCallback((i: number) => {
    setPageIndex((((i % PAGES.length) + PAGES.length) % PAGES.length));
  }, []);

  // 主题：写入 data-theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 主题：跟随系统变化
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // 监听 Rust 推送的状态变化
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<IslandState>("window://state-changed", (e) => setIslandState(e.payload)).then(
      (fn) => {
        un = fn;
      },
    );
    return () => un?.();
  }, []);

  // 局部快捷键（仅展开态，需窗口焦点）
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
        if (i < PAGES.length) {
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
  }, [expanded, pageIndex, setPage, setState]);

  return (
    <div className="flex h-screen w-screen items-start justify-center pt-3">
      <div
        className={
          "flex w-full max-w-[700px] flex-col rounded-2xl border border-border/60 bg-card/70 px-4 shadow-2xl backdrop-blur-xl transition-[height] duration-300 ease-out " +
          (expanded ? "h-[380px] py-3" : "h-14 py-0")
        }
      >
        {/* 顶部条 */}
        <div data-tauri-drag-region className="flex h-14 shrink-0 items-center gap-3">
          {expanded ? (
            <div className="flex items-center gap-1">
              {PAGES.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setPage(i)}
                  className={
                    "rounded-md px-2.5 py-1 text-xs transition-colors " +
                    (i === pageIndex
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {PAGES.map((p, i) => (
                <span
                  key={p.id}
                  className={
                    "h-1.5 rounded-full transition-all " +
                    (i === pageIndex ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/40")
                  }
                />
              ))}
            </div>
          )}

          {!expanded && (
            <div className="ml-1">
              <CurrentPage compact />
            </div>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                setState(expanded ? "compact" : "expanded");
              }}
              aria-label="展开/收起"
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                setTheme(theme === "dark" ? "light" : "dark");
              }}
              aria-label="切换主题"
            >
              {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* 展开内容 */}
        {expanded && (
          <div className="flex-1 overflow-hidden px-2 pb-1">
            <CurrentPage compact={false} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
