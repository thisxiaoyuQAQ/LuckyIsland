import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { KEYS, onSettingsChanged, parseShortcuts, settingGet, type Shortcut } from "@/lib/settings";

export type { Shortcut };

/**
 * 终端工具栏快捷命令：从 terminal:shortcuts 读（设置面板可编辑），监听即时同步。
 * 内置示例在 settings.ts parseShortcuts 的 fallback。
 */
export function Shortcuts({ onRun, disabled }: { onRun: (s: Shortcut) => void; disabled?: boolean }) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(parseShortcuts(null));

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

  if (shortcuts.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {shortcuts.map((s, i) => (
        <button
          key={`${s.name}-${i}`}
          onClick={() => onRun(s)}
          disabled={disabled}
          title={s.cwd ? `${s.command} @ ${s.cwd}` : s.command}
          className={cn(
            "rounded-md border border-border/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
          )}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
