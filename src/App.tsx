import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return (
    <div className="flex h-screen w-screen items-start justify-center pt-3">
      <div
        data-tauri-drag-region
        className="flex h-14 w-full max-w-[700px] items-center gap-4 rounded-2xl border border-border/60 bg-card/70 px-6 shadow-2xl backdrop-blur-xl"
      >
        <span data-tauri-drag-region className="text-sm font-semibold tracking-tight">
          LuckyIsland
        </span>
        <span data-tauri-drag-region className="text-xs text-muted-foreground">
          灵动岛
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm font-medium tabular-nums">
            {hh}:{mm}
            <span className="text-muted-foreground">:{ss}</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
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
    </div>
  );
}

export default App;
