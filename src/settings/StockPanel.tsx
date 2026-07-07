import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Row } from "./shared";
import { KEYS, parseBool, settingGet, settingSetEmit } from "@/lib/settings";

/** 股票页配置：红涨绿跌方向 */
export function StockPanel() {
  const [redUp, setRedUp] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void settingGet(KEYS.stockRedUp).then((v) => {
      setRedUp(parseBool(v, true));
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">股票</h2>
        <p className="text-sm text-muted-foreground">涨跌着色方向，即时生效到自选股列表与紧凑态。</p>
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
    </section>
  );
}
