import type { FC } from "react";
import { TimePage } from "@/components/pages/time/TimePage";
import { CalendarPage } from "@/components/pages/calendar/CalendarPage";
import { WeatherPage } from "@/components/pages/weather/WeatherPage";
import { StockPage } from "@/components/pages/stock/StockPage";
import { TodoPage } from "@/components/pages/todo/TodoPage";
import { TerminalPage } from "@/components/pages/terminal/TerminalPage";
import { NotifyPage } from "@/components/pages/notify/NotifyPage";
import type { PageId } from "@/lib/settings";

export interface PageMeta {
  id: PageId;
  label: string;
  Component: FC<{ compact: boolean }>;
}

export const ALL_PAGES: PageMeta[] = [
  { id: "time", label: "时间", Component: TimePage },
  { id: "calendar", label: "日历", Component: CalendarPage },
  { id: "weather", label: "天气", Component: WeatherPage },
  { id: "stock", label: "股票", Component: StockPage },
  { id: "todo", label: "待办", Component: TodoPage },
  { id: "notify", label: "通知", Component: NotifyPage },
  { id: "terminal", label: "终端", Component: TerminalPage },
];

export const PAGE_BY_ID = Object.fromEntries(
  ALL_PAGES.map((p) => [p.id, p]),
) as Record<PageId, PageMeta>;
