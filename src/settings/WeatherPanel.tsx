import { useEffect, useState } from "react";
import { Row, selectCls } from "./shared";
import { KEYS, parseRefreshMin, settingGet, settingSetEmit } from "@/lib/settings";

/** 天气页配置：自动刷新间隔 */
export function WeatherPanel() {
  const [min, setMin] = useState(10);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void settingGet(KEYS.weatherRefreshMin).then((v) => {
      setMin(parseRefreshMin(v));
      setLoading(false);
    });
  }, []);

  const change = async (raw: number) => {
    const v = Number.isNaN(raw) || raw < 1 ? 1 : Math.min(raw, 1440);
    setMin(v);
    await settingSetEmit(KEYS.weatherRefreshMin, String(v));
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">天气</h2>
        <p className="text-sm text-muted-foreground">影响天气页后台自动刷新频率。</p>
      </div>
      <Row label="自动刷新间隔" desc="单位分钟（1~1440）">
        <input
          type="number"
          min={1}
          max={1440}
          value={min}
          onChange={(e) => void change(parseInt(e.target.value, 10))}
          className={selectCls + " w-20"}
        />
      </Row>
    </section>
  );
}
