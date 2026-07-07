import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Loader2, RefreshCw, AlertTriangle, MapPin, LocateFixed, Plus, X, Pin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReorder } from "@/lib/useReorder";
import { KEYS, onSettingsChanged, parseRefreshMin, settingGet } from "@/lib/settings";
import { CITIES } from "./cities";

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

const COMPACT_KEY = "weather:compact_city";

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
  const [compactCity, setCompactCity] = useState("");
  const [cache, setCache] = useState<Record<string, WeatherNow>>({});
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshMin, setRefreshMin] = useState(10);

  const suggestions = useMemo(() => {
    const q = draft.trim();
    const pool = (q ? CITIES.filter((c) => c.includes(q)) : CITIES).filter(
      (c) => !cities.includes(c),
    );
    return pool.slice(0, 12);
  }, [draft, cities]);

  const fetchWeather = useCallback(async (city: string) => {
    if (!city) return;
    setLoading(true);
    setErr(null);
    try {
      const data = await invoke<WeatherNow>("weather_get", { city });
      setCache((c) => ({ ...c, [city]: data }));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCities = useCallback(async () => {
    try {
      return await invoke<string[]>("weather_cities_list");
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
      setCities(list);
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

  // 首挂载：载入城市 + 紧凑态城市；空则自动定位
  useEffect(() => {
    void (async () => {
      const [list, savedCompact] = await Promise.all([
        loadCities(),
        invoke<string | null>("setting_get", { key: COMPACT_KEY }),
      ]);
      if (list.length === 0) {
        await locateAndAdd();
        return;
      }
      setCities(list);
      const first = list[0];
      const comp = savedCompact && list.includes(savedCompact) ? savedCompact : first;
      setActive(first);
      setCompactCity(comp);
      void fetchWeather(first);
      if (comp !== first) void fetchWeather(comp);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchCity = (c: string) => {
    if (c === active) return;
    setActive(c);
    void fetchWeather(c);
  };

  const addCity = async (c: string) => {
    const city = c.trim();
    if (!city) return;
    try {
      await invoke("weather_cities_add", { city });
      setDraft("");
      setAdding(false);
      const list = await loadCities();
      setCities(list);
      setActive(city);
      await fetchWeather(city);
    } catch (e) {
      setErr(String(e));
    }
  };

  const removeCity = async (c: string) => {
    try {
      await invoke("weather_cities_remove", { city: c });
      const list = await loadCities();
      setCities(list);
      if (active === c) {
        const next = list[0] ?? "";
        setActive(next);
        if (next) void fetchWeather(next);
      }
      if (compactCity === c) {
        const next = list[0] ?? "";
        setCompactCity(next);
        void invoke("setting_set", { key: COMPACT_KEY, value: next || null });
        if (next && next !== active) void fetchWeather(next);
      }
    } catch (e) {
      setErr(String(e));
    }
  };

  const pickCompact = async (c: string) => {
    setCompactCity(c);
    setPicking(false);
    await invoke("setting_set", { key: COMPACT_KEY, value: c });
    if (!cache[c]) void fetchWeather(c);
  };

  const { overIndex, itemProps } = useReorder<string>((next) => {
    setCities(next);
    void invoke("weather_cities_reorder", { cities: next });
  });

  const refreshAll = useCallback(() => {
    if (active) void fetchWeather(active);
    if (compactCity && compactCity !== active) void fetchWeather(compactCity);
  }, [active, compactCity, fetchWeather]);

  // 自动刷新间隔：读 settings + 监听即时生效
  useEffect(() => {
    void settingGet(KEYS.weatherRefreshMin).then((v) => setRefreshMin(parseRefreshMin(v)));
    let un: (() => void) | undefined;
    onSettingsChanged((key, value) => {
      if (key === KEYS.weatherRefreshMin) setRefreshMin(parseRefreshMin(value));
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  // 后台定时刷新（间隔由 refreshMin 控制）
  useEffect(() => {
    if (refreshMin <= 0) return;
    const id = window.setInterval(() => refreshAll(), refreshMin * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshMin, refreshAll]);

  const w = cache[active];
  const wCompact = cache[compactCity];

  if (compact) {
    const cur = wCompact ?? w;
    if (loading && !cur) return <span className="text-sm text-muted-foreground">天气…</span>;
    if (!cur) return <span className="text-sm text-muted-foreground">无天气</span>;
    return (
      <span className="flex items-center gap-1.5 text-sm tabular-nums">
        <span>{weatherEmoji(cur.weather_icon)}</span>
        <span className="text-muted-foreground">{cur.city}</span>
        <span className="font-medium">{Math.round(cur.temperature)}°</span>
        <span className="text-muted-foreground">{cur.weather}</span>
        {cur.offline && <span className="text-[10px] text-yellow-500">离线</span>}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 城市芯片行（可拖拽排序） */}
      <div className="flex items-center gap-1.5">
        <div className="flex flex-1 min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-gutter:stable]">
        {cities.map((c, i) => (
          <span
            key={c}
            {...itemProps(i, cities)}
            className={cn(
              "group flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              c === active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground",
              overIndex === i && "ring-2 ring-primary/60",
            )}
          >
            <button onClick={() => switchCity(c)} className="cursor-pointer">
              {c}
            </button>
            {c === compactCity && <Pin className="h-2.5 w-2.5 text-primary" />}
            <button
              draggable={false}
              onClick={() => void removeCity(c)}
              aria-label={`删除${c}`}
              className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        {adding ? (
          <div className="relative shrink-0">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (suggestions.length > 0) void addCity(suggestions[0]);
                } else if (e.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              onBlur={() => setTimeout(() => { setAdding(false); setDraft(""); }, 120)}
              placeholder="城市名"
              className="w-24 rounded-full border border-input bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            {suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                {suggestions.map((c) => (
                  <button
                    key={c}
                    onMouseDown={(e) => { e.preventDefault(); void addCity(c); }}
                    className="block w-full px-2.5 py-1 text-left text-xs hover:bg-accent"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            aria-label="添加城市"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border/60 text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* 选择紧凑态显示的城市 */}
          <div className="relative">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              onClick={() => setPicking((v) => !v)}
              aria-label="选择紧凑态城市"
              title={`紧凑态显示：${compactCity || "默认"}`}
            >
              <Pin className="h-3.5 w-3.5" />
            </Button>
            {picking && (
              <div className="absolute right-0 top-full z-10 mt-1 max-h-56 w-32 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                {cities.map((c) => (
                  <button
                    key={c}
                    onMouseDown={(e) => { e.preventDefault(); void pickCompact(c); }}
                    className={cn(
                      "flex w-full items-center gap-1.5 px-2.5 py-1 text-left text-xs hover:bg-accent",
                      c === compactCity && "text-primary",
                    )}
                  >
                    {c === compactCity && <Pin className="h-2.5 w-2.5" />}
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>
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
            onClick={refreshAll}
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
