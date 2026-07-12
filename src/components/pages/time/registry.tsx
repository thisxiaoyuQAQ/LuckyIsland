import type { WidgetId } from "./layout";
import { SayingWidget } from "./widgets/SayingWidget";
import { HistoryWidget } from "./widgets/HistoryWidget";
import { FortuneWidget } from "./widgets/FortuneWidget";
import { WoodenFishWidget } from "./widgets/WoodenFishWidget";
import { MoodWidget } from "./widgets/MoodWidget";

export interface WidgetProps {}

export interface WidgetMeta {
  id: WidgetId;
  label: string;
  Component: React.FC<WidgetProps>;
}

export const WIDGETS: Record<WidgetId, WidgetMeta> = {
  saying: { id: "saying", label: "一言", Component: SayingWidget },
  programmer_history: {
    id: "programmer_history",
    label: "程序员历史上的今天",
    Component: HistoryWidget,
  },
  fortune: { id: "fortune", label: "今日运势", Component: FortuneWidget },
  wooden_fish: { id: "wooden_fish", label: "电子木鱼", Component: WoodenFishWidget },
  mood: { id: "mood", label: "今日心情", Component: MoodWidget },
};
