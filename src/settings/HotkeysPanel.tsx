import { useEffect, useState } from "react";
import {
  bindingFromEvent,
  formatBinding,
  hotkeysApply,
  hotkeysList,
  hotkeysReload,
  hotkeysReset,
  hotkeysSuspend,
  type HotkeyEntry,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

/**
 * 全局热键设置面板：列出可绑定动作，点击按键框录制组合键，保存后即时重新注册。
 *
 * 录制时先 hotkeysSuspend 暂停所有热键注册，避免按下「当前已注册」的组合键时
 * OS 层全局热键先触发动作（webview 的 preventDefault 拦不住 OS 快捷键）；
 * 录制结束/取消/组件卸载时 hotkeysReload 从 DB 恢复注册态。
 */
export function HotkeysPanel() {
  const [entries, setEntries] = useState<HotkeyEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 加载当前绑定
  useEffect(() => {
    let disposed = false;
    void hotkeysList()
      .then((list) => {
        if (disposed) return;
        setEntries(list);
        const d: Record<string, string> = {};
        for (const e of list) d[e.action] = e.binding;
        setDrafts(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!disposed) {
          setErrors({ _: String(e) });
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, []);

  const clearError = (action: string) =>
    setErrors((er) => {
      const n = { ...er };
      delete n[action];
      return n;
    });

  // 录制：进入时 suspend，退出（结束/取消/卸载）时 reload
  useEffect(() => {
    if (!recording) return;
    void hotkeysSuspend();
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setRecording(null);
        return;
      }
      if (e.code === "Backspace" || e.code === "Delete") {
        setDrafts((d) => ({ ...d, [recording]: "" }));
        clearError(recording);
        setRecording(null);
        return;
      }
      const r = bindingFromEvent(e);
      if (!r) {
        setErrors((er) => ({
          ...er,
          [recording]: "需至少一个修饰键（Alt/Ctrl/Shift/Win），或使用 F1-F12",
        }));
        return; // 保持录制态，让用户重按
      }
      if ("modifierOnly" in r) return; // 等主键
      setDrafts((d) => ({ ...d, [recording]: r.binding }));
      clearError(recording);
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      void hotkeysReload();
    };
  }, [recording]);

  const dirty = entries.some((e) => (drafts[e.action] ?? "") !== e.binding);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setErrors({});
    try {
      const bindings: [string, string][] = entries.map((e) => [
        e.action,
        drafts[e.action] ?? "",
      ]);
      const results = await hotkeysApply(bindings);
      const byAction = new Map(results.map((r) => [r.action, r]));
      setEntries((prev) =>
        prev.map((e) => {
          const r = byAction.get(e.action);
          // 仅成功的动作更新生效绑定；失败保持旧值（实际未注册）
          return r && r.ok ? { ...e, binding: r.binding } : e;
        }),
      );
      setDrafts((d) => {
        const n = { ...d };
        for (const r of results) if (r.ok) n[r.action] = r.binding;
        return n;
      });
      const newErr: Record<string, string> = {};
      for (const r of results) {
        if (!r.ok && r.error) newErr[r.action] = r.error;
      }
      setErrors(newErr);
    } catch (e) {
      setErrors({ _: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (saving) return;
    setSaving(true);
    setErrors({});
    try {
      const results = await hotkeysReset();
      const list = await hotkeysList();
      setEntries(list);
      const d: Record<string, string> = {};
      for (const e of list) d[e.action] = e.binding;
      setDrafts(d);
      const newErr: Record<string, string> = {};
      for (const r of results) if (!r.ok && r.error) newErr[r.action] = r.error;
      setErrors(newErr);
    } catch (e) {
      setErrors({ _: String(e) });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">全局热键</h2>
      <p className="text-xs text-muted-foreground">
        点击右侧按键框后按下组合键录制；ESC 取消，Backspace 清空。需至少一个修饰键或使用 F1-F12。
      </p>

      {entries.map((e) => {
        const draft = drafts[e.action] ?? "";
        const isRecording = recording === e.action;
        const err = errors[e.action];
        return (
          <div key={e.action} className="flex items-center justify-between gap-4 py-2">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm font-medium">{e.label}</div>
              <div className="text-xs text-muted-foreground">
                默认：{formatBinding(e.default)}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={() => {
                  setRecording(e.action);
                  clearError(e.action);
                }}
                disabled={saving}
                className={cn(
                  "min-w-36 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
                  isRecording
                    ? "border-ring ring-[3px] ring-ring/50"
                    : "border-border/60 hover:border-border",
                  err && !isRecording && "border-destructive",
                )}
              >
                {isRecording
                  ? "按下组合键…"
                  : draft
                    ? formatBinding(draft)
                    : "未设置（点击录制）"}
              </button>
              {err && <p className="text-xs text-destructive">{err}</p>}
              {draft !== e.default && (
                <button
                  onClick={() => {
                    setDrafts((d) => ({ ...d, [e.action]: e.default }));
                    clearError(e.action);
                  }}
                  disabled={saving}
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  恢复默认
                </button>
              )}
            </div>
          </div>
        );
      })}

      {errors._ && <p className="text-xs text-destructive">{errors._}</p>}

      <div className="flex gap-2 pt-2">
        <button
          onClick={save}
          disabled={!dirty || saving || recording !== null}
          className="rounded-md bg-primary px-4 py-1.5 text-sm text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        <button
          onClick={resetAll}
          disabled={saving || recording !== null}
          className="rounded-md border border-border/60 px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          全部恢复默认
        </button>
      </div>
    </section>
  );
}
