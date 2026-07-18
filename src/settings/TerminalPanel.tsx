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
import { useDraftField } from "./useDraftField";

const SHELL_OPTIONS = [
  { value: "default", label: "PowerShell 7（默认）" },
  { value: "powershell.exe", label: "Windows PowerShell" },
  { value: "cmd.exe", label: "命令提示符" },
];

/** 终端页配置：默认 shell + 字号 + 自定义快捷命令 */
export function TerminalPanel() {
  const [initial, setInitial] = useState<{ shell: string; fontSize: number } | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(parseShortcuts(null));
  const [draft, setDraft] = useState({ name: "", command: "", cwd: "" });

  useEffect(() => {
    (async () => {
      const [s, fs, sc] = await Promise.all([
        settingGet(KEYS.terminalShell),
        settingGet(KEYS.terminalFontSize),
        settingGet(KEYS.terminalShortcuts),
      ]);
      setInitial({
        shell: s ?? "default",
        fontSize: parseFontSize(fs),
      });
      setShortcuts(parseShortcuts(sc));
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

  if (!initial) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <TerminalPanelContent
      initial={initial}
      shortcuts={shortcuts}
      draft={draft}
      overIndex={overIndex}
      itemProps={itemProps}
      onDraftChange={setDraft}
      onAddShortcut={() => void addShortcut()}
      onRemoveShortcut={(i) => void removeShortcut(i)}
    />
  );
}

interface TerminalPanelContentProps {
  initial: { shell: string; fontSize: number };
  shortcuts: Shortcut[];
  draft: { name: string; command: string; cwd: string };
  overIndex: number | null;
  itemProps: (index: number, list: Shortcut[]) => Record<string, unknown>;
  onDraftChange: (next: { name: string; command: string; cwd: string }) => void;
  onAddShortcut: () => void;
  onRemoveShortcut: (index: number) => void;
}

function TerminalPanelContent(props: TerminalPanelContentProps) {
  const {
    initial,
    shortcuts,
    draft,
    overIndex,
    itemProps,
    onDraftChange,
    onAddShortcut,
    onRemoveShortcut,
  } = props;

  const shellField = useDraftField<string>({
    parse: (raw) => raw ?? "default",
    serialize: (value) => value,
    initial: initial.shell,
    settingKey: KEYS.terminalShell,
    debounceMs: 0,
  });

  const fontSizeField = useDraftField<number>({
    parse: (raw) => parseFontSize(raw),
    serialize: (value) => (Number.isFinite(value) && value >= 6 && value <= 72 ? String(value) : null),
    initial: String(initial.fontSize),
    settingKey: KEYS.terminalFontSize,
    debounceMs: 400,
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">终端</h2>
        <p className="text-sm text-muted-foreground">
          shell 对新建 tab 生效；字号即时应用到所有 tab；快捷命令即时同步到工具栏。
        </p>
      </div>
      <Row label="默认 shell" desc="新建终端 tab 使用的 shell">
        <div className="flex flex-col items-end gap-1">
          <select
            className={selectCls}
            value={shellField.draft}
            onChange={(e) => {
              shellField.setDraft(e.target.value);
              shellField.commit();
            }}
          >
            {SHELL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {shellField.saveError && (
            <p className="text-xs text-destructive">保存 shell 失败：{shellField.saveError}</p>
          )}
        </div>
      </Row>
      <Row label="字号" desc="6~72，即时生效">
        <div className="flex flex-col items-end gap-1">
          <input
            type="number"
            min={6}
            max={72}
            value={fontSizeField.draft}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) fontSizeField.setDraft(n);
            }}
            onBlur={fontSizeField.commit}
            className={selectCls + " w-20"}
          />
          {fontSizeField.saveError && (
            <p className="text-xs text-destructive">保存字号失败：{fontSizeField.saveError}</p>
          )}
        </div>
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
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRemoveShortcut(i)}
              aria-label={`删除${s.name}`}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/60 p-3">
        <div className="text-sm font-medium">新增快捷命令</div>
        <input
          value={draft.name}
          onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
          placeholder="名称（如：构建）"
          className={selectCls}
        />
        <input
          value={draft.command}
          onChange={(e) => onDraftChange({ ...draft, command: e.target.value })}
          placeholder="命令（如：pnpm build）"
          className={selectCls}
        />
        <input
          value={draft.cwd}
          onChange={(e) => onDraftChange({ ...draft, cwd: e.target.value })}
          placeholder="工作目录（可选）"
          className={selectCls}
        />
        <Button size="sm" onClick={onAddShortcut} disabled={!draft.name.trim() || !draft.command.trim()}>
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
    </section>
  );
}
