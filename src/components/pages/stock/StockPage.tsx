import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { StockAdd } from "./StockAdd";
import { StockRow, type Quote } from "./StockRow";
import { StockDetail } from "./StockDetail";

function colorFor(change: number): string {
  if (change > 0) return "text-red-500";
  if (change < 0) return "text-green-500";
  return "text-muted-foreground";
}

export function StockPage({ compact }: { compact: boolean }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setQuotes(await invoke<Quote[]>("stock_get"));
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    let un: (() => void) | undefined;
    listen<Quote[]>("stock://tick", (e) => setQuotes(e.payload)).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, [refresh]);

  const remove = async (symbol: string) => {
    try {
      await invoke("stock_watchlist_remove", { symbol });
      if (selected === symbol) setSelected(null);
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  };

  const selectedQuote = quotes.find((q) => q.symbol === selected) ?? null;

  if (compact) {
    if (quotes.length === 0) {
      return <span className="text-sm text-muted-foreground">无自选</span>;
    }
    const q = quotes[0];
    const color = colorFor(q.change);
    return (
      <span className="flex items-center gap-1.5 text-sm tabular-nums">
        <span className="text-muted-foreground">{q.name}</span>
        <span className={cn("font-medium", color)}>{q.current.toFixed(2)}</span>
        <span className={cn("text-[11px]", color)}>
          {q.change >= 0 ? "+" : ""}
          {q.change_percent.toFixed(2)}%
        </span>
        {quotes.length > 1 && (
          <span className="text-[10px] text-muted-foreground/70">+{quotes.length - 1}</span>
        )}
      </span>
    );
  }

  // 选中个股：左列表 + 右详情（上数据 / 下K图）
  if (selected && selectedQuote) {
    return (
      <div className="flex h-full gap-3">
        <div className="flex w-[200px] shrink-0 flex-col gap-2 border-r border-border/60 pr-2">
          <StockAdd onAdded={refresh} />
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            {quotes.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                暂无自选
              </div>
            ) : (
              <ul className="space-y-1">
                {quotes.map((q) => (
                  <StockRow
                    key={q.symbol}
                    q={q}
                    active={q.symbol === selected}
                    onClick={(s) => setSelected(s)}
                    onRemove={(s) => void remove(s)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <StockDetail quote={selectedQuote} onBack={() => setSelected(null)} />
        </div>
      </div>
    );
  }

  // 未选：全宽列表
  return (
    <div className="flex h-full flex-col gap-3">
      <StockAdd onAdded={refresh} />
      {err && <div className="text-[11px] text-destructive">{err}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {quotes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无自选股
          </div>
        ) : (
          <ul className="space-y-1">
            {quotes.map((q) => (
              <StockRow
                key={q.symbol}
                q={q}
                onClick={(s) => setSelected(s)}
                onRemove={(s) => void remove(s)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
