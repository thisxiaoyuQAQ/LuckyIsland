import { useState } from "react";

export function CalendarPage({ compact }: { compact: boolean }) {
  const [now] = useState(() => new Date());

  if (compact) {
    return (
      <span className="text-sm tabular-nums text-muted-foreground">
        {now.getMonth() + 1}/{now.getDate()}
      </span>
    );
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      日历页 · M2 块3 接入月视图 + 农历 + 节气
    </div>
  );
}
