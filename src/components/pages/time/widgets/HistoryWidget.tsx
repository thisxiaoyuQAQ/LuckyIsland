import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTimeSetting } from "../useTimeConfig";
import { timeWidgetKey } from "@/lib/settings";
import { parseHistoryConfig, DEFAULT_HISTORY } from "../widgetConfig";

interface PEvent {
  year: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  importance: number;
  source: string;
}
interface PHistory {
  date: string;
  events: PEvent[];
  offline: boolean;
}

export function HistoryWidget() {
  const { value: cfg } = useTimeSetting(
    timeWidgetKey("programmer_history"),
    parseHistoryConfig,
    DEFAULT_HISTORY,
  );
  const [data, setData] = useState<PHistory | null>(null);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState(false);
  const [detail, setDetail] = useState<PEvent | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const h = await invoke<PHistory>("time_programmer_history_get");
        setData(h);
        setIdx(0);
        setErr(false);
      } catch {
        setErr(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!cfg.autoRotate || !data || data.events.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % data.events.length), 5000);
    return () => clearInterval(id);
  }, [cfg.autoRotate, data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ev = data?.events[idx];

  return (
    <div className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-card/20 px-3 py-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">历史</span>
      {err ? (
        <span className="flex-1 truncate text-xs text-destructive">加载失败，稍后重试</span>
      ) : ev ? (
        <button
          type="button"
          onClick={() => setDetail(ev)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          aria-label="查看事件详情"
        >
          <span className="shrink-0 text-xs font-semibold tabular-nums">{ev.year || "—"}</span>
          {cfg.showCategory && ev.category && (
            <span className="shrink-0 rounded bg-accent px-1 text-[10px] text-muted-foreground">
              {ev.category}
            </span>
          )}
          <span className="truncate text-xs">{ev.title}</span>
        </button>
      ) : (
        <span className="flex-1 text-xs text-muted-foreground">暂无数据</span>
      )}
      {data && data.events.length > 1 && (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <button
            onClick={() => setIdx((i) => (i - 1 + data.events.length) % data.events.length)}
            aria-label="上一条"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span className="text-[10px] tabular-nums">
            {idx + 1}/{data.events.length}
          </span>
          <button
            onClick={() => setIdx((i) => (i + 1) % data.events.length)}
            aria-label="下一条"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </span>
      )}
      {data?.offline && <span className="shrink-0 text-[10px] text-yellow-500">缓存</span>}

      {detail && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="max-h-64 w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-popover p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-sm font-semibold tabular-nums">{detail.year}</span>
              {detail.category && (
                <span className="rounded bg-accent px-1 text-[10px]">{detail.category}</span>
              )}
            </div>
            <div className="text-sm font-medium">{detail.title}</div>
            {detail.description && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {detail.description}
              </p>
            )}
            {detail.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {detail.tags.map((t) => (
                  <span key={t} className="rounded bg-accent px-1 text-[10px]">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {detail.source && (
              <p className="mt-1 text-[10px] text-muted-foreground">来源：{detail.source}</p>
            )}
            <button className="mt-2 text-xs text-primary" onClick={() => setDetail(null)}>
              关闭（Esc）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
