import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LocateFixed,
  MapPin,
  Pin,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReorder } from "@/lib/useReorder";
import { KEYS, onSettingsChanged, parseRefreshMin, settingGet } from "@/lib/settings";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { CITIES } from "./cities";
import {
  RequestGate,
  dateInTimezone,
  displayForecast,
  hasPrecipitation,
  parseWeatherCommandError,
  weatherDayLabel,
  wheelDeltaToHorizontal,
  type WeatherBundle,
  type WeatherLocation,
} from "./model";

interface LocatedCity {
  city: string;
  region: string;
  ip: string;
}

const COMPACT_KEY = "weather:compact_city";

function weatherEmoji(icon: string): string {
  if (!/^\d+$/.test(icon)) return icon || "🌡️";
  const code = Number(icon);
  if (code === 100 || code === 150) return "☀️";
  if (code >= 101 && code <= 103) return "⛅";
  if (code === 104 || code === 154) return "☁️";
  if (code >= 300 && code < 400) return code === 302 || code === 303 ? "⛈️" : "🌧️";
  if (code >= 400 && code < 500) return "🌨️";
  if (code >= 500 && code < 600) return "🌫️";
  return "🌡️";
}

function levelColor(level: string): string {
  if (level.includes("红")) return "text-red-500";
  if (level.includes("橙")) return "text-orange-500";
  if (level.includes("黄")) return "text-yellow-500";
  if (level.includes("蓝")) return "text-blue-500";
  return "text-muted-foreground";
}

function locationLabel(location: WeatherLocation): string {
  return [location.displayName, location.province, location.country].filter(Boolean).join(" / ");
}

export function WeatherPage({ compact }: { compact: boolean }) {
  const [cities, setCities] = useState<string[]>([]);
  const [active, setActive] = useState("");
  const [compactCity, setCompactCity] = useState("");
  const [cache, setCache] = useState<Record<string, WeatherBundle>>({});
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const [loadingCity, setLoadingCity] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ city: string; values: WeatherLocation[] } | null>(null);
  const [refreshMin, setRefreshMin] = useState(10);
  const activeGate = useRef(new RequestGate());
  const compactGate = useRef(new RequestGate());
  const forecastRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const query = draft.trim();
    return (query ? CITIES.filter((city) => city.includes(query)) : CITIES)
      .filter((city) => !cities.includes(city))
      .slice(0, 12);
  }, [draft, cities]);

  const fetchWeather = useCallback(async (
    city: string,
    location?: WeatherLocation,
    purpose: "active" | "compact" = "active",
  ) => {
    if (!city) return;
    const gate = purpose === "active" ? activeGate.current : compactGate.current;
    const requestId = gate.next();
    if (purpose === "active") {
      setLoadingCity(city);
      setErr(null);
      setCandidates(null);
    }
    try {
      const data = await invoke<WeatherBundle>("weather_get", { city, location: location ?? null });
      if (!gate.isCurrent(requestId)) return;
      setCache((current) => ({ ...current, [city]: data }));
    } catch (error) {
      if (!gate.isCurrent(requestId)) return;
      const structured = parseWeatherCommandError(error);
      if (purpose === "active" && structured?.code === "ambiguous_location" && structured.candidates) {
        setCandidates({ city, values: structured.candidates });
      } else if (purpose === "active") {
        setErr(structured?.message ?? String(error));
      }
    } finally {
      if (purpose === "active" && gate.isCurrent(requestId)) setLoadingCity(null);
    }
  }, []);

  const loadCities = useCallback(async () => {
    try {
      return await invoke<string[]>("weather_cities_list");
    } catch (error) {
      setErr(String(error));
      return [];
    }
  }, []);

  const locateAndAdd = useCallback(async () => {
    setLocating(true);
    setErr(null);
    try {
      const located = await invoke<LocatedCity>("weather_locate");
      await invoke("weather_cities_add", { city: located.city });
      const list = await loadCities();
      setCities(list);
      const next = list.at(-1) ?? located.city;
      setActive(next);
      await fetchWeather(next);
    } catch (error) {
      setErr(`定位失败：${error}`);
      setAdding(true);
    } finally {
      setLocating(false);
    }
  }, [fetchWeather, loadCities]);

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
      const selectedCompact = savedCompact && list.includes(savedCompact) ? savedCompact : first;
      setActive(first);
      setCompactCity(selectedCompact);
      void fetchWeather(first, undefined, "active");
      if (selectedCompact !== first) void fetchWeather(selectedCompact, undefined, "compact");
    })();
  }, [fetchWeather, loadCities, locateAndAdd]);

  useTauriEvent("config://imported", () => {
    void loadCities().then((list) => {
      setCities(list);
      const next = list.includes(active) ? active : (list[0] ?? "");
      const compactNext = list.includes(compactCity) ? compactCity : (list[0] ?? "");
      setActive(next);
      setCompactCity(compactNext);
      if (next) void fetchWeather(next);
      if (compactNext && compactNext !== next) void fetchWeather(compactNext, undefined, "compact");
    });
  });

  const persistResolvedCity = useCallback(async (city: string, location: WeatherLocation) => {
    await invoke("weather_cities_add", { city });
    const list = await loadCities();
    setCities(list);
    setActive(city);
    setDraft("");
    setAdding(false);
    setCandidates(null);
    await fetchWeather(city, location);
  }, [fetchWeather, loadCities]);

  const addCity = async (value: string) => {
    const city = value.trim();
    if (!city) return;
    try {
      const matches = await invoke<WeatherLocation[]>("weather_location_search", { query: city });
      if (matches.length === 0) {
        setErr(`未找到城市：${city}`);
        return;
      }
      if (matches.length === 1) {
        await persistResolvedCity(city, matches[0]);
      } else {
        setCandidates({ city, values: matches });
      }
    } catch (error) {
      setErr(parseWeatherCommandError(error)?.message ?? String(error));
    }
  };

  const removeCity = async (city: string) => {
    await invoke("weather_cities_remove", { city });
    const list = await loadCities();
    setCities(list);
    if (active === city) {
      const next = list[0] ?? "";
      setActive(next);
      if (next) void fetchWeather(next);
    }
    if (compactCity === city) {
      const next = list[0] ?? "";
      setCompactCity(next);
      await invoke("setting_set", { key: COMPACT_KEY, value: next || null });
      if (next && next !== active) void fetchWeather(next, undefined, "compact");
    }
  };

  const pickCompact = async (city: string) => {
    setCompactCity(city);
    setPicking(false);
    await invoke("setting_set", { key: COMPACT_KEY, value: city });
    if (!cache[city]) void fetchWeather(city, undefined, "compact");
  };

  const { overIndex, itemProps } = useReorder<string>((next) => {
    setCities(next);
    void invoke("weather_cities_reorder", { cities: next });
  });

  const refreshAll = useCallback(() => {
    if (active) void fetchWeather(active);
    if (compactCity && compactCity !== active) void fetchWeather(compactCity, undefined, "compact");
  }, [active, compactCity, fetchWeather]);

  useEffect(() => {
    void settingGet(KEYS.weatherRefreshMin).then((value) => setRefreshMin(parseRefreshMin(value)));
  }, []);

  useAsyncSubscription(
    () => onSettingsChanged((key, value) => {
      if (key === KEYS.weatherRefreshMin) setRefreshMin(parseRefreshMin(value));
    }),
    [],
    { label: "settings://changed:weather" },
  );

  useEffect(() => {
    const id = window.setInterval(refreshAll, refreshMin * 60 * 1000);
    return () => clearInterval(id);
  }, [refreshMin, refreshAll]);

  const bundle = cache[active];
  const compactBundle = cache[compactCity] ?? bundle;
  if (compact) {
    if (loadingCity && !compactBundle) return <span className="text-sm text-muted-foreground">天气…</span>;
    if (!compactBundle) return <span className="text-sm text-muted-foreground">无天气</span>;
    const now = compactBundle.now;
    return (
      <span className="flex items-center gap-1.5 text-sm tabular-nums">
        <span>{weatherEmoji(now.weatherIcon)}</span>
        <span className="text-muted-foreground">{now.city}</span>
        <span className="font-medium">{Math.round(now.temperature)}°</span>
        <span className="text-muted-foreground">{now.weather}</span>
        {compactBundle.offline && <span className="text-[10px] text-yellow-500">离线</span>}
      </span>
    );
  }

  const now = bundle?.now;
  const todayDate = bundle ? dateInTimezone(bundle.timezone) : "";
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {cities.map((city, index) => (
            <span key={city} {...itemProps(index, cities)} className={cn(
              "group flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
              city === active ? "border-primary bg-primary/10" : "border-border/60 text-muted-foreground",
              overIndex === index && "ring-2 ring-primary/60",
            )}>
              <button onClick={() => { setActive(city); void fetchWeather(city); }}>{city}</button>
              {city === compactCity && <Pin className="h-2.5 w-2.5 text-primary" />}
              <button draggable={false} onClick={() => void removeCity(city)} aria-label={`删除${city}`}>
                <X className="h-3 w-3 opacity-50 group-hover:opacity-100" />
              </button>
            </span>
          ))}
          {adding ? (
            <div className="relative shrink-0">
              <input autoFocus value={draft} onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && draft.trim()) void addCity(suggestions[0] ?? draft);
                  if (event.key === "Escape") setAdding(false);
                }} placeholder="城市名"
                className="w-24 rounded-full border border-input bg-background px-2 py-0.5 text-xs" />
              {suggestions.length > 0 && <div className="absolute left-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-md border bg-popover shadow-md">
                {suggestions.map((city) => <button key={city} onMouseDown={(event) => { event.preventDefault(); void addCity(city); }} className="block w-full px-2.5 py-1 text-left text-xs hover:bg-accent">{city}</button>)}
              </div>}
            </div>
          ) : <button onClick={() => setAdding(true)} aria-label="添加城市" className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed"><Plus className="h-3 w-3" /></button>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="relative">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPicking((value) => !value)}><Pin className="h-3.5 w-3.5" /></Button>
            {picking && <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-md border bg-popover shadow-md">
              {cities.map((city) => <button key={city} onMouseDown={(event) => { event.preventDefault(); void pickCompact(city); }} className="block w-full px-2.5 py-1 text-left text-xs hover:bg-accent">{city}</button>)}
            </div>}
          </div>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void locateAndAdd()} disabled={locating}>{locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LocateFixed className="h-3.5 w-3.5" />}</Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={refreshAll}>{loadingCity ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}</Button>
        </div>
      </div>

      {candidates && <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
        <p className="mb-1 text-xs">“{candidates.city}”对应多个地点，请选择：</p>
        <div className="flex flex-wrap gap-1">
          {candidates.values.map((location) => <Button key={location.providerId} size="sm" variant="outline" className="h-7 text-xs" onClick={() => void persistResolvedCity(candidates.city, location)}>{locationLabel(location)}</Button>)}
        </div>
      </div>}
      {err && !bundle && <div className="flex flex-1 items-center justify-center text-sm text-destructive">{err}</div>}

      {bundle && now && <>
        <div className="flex items-center gap-3">
          <span className="text-4xl leading-none">{weatherEmoji(now.weatherIcon)}</span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-1"><span className="text-3xl font-semibold tabular-nums">{Math.round(now.temperature)}</span><span className="text-sm text-muted-foreground">°C</span></div>
            <div className="truncate text-xs text-muted-foreground">{now.weather} · {now.windDirection} {now.windPower} · 湿度 {Math.round(now.humidity)}%</div>
            <div className="truncate text-[10px] text-muted-foreground/80"><MapPin className="mr-1 inline h-3 w-3" />{now.district ? `${now.province} ${now.city} ${now.district}` : `${now.province} ${now.city}`} · {now.reportTime}</div>
          </div>
          <div className="ml-auto text-right text-[10px] text-muted-foreground">
            {bundle.offline ? <span className="text-yellow-500">离线</span> : bundle.partial ? <span className="text-amber-500">部分数据</span> : <span>在线</span>}
            <div>{new Date(bundle.fetchedAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        </div>

        <div className="relative">
          <div ref={forecastRef} tabIndex={0} aria-label="未来天气预报" className="flex snap-x gap-2 overflow-x-auto pb-1 outline-none"
            onWheel={(event) => {
              const element = forecastRef.current;
              if (!element || element.scrollWidth <= element.clientWidth) return;
              const delta = wheelDeltaToHorizontal(event.deltaX, event.deltaY);
              if (delta === 0) return;
              event.preventDefault();
              element.scrollLeft += delta;
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              forecastRef.current?.scrollBy({ left: event.key === "ArrowLeft" ? -140 : 140, behavior: "smooth" });
            }}>
            {displayForecast(bundle.forecast).map((day, index) => <div key={day.date} className={cn("w-28 shrink-0 snap-start rounded-lg border p-2 text-center", index === 0 && "border-primary/60 bg-primary/5")}>
              <div className="text-xs font-medium">{weatherDayLabel(day.date, bundle.timezone, todayDate)}</div>
              <div className="my-1 text-2xl">{weatherEmoji(day.weatherIcon)}</div>
              <div className="truncate text-[11px] text-muted-foreground">{day.weather}</div>
              <div className="text-xs tabular-nums">{Math.round(day.tempMax)}° / {Math.round(day.tempMin)}°</div>
              {hasPrecipitation(day) && <div className="text-[10px] text-blue-500">降雨 {Math.round(day.precipitationProbability ?? 0)}%</div>}
            </div>)}
          </div>
          <button aria-label="向左滚动预报" className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-0.5" onClick={() => forecastRef.current?.scrollBy({ left: -140, behavior: "smooth" })}><ChevronLeft className="h-3 w-3" /></button>
          <button aria-label="向右滚动预报" className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full bg-background/80 p-0.5" onClick={() => forecastRef.current?.scrollBy({ left: 140, behavior: "smooth" })}><ChevronRight className="h-3 w-3" /></button>
        </div>

        <div className="flex min-h-0 items-start justify-between gap-2 text-[10px] text-muted-foreground">
          <span>{bundle.source.attribution ?? `${bundle.source.current} / ${bundle.source.forecast}`}{bundle.source.license ? ` · ${bundle.source.license}` : ""}</span>
          {now.alerts.length > 0 && <details className="max-h-16 overflow-y-auto">
            <summary className="cursor-pointer"><AlertTriangle className="mr-1 inline h-3 w-3" />{now.alerts.length} 条预警</summary>
            {now.alerts.map((alert, index) => <p key={index} className={cn("mt-1", levelColor(alert.level))}>{alert.title}：{alert.text}</p>)}
          </details>}
        </div>
      </>}
    </div>
  );
}
