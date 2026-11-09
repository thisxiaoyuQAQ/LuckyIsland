import { useEffect, useState, type KeyboardEvent } from "react";
import { Check, GripVertical, Pencil, Plus, Trash2, X } from "lucide-react";
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
import {
  DEFAULT_SHELL,
  PROFILE_PREFIX,
  parseProfiles,
  profileChoice,
  shellOptions,
  type ShellOption,
  type TerminalProfile,
} from "@/lib/terminal-profiles";
import { useDraftField } from "./useDraftField";
import { TerminalProfilesSection } from "./TerminalProfilesSection";

interface ShortcutDraft {
  name: string;
  command: string;
  cwd: string;
  /** "" = 跟随默认 shell */
  shell: string;
}

const EMPTY_SHORTCUT: ShortcutDraft = { name: "", command: "", cwd: "", shell: "" };

function toShortcut(draft: ShortcutDraft): Shortcut | null {
  const name = draft.name.trim();
  const command = draft.command.trim();
  if (!name || !command) return null;
  return {
    name,
    command,
    cwd: draft.cwd.trim() || undefined,
    shell: draft.shell || undefined,
  };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 默认 shell 下拉：当前值不在选项里（旧版本写入的可执行名 / 已删除的程序）时追加一项如实显示 */
function defaultShellOptions(profiles: TerminalProfile[], current: string): ShellOption[] {
  const options = shellOptions(profiles);
  if (current && !options.some((o) => o.value === current)) {
    options.push({
      value: current,
      label: current.startsWith(PROFILE_PREFIX) ? "已删除的程序（按自动处理）" : current,
    });
  }
  return options;
}

interface LoadedState {
  shell: string;
  fontSize: number;
  shortcuts: Shortcut[];
  profiles: TerminalProfile[];
}

/** 终端页配置：默认 shell + 字号 + 自定义程序 + 快捷命令 */
export function TerminalPanel() {
  const [loaded, setLoaded] = useState<LoadedState | null>(null);

  useEffect(() => {
    (async () => {
      const [s, fs, sc, pf] = await Promise.all([
        settingGet(KEYS.terminalShell),
        settingGet(KEYS.terminalFontSize),
        settingGet(KEYS.terminalShortcuts),
        settingGet(KEYS.terminalProfiles),
      ]);
      setLoaded({
        shell: s ?? DEFAULT_SHELL,
        fontSize: parseFontSize(fs),
        shortcuts: parseShortcuts(sc),
        profiles: parseProfiles(pf),
      });
    })();
  }, []);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }
  return <TerminalPanelContent initial={loaded} />;
}

function TerminalPanelContent({ initial }: { initial: LoadedState }) {
  const [shell, setShell] = useState(initial.shell);
  const [shellError, setShellError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<TerminalProfile[]>(initial.profiles);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(initial.shortcuts);
  const [draft, setDraft] = useState<ShortcutDraft>(EMPTY_SHORTCUT);
  /** 行内编辑目标的下标；同时只编辑一条避免歧义。 */
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<ShortcutDraft>(EMPTY_SHORTCUT);

  const fontSizeField = useDraftField<number>({
    parse: (raw) => parseFontSize(raw),
    serialize: (value) => (Number.isFinite(value) && value >= 6 && value <= 72 ? String(value) : null),
    initial: String(initial.fontSize),
    settingKey: KEYS.terminalFontSize,
    debounceMs: 400,
  });

  const options = shellOptions(profiles);

  // 选中即写入：不经 draft，避免同一事件里 setDraft+commit 提交到上一次的值
  const persistShell = async (next: string) => {
    const prev = shell;
    setShell(next);
    setShellError(null);
    try {
      await settingSetEmit(KEYS.terminalShell, next);
    } catch (e) {
      setShell(prev);
      setShellError(errorText(e));
    }
  };

  const persistShortcuts = async (next: Shortcut[]) => {
    setShortcuts(next);
    await settingSetEmit(KEYS.terminalShortcuts, JSON.stringify(next));
  };

  const persistProfiles = async (next: TerminalProfile[]) => {
    setProfiles(next);
    await settingSetEmit(KEYS.terminalProfiles, JSON.stringify(next));
  };

  /** 删除程序：先解除默认 shell 与快捷命令对它的引用，再删除本身 */
  const deleteProfile = async (id: string) => {
    const choice = profileChoice(id);
    if (shell === choice) await persistShell(DEFAULT_SHELL);
    if (shortcuts.some((s) => s.shell === choice)) {
      await persistShortcuts(shortcuts.map((s) => (s.shell === choice ? { ...s, shell: undefined } : s)));
    }
    const clearRef = (d: ShortcutDraft) => (d.shell === choice ? { ...d, shell: "" } : d);
    setDraft(clearRef);
    setEditingDraft(clearRef);
    await persistProfiles(profiles.filter((p) => p.id !== id));
  };

  const { overIndex, itemProps } = useReorder<Shortcut>((next) => {
    void persistShortcuts(next);
  });

  const addShortcut = async () => {
    const next = toShortcut(draft);
    if (!next) return;
    await persistShortcuts([...shortcuts, next]);
    setDraft(EMPTY_SHORTCUT);
  };

  const removeShortcut = async (i: number) => {
    if (editingIndex === i) setEditingIndex(null);
    await persistShortcuts(shortcuts.filter((_, j) => j !== i));
  };

  const startEdit = (i: number) => {
    const target = shortcuts[i];
    if (!target) return;
    setEditingIndex(i);
    setEditingDraft({
      name: target.name,
      command: target.command,
      cwd: target.cwd ?? "",
      // 引用已不存在的程序时回到「跟随默认」，避免保存时把悬空引用写回去
      shell: target.shell && options.some((o) => o.value === target.shell) ? target.shell : "",
    });
  };

  const saveEdit = async () => {
    if (editingIndex === null) return;
    const next = toShortcut(editingDraft);
    if (!next) return;
    const list = shortcuts.map((item, j) => (j === editingIndex ? next : item));
    setEditingIndex(null);
    await persistShortcuts(list);
  };

  const shellLabel = (value: string | undefined) => {
    if (!value) return null;
    return options.find((o) => o.value === value)?.label ?? "已删除的程序（跟随默认）";
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">终端</h2>
        <p className="text-sm text-muted-foreground">
          shell 对新建 tab 生效；字号即时应用到所有 tab；自定义程序与快捷命令即时同步到工具栏。
        </p>
      </div>
      <Row label="默认 shell" desc="新建终端 tab 使用的程序">
        <div className="flex flex-col items-end gap-1">
          <select
            aria-label="默认 shell"
            className={selectCls}
            value={shell}
            onChange={(e) => void persistShell(e.target.value)}
          >
            {defaultShellOptions(profiles, shell).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {shellError && <p className="text-xs text-destructive">保存 shell 失败：{shellError}</p>}
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

      <TerminalProfilesSection
        profiles={profiles}
        onSave={persistProfiles}
        onDelete={(id) => void deleteProfile(id)}
      />

      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">快捷命令</div>
        <div className="text-xs text-muted-foreground">在终端工具栏一键执行；即时同步，重启保留。</div>
      </div>
      <div className="flex flex-col gap-2">
        {shortcuts.map((s, i) => {
          const editing = editingIndex === i;
          const runIn = shellLabel(s.shell);
          return (
            <div
              key={i}
              {...(editing ? {} : itemProps(i, shortcuts))}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 transition-colors",
                overIndex === i && "border-primary/70 bg-primary/5",
                editing && "border-primary/70 bg-primary/5",
              )}
            >
              <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden />
              {editing ? (
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <ShortcutFields
                    draft={editingDraft}
                    onChange={setEditingDraft}
                    options={options}
                    labelPrefix="编辑快捷命令"
                    autoFocus
                    onEnter={() => void saveEdit()}
                    onEscape={() => setEditingIndex(null)}
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s.command}
                    {s.cwd ? ` @ ${s.cwd}` : ""}
                    {runIn ? ` · ${runIn}` : ""}
                  </div>
                </div>
              )}
              {editing ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void saveEdit()}
                    disabled={!editingDraft.name.trim() || !editingDraft.command.trim()}
                    aria-label="保存"
                  >
                    <Check />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setEditingIndex(null)}
                    aria-label="取消"
                  >
                    <X />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => startEdit(i)}
                    aria-label={`编辑${s.name}`}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void removeShortcut(i)}
                    aria-label={`删除${s.name}`}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/60 p-3">
        <div className="text-sm font-medium">新增快捷命令</div>
        <ShortcutFields
          draft={draft}
          onChange={setDraft}
          options={options}
          labelPrefix="新快捷命令"
          examples
        />
        <Button
          size="sm"
          onClick={() => void addShortcut()}
          disabled={!draft.name.trim() || !draft.command.trim()}
          aria-label="添加快捷命令"
        >
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
    </section>
  );
}

interface ShortcutFieldsProps {
  draft: ShortcutDraft;
  onChange: (next: ShortcutDraft) => void;
  options: ShellOption[];
  labelPrefix: string;
  /** 新增表单显示示例占位 */
  examples?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
  onEscape?: () => void;
}

/** 名称 / 命令 / 工作目录 / 运行程序四栏，新增与行内编辑共用 */
function ShortcutFields(props: ShortcutFieldsProps) {
  const { draft, onChange, options, labelPrefix, examples, autoFocus, onEnter, onEscape } = props;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") onEnter?.();
    if (e.key === "Escape") onEscape?.();
  };
  return (
    <>
      <input
        aria-label={`${labelPrefix}名称`}
        autoFocus={autoFocus}
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder={examples ? "名称（如：构建）" : "名称"}
        className={selectCls}
      />
      <input
        aria-label={`${labelPrefix}命令`}
        value={draft.command}
        onChange={(e) => onChange({ ...draft, command: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder={examples ? "命令（如：pnpm build）" : "命令"}
        className={selectCls}
      />
      <input
        aria-label={`${labelPrefix}工作目录`}
        value={draft.cwd}
        onChange={(e) => onChange({ ...draft, cwd: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder="工作目录（可选）"
        className={selectCls}
      />
      <select
        aria-label={`${labelPrefix}运行程序`}
        value={draft.shell}
        onChange={(e) => onChange({ ...draft, shell: e.target.value })}
        className={selectCls}
      >
        <option value="">运行程序：跟随默认 shell</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
