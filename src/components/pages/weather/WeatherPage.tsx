import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, AlertTriangle, MapPin, LocateFixed, Plus, X } from "lucide-react";
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

interface LocatedCity {
  city: string;
  region: string;
  ip: string;
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
  const [cities, setCities] = useState<string[]>([]);
  const [active, setActive] = useState("");
  const [w, setW] = useState<WeatherNow | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchWeather = useCallback(async (city: string) => {
    if (!city) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await invoke<WeatherNow>("weather_get", { city });
      setW(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCities = useCallback(async () => {
    try {
      const list = await invoke<string[]>("weather_cities_list");
      setCities(list);
      return list;
    } catch (e) {
      setErr(String(e));
      return [];
    }
  }, []);

  const locateAndAdd = useCallback(async () => {
    setLocating(true);
    setErr(null);
    try {
      const loc = await invoke<LocatedCity>("weather_locate");
      await invoke("weather_cities_add", { city: loc.city });
      const list = await loadCities();
      const next = list.length > 0 ? list[list.length - 1] : loc.city;
      setActive(next);
      await fetchWeather(next);
    } catch (e) {
      setErr(`定位失败：${e}`);
      setAdding(true);
    } finally {
      setLocating(false);
    }
  }, [fetchWeather, loadCities]);

  // 首挂载：载入城市；空则自动定位加入
  useEffect(() => {
    void (async () => {
      const list = await loadCities();
      if (list.length === 0) {
        await locateAndAdd();
        return;
      }
      const first = list[0];
      setActive(first);
      await fetchWeather(first);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchCity = (c: string) => {
    if (c === active) return;
    setActive(c);
    void fetchWeather(c);
  };

  const addCity = async () => {
    const c = draft.trim();
    if (!c) return;
    try {
      await invoke("weather_cities_add", { city: c });
      setDraft("");
      setAdding(false);
      const list = await loadCities();
      setActive(c);
      await fetchWeather(c);
    } catch (e) {
      setErr(String(e));
    }
  };

  const removeCity = async (c: string) => {
    try {
      await invoke("weather_cities_remove", { city: c });
      const list = await loadCities();
      if (active === c) {
        const next = list[0] ?? "";
        setActive(next);
        if (next) void fetchWeather(next);
        else setW(null);
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  if (compact) {
    if (loading && !w) return <span className="text-sm text-muted-foreground">天气…</span>;
    if (!w) return <span className="text-sm text-muted-foreground">无天气</span>;
    return (
      <span className="flex items-center gap-1.5 text-sm tabular-nums">
        <span>{weatherEmoji(w.weather_icon)}</span>
        <span className="text-muted-foreground">{w.city}</span>
        <span className="font-medium">{Math.round(w.temperature)}°</span>
        <span className="text-muted-foreground">{w.weather}</span>
        {w.offline && <span className="text-[10px] text-yellow-500">离线</span>}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 城市芯片行 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {cities.map((c) => (
          <span
            key={c}
            className={cn(
              "group flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              c === active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground",
            )}
          >
            <button onClick={() => switchCity(c)} className="cursor-pointer">
              {c}
            </button>
            <button
              onClick={() => void removeCity(c)}
              aria-label={`删除${c}`}
              className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addCity();
              } else if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            onBlur={() => {
              if (!draft.trim()) setAdding(false);
            }}
            placeholder="城市名"
            className="w-20 rounded-full border border-input bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            aria-label="添加城市"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border/60 text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => void locateAndAdd()}
            disabled={locating}
            aria-label="定位本机"
            title="IP 定位本机城市"
          >
            {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => active && void fetchWeather(active)}
            aria-label="刷新"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          {w?.offline && <span className="text-[10px] text-yellow-500">离线</span>}
        </div>
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
                <MapPin className="mr-1 inline h-3 w-3" />
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
