import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, AlertTriangle, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WeatherAlert {
  title: string;
  alert_type: string;
  level: string;
  text: string;
  publish_time: string;
  publisher: string;
}

interface WeatherNow {
  province: string;
  city: string;
  district: string | null;
  weather: string;
  weather_icon: string;
  temperature: number;
  wind_direction: string;
  wind_power: string;
  humidity: number;
  report_time: string;
  alerts: WeatherAlert[];
  offline: boolean;
  fetched_at: number;
}

/** uapis/和风风格 icon 码 → emoji（覆盖常见范围） */
function weatherEmoji(icon: string): string {
  const n = parseInt(icon, 10);
  if (Number.isNaN(n)) return "🌡️";
  if (n === 100 || n === 150) return "☀️";
  if (n >= 101 && n <= 103) return "⛅";
  if (n === 104 || n === 154) return "☁️";
  if (n >= 300 && n < 400) return n === 302 || n === 303 ? "⛈️" : "🌧️";
  if (n >= 400 && n < 500) return "🌨️";
  if (n >= 500 && n < 600) return "🌫️";
  return "🌡️";
}

function levelColor(level: string): string {
  if (level.includes("红")) return "text-red-500";
  if (level.includes("橙")) return "text-orange-500";
  if (level.includes("黄")) return "text-yellow-500";
  if (level.includes("蓝")) return "text-blue-500";
  return "text-muted-foreground";
}

export function WeatherPage({ compact }: { compact: boolean }) {
  const [w, setW] = useState<WeatherNow | null>(null);
  const [city, setCity] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [data, savedCity] = await Promise.all([
        invoke<WeatherNow>("weather_get"),
        invoke<string>("weather_get_city"),
      ]);
      setW(data);
      setCity(savedCity);
      setDraft(savedCity);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeCity = async () => {
    const c = draft.trim();
    if (!c || c === city) return;
    try {
      await invoke("weather_set_city", { city: c });
      setCity(c);
      setLoading(true);
      setErr(null);
      const data = await invoke<WeatherNow>("weather_get", { city: c });
      setW(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  if (compact) {
    if (loading && !w) return <span className="text-sm text-muted-foreground">天气…</span>;
    if (!w) return <span className="text-sm text-muted-foreground">无天气</span>;
    return (
      <span className="flex items-center gap-1.5 text-sm tabular-nums">
        <span>{weatherEmoji(w.weather_icon)}</span>
        <span className="font-medium">{Math.round(w.temperature)}°</span>
        <span className="text-muted-foreground">{w.weather}</span>
        {w.offline && <span className="text-[10px] text-yellow-500">离线</span>}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 顶部：城市 + 刷新 */}
      <div className="flex items-center gap-2">
        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void changeCity();
            }
          }}
          placeholder="城市名，如 北京 / beijing"
          className="w-32 rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void load()} aria-label="刷新">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
        {w?.offline && (
          <span className="text-[10px] text-yellow-500">离线（缓存）</span>
        )}
      </div>

      {err && !w && (
        <div className="flex h-full items-center justify-center text-sm text-destructive">{err}</div>
      )}

      {w && (
        <>
          {/* 主体：图标 + 温度 + 描述 */}
          <div className="flex items-center gap-4">
            <span className="text-5xl leading-none">{weatherEmoji(w.weather_icon)}</span>
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-semibold tabular-nums">{Math.round(w.temperature)}</span>
                <span className="text-lg text-muted-foreground">°C</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {w.weather} · {w.wind_direction} {w.wind_power} · 湿度 {Math.round(w.humidity)}%
              </div>
              <div className="text-[11px] text-muted-foreground/80">
                {w.district ? `${w.province} ${w.city} ${w.district}` : `${w.province} ${w.city}`} · {w.report_time}
              </div>
            </div>
          </div>

          {/* 预警 */}
          {w.alerts.length > 0 && (
            <div className="flex-1 space-y-1.5 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
              {w.alerts.map((a, i) => (
                <details key={i} className="rounded-md border border-border/60 bg-background/40 px-2.5 py-1.5">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-xs">
                    <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", levelColor(a.level))} />
                    <span className="font-medium">{a.title}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{a.publish_time}</span>
                  </summary>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{a.text}</p>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
