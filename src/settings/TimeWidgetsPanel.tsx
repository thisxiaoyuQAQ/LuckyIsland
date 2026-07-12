import { useReorder } from "@/lib/useReorder";
import { useTimeSetting } from "@/components/pages/time/useTimeConfig";
import { KEYS, timeWidgetKey } from "@/lib/settings";
import {
  parseLayout,
  setWidgetRegion,
  reorderWidgets,
  DEFAULT_LAYOUT,
  REGIONS,
  REGION_LABELS,
  type WidgetId,
  type Region,
  type TimeLayout,
} from "@/components/pages/time/layout";
import {
  parseSayingConfig,
  parseHistoryConfig,
  parseFortuneConfig,
  parseWoodenFishConfig,
  parseMoodConfig,
  DEFAULT_SAYING,
  DEFAULT_HISTORY,
  DEFAULT_FORTUNE,
  DEFAULT_WOODEN_FISH,
  DEFAULT_MOOD,
} from "@/components/pages/time/widgetConfig";
import { Row, selectCls } from "./shared";
import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";

const LABELS: Record<WidgetId, string> = {
  saying: "一言",
  programmer_history: "程序员历史上的今天",
  fortune: "今日运势",
  wooden_fish: "电子木鱼",
  mood: "今日心情",
};

function WidgetRow({
  id,
  layout,
  onRegion,
  onToggle,
  children,
}: {
  id: WidgetId;
  layout: TimeLayout;
  onRegion: (r: Region) => void;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  const w = layout.widgets.find((x) => x.id === id)!;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden />
        <span className="flex-1 text-sm font-medium">{LABELS[id]}</span>
        <input type="checkbox" checked={w.enabled} onChange={(e) => onToggle(e.target.checked)} aria-label={`启用${LABELS[id]}`} />
      </div>
      <Row label="区域" desc="组件不能与时钟同区">
        <select
          value={w.region}
          onChange={(e) => onRegion(e.target.value as Region)}
          className={selectCls}
        >
          {REGIONS.map((r) => (
            <option key={r} value={r} disabled={r === layout.clockRegion}>
              {REGION_LABELS[r]}
              {r === layout.clockRegion ? "（时钟）" : ""}
            </option>
          ))}
        </select>
      </Row>
      {w.enabled && children}
    </div>
  );
}

function useWidgetConfig<T>(id: WidgetId, parse: (v: string | null) => T, fallback: T) {
  return useTimeSetting(timeWidgetKey(id), parse, fallback);
}

export function TimeWidgetsPanel() {
  const { value: layout, set: setLayout } = useTimeSetting(KEYS.timeLayout, parseLayout, DEFAULT_LAYOUT);

  const ordered: WidgetId[] = [...layout.widgets]
    .sort((a, b) =>
      a.region === b.region
        ? a.order - b.order
        : REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region),
    )
    .map((w) => w.id);

  const { overIndex, itemProps } = useReorder<WidgetId>((next) => setLayout(reorderWidgets(layout, next)));

  const saying = useWidgetConfig("saying", parseSayingConfig, DEFAULT_SAYING);
  const history = useWidgetConfig("programmer_history", parseHistoryConfig, DEFAULT_HISTORY);
  const fortune = useWidgetConfig("fortune", parseFortuneConfig, DEFAULT_FORTUNE);
  const wooden = useWidgetConfig("wooden_fish", parseWoodenFishConfig, DEFAULT_WOODEN_FISH);
  const mood = useWidgetConfig("mood", parseMoodConfig, DEFAULT_MOOD);

  const toggle = (id: WidgetId, enabled: boolean) => {
    const widgets = layout.widgets.map((w) => (w.id === id ? { ...w, enabled } : w));
    setLayout({ ...layout, widgets });
  };

  const rowFor = (id: WidgetId, idx: number) => {
    const props = itemProps(idx, ordered);
    return (
      <div
        key={id}
        {...props}
        className={cn("transition-colors", overIndex === idx && "rounded-lg ring-2 ring-primary/60")}
      >
        <WidgetRow
          id={id}
          layout={layout}
          onRegion={(r) => setLayout(setWidgetRegion(layout, id, r))}
          onToggle={(enabled) => toggle(id, enabled)}
        >
          {id === "saying" && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={saying.value.refreshOnEnter}
                  onChange={(e) => saying.set({ ...saying.value, refreshOnEnter: e.target.checked })}
                />
                进入页面时刷新
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={saying.value.clickToRefresh}
                  onChange={(e) => saying.set({ ...saying.value, clickToRefresh: e.target.checked })}
                />
                点击换一句
              </label>
            </div>
          )}
          {id === "programmer_history" && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={history.value.showCategory}
                  onChange={(e) => history.set({ ...history.value, showCategory: e.target.checked })}
                />
                显示分类
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={history.value.autoRotate}
                  onChange={(e) => history.set({ ...history.value, autoRotate: e.target.checked })}
                />
                自动轮换事件
              </label>
            </div>
          )}
          {id === "fortune" && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={fortune.value.animation}
                onChange={(e) => fortune.set({ ...fortune.value, animation: e.target.checked })}
              />
              抽取动画
            </label>
          )}
          {id === "wooden_fish" && (
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={wooden.value.sound}
                  onChange={(e) => wooden.set({ ...wooden.value, sound: e.target.checked })}
                />
                音效
              </label>
              <label className="flex items-center gap-1">
                音量
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={wooden.value.volume}
                  onChange={(e) => wooden.set({ ...wooden.value, volume: Number(e.target.value) })}
                />
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={wooden.value.animation}
                  onChange={(e) => wooden.set({ ...wooden.value, animation: e.target.checked })}
                />
                动画
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={wooden.value.crazyThursday}
                  onChange={(e) => wooden.set({ ...wooden.value, crazyThursday: e.target.checked })}
                />
                疯狂星期四文案
              </label>
            </div>
          )}
          {id === "mood" && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={mood.value.showStreak}
                onChange={(e) => mood.set({ ...mood.value, showStreak: e.target.checked })}
              />
              显示连续天数
            </label>
          )}
        </WidgetRow>
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">时间组件</h2>
        <p className="text-sm text-muted-foreground">启用/关闭、放置区域与排序；同一区域可拖拽排序。</p>
      </div>
      <div className="flex flex-col gap-2">{ordered.map((id, i) => rowFor(id, i))}</div>
    </section>
  );
}
