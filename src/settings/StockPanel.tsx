import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Row } from "./shared";
import { StockAdd } from "@/components/pages/stock/StockAdd";
import { invoke } from "@tauri-apps/api/core";
import { KEYS, parseBool, settingGet, settingSetEmit } from "@/lib/settings";

interface WatchItem {
  symbol: string;
}

/** 股票页配置：红涨绿跌 + 自选股管理（F9.8，与股票页同步） */
export function StockPanel() {
  const [redUp, setRedUp] = useState(true);
  const [list, setList] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshList = useCallback(async () => {
    try {
      setList(await invoke<WatchItem[]>("stock_watchlist_list"));
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
        <div className="text-xs text-muted-foreground">搜索添加 / 删除，与股票页同步。</div>
      </div>
      <StockAdd onAdded={() => void refreshList()} />
      <div className="flex flex-col gap-2">
        {list.map((w) => (
          <div
            key={w.symbol}
            className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-xs uppercase text-muted-foreground">
              {w.symbol}
            </span>
            <button
              onClick={() => void remove(w.symbol)}
              aria-label="删除"
              className="text-muted-foreground transition-colors hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {list.length === 0 && <p className="text-xs text-muted-foreground">暂无自选股</p>}
      </div>
    </section>
  );
}
