import type { WidgetId } from "./layout";

export interface WidgetProps {}

const Stub: React.FC<{ label: string }> = ({ label }) => (
  <div className="rounded-md border border-dashed border-border/60 p-2 text-xs text-muted-foreground">
    {label}（占位）
  </div>
);

export interface WidgetMeta {
  id: WidgetId;
  label: string;
  Component: React.FC<WidgetProps>;
}

export const WIDGETS: Record<WidgetId, WidgetMeta> = {
  saying: { id: "saying", label: "一言", Component: () => <Stub label="一言" /> },
  programmer_history: {
    id: "programmer_history",
    label: "程序员历史上的今天",
    Component: () => <Stub label="程序员历史上的今天" />,
  },
  fortune: { id: "fortune", label: "今日运势", Component: () => <Stub label="今日运势" /> },
  wooden_fish: { id: "wooden_fish", label: "电子木鱼", Component: () => <Stub label="电子木鱼" /> },
  mood: { id: "mood", label: "今日心情", Component: () => <Stub label="今日心情" /> },
};
