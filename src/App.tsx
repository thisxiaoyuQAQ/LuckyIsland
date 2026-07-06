import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, ChevronUp, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";
type IslandState = "hidden" | "compact" | "expanded";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [now, setNow] = useState(() => new Date());
  const [islandState, setIslandState] = useState<IslandState>("compact");

  const expanded = islandState === "expanded";

  const setState = useCallback((s: IslandState) => {
    setIslandState(s);
    void invoke("set_island_state", { state: s });
  }, []);

  // 主题：写入 data-theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 主题：跟随系统变化
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // 时间 tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // 监听 Rust 推送的状态变化（Alt+X / 托盘触发）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<IslandState>("window://state-changed", (e) => setIslandState(e.payload)).then(
      (fn) => {
        unlisten = fn;
      },
    );
    return () => unlisten?.();
  }, []);

  // ESC 收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && islandState === "expanded") {
        setState("compact");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [islandState, setState]);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return (
    <div className="flex h-screen w-screen items-start justify-center pt-3">
      <div
        className={
          "flex w-full max-w-[700px] flex-col gap-4 rounded-2xl border border-border/60 bg-card/70 px-6 shadow-2xl backdrop-blur-xl transition-[height] duration-300 ease-out " +
          (expanded ? "h-[380px] py-5" : "h-14 py-0")
        }
      >
        {/* 顶部条（可拖拽 + 可点击展开/收起） */}
        <div
          data-tauri-drag-region
          onClick={() => setState(expanded ? "compact" : "expanded")}
          className="flex h-14 shrink-0 cursor-pointer items-center gap-4"
        >
          <span data-tauri-drag-region className="text-sm font-semibold tracking-tight">
            LuckyIsland
          </span>
          <span data-tauri-drag-region className="text-xs text-muted-foreground">
            灵动岛
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm font-medium tabular-nums">
              {hh}:{mm}
              <span className="text-muted-foreground">:{ss}</span>
            </span>
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
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
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
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
        {/* 展开内容（占位，M2 接入真实页面） */}
        {expanded && (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/50 text-sm text-muted-foreground">
            页面区 · M2 接入时间 / 日历 / 待办 / 天气 / 股票 / 终端 / 通知
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
