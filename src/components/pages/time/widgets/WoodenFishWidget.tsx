import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTimeSetting } from "../useTimeConfig";
import { settingGet, settingSet, timeWidgetKey } from "@/lib/settings";
import { parseWoodenFishConfig, DEFAULT_WOODEN_FISH } from "../widgetConfig";
import { rolloverMerit, applyMeritClick, isCrazyThursday, localDateKey, type MeritState } from "../date";
import { thursdayLine } from "./thursdayContent";

const DATA_KEY = "time:data:wooden_fish";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let audioCtx: AudioContext | null = null;
function playKnock(volume: number) {
  if (!audioCtx) audioCtx = new AudioContext();
  const ctx = audioCtx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(220, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08);
  g.gain.setValueAtTime(volume, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.2);
}

interface FloatItem {
  id: number;
  text: string;
}

export function WoodenFishWidget() {
  const { value: cfg } = useTimeSetting(
    timeWidgetKey("wooden_fish"),
    parseWoodenFishConfig,
    DEFAULT_WOODEN_FISH,
  );
  const [state, setState] = useState<MeritState>({
    date: localDateKey(new Date()),
    todayCount: 0,
    totalCount: 0,
    lastMilestone: null,
  });
  const [floats, setFloats] = useState<FloatItem[]>([]);
  const [thursday, setThursday] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floatId = useRef(0);

  useEffect(() => {
    (async () => {
      const stored = await settingGet(DATA_KEY);
      let parsed: MeritState | null = null;
      if (stored) {
        try {
          parsed = JSON.parse(stored) as MeritState;
        } catch {
          parsed = null;
        }
      }
      setState(rolloverMerit(parsed, localDateKey(new Date())));
    })();
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  const schedulePersist = (s: MeritState) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void settingSet(DATA_KEY, JSON.stringify(s));
    }, 500);
  };

  const knock = () => {
    const { state: next, crossed } = applyMeritClick(state);
    setState(next);
    schedulePersist(next);
    if (cfg.sound) {
      try {
        playKnock(cfg.volume);
      } catch {
        /* 忽略音频失败 */
      }
    }
    if (!reduceMotion() && cfg.animation) {
      const id = ++floatId.current;
      setFloats((f) => [...f, { id, text: "+1" }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 700);
    }
    if (crossed !== null && cfg.crazyThursday && isCrazyThursday(new Date())) {
      setThursday(thursdayLine());
      setTimeout(() => setThursday(null), 4000);
    }
  };

  return (
    <div className="relative flex w-full flex-col items-center gap-1 rounded-lg border border-border/40 bg-card/20 px-3 py-2">
      <div className="flex w-full items-center justify-between text-[10px] text-muted-foreground">
        <span>电子木鱼</span>
        <span className="tabular-nums">
          今日 {state.todayCount} · 累计 {state.totalCount}
        </span>
      </div>
      <motion.button
        type="button"
        onClick={knock}
        aria-label="敲击木鱼"
        animate={reduceMotion() || !cfg.animation ? {} : { scale: [1, 0.92, 1] }}
        transition={{ duration: 0.15 }}
        className="select-none"
      >
        <svg width="52" height="36" viewBox="0 0 56 40" fill="none" aria-hidden>
          <ellipse cx="28" cy="20" rx="24" ry="14" fill="#8b5e34" />
          <ellipse cx="28" cy="20" rx="24" ry="14" stroke="#5a3a1f" strokeWidth="1.5" />
          <path d="M10 20 Q28 10 46 20" stroke="#5a3a1f" strokeWidth="1" fill="none" />
          <circle cx="20" cy="18" r="1.5" fill="#3a2410" />
          <circle cx="36" cy="18" r="1.5" fill="#3a2410" />
        </svg>
      </motion.button>
      <AnimatePresence>
        {floats.map((f) => (
          <motion.span
            key={f.id}
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 0, y: -24 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="pointer-events-none absolute top-10 text-xs text-primary"
          >
            {f.text}
          </motion.span>
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {thursday && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute -bottom-1 left-1 right-1 rounded bg-primary/15 px-1 py-0.5 text-center text-[10px] text-primary"
          >
            {thursday}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
