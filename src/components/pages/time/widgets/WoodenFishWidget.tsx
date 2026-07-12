import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useAnimationControls } from "motion/react";
import { useTimeSetting } from "../useTimeConfig";
import { settingGet, settingSet, timeWidgetKey } from "@/lib/settings";
import { parseWoodenFishConfig, DEFAULT_WOODEN_FISH } from "../widgetConfig";
import { rolloverMerit, applyMeritClick, isCrazyThursday, localDateKey, type MeritState } from "../date";
import { thursdayLine } from "./thursdayContent";

const DATA_KEY = "time:data:wooden_fish";
const SOUND_URL = "/sound_1.mp3";
const FISH_URL = "/WoodenFish.svg";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// 3 元素循环池：允许快速连击叠音，同时限制并发音效数量避免失控。
const audioPool: HTMLAudioElement[] = [];
let poolIdx = 0;
function playKnock(volume: number) {
  if (audioPool.length < 3) audioPool.push(new Audio(SOUND_URL));
  const a = audioPool[poolIdx % audioPool.length];
  poolIdx++;
  a.volume = volume;
  a.currentTime = 0;
  void a.play().catch(() => {
    /* 忽略：快速重启导致的 interrupt */
  });
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
  const controls = useAnimationControls();

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
    if (cfg.sound) playKnock(cfg.volume);
    if (!reduceMotion() && cfg.animation) {
      // 每次敲击重新触发：放大再缩回。controls.start 会打断上一次动画，连击也能逐次播放。
      void controls.start({ scale: [1, 1.18, 1], transition: { duration: 0.22, ease: "easeOut" } });
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
        animate={controls}
        className="select-none"
      >
        <img src={FISH_URL} alt="木鱼" className="h-14 w-auto" draggable={false} />
      </motion.button>
      <AnimatePresence>
        {floats.map((f) => (
          <motion.span
            key={f.id}
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 0, y: -24 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="pointer-events-none absolute top-12 text-xs text-primary"
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
