import { useEffect, useRef } from "react";
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
interface MaValues {
  ma5: number;
  ma10: number;
  ma20: number;
}

// MA 线颜色（与下方 setStyles indicator.lines 一致，图例外侧图例复用）
export const MA_COLORS = ["#ffb74d", "#4fc3f7", "#ba68c8"];

function maValue(closes: number[], n: number): number {
  if (closes.length < n) return 0;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i];
  return sum / n;
}

export function StockChart({
  symbol,
  period,
  onMa,
}: {
  symbol: string;
  period: Period;
  onMa?: (ma: MaValues | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);

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
        // MA5/10/20 线色，与外置图例对应
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
        onMa?.({
          ma5: maValue(closes, 5),
          ma10: maValue(closes, 10),
          ma20: maValue(closes, 20),
        });
      })
      .catch(() => onMa?.(null));
    return () => {
      cancelled = true;
    };
  }, [symbol, period, onMa]);

  return <div ref={containerRef} className="h-full w-full" />;
}
