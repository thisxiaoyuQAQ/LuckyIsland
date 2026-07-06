import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Quote {
  symbol: string;
  name: string;
  code: string;
  current: number;
  yesterday_close: number;
  open: number;
  high: number;
  low: number;
  change: number;
  change_percent: number;
  time: string;
}

function colorFor(change: number): string {
  if (change > 0) return "text-red-500";
  if (change < 0) return "text-green-500";
  return "text-muted-foreground";
}

function signed(n: number, digits = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function hhmm(time: string): string {
  // YYYYMMDDHHMMSS → HH:MM
  return time.length >= 12 ? `${time.slice(8, 10)}:${time.slice(10, 12)}` : "";
}

export function StockRow({
  q,
  onRemove,
}: {
  q: Quote;
  onRemove?: (symbol: string) => void;
}) {
  const color = colorFor(q.change);
  return (
    <li className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{q.name}</span>
          <span className="text-[10px] uppercase text-muted-foreground">{q.symbol}</span>
        </div>
        <div className="text-[10px] text-muted-foreground/80">
          高 {q.high.toFixed(2)} · 低 {q.low.toFixed(2)} · {hhmm(q.time)}
        </div>
      </div>
      <div className="text-right tabular-nums">
        <div className={cn("text-sm font-semibold", color)}>{q.current.toFixed(2)}</div>
        <div className={cn("text-[11px]", color)}>
          {signed(q.change)} {signed(q.change_percent)}%
        </div>
      </div>
      {onRemove && (
        <button
          onClick={() => onRemove(q.symbol)}
          aria-label="删除"
          className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
