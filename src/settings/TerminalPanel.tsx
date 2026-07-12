import { useEffect, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Row, selectCls } from "./shared";
import { cn } from "@/lib/utils";
import { useReorder } from "@/lib/useReorder";
import {
  KEYS,
  parseFontSize,
  parseShortcuts,
  settingGet,
  settingSetEmit,
  type Shortcut,
} from "@/lib/settings";

const SHELL_OPTIONS = [
  { value: "default", label: "PowerShell 7（默认）" },
  { value: "powershell.exe", label: "Windows PowerShell" },
  { value: "cmd.exe", label: "命令提示符" },
];

/** 终端页配置：默认 shell + 字号 + 自定义快捷命令 */
export function TerminalPanel() {
  const [shell, setShell] = useState("default");
  const [fontSize, setFontSize] = useState(13);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(parseShortcuts(null));
  const [draft, setDraft] = useState({ name: "", command: "", cwd: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, fs, sc] = await Promise.all([
        settingGet(KEYS.terminalShell),
        settingGet(KEYS.terminalFontSize),
        settingGet(KEYS.terminalShortcuts),
      ]);
      if (s) setShell(s);
      setFontSize(parseFontSize(fs));
      setShortcuts(parseShortcuts(sc));
      setLoading(false);
    })();
  }, []);

  const persistShortcuts = async (next: Shortcut[]) => {
    setShortcuts(next);
    await settingSetEmit(KEYS.terminalShortcuts, JSON.stringify(next));
  };

  const { overIndex, itemProps } = useReorder<Shortcut>((next) => {
    void persistShortcuts(next);
  });

  const addShortcut = async () => {
    const name = draft.name.trim();
    const command = draft.command.trim();
    if (!name || !command) return;
    await persistShortcuts([...shortcuts, { name, command, cwd: draft.cwd.trim() || undefined }]);
    setDraft({ name: "", command: "", cwd: "" });
  };

  const removeShortcut = async (i: number) => {
    await persistShortcuts(shortcuts.filter((_, j) => j !== i));
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">终端</h2>
        <p className="text-sm text-muted-foreground">
          shell 对新建 tab 生效；字号即时应用到所有 tab；快捷命令即时同步到工具栏。
        </p>
      </div>
      <Row label="默认 shell" desc="新建终端 tab 使用的 shell">
        <select
          className={selectCls}
          value={shell}
          onChange={async (e) => {
            setShell(e.target.value);
            await settingSetEmit(KEYS.terminalShell, e.target.value);
          }}
        >
          {SHELL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="字号" desc="6~72，即时生效">
        <input
          type="number"
          min={6}
          max={72}
          value={fontSize}
          onChange={async (e) => {
            const n = parseFontSize(e.target.value);
            setFontSize(n);
            await settingSetEmit(KEYS.terminalFontSize, String(n));
          }}
          className={selectCls + " w-20"}
        />
      </Row>

      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">快捷命令</div>
        <div className="text-xs text-muted-foreground">在终端工具栏一键执行；即时同步，重启保留。</div>
      </div>
      <div className="flex flex-col gap-2">
        {shortcuts.map((s, i) => (
          <div
            key={i}
            {...itemProps(i, shortcuts)}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 transition-colors",
              overIndex === i && "border-primary/70 bg-primary/5",
            )}
          >
            <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{s.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {s.command}
                {s.cwd ? ` @ ${s.cwd}` : ""}
              </div>
            </div>
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
            >
              <button
                onClick={() => void removeShortcut(i)}
                aria-label="删除"
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {shortcuts.length === 0 && <p className="text-xs text-muted-foreground">暂无快捷命令</p>}
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/60 p-3">
          <div className="flex gap-2">
            <input
              placeholder="名称"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addShortcut();
              }}
              className={selectCls + " w-28"}
            />
            <input
              placeholder="命令"
              value={draft.command}
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addShortcut();
              }}
              className={selectCls + " flex-1"}
            />
          </div>
          <div className="flex gap-2">
            <input
              placeholder="工作目录（可选）"
              value={draft.cwd}
              onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addShortcut();
              }}
              className={selectCls + " flex-1"}
            />
            <Button
              size="sm"
              onClick={() => void addShortcut()}
              disabled={!draft.name.trim() || !draft.command.trim()}
            >
              <Plus className="h-3.5 w-3.5" />
              添加
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
