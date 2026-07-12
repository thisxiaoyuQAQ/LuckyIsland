import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  KEYS,
  NOTIFY_SOURCES,
  parseFilterSources,
  settingGet,
  settingSetEmit,
  type NotifySource,
} from "@/lib/settings";

const SOURCE_LABELS: Record<NotifySource, string> = {
  claude: "Claude",
  codex: "Codex",
  custom: "自定义",
};

/** 通知页配置：按来源过滤弹卡片（被过滤的来源仍存历史，只是不弹） */
export function NotifyPanel() {
  const [filter, setFilter] = useState<Record<NotifySource, boolean>>(parseFilterSources(null));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void settingGet(KEYS.notifyFilterSources).then((v) => {
      setFilter(parseFilterSources(v));
      setLoading(false);
    });
  }, []);

  const toggle = async (src: NotifySource, v: boolean) => {
    const next = { ...filter, [src]: v };
    setFilter(next);
    const allowed = NOTIFY_SOURCES.filter((s) => next[s]);
    // 至少保留一个来源，避免全过滤后看不到任何通知
    const val = allowed.length === 0 ? "claude,codex,custom" : allowed.join(",");
    await settingSetEmit(KEYS.notifyFilterSources, val);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">通知</h2>
        <p className="text-sm text-muted-foreground">未勾选的来源不弹卡片、不展开灵动岛（仍存历史）。</p>
      </div>
      <div className="flex flex-col gap-2">
        {NOTIFY_SOURCES.map((src) => (
          <div
            key={src}
            className="flex items-center justify-between rounded-lg border border-border/70 bg-card/50 px-3 py-2"
          >
            <span className="text-sm">{SOURCE_LABELS[src]}</span>
            <Switch checked={filter[src]} onCheckedChange={(v) => void toggle(src, v)} />
          </div>
        ))}
      </div>
    </section>
  );
}
