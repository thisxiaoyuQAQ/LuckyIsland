import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useAnimationControls } from "motion/react";
import { useTimeSetting } from "../useTimeConfig";
import { settingGet, settingSet, timeWidgetKey } from "@/lib/settings";
import { parseWoodenFishConfig, DEFAULT_WOODEN_FISH } from "../widgetConfig";
import { rolloverMerit, isCrazyThursday, type MeritState } from "../date";
import { currentLocalDay, useLocalDay } from "../useLocalDay";
import { createDebouncedWriter } from "../debouncedWriter";
import { loadWoodenFishState, prepareWoodenFishKnock } from "../woodenFishState";
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
  const day = useLocalDay();
  const initialState: MeritState = {
    date: day,
    todayCount: 0,
    totalCount: 0,
    lastMilestone: null,
  };
  const [state, setState] = useState<MeritState>(initialState);
  const stateRef = useRef(initialState);
  const loadedRef = useRef(false);
  const [floats, setFloats] = useState<FloatItem[]>([]);
  const [thursday, setThursday] = useState<string | null>(null);
  const persistWriter = useRef(
    createDebouncedWriter<MeritState>(
      (value) => settingSet(DATA_KEY, JSON.stringify(value)),
      500,
    ),
  );
  const floatId = useRef(0);
  const controls = useAnimationControls();

  useEffect(() => {
    let disposed = false;
    (async () => {
      const loaded = await loadWoodenFishState(() => settingGet(DATA_KEY), currentLocalDay);
      if (disposed) return;
      loadedRef.current = loaded.canInteract;
      stateRef.current = loaded.state;
      setState(loaded.state);
      if (loaded.canInteract && loaded.rolledOver) {
        persistWriter.current.schedule(loaded.state);
        void persistWriter.current.flush().catch(() => {
          /* 首次跨日恢复失败不阻塞 UI；后续敲击会继续调度最新状态。 */
        });
      }
    })();
    return () => {
      disposed = true;
      void persistWriter.current.flush().catch(() => {
        /* 卸载期间无法再展示错误；保留异步写入尽力提交。 */
      });
    };
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    const next = rolloverMerit(stateRef.current, day);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
    persistWriter.current.schedule(next);
    void persistWriter.current.flush().catch(() => {
      /* 保持 UI 可用；后续敲击会继续调度最新状态。 */
    });
  }, [day]);

  const schedulePersist = (value: MeritState) => {
    persistWriter.current.schedule(value);
  };

  const knock = () => {
    if (!loadedRef.current) return;
    const next = prepareWoodenFishKnock(stateRef.current, currentLocalDay());
    stateRef.current = next.state;
    setState(next.state);
    schedulePersist(next.state);
    if (cfg.sound) playKnock(cfg.volume);
    if (!reduceMotion() && cfg.animation) {
      // 每次敲击重新触发：放大再缩回。controls.start 会打断上一次动画，连击也能逐次播放。
      void controls.start({ scale: [1, 1.18, 1], transition: { duration: 0.22, ease: "easeOut" } });
      const id = ++floatId.current;
      setFloats((f) => [...f, { id, text: "+1" }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 700);
    }
    if (next.crossed !== null && cfg.crazyThursday && isCrazyThursday(new Date())) {
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
        disabled={!loadedRef.current}
        aria-label="敲击木鱼"
        animate={controls}
        className="select-none disabled:cursor-wait disabled:opacity-60"
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
