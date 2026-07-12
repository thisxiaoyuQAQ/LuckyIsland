import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { useTimeSetting } from "../useTimeConfig";
import { timeWidgetKey } from "@/lib/settings";
import { parseSayingConfig, DEFAULT_SAYING } from "../widgetConfig";
import { fallbackSaying } from "./sayingFallback";

interface Saying {
  text: string;
  source: string | null;
  offline: boolean;
}

export function SayingWidget() {
  const { value: cfg } = useTimeSetting(timeWidgetKey("saying"), parseSayingConfig, DEFAULT_SAYING);
  const [text, setText] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchOne = useCallback(async () => {
    setLoading(true);
    try {
      const s = await invoke<Saying>("time_saying_get");
      setText(s.text);
      setSource(s.source);
      setOffline(s.offline);
    } catch {
      setText(fallbackSaying());
      setSource(null);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cfg.refreshOnEnter) void fetchOne();
    else setText(fallbackSaying());
  }, [cfg.refreshOnEnter, fetchOne]);

  return (
    <button
      type="button"
      onClick={() => cfg.clickToRefresh && void fetchOne()}
      className="flex w-full flex-col gap-1 rounded-lg border border-border/60 bg-card/40 p-2 text-left"
      aria-label="一言，点击换一句"
    >
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>一言</span>
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed">{text || "……"}</p>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {source && <span className="truncate">{source}</span>}
        {offline && <span className="text-yellow-500">缓存</span>}
      </div>
    </button>
  );
}
