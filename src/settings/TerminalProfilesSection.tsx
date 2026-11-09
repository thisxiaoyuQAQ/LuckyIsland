import { useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, FolderOpen, Pencil, Plus, ScanSearch, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assertIpc, isDetectedShellList } from "@/lib/ipc-schemas";
import {
  formatArgs,
  mergeDetected,
  splitArgs,
  type TerminalProfile,
} from "@/lib/terminal-profiles";
import { selectCls } from "./shared";

interface ProfileDraft {
  name: string;
  program: string;
  args: string;
}

const EMPTY_DRAFT: ProfileDraft = { name: "", program: "", args: "" };

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toProfile(draft: ProfileDraft, id: string): TerminalProfile | null {
  const name = draft.name.trim();
  const program = draft.program.trim();
  if (!name || !program) return null;
  return { id, name, program, args: splitArgs(draft.args) };
}

/** 路径 → 默认显示名：取文件名去掉 .exe */
function stemOf(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? "";
  return file.replace(/\.exe$/i, "");
}

interface ProfileFieldsProps {
  draft: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
  labelPrefix: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  onEscape?: () => void;
  onBrowseError: (message: string) => void;
}

/** 名称 / 路径（带浏览） / 启动参数三栏，新增与行内编辑共用 */
function ProfileFields(props: ProfileFieldsProps) {
  const { draft, onChange, labelPrefix, autoFocus, onEnter, onEscape, onBrowseError } = props;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") onEnter?.();
    if (e.key === "Escape") onEscape?.();
  };

  const browse = async () => {
    try {
      const path = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "程序", extensions: ["exe"] }],
      });
      if (typeof path !== "string" || !path) return;
      onChange({ ...draft, program: path, name: draft.name.trim() ? draft.name : stemOf(path) });
    } catch (e) {
      onBrowseError(`选择文件失败：${errorText(e)}`);
    }
  };

  return (
    <>
      <input
        aria-label={`${labelPrefix}名称`}
        autoFocus={autoFocus}
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder="名称（如：Nushell）"
        className={selectCls}
      />
      <div className="flex items-center gap-2">
        <input
          aria-label={`${labelPrefix}路径`}
          value={draft.program}
          onChange={(e) => onChange({ ...draft, program: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder="完整路径或命令名（如：nu）"
          className={cn(selectCls, "min-w-0 flex-1")}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void browse()}
          aria-label={`${labelPrefix}浏览`}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          浏览…
        </Button>
      </div>
      <input
        aria-label={`${labelPrefix}启动参数`}
        value={draft.args}
        onChange={(e) => onChange({ ...draft, args: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder='启动参数（可选，如：--login -i；含空格的参数用双引号）'
        className={selectCls}
      />
    </>
  );
}

interface TerminalProfilesSectionProps {
  profiles: TerminalProfile[];
  onSave: (next: TerminalProfile[]) => Promise<void>;
  /** 删除需同时清理默认 shell 与快捷命令引用，交给父组件 */
  onDelete: (id: string) => void;
}

/** 05a：自定义终端程序列表（增删改 + 检测已安装 shell） */
export function TerminalProfilesSection({ profiles, onSave, onDelete }: TerminalProfilesSectionProps) {
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const add = async () => {
    const profile = toProfile(draft, crypto.randomUUID());
    if (!profile) return;
    await onSave([...profiles, profile]);
    setDraft(EMPTY_DRAFT);
  };

  const startEdit = (p: TerminalProfile) => {
    setEditingId(p.id);
    setEditingDraft({ name: p.name, program: p.program, args: formatArgs(p.args) });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const profile = toProfile(editingDraft, editingId);
    if (!profile) return;
    setEditingId(null);
    await onSave(profiles.map((p) => (p.id === editingId ? profile : p)));
  };

  const remove = (id: string) => {
    if (editingId === id) setEditingId(null);
    onDelete(id);
  };

  const detect = async () => {
    setDetecting(true);
    setMessage(null);
    try {
      const raw = await invoke<unknown>("term_detect_shells");
      const detected = assertIpc("term_detect_shells", raw, isDetectedShellList);
      const { next, added } = mergeDetected(profiles, detected);
      if (added > 0) {
        await onSave(next);
        const names = next.slice(-added).map((p) => p.name).join("、");
        setMessage(`新增 ${added} 个：${names}`);
      } else {
        setMessage(detected.length > 0 ? "没有发现新的 shell（已在列表中）" : "没有发现新的 shell");
      }
    } catch (e) {
      setMessage(`检测失败：${errorText(e)}`);
    } finally {
      setDetecting(false);
    }
  };

  const canAdd = Boolean(draft.name.trim() && draft.program.trim());
  const canSaveEdit = Boolean(editingDraft.name.trim() && editingDraft.program.trim());

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">自定义程序</div>
          <div className="text-xs text-muted-foreground">
            如 nushell、Git Bash、WSL；可设为默认 shell，也可在终端「+」旁的下拉里临时选用。
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void detect()}
          disabled={detecting}
          aria-label="检测已安装的 shell"
        >
          <ScanSearch className="h-3.5 w-3.5" />
          {detecting ? "检测中…" : "检测已安装"}
        </Button>
      </div>
      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      {profiles.map((p) => {
        const editing = editingId === p.id;
        const detail = [p.program, formatArgs(p.args)].filter(Boolean).join(" ");
        return (
          <div
            key={p.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2",
              editing && "border-primary/70 bg-primary/5",
            )}
          >
            {editing ? (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <ProfileFields
                  draft={editingDraft}
                  onChange={setEditingDraft}
                  labelPrefix="编辑程序"
                  autoFocus
                  onEnter={() => void saveEdit()}
                  onEscape={() => setEditingId(null)}
                  onBrowseError={setMessage}
                />
              </div>
            ) : (
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground" title={detail}>
                  {detail}
                </div>
              </div>
            )}
            {editing ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => void saveEdit()}
                  disabled={!canSaveEdit}
                  aria-label="保存程序"
                >
                  <Check />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setEditingId(null)}
                  aria-label="取消编辑程序"
                >
                  <X />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => startEdit(p)}
                  aria-label={`编辑程序${p.name}`}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => remove(p.id)}
                  aria-label={`删除程序${p.name}`}
                >
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        );
      })}

      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/60 p-3">
        <div className="text-sm font-medium">新增程序</div>
        <ProfileFields
          draft={draft}
          onChange={setDraft}
          labelPrefix="新程序"
          onBrowseError={setMessage}
        />
        <Button size="sm" onClick={() => void add()} disabled={!canAdd} aria-label="添加程序">
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
    </div>
  );
}
