import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StockChart } from "./StockChart";
import type { Quote } from "./StockRow";

type Period = "day" | "week" | "month";
const PERIODS: ReadonlyArray<[Period, string]> = [
  ["day", "日K"],
  ["week", "周K"],
  ["month", "月K"],
];

/** 0 显示 --，否则保留 digits 位 */
function fmt(n: number, digits = 2, unit = ""): string {
  if (!n) return "--";
  return `${n.toFixed(digits)}${unit}`;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("text-xs tabular-nums", color)}>{value}</span>
    </div>
  );
}

export function StockDetail({ quote, onBack }: { quote: Quote; onBack: () => void }) {
  const [period, setPeriod] = useState<Period>("day");
  const up = quote.change > 0;
  const down = quote.change < 0;
  const color = up ? "text-red-500" : down ? "text-green-500" : "text-muted-foreground";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 顶部：返回 + 名称 + 价 + 涨跌 */}
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onBack} aria-label="返回列表">
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-sm font-medium">{quote.name}</span>
        <span className="text-[10px] uppercase text-muted-foreground">{quote.symbol}</span>
        <span className={cn("ml-auto text-base font-semibold tabular-nums", color)}>
          {quote.current.toFixed(2)}
        </span>
        <span className={cn("text-xs tabular-nums", color)}>
          {quote.change >= 0 ? "+" : ""}
          {quote.change.toFixed(2)} ({quote.change >= 0 ? "+" : ""}
          {quote.change_percent.toFixed(2)}%)
        </span>
      </div>

      {/* 数据面板（右上） */}
      <div className="grid shrink-0 grid-cols-4 gap-x-3 gap-y-1.5 rounded-md border border-border/60 bg-background/40 px-3 py-2">
        <Stat label="昨收" value={fmt(quote.yesterday_close)} />
        <Stat label="今开" value={fmt(quote.open)} />
        <Stat label="最高" value={fmt(quote.high)} color="text-red-500" />
        <Stat label="最低" value={fmt(quote.low)} color="text-green-500" />
        <Stat label="换手率" value={fmt(quote.turnover_rate, 2, "%")} />
        <Stat label="量比" value={fmt(quote.volume_ratio)} />
        <Stat label="振幅" value={fmt(quote.amplitude, 2, "%")} />
        <Stat label="市盈率" value={fmt(quote.pe)} />
        <Stat label="市净率" value={fmt(quote.pb)} />
        <Stat label="总市值" value={fmt(quote.total_market_cap, 0, "亿")} />
        <Stat label="流通" value={fmt(quote.circ_market_cap, 0, "亿")} />
        <Stat label="成交额" value={fmt(quote.amount, 0, "万")} />
        <Stat label="涨停" value={fmt(quote.limit_up)} color="text-red-500" />
        <Stat label="跌停" value={fmt(quote.limit_down)} color="text-green-500" />
        <Stat label="成交量" value={fmt(quote.volume, 0, "手")} />
      </div>

      {/* 周期切换 */}
      <div className="flex shrink-0 items-center gap-1">
        {PERIODS.map(([p, label]) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] transition-colors",
              period === p
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* K 图（右下） */}
      <div className="min-h-0 flex-1">
        <StockChart key={`${quote.symbol}-${period}`} symbol={quote.symbol} period={period} />
      </div>
    </div>
  );
}
