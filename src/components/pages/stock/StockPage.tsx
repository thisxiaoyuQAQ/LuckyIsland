import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";
import { useReorder } from "@/lib/useReorder";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { KEYS, onSettingsChanged, parseBool, settingGet } from "@/lib/settings";
import { assertIpc, isQuoteList } from "@/lib/ipc-schemas";
import { StockAdd } from "./StockAdd";
import { StockRow, colorFor, type Quote } from "./StockRow";
import { StockDetail } from "./StockDetail";

const COMPACT_KEY = "stock:compact_symbol";

export function StockPage({ compact }: { compact: boolean }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [compactSymbol, setCompactSymbol] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [redUp, setRedUp] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<unknown>("stock_get");
      setQuotes(assertIpc("stock_get", raw, isQuoteList) as Quote[]);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    void invoke<string | null>("setting_get", { key: COMPACT_KEY }).then((s) => {
      if (s) setCompactSymbol(s);
    });
  }, [refresh]);

  useTauriEvent<Quote[]>("stock://tick", (e) => {
    try {
      setQuotes(assertIpc("stock://tick", e.payload, isQuoteList) as Quote[]);
    } catch (error) {
      console.error(error);
    }
  });

  // 07a 配置导入会全量覆盖自选股表；导入完成后立即重读，避免当前页面保留旧列表。
  useTauriEvent("config://imported", () => {
    setSelected(null);
    void refresh();
  });

  // 红涨绿跌方向：读 settings + 监听即时生效
  useEffect(() => {
    void settingGet(KEYS.stockRedUp).then((v) => setRedUp(parseBool(v, true)));
  }, []);

  useAsyncSubscription(
    () =>
      onSettingsChanged((key, value) => {
        if (key === KEYS.stockRedUp) setRedUp(parseBool(value, true));
      }),
    [],
    { label: "settings://changed:stock" },
  );

  const remove = async (symbol: string) => {
    try {
      await invoke("stock_watchlist_remove", { symbol });
      if (selected === symbol) setSelected(null);
      if (compactSymbol === symbol) {
        setCompactSymbol(null);
        void invoke("setting_set", { key: COMPACT_KEY, value: null });
      }
      await refresh();
    } catch (e) {
      setErr(String(e));
    }
  };

  // 选中个股 = 进入详情 + 记为紧凑态显示
  const selectStock = (sym: string) => {
    setSelected(sym);
    if (sym !== compactSymbol) {
      setCompactSymbol(sym);
      void invoke("setting_set", { key: COMPACT_KEY, value: sym });
    }
  };

  const { overIndex, itemProps } = useReorder<Quote>((next) => {
    setQuotes(next);
    void invoke("stock_watchlist_reorder", { symbols: next.map((q) => q.symbol) });
  });

  const selectedQuote = quotes.find((q) => q.symbol === selected) ?? null;

  if (compact) {
    const q = quotes.find((x) => x.symbol === compactSymbol) ?? quotes[0];
    if (!q) return <span className="text-sm text-muted-foreground">无自选</span>;
    const color = colorFor(q.change, redUp);
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
        <div className="flex w-[220px] shrink-0 flex-col gap-2 border-r border-border/60 pr-2">
          <StockAdd onAdded={refresh} />
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
            {quotes.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                暂无自选
              </div>
            ) : (
              <ul className="space-y-1">
                {quotes.map((q, i) => (
                  <StockRow
                    key={q.symbol}
                    q={q}
                    compact
                    active={q.symbol === selected}
                    redUp={redUp}
                    dragProps={itemProps(i, quotes)}
                    dragOver={overIndex === i}
                    onClick={(s) => selectStock(s)}
                    onRemove={(s) => void remove(s)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <StockDetail quote={selectedQuote} onBack={() => setSelected(null)} redUp={redUp} />
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
            {quotes.map((q, i) => (
              <StockRow
                key={q.symbol}
                q={q}
                redUp={redUp}
                dragProps={itemProps(i, quotes)}
                dragOver={overIndex === i}
                onClick={(s) => selectStock(s)}
                onRemove={(s) => void remove(s)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
