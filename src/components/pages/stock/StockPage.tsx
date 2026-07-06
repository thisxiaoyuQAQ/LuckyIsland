import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StockRow, type Quote } from "./StockRow";

function colorFor(change: number): string {
  if (change > 0) return "text-red-500";
  if (change < 0) return "text-green-500";
  return "text-muted-foreground";
}

export function StockPage({ compact }: { compact: boolean }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const qs = await invoke<Quote[]>("stock_get");
      setQuotes(qs);
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

  const add = async () => {
    const s = input.trim();
    if (!s) return;
    try {
      setErr(null);
      await invoke("stock_watchlist_add", { symbol: s });
      setInput("");
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  };

  const remove = async (symbol: string) => {
    try {
      await invoke("stock_watchlist_remove", { symbol });
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  };

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

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="添加代码，如 sh600519 / usAAPL"
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" onClick={() => void add()} aria-label="添加">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {err && (
        <div className="text-[11px] text-destructive">{err}</div>
      )}

      <div className="flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {quotes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无自选股
          </div>
        ) : (
          <ul className="space-y-1">
            {quotes.map((q) => (
              <StockRow key={q.symbol} q={q} onRemove={(s) => void remove(s)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
