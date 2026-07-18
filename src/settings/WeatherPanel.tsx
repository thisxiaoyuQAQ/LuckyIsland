import { useCallback, useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Row, selectCls } from "./shared";
import { cn } from "@/lib/utils";
import { useReorder } from "@/lib/useReorder";
import { CITIES } from "@/components/pages/weather/cities";
import { invoke } from "@tauri-apps/api/core";
import { KEYS, parseRefreshMin, settingGet } from "@/lib/settings";
import {
  parseWeatherCommandError,
  type WeatherLocation,
} from "@/components/pages/weather/model";
import { useDraftField } from "./useDraftField";

/** 天气页配置：刷新间隔 + 城市管理（F9.8，与天气页同步） */
export function WeatherPanel() {
  const [initialMin, setInitialMin] = useState<number | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ city: string; values: WeatherLocation[] } | null>(null);

  const refreshCities = useCallback(async () => {
    try {
      setCities(await invoke<string[]>("weather_cities_list"));
    } catch {
      /* ignore */
    }
  }, []);

  const persistOrder = useCallback(async (next: string[]) => {
    setCities(next);
    try {
      await invoke("weather_cities_reorder", { cities: next });
    } catch {
      /* ignore */
    }
  }, []);

  const { overIndex, itemProps } = useReorder<string>(persistOrder);

  const suggestions = useMemo(() => {
    const q = draft.trim();
    if (!q) return []; // 空输入不弹建议
    return CITIES.filter((c) => c.includes(q))
      .filter((c) => !cities.includes(c))
      .slice(0, 12);
  }, [draft, cities]);

  useEffect(() => {
    (async () => {
      const m = await settingGet(KEYS.weatherRefreshMin);
      setInitialMin(parseRefreshMin(m));
      await refreshCities();
    })();
  }, [refreshCities]);

  const persistResolvedCity = async (city: string, location: WeatherLocation) => {
    await invoke("weather_get", { city, location });
    await invoke("weather_cities_add", { city });
    setDraft("");
    setCandidates(null);
    await refreshCities();
  };

  const addCity = async (c: string) => {
    const city = c.trim();
    if (!city) return;
    setError(null);
    try {
      const locations = await invoke<WeatherLocation[]>("weather_location_search", { query: city });
      if (locations.length === 0) {
        setError(`未找到城市：${city}`);
      } else if (locations.length === 1) {
        await persistResolvedCity(city, locations[0]);
      } else {
        setCandidates({ city, values: locations });
      }
    } catch (reason) {
      setError(parseWeatherCommandError(reason)?.message ?? String(reason));
    }
  };

  const removeCity = async (c: string) => {
    await invoke("weather_cities_remove", { city: c });
    await refreshCities();
  };

  if (initialMin === null) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <WeatherPanelContent
      initialMin={initialMin}
      cities={cities}
      draft={draft}
      error={error}
      candidates={candidates}
      suggestions={suggestions}
      overIndex={overIndex}
      itemProps={itemProps}
      onDraftChange={setDraft}
      onAddCity={(c) => void addCity(c)}
      onRemoveCity={(c) => void removeCity(c)}
      onPickCandidate={(city, location) => void persistResolvedCity(city, location)}
    />
  );
}

interface WeatherPanelContentProps {
  initialMin: number;
  cities: string[];
  draft: string;
  error: string | null;
  candidates: { city: string; values: WeatherLocation[] } | null;
  suggestions: string[];
  overIndex: number | null;
  itemProps: (index: number, list: string[]) => Record<string, unknown>;
  onDraftChange: (next: string) => void;
  onAddCity: (city: string) => void;
  onRemoveCity: (city: string) => void;
  onPickCandidate: (city: string, location: WeatherLocation) => void;
}

function WeatherPanelContent(props: WeatherPanelContentProps) {
  const {
    initialMin,
    cities,
    draft,
    error,
    candidates,
    suggestions,
    overIndex,
    itemProps,
    onDraftChange,
    onAddCity,
    onRemoveCity,
    onPickCandidate,
  } = props;

  const refreshMinField = useDraftField<number>({
    parse: (raw) => parseRefreshMin(raw),
    serialize: (value) => (Number.isFinite(value) && value >= 1 && value <= 1440 ? String(value) : null),
    initial: String(initialMin),
    settingKey: KEYS.weatherRefreshMin,
    debounceMs: 400,
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">天气</h2>
        <p className="text-sm text-muted-foreground">
          刷新间隔影响后台轮询；城市与天气页同步（切回天气页生效）。
        </p>
      </div>
      <Row label="自动刷新间隔" desc="单位分钟（1~1440）">
        <div className="flex flex-col items-end gap-1">
          <input
            type="number"
            min={1}
            max={1440}
            value={refreshMinField.draft}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) refreshMinField.setDraft(n);
            }}
            onBlur={refreshMinField.commit}
            className={selectCls + " w-20"}
          />
          {refreshMinField.saveError && (
            <p className="text-xs text-destructive">保存刷新间隔失败：{refreshMinField.saveError}</p>
          )}
        </div>
      </Row>

      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">城市</div>
        <div className="text-xs text-muted-foreground">添加 / 删除城市，与天气页同步。</div>
      </div>
      <div className="relative">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (suggestions.length > 0) onAddCity(suggestions[0]);
                else if (draft.trim()) onAddCity(draft);
              }
            }}
            placeholder="城市名"
            className={selectCls + " flex-1"}
          />
          <Button
            size="sm"
            onClick={() => {
              if (suggestions.length > 0) onAddCity(suggestions[0]);
              else if (draft.trim()) onAddCity(draft);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {suggestions.length > 0 && (
          <div className="absolute left-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {suggestions.map((c) => (
              <button
                key={c}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onAddCity(c);
                }}
                className="block w-full px-2.5 py-1 text-left text-xs hover:bg-accent"
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {candidates && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          <p className="mb-1 text-xs">“{candidates.city}”对应多个地点，请选择：</p>
          <div className="flex flex-wrap gap-1">
            {candidates.values.map((location) => (
              <Button
                key={location.providerId}
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => onPickCandidate(candidates.city, location)}
              >
                {[location.displayName, location.province, location.country].filter(Boolean).join(" / ")}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {cities.map((c, i) => (
          <div
            key={c}
            {...itemProps(i, cities)}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 transition-colors",
              overIndex === i && "border-primary/70 bg-primary/5",
            )}
          >
            <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm">{c}</span>
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
            >
              <button
                onClick={() => onRemoveCity(c)}
                aria-label="删除"
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {cities.length === 0 && <p className="text-xs text-muted-foreground">暂无城市</p>}
      </div>
    </section>
  );
}
