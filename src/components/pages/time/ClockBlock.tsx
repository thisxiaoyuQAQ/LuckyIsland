import { useEffect, useState } from "react";
import { useTimeSetting } from "./useTimeConfig";
import { KEYS } from "@/lib/settings";
import { useVisualStyle } from "@/lib/visual-style";
import { islandStyleRecipe } from "@/lib/window-policy";
import { parseAppearance, textStyleCss, DEFAULT_APPEARANCE } from "./appearance";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

const SIZE_CLASS = { sm: "text-3xl", md: "text-4xl", lg: "text-5xl" } as const;
const WEIGHT_CLASS = { normal: "font-normal", bold: "font-bold" } as const;

export function ClockBlock({ compact }: { compact?: boolean }) {
  const { value: a } = useTimeSetting(KEYS.timeAppearance, parseAppearance, DEFAULT_APPEARANCE);
  // 仅紧凑时钟随视觉样式缩放（legacy text-sm / new text-lg）；展开时钟字号布局不变。
  const compactClockClass = islandStyleRecipe(useVisualStyle()).compactClockClass;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h24 = now.getHours();
  let hh: string;
  let suffix = "";
  if (a.use24h) {
    hh = String(h24).padStart(2, "0");
  } else {
    const isPm = h24 >= 12;
    hh = String(((h24 + 11) % 12) + 1).padStart(2, "0");
    suffix = isPm ? " PM" : " AM";
  }
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  if (compact) {
    return (
      <span className={compactClockClass} style={textStyleCss(a.clock)}>
        {hh}:{mm}
        {a.showSeconds && <span className="text-muted-foreground">:{ss}</span>}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5">
      <div
        className={`tabular-nums leading-none ${SIZE_CLASS[a.fontSize]} ${WEIGHT_CLASS[a.fontWeight]}`}
        style={textStyleCss(a.clock)}
      >
        {hh}:{mm}
        {a.showSeconds && <span className="text-2xl">:{ss}</span>}
        {suffix && <span className="text-xl">{suffix}</span>}
      </div>
      <div className="text-xs" style={textStyleCss(a.date)}>
        {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日
      </div>
      <div className="text-xs" style={textStyleCss(a.weekday)}>
        {WEEKDAYS[now.getDay()]}
      </div>
    </div>
  );
}
