import { useEffect, useState } from "react";
import { useTimeSetting } from "../useTimeConfig";
import { settingGet, settingSet, settingsList, timeWidgetKey } from "@/lib/settings";
import { parseMoodConfig, DEFAULT_MOOD } from "../widgetConfig";
import { moodStreak, localDateKey, type MoodLevel } from "../date";

const LEVELS: { id: MoodLevel; emoji: string; label: string }[] = [
  { id: "great", emoji: "😄", label: "很棒" },
  { id: "good", emoji: "🙂", label: "开心" },
  { id: "neutral", emoji: "😐", label: "平静" },
  { id: "tired", emoji: "😮‍💨", label: "疲惫" },
  { id: "down", emoji: "😔", label: "低落" },
];

function moodKey(day: string) {
  return `time:data:mood:${day}`;
}

export function MoodWidget() {
  const { value: cfg } = useTimeSetting(timeWidgetKey("mood"), parseMoodConfig, DEFAULT_MOOD);
  const [today, setToday] = useState<MoodLevel | null>(null);
  const [streak, setStreak] = useState(0);
  const day = localDateKey(new Date());

  const refresh = async () => {
    const v = await settingGet(moodKey(day));
    setToday(v && LEVELS.some((l) => l.id === v) ? (v as MoodLevel) : null);
    const all = await settingsList("time:data:mood:");
    const records: Record<string, MoodLevel> = {};
    for (const [k, val] of Object.entries(all)) {
      const d = k.replace("time:data:mood:", "");
      if (LEVELS.some((l) => l.id === val)) records[d] = val as MoodLevel;
    }
    setStreak(moodStreak(records, day));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (lv: MoodLevel) => {
    setToday(lv);
    await settingSet(moodKey(day), lv);
    void refresh();
  };

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-border/40 bg-card/20 px-3 py-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>今日心情</span>
        {cfg.showStreak && <span className="tabular-nums">连续 {streak} 天</span>}
      </div>
      <div className="flex justify-between gap-0.5">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => void pick(l.id)}
            aria-label={l.label}
            title={l.label}
            className={`flex flex-1 flex-col items-center rounded-md py-0.5 text-base transition-colors ${
              today === l.id ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-accent"
            }`}
          >
            <span>{l.emoji}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
