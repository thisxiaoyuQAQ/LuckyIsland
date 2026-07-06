import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StockRow, type Quote } from "./StockRow";

interface SearchResult {
  name: string;
  symbol: string;
  market: string;
}

function colorFor(change: number): string {
  if (change > 0) return "text-red-500";
  if (change < 0) return "text-green-500";
  return "text-muted-foreground";
}

export function StockPage({ compact }: { compact: boolean }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [hl, setHl] = useState(0);
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

  // 输入防抖搜索
  useEffect(() => {
    const q = input.trim();
    if (!q) {
      setSuggestions([]);
      setShowSug(false);
      return;
    }
    const t = setTimeout(() => {
      void invoke<SearchResult[]>("stock_search", { query: q })
        .then((r) => {
          setSuggestions(r);
          setShowSug(true);
          setHl(0);
        })
        .catch(() => {
          setSuggestions([]);
          setShowSug(false);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [input]);

  const addBySymbol = useCallback(
    async (sym: string) => {
      try {
        setErr(null);
        await invoke("stock_watchlist_add", { symbol: sym });
        setInput("");
        setSuggestions([]);
        setShowSug(false);
        await refresh();
      } catch (e) {
        setErr(String(e));
      }
    },
    [refresh],
  );

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && showSug && suggestions.length) {
      e.preventDefault();
      setHl((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp" && showSug && suggestions.length) {
      e.preventDefault();
      setHl((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      setShowSug(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = suggestions[hl];
      if (showSug && picked) {
        void addBySymbol(picked.symbol);
      } else if (suggestions.length === 1) {
        void addBySymbol(suggestions[0].symbol);
      } else {
        const s = input.trim();
        if (s) void addBySymbol(s);
      }
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
      {/* 添加（typeahead） */}
      <div className="relative flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={onInputKey}
          onFocus={() => suggestions.length && setShowSug(true)}
          onBlur={() => setTimeout(() => setShowSug(false), 120)}
          placeholder="搜索名称/代码/拼音，如 茅台 / 600519 / maotai"
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <Button
          size="sm"
          onClick={() => {
            const picked = suggestions[hl];
            if (showSug && picked) void addBySymbol(picked.symbol);
            else if (input.trim()) void addBySymbol(input.trim());
          }}
          aria-label="添加"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>

        {showSug && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {suggestions.map((s, i) => (
              <button
                key={s.symbol}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void addBySymbol(s.symbol);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent",
                  i === hl && "bg-accent",
                )}
              >
                <span className="w-6 shrink-0 text-[10px] text-muted-foreground">{s.market}</span>
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[10px] text-muted-foreground">{s.symbol}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {err && <div className="text-[11px] text-destructive">{err}</div>}

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
