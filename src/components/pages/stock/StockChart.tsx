import { useEffect, useRef, useState } from "react";
import { init, dispose, TooltipShowRule, type Chart, type KLineData } from "klinecharts";
import { invoke } from "@tauri-apps/api/core";

interface KBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

type Period = "day" | "week" | "month";

// MA 线颜色（与下方 setStyles indicator.lines 一致）
const MA_COLORS = ["#ffb74d", "#4fc3f7", "#ba68c8"];
const MA_PERIODS = [5, 10, 20];

function maValue(closes: number[], n: number): number {
  if (closes.length < n) return 0;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i];
  return sum / n;
}

export function StockChart({ symbol, period }: { symbol: string; period: Period }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [ma, setMa] = useState<{ ma5: number; ma10: number; ma20: number } | null>(null);

  // 初始化图表（一次）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = init(el);
    if (!chart) return;
    chartRef.current = chart;
    chart.setStyles({
      candle: {
        bar: { upColor: "#ef5350", downColor: "#26a69a", noChangeColor: "#94a3b8" },
      },
      indicator: {
        // 隐藏图内 MA 图例（移到图上方单独展示）
        tooltip: { showRule: TooltipShowRule.None },
        // MA5/10/20 线色，与上方图例对应
        lines: MA_COLORS.map((c) => ({ color: c })),
      },
    });
    chart.createIndicator("MA", true); // 主图叠加 MA
    chart.createIndicator("VOL"); // 成交量副图
    return () => {
      dispose(el);
      chartRef.current = null;
    };
  }, []);

  // 容器尺寸变化 → resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => chartRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // symbol/period 变化 → 重新拉数据
  useEffect(() => {
    let cancelled = false;
    const chart = chartRef.current;
    if (!chart) return;
    invoke<KBar[]>("stock_kline", { symbol, period })
      .then((bars) => {
        if (cancelled || !chartRef.current) return;
        const closes = bars.map((b) => b.close);
        const data: KLineData[] = bars.map((b) => ({
          // b.date 形如 "2026-06-29"，按本地零点取时间戳，避免日期错位
          timestamp: new Date(`${b.date}T00:00:00`).getTime(),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));
        chartRef.current.applyNewData(data);
        setMa({
          ma5: maValue(closes, 5),
          ma10: maValue(closes, 10),
          ma20: maValue(closes, 20),
        });
      })
      .catch(() => setMa(null));
    return () => {
      cancelled = true;
    };
  }, [symbol, period]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* MA 图例（图上方，独立可读） */}
      {ma && (
        <div className="flex shrink-0 items-center gap-3 px-1 pb-0.5 text-[10px] tabular-nums text-muted-foreground">
          {MA_PERIODS.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              <span style={{ color: MA_COLORS[i] }}>●</span>
              MA{n} {(n === 5 ? ma.ma5 : n === 10 ? ma.ma10 : ma.ma20).toFixed(2)}
            </span>
          ))}
        </div>
      )}
      <div ref={containerRef} className="min-h-0 flex-1" />
    </div>
  );
}
