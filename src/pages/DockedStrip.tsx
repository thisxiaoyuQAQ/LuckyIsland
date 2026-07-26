import { useEffect, useState } from "react";
import { ClockBlock } from "@/components/pages/time/ClockBlock";
import { WeatherPage } from "@/components/pages/weather/WeatherPage";
import { TodoPage } from "@/components/pages/todo/TodoPage";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 贴顶新 UI 的日期短标签：本地计算，30s 刷新一次即可跟上跨天。 */
function DateLabel() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
      {now.getMonth() + 1}月{now.getDate()}日 周{WEEKDAYS[now.getDay()]}
    </span>
  );
}

/** 组件间竖线分隔。 */
function Divider() {
  return <span className="h-4 w-px shrink-0 bg-border/60" aria-hidden />;
}

/**
 * 贴顶新 UI（classisland）紧凑态的并排信息条：时间 · 日期 · 天气 · 待办数（模块 13 C）。
 *
 * 复用各页 compact 自包含渲染（ClockBlock / WeatherPage / TodoPage 各自拉取并刷新数据），
 * 不新增数据路径。仅在紧凑（非胶囊、非展开）态挂载，避免与展开态整页重复拉取。
 */
export function DockedStrip() {
  return (
    <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
      <ClockBlock compact />
      <Divider />
      <DateLabel />
      <Divider />
      <WeatherPage compact />
      <Divider />
      <TodoPage compact />
    </div>
  );
}
