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
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchOne = useCallback(async () => {
    setLoading(true);
    try {
      const s = await invoke<Saying>("time_saying_get");
      setText(s.text);
      setOffline(s.offline);
    } catch {
      setText(fallbackSaying());
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
      className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-card/20 px-3 py-1.5 text-left transition-colors hover:bg-card/40"
      aria-label="一言，点击换一句"
    >
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">一言</span>
      <span className="min-w-0 flex-1 truncate text-xs">{text || "……"}</span>
      {offline && <span className="shrink-0 text-[10px] text-yellow-500">缓存</span>}
      <RefreshCw
        className={`h-3 w-3 shrink-0 text-muted-foreground ${loading ? "animate-spin" : ""}`}
        aria-hidden
      />
    </button>
  );
}
