import { useCallback, useEffect, useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Row } from "./shared";
import { cn } from "@/lib/utils";
import { useReorder } from "@/lib/useReorder";
import { StockAdd } from "@/components/pages/stock/StockAdd";
import { invoke } from "@tauri-apps/api/core";
import { KEYS, parseBool, settingGet, settingSetEmit } from "@/lib/settings";
import type { Quote } from "@/components/pages/stock/StockRow";

/** 股票页配置：红涨绿跌 + 自选股管理（F9.8，与股票页同步） */
export function StockPanel() {
  const [redUp, setRedUp] = useState(true);
  const [list, setList] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshList = useCallback(async () => {
    try {
      setList(await invoke<Quote[]>("stock_get"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      const ru = await settingGet(KEYS.stockRedUp);
      setRedUp(parseBool(ru, true));
      await refreshList();
      setLoading(false);
    })();
  }, [refreshList]);

  const persistOrder = useCallback(async (next: Quote[]) => {
    setList(next);
    try {
      await invoke("stock_watchlist_reorder", { symbols: next.map((q) => q.symbol) });
    } catch {
      /* ignore */
    }
  }, []);

  const { overIndex, itemProps } = useReorder<Quote>(persistOrder);

  const remove = async (symbol: string) => {
    await invoke("stock_watchlist_remove", { symbol });
    await refreshList();
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">股票</h2>
        <p className="text-sm text-muted-foreground">
          涨跌着色即时生效；自选股与股票页同步（下次行情刷新或切回股票页生效）。
        </p>
      </div>
      <Row label="红涨绿跌" desc="开启：红=涨 / 绿=跌（中国习惯）；关闭：绿=涨 / 红=跌">
        <Switch
          checked={redUp}
          onCheckedChange={async (v) => {
            setRedUp(v);
            await settingSetEmit(KEYS.stockRedUp, v ? "true" : "false");
          }}
        />
      </Row>

      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">自选股</div>
        <div className="text-xs text-muted-foreground">搜索添加 / 删除 / 拖拽排序，与股票页同步。</div>
      </div>
      <StockAdd onAdded={() => void refreshList()} />
      <div className="flex flex-col gap-2">
        {list.map((q, i) => (
          <div
            key={q.symbol}
            {...itemProps(i, list)}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 transition-colors",
              overIndex === i && "border-primary/70 bg-primary/5",
            )}
          >
            <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{q.name}</div>
              <div className="text-xs uppercase text-muted-foreground">{q.symbol}</div>
            </div>
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
            >
              <button
                onClick={() => void remove(q.symbol)}
                aria-label="删除"
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="text-xs text-muted-foreground">暂无自选股</p>}
      </div>
    </section>
  );
}
