import { useEffect, useState } from "react";
import { useTimeSetting } from "../useTimeConfig";
import { settingGet, settingSet, timeWidgetKey } from "@/lib/settings";
import { parseFortuneConfig, DEFAULT_FORTUNE } from "../widgetConfig";
import { ensureTodayFortune, generateFortune, type Fortune } from "../fortuneContent";
import { localDateKey } from "../date";

const DATA_KEY = "time:data:fortune";

function Stars({ n }: { n: number }) {
  return (
    <span className="text-[10px] tracking-tight">
      {"★".repeat(n)}
      {"☆".repeat(5 - n)}
    </span>
  );
}

export function FortuneWidget() {
  const { value: cfg } = useTimeSetting(timeWidgetKey("fortune"), parseFortuneConfig, DEFAULT_FORTUNE);
  const [fortune, setFortune] = useState<Fortune | null>(null);
  const [flipping, setFlipping] = useState(false);

  const persist = (f: Fortune) => {
    setFortune(f);
    void settingSet(DATA_KEY, JSON.stringify(f));
  };

  useEffect(() => {
    (async () => {
      const today = localDateKey(new Date());
      const stored = await settingGet(DATA_KEY);
      let parsed: Fortune | null = null;
      if (stored) {
        try {
          parsed = JSON.parse(stored) as Fortune;
        } catch {
          parsed = null;
        }
      }
      persist(ensureTodayFortune(parsed, today));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redraw = () => {
    const today = localDateKey(new Date());
    if (cfg.animation) {
      setFlipping(true);
      setTimeout(() => {
        persist(generateFortune(today));
        setFlipping(false);
      }, 200);
    } else {
      persist(generateFortune(today));
    }
  };

  if (!fortune) {
    return <div className="rounded-lg border border-border/60 p-2 text-xs text-muted-foreground">今日运势……</div>;
  }

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-border/60 bg-card/40 p-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>今日运势 · 仅供娱乐</span>
        <button onClick={redraw} className="text-primary hover:underline" aria-label="再抽一次">
          再抽
        </button>
      </div>
      <div className={`flex items-center gap-2 ${flipping ? "opacity-30 transition-opacity" : ""}`}>
        <span className="text-lg font-semibold">{fortune.level}</span>
        <Stars n={fortune.stars} />
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed">{fortune.blessing}</p>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>幸运数字 {fortune.luckyNumber}</span>
        <span className="flex items-center gap-1">
          幸运色
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-border"
            style={{ background: fortune.luckyColor.hex }}
          />
          {fortune.luckyColor.name}
        </span>
      </div>
    </div>
  );
}
