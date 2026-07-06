import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DayInfo {
  day: number;
  lunar: string;
  is_today: boolean;
}
interface MonthData {
  year: number;
  month: number;
  first_weekday: number;
  days: DayInfo[];
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const MONTH_NAMES = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

function todayYm() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export function CalendarPage({ compact }: { compact: boolean }) {
  const t = todayYm();
  const [year, setYear] = useState(t.year);
  const [month, setMonth] = useState(t.month);
  const [data, setData] = useState<MonthData | null>(null);

  useEffect(() => {
    void invoke<MonthData>("calendar_month", { year, month }).then(setData);
  }, [year, month]);

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };
  const nextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  if (compact) {
    const todayInfo = data?.days.find((d) => d.is_today);
    return (
      <span className="text-sm tabular-nums text-muted-foreground">
        {t.month}/{t.day}
        {todayInfo ? ` · ${todayInfo.lunar}` : ""}
      </span>
    );
  }

  const cells: (DayInfo | null)[] = [];
  for (let i = 0; i < (data?.first_weekday ?? 0); i++) cells.push(null);
  for (const d of data?.days ?? []) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={prevMonth}
          aria-label="上个月"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-sm font-medium">
          {year}年 {MONTH_NAMES[month - 1]}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={nextMonth}
          aria-label="下个月"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-7 gap-px overflow-y-auto [scrollbar-gutter:stable]">
        {cells.map((c, i) => (
          <div
            key={i}
            className={cn(
              "flex flex-col items-center justify-center rounded-md py-1 text-xs",
              !c && "pointer-events-none opacity-0",
              c?.is_today
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            {c && (
              <>
                <span className="tabular-nums">{c.day}</span>
                <span className="text-[9px] opacity-70">{c.lunar}</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
