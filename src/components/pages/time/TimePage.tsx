import { useEffect, useState } from "react";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

export function TimePage({ compact }: { compact: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  if (compact) {
    return (
      <span className="text-sm font-medium tabular-nums">
        {hh}:{mm}
        <span className="text-muted-foreground">:{ss}</span>
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="text-6xl font-semibold tabular-nums">
        {hh}:{mm}
        <span className="text-3xl text-muted-foreground">:{ss}</span>
      </div>
      <div className="text-sm text-muted-foreground">
        {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日 · {WEEKDAYS[now.getDay()]}
      </div>
    </div>
  );
}
