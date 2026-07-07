import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { KEYS, onSettingsChanged, parseShortcuts, settingGet, type Shortcut } from "@/lib/settings";

export type { Shortcut };

const VISIBLE = 2;

/**
 * 终端工具栏快捷命令：从 terminal:shortcuts 读，设置面板可编辑，即时同步。
 * 命令多于 VISIBLE 个时只显前几个 + 「更多 ▾」下拉，避免挤压左侧终端 tab。
 */
export function Shortcuts({ onRun, disabled }: { onRun: (s: Shortcut) => void; disabled?: boolean }) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(parseShortcuts(null));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void settingGet(KEYS.terminalShortcuts).then((v) => setShortcuts(parseShortcuts(v)));
    let un: (() => void) | undefined;
    onSettingsChanged((key, value) => {
      if (key === KEYS.terminalShortcuts) setShortcuts(parseShortcuts(value));
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  // 下拉打开时点外部关闭
  useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);

  if (shortcuts.length === 0) return null;

  const visible = shortcuts.slice(0, VISIBLE);
  const overflow = shortcuts.slice(VISIBLE);
  const btnCls = cn(
    "rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
  );

  return (
    <div className="flex items-center gap-1">
      {visible.map((s, i) => (
        <button
          key={`v-${s.name}-${i}`}
          onClick={() => onRun(s)}
          disabled={disabled}
          title={s.cwd ? `${s.command} @ ${s.cwd}` : s.command}
          className={btnCls}
        >
          {s.name}
        </button>
      ))}
      {overflow.length > 0 && (
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            disabled={disabled}
            title="更多快捷命令"
            className={cn(btnCls, "flex items-center gap-0.5")}
          >
            更多
            <ChevronDown className="h-3 w-3" />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-10 mt-1 max-h-56 min-w-28 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
              {overflow.map((s, i) => (
                <button
                  key={`o-${s.name}-${i}`}
                  onClick={() => {
                    onRun(s);
                    setOpen(false);
                  }}
                  title={s.cwd ? `${s.command} @ ${s.cwd}` : s.command}
                  className="block w-full px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
