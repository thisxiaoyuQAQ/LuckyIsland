import { useEffect, useRef } from "react";
import { init, dispose, type Chart, type KLineData } from "klinecharts";
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

export function StockChart({ symbol, period }: { symbol: string; period: Period }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);

  // 初始化图表（一次）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = init(el);
    if (!chart) return;
    chartRef.current = chart;
    // 红涨绿跌（中国习惯）
    chart.setStyles({
      candle: {
        bar: { upColor: "#ef5350", downColor: "#26a69a", noChangeColor: "#94a3b8" },
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
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol, period]);

  return <div ref={containerRef} className="h-full w-full" />;
}
