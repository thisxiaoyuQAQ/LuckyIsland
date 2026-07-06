import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TerminalTab } from "./TerminalTab";

interface Tab {
  id: string;
  title: string;
}

interface NewTabOpts {
  cwd?: string;
  command?: string;
  title?: string;
}

export function TerminalPage({ compact }: { compact: boolean }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState("");

  const newTab = useCallback(async (opts?: NewTabOpts) => {
    const id = await invoke<string>("term_create", {
      cwd: opts?.cwd ?? null,
      command: opts?.command ?? null,
    });
    const title = opts?.title ?? `终端 ${tabsCount(tabs) + 1}`;
    setTabs((t) => [...t, { id, title }]);
    setActive(id);
    return id;
  }, [tabs]);

  // 首挂载建一个 tab
  useEffect(() => {
    void newTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeTab = async (id: string) => {
    try {
      await invoke("term_kill", { termId: id });
    } catch {
      /* ignore */
    }
    setTabs((t) => {
      const next = t.filter((x) => x.id !== id);
      if (active === id) setActive(next[0]?.id ?? "");
      return next;
    });
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
      {/* tab 栏 */}
      <div className="flex shrink-0 items-center gap-1">
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
            <button onClick={() => setActive(t.id)} className="cursor-pointer">
              {t.title}
            </button>
            <button
              onClick={() => void closeTab(t.id)}
              aria-label="关闭标签"
              className="text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <button
          onClick={() => void newTab()}
          aria-label="新标签"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

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

function tabsCount(tabs: Tab[]): number {
  return tabs.length;
}
