import { cn } from "@/lib/utils";

export interface Shortcut {
  name: string;
  command: string;
  cwd?: string;
}

/** 内置快捷命令（F6.8 示例）；M6 配置 UI 落地后改由 settings 持久化、可编辑 */
const SHORTCUTS: Shortcut[] = [
  { name: "codex", command: "codex" },
  { name: "claude", command: "claude" },
  { name: "git status", command: "git status" },
  { name: "git pull", command: "git pull" },
];

export function Shortcuts({
  onRun,
  disabled,
}: {
  onRun: (s: Shortcut) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {SHORTCUTS.map((s) => (
        <button
          key={s.name}
          onClick={() => onRun(s)}
          disabled={disabled}
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
