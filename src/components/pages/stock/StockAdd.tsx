import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { assertIpc, isStockSearchResultList } from "@/lib/ipc-schemas";

interface SearchResult {
  name: string;
  symbol: string;
  market: string;
}

export function StockAdd({ onAdded }: { onAdded: () => void }) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [hl, setHl] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = input.trim();
    if (!q) {
      setSuggestions([]);
      setShowSug(false);
      return;
    }
    const t = setTimeout(() => {
      void invoke<unknown>("stock_search", { query: q })
        .then((raw) => {
          setSuggestions(assertIpc("stock_search", raw, isStockSearchResultList));
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
        onAdded();
      } catch (e) {
        setErr(String(e));
      }
    },
    [onAdded],
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

  return (
    <div className="flex flex-col gap-1">
      <div className="relative flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={onInputKey}
          onFocus={() => suggestions.length && setShowSug(true)}
          onBlur={() => setTimeout(() => setShowSug(false), 120)}
          placeholder="搜索名称/代码/拼音"
          className="flex-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
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
                <span className="w-5 shrink-0 text-[10px] text-muted-foreground">{s.market}</span>
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[10px] text-muted-foreground">{s.symbol}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {err && <div className="text-[10px] text-destructive">{err}</div>}
    </div>
  );
}
