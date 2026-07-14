import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { getVerticalWheelDirection } from "@/lib/islandWheel";
import { useReorder } from "@/lib/useReorder";
import { TerminalTab } from "./TerminalTab";
import { Shortcuts } from "./Shortcuts";
import type { Shortcut } from "@/lib/settings";
import {
  addTab,
  closeTab as storeCloseTab,
  ensureFirstTab,
  getActive,
  getTabs,
  renameTab,
  reorderTabs,
  setActive as storeSetActive,
  subscribe,
} from "./term-store";

export function TerminalPage({ compact }: { compact: boolean }) {
  const tabs = useSyncExternalStore(subscribe, getTabs, getTabs);
  const active = useSyncExternalStore(subscribe, getActive, getActive);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const { overIndex, itemProps } = useReorder(reorderTabs);

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

  const commitTitle = (id: string) => {
    renameTab(id, titleDraft);
    setEditing(null);
    setTitleDraft("");
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
      {/* 工具栏：tab 栏（横向滚动） + 快捷命令 + 外部 WT */}
      <div className="flex shrink-0 items-center gap-2">
        <div
          data-island-wheel-native
          className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto [scrollbar-gutter:stable]"
          onWheel={(e) => {
            if (tabs.length < 2) return;
            const direction = getVerticalWheelDirection(e);
            if (direction === 0) return;
            const idx = tabs.findIndex((t) => t.id === active);
            if (idx < 0) return;
            const next = Math.max(0, Math.min(idx + direction, tabs.length - 1));
            storeSetActive(tabs[next].id);
          }}
        >
          {tabs.map((t, i) => (
            <span
              key={t.id}
              {...itemProps(i, tabs)}
              className={cn(
                "group flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors",
                t.id === active
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                overIndex === i && "ring-1 ring-primary/60",
              )}
            >
              {editing === t.id ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTitle(t.id);
                    else if (e.key === "Escape") {
                      setEditing(null);
                      setTitleDraft("");
                    }
                  }}
                  onBlur={() => commitTitle(t.id)}
                  className="w-20 rounded bg-background px-1 py-0 text-xs outline-none ring-1 ring-ring"
                />
              ) : (
                <button
                  onClick={() => storeSetActive(t.id)}
                  onDoubleClick={() => {
                    setEditing(t.id);
                    setTitleDraft(t.title);
                  }}
                  className="cursor-pointer"
                  title="双击改名，拖动排序"
                >
                  {t.title}
                </button>
              )}
              <button
                draggable={false}
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
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
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

      {/* tab 内容：仅渲染激活 tab（避免隐藏容器上 xterm 不渲染） */}
      <div
        data-island-wheel-native
        className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 bg-[#0c0c14]"
      >
        {tabs
          .filter((t) => t.id === active)
          .map((t) => (
            <div key={t.id} className="h-full">
              <TerminalTab termId={t.id} active />
            </div>
          ))}
      </div>
    </div>
  );
}
