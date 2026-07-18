import { useCallback, useEffect, useRef, useState } from "react";
import { settingSetEmit } from "@/lib/settings";

export interface UseDraftFieldOptions<T> {
  /** 从持久化字符串解析出当前值（启动时读到的、或外部 settings://changed 推送的） */
  parse: (raw: string | null) => T;
  /** 把 draft 序列化为可持久化字符串；返回 null 表示当前 draft 不合法、不应提交 */
  serialize: (draft: T) => string | null;
  /** 启动时从 KV 读到的初始 raw；hook 内部据此初始化 draft 与 persisted */
  initial: string | null;
  /** 写入 KV 的 key */
  settingKey: string;
  /** debounce 毫秒；0 表示不启用 debounce（依赖 blur 或显式 commit） */
  debounceMs?: number;
  /** 是否在 unmount/依赖变化时丢弃未提交的 draft（默认 true） */
  discardOnCleanup?: boolean;
}

export interface UseDraftFieldResult<T> {
  /** 当前编辑中的值（可能尚未提交） */
  draft: T;
  /** 最近一次成功提交到 KV 的值 */
  persisted: T;
  /** 是否存在未提交的修改（draft !== persisted 且通过 serialize 校验） */
  dirty: boolean;
  /** 是否有写入在进行中 */
  saving: boolean;
  /** 最近一次保存失败的错误文案（成功保存/输入变化时清空） */
  saveError: string | null;
  /** 修改 draft；按 debounceMs 节流自动提交 */
  setDraft: (next: T) => void;
  /** 立即提交当前 draft（通常绑 onBlur/Enter） */
  commit: () => void;
  /** 放弃 draft，回滚到 persisted */
  reset: () => void;
}

const defaultError = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * 设置文本/数字字段的 draft/persisted 分离：
 * - draft 编辑不立即写 KV；debounce 或显式 commit 才提交；
 * - 提交失败保留 draft 并回显错误；提交成功更新 persisted 并清错误；
 * - 同一字段多次 commit 之间不串话：后一次提交覆盖前一次的 persisted 视图，但不让在途旧响应把已更新的 persisted 回退。
 */
export function useDraftField<T>(options: UseDraftFieldOptions<T>): UseDraftFieldResult<T> {
  const {
    parse,
    serialize,
    initial,
    settingKey,
    debounceMs = 400,
    discardOnCleanup = true,
  } = options;

  const [persisted, setPersisted] = useState<T>(() => parse(initial));
  const [draft, setDraftState] = useState<T>(() => parse(initial));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generationRef = useRef(0);
  // latest 引用让 debounce 回调读到最新 draft，避免闭包陈旧
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const commitNow = useCallback(async (value: T, generation: number) => {
    const serialized = serialize(value);
    if (serialized === null) {
      // 不合法输入：不视为错误，只是不提交（用户可能正在输入中间态）
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await settingSetEmit(settingKey, serialized);
      if (generationRef.current !== generation) return;
      setPersisted(value);
    } catch (error) {
      if (generationRef.current !== generation) return;
      setSaveError(defaultError(error));
    } finally {
      if (generationRef.current === generation) setSaving(false);
    }
  }, [serialize, settingKey]);

  const setDraft = useCallback((next: T) => {
    setDraftState(next);
    setSaveError(null);
    clearTimer();
    const generation = ++generationRef.current;
    if (debounceMs > 0) {
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        void commitNow(next, generation);
      }, debounceMs);
    }
  }, [clearTimer, commitNow, debounceMs]);

  const commit = useCallback(() => {
    clearTimer();
    const generation = ++generationRef.current;
    void commitNow(draftRef.current, generation);
  }, [clearTimer, commitNow]);

  const reset = useCallback(() => {
    clearTimer();
    generationRef.current += 1;
    setDraftState(persisted);
    setSaveError(null);
  }, [clearTimer, persisted]);

  useEffect(() => {
    if (!discardOnCleanup) return undefined;
    return () => {
      clearTimer();
      // 不让在途提交把已卸载组件的 persisted 推回去
      generationRef.current += 1;
    };
  }, [clearTimer, discardOnCleanup]);

  const dirty = serialize(draft) !== null && serialize(draft) !== serialize(persisted);

  return {
    draft,
    persisted,
    dirty,
    saving,
    saveError,
    setDraft,
    commit,
    reset,
  };
}
