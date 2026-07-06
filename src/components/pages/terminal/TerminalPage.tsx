import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { TerminalTab } from "./TerminalTab";
import { Shortcuts, type Shortcut } from "./Shortcuts";
import {
  addTab,
  closeTab as storeCloseTab,
  ensureFirstTab,
  getActive,
  getTabs,
  setActive as storeSetActive,
  subscribe,
} from "./term-store";

export function TerminalPage({ compact }: { compact: boolean }) {
  const tabs = useSyncExternalStore(subscribe, getTabs, getTabs);
  const active = useSyncExternalStore(subscribe, getActive, getActive);
  const [err, setErr] = useState<string | null>(null);

  // 首挂载建一个 tab（store 持久，重挂载不会重复建）
  useEffect(() => {
    ensureFirstTab();
  }, []);

  const runShortcut = (s: Shortcut) => {
    void addTab({ command: s.command, title: s.name, cwd: s.cwd });
  };

  const openInWt = async () => {
    try {
      await invoke("term_open_wt", { cwd: null });
    } catch (e) {
      setErr(String(e));
    }
  };

  if (compact) {
    return (
      <span className="text-sm text-muted-foreground">
        终端{tabs.length > 0 ? ` ${tabs.length}` : ""}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 工具栏：tab 栏 + 快捷命令 + 外部 WT */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <span
              key={t.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors",
                t.id === active
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <button onClick={() => storeSetActive(t.id)} className="cursor-pointer">
                {t.title}
              </button>
              <button
                onClick={() => void storeCloseTab(t.id)}
                aria-label="关闭标签"
                className="text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            onClick={() => void addTab()}
            aria-label="新标签"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Shortcuts onRun={runShortcut} />
          <button
            onClick={() => void openInWt()}
            aria-label="在外部 Windows Terminal 打开"
            title="在外部 Windows Terminal 打开"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {err && <div className="shrink-0 text-[11px] text-destructive">{err}</div>}

      {/* tab 内容（全部挂载，仅激活态可见，切换不丢输出历史） */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 bg-[#0c0c14]">
        {tabs.map((t) => (
          <div key={t.id} className={cn("h-full", t.id !== active && "hidden")}>
            <TerminalTab termId={t.id} active={t.id === active} />
          </div>
        ))}
      </div>
    </div>
  );
}
