export type Region =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right";

export type WidgetId = "saying" | "programmer_history" | "fortune" | "wooden_fish" | "mood";

export const WIDGET_IDS: WidgetId[] = ["saying", "programmer_history", "fortune", "wooden_fish", "mood"];

export const REGIONS: Region[] = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
];

export const REGION_LABELS: Record<Region, string> = {
  "top-left": "左上", top: "上方", "top-right": "右上",
  left: "左侧", center: "中央", right: "右侧",
  "bottom-left": "左下", bottom: "下方", "bottom-right": "右下",
};

export const DEFAULT_REGIONS: Record<WidgetId, Region> = {
  saying: "top",
  programmer_history: "bottom",
  fortune: "left",
  wooden_fish: "right",
  mood: "bottom-left",
};

export interface WidgetPlacement {
  id: WidgetId;
  enabled: boolean;
  region: Region;
  order: number;
}

export interface TimeLayout {
  version: number;
  clockRegion: Region;
  widgets: WidgetPlacement[];
}

export const DEFAULT_LAYOUT: TimeLayout = {
  version: 1,
  clockRegion: "center",
  widgets: WIDGET_IDS.map((id) => ({ id, enabled: true, region: DEFAULT_REGIONS[id], order: 0 })),
};

function isWidgetId(v: unknown): v is WidgetId {
  return typeof v === "string" && (WIDGET_IDS as string[]).includes(v);
}

function isRegion(v: unknown): v is Region {
  return typeof v === "string" && (REGIONS as string[]).includes(v);
}

function reindex(layout: TimeLayout): TimeLayout {
  const byRegion: Partial<Record<Region, WidgetPlacement[]>> = {};
  for (const w of layout.widgets) (byRegion[w.region] ??= []).push(w);
  const widgets: WidgetPlacement[] = [];
  for (const region of REGIONS) {
    const list = (byRegion[region] ?? []).sort((a, b) => a.order - b.order);
    list.forEach((w, i) => widgets.push({ ...w, order: i }));
  }
  return { ...layout, widgets };
}

export function parseLayout(v: string | null): TimeLayout {
  if (!v) return DEFAULT_LAYOUT;
  try {
    const parsed = JSON.parse(v) as Partial<TimeLayout>;
    const widgets: WidgetPlacement[] = [];
    const seen = new Set<WidgetId>();
    if (Array.isArray(parsed.widgets)) {
      for (const w of parsed.widgets) {
        if (w && isWidgetId(w.id) && !seen.has(w.id)) {
          seen.add(w.id);
          widgets.push({
            id: w.id,
            enabled: typeof w.enabled === "boolean" ? w.enabled : true,
            region: isRegion(w.region) ? w.region : DEFAULT_REGIONS[w.id],
            order: typeof w.order === "number" ? w.order : 0,
          });
        }
      }
    }
    for (const id of WIDGET_IDS) {
      if (!seen.has(id)) widgets.push({ id, enabled: true, region: DEFAULT_REGIONS[id], order: 0 });
    }
    const clockRegion: Region = isRegion(parsed.clockRegion) ? parsed.clockRegion : "center";
    let layout: TimeLayout = { version: 1, clockRegion, widgets };
    // 修复：落在时钟区域的组件回到默认区域
    layout = {
      ...layout,
      widgets: layout.widgets.map((w) =>
        w.region === layout.clockRegion ? { ...w, region: DEFAULT_REGIONS[w.id] } : w,
      ),
    };
    return reindex(layout);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function moveClock(layout: TimeLayout, target: Region): TimeLayout {
  if (!isRegion(target) || target === layout.clockRegion) return layout;
  const old = layout.clockRegion;
  const widgets = layout.widgets.map((w) => (w.region === target ? { ...w, region: old } : w));
  return reindex({ ...layout, clockRegion: target, widgets });
}

export function setWidgetRegion(layout: TimeLayout, id: WidgetId, region: Region): TimeLayout {
  if (!isRegion(region) || region === layout.clockRegion) return layout;
  const widgets = layout.widgets.map((w) => (w.id === id ? { ...w, region } : w));
  return reindex({ ...layout, widgets });
}

export function reorderWidgets(layout: TimeLayout, orderedIds: WidgetId[]): TimeLayout {
  const widgets = layout.widgets.map((w) => ({ ...w }));
  for (const region of REGIONS) {
    let i = 0;
    for (const id of orderedIds) {
      const w = widgets.find((x) => x.id === id && x.region === region);
      if (w) w.order = i++;
    }
  }
  return { ...layout, widgets };
}

export function widgetsByRegion(layout: TimeLayout): Record<Region, WidgetPlacement[]> {
  const out = {} as Record<Region, WidgetPlacement[]>;
  for (const r of REGIONS) out[r] = [];
  for (const w of layout.widgets) {
    if (w.enabled && w.region !== layout.clockRegion) out[w.region].push(w);
  }
  for (const r of REGIONS) out[r].sort((a, b) => a.order - b.order);
  return out;
}
