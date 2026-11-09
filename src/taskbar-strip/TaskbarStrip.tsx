import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface TaskbarSnapshot {
  available: boolean;
  expanded: boolean;
  reason?: string | null;
  taskbar?: unknown;
  client?: unknown;
  strip?: unknown;
  workArea?: unknown;
  dpi?: number;
  explorerPid?: number;
}

export interface TaskbarStripProps {
  snapshot?: Pick<TaskbarSnapshot, "available" | "expanded" | "reason">;
  now?: Date;
  weatherSummary?: string;
  todoSummary?: string;
  onToggle?: () => Promise<boolean>;
}

export async function taskbarAvailability(): Promise<Pick<TaskbarSnapshot, "available" | "reason">> {
  return invoke<Pick<TaskbarSnapshot, "available" | "reason">>("taskbar_availability");
}

export async function taskbarStripToggle(): Promise<boolean> {
  return invoke<boolean>("taskbar_strip_toggle_command");
}

function formatTime(now: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(now);
}

export function TaskbarStrip({
  snapshot: providedSnapshot,
  now,
  weatherSummary = "天气—",
  todoSummary = "待办—",
  onToggle = taskbarStripToggle,
}: TaskbarStripProps) {
  const [snapshot, setSnapshot] = useState<Pick<TaskbarSnapshot, "available" | "expanded" | "reason">>(
    providedSnapshot ?? { available: true, expanded: false, reason: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [liveNow, setLiveNow] = useState(() => new Date());

  // 时钟每 30s 自走；测试注入 now 时以注入值为准且不启动计时器。
  useEffect(() => {
    if (now) return;
    const timer = window.setInterval(() => setLiveNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [now]);

  useEffect(() => {
    if (providedSnapshot) {
      setSnapshot(providedSnapshot);
      return;
    }
    let disposed = false;
    const refreshAvailability = () => {
      void taskbarAvailability()
        .then((availability) => {
          if (!disposed) setSnapshot((current) => ({ ...current, ...availability }));
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : String(reason);
          console.error("[taskbar-strip] taskbar_availability failed", reason);
          if (!disposed) setError(message);
        });
    };
    refreshAvailability();
    const interval = window.setInterval(refreshAvailability, 5000);
    // 运行时重挂/其他窗口 toggle 后同步 expanded 与可用性，不靠 5s 轮询兜底。
    const unlisten = listen<TaskbarSnapshot>(
      "window://taskbar-state-changed",
      (event) => {
        if (!disposed) {
          setSnapshot((current) => ({
            ...current,
            available: event.payload.available,
            expanded: event.payload.expanded,
            reason: event.payload.reason ?? null,
          }));
        }
      },
    );
    return () => {
      disposed = true;
      window.clearInterval(interval);
      void unlisten.then((off) => off());
    };
  }, [providedSnapshot]);

  const handleToggle = useCallback(async () => {
    setError(null);
    try {
      const expanded = await onToggle();
      setSnapshot((current) => ({ ...current, expanded }));
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : String(reason);
      console.error("[taskbar-strip] taskbar toggle failed", reason);
      setError(message);
    }
  }, [onToggle]);

  const time = useMemo(() => formatTime(now ?? liveNow), [now, liveNow]);
  const compactError = error ?? (!snapshot.available ? snapshot.reason : null);

  return (
    <button
      type="button"
      className="taskbar-strip"
      data-testid="taskbar-strip"
      data-expanded={String(snapshot.expanded)}
      aria-pressed={snapshot.expanded}
      onClick={() => void handleToggle()}
    >
      <span className={`taskbar-strip__status ${snapshot.available ? "" : "is-error"}`} data-testid="taskbar-strip-mode" aria-label={snapshot.available ? "任务栏模式可用" : "任务栏模式不可用"} />
      <span className="taskbar-strip__body">
        <span className="taskbar-strip__time" data-testid="taskbar-strip-time">{time}</span>
        <span className="taskbar-strip__summary" data-testid="taskbar-strip-summary">
          {compactError ? `⚠ ${compactError}` : `${weatherSummary} · ${todoSummary}`}
        </span>
      </span>
      <span className="taskbar-strip__state" data-testid="taskbar-strip-state">{snapshot.expanded ? "展开" : "收起"}</span>
    </button>
  );
}
