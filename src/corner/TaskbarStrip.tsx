import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  KEYS,
  modeKey,
  onSettingsChanged,
  parseOpacity,
  settingGet,
} from "@/lib/settings";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

/** 天气刷新间隔：任务栏条只是概览，10 分钟一次足够且不给上游添压。 */
const WEATHER_REFRESH_MS = 10 * 60 * 1000;

/** 指针离开条到交还 hover 阶段的宽限（略长于岛自身的 300ms leave，覆盖跨窗口行程）。 */
const HOVER_RELEASE_DELAY_MS = 360;

function formatClock(now: Date): string {
  const hh = `${now.getHours()}`.padStart(2, "0");
  const mm = `${now.getMinutes()}`.padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDate(now: Date): string {
  return `${now.getMonth() + 1}/${now.getDate()}`;
}

/** 每分钟对齐整分跳一次，避免 setInterval(1000) 空转 */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = new Date();
      setNow(current);
      const msToNextMinute = 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds());
      timer = setTimeout(tick, Math.max(1_000, msToNextMinute));
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

/** 当前城市温度；未配置城市或请求失败时返回 null，由调用方降级显示日期。 */
function useTemperature(): string | null {
  const [temp, setTemp] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const city = await invoke<string>("weather_get_city");
        const bundle = await invoke<{ now?: { temperature?: number } }>("weather_get", {
          city: city || null,
        });
        if (disposed) return;
        const value = bundle?.now?.temperature;
        setTemp(typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}°` : null);
      } catch {
        // 离线/未配置城市：保持 null 走日期降级，不打扰用户。
        if (!disposed) setTemp(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), WEATHER_REFRESH_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  return temp;
}

/**
 * 13a.2 嵌入任务栏的静息条。
 *
 * 这个窗口是 `Shell_TrayWnd` 的子窗口，会被任务栏裁剪，所以只承载「时间 + 一项信息」，
 * 完整面板由 island 窗口在任务栏正上方展开。视觉上不能有圆角/边框/阴影——那些会让它
 * 看起来是浮在任务栏上的卡片，而不是任务栏的一部分。
 */
export function TaskbarStrip() {
  const now = useClock();
  const temp = useTemperature();
  const [opacity, setOpacity] = useState(0.7);

  useEffect(() => {
    void (async () => {
      const raw = await settingGet(modeKey(KEYS.windowOpacity, "corner")).catch(() => null);
      setOpacity(parseOpacity(raw));
    })();
  }, []);

  useAsyncSubscription(
    () =>
      onSettingsChanged((key, value) => {
        if (key === modeKey(KEYS.windowOpacity, "corner")) setOpacity(parseOpacity(value));
      }),
    [],
    { label: "corner settings://changed" },
  );

  // 悬停 → 阶段 1（岛作为面板出现在任务栏正上方）。
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(releaseTimer.current), []);

  const onEnter = useCallback(() => {
    clearTimeout(releaseTimer.current);
    void invoke("window_hover_stage_set", { stage: 1 }).catch(() => {});
  }, []);

  // 离开条：延迟一拍再交还，给「从条移到面板」留出行程时间；后端还会再确认一次指针
  // 是否已经落在面板上（两个窗口不共享 mouseenter/mouseleave，见 window_strip_hover_release）。
  const onLeave = useCallback(() => {
    clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => {
      void invoke("window_strip_hover_release").catch(() => {});
    }, HOVER_RELEASE_DELAY_MS);
  }, []);

  const onClick = useCallback(() => {
    void invoke("set_island_state", { state: "expanded" }).catch(() => {});
  }, []);

  return (
    <button
      type="button"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onClick}
      aria-label="展开 LuckyIsland"
      // color-mix 在测试用的 happy-dom 里会被 CSSStyleDeclaration 丢弃，data-opacity 让
      // 「跟随 corner 模式透明度」这条行为可断言（同时也方便真机排查）。
      data-opacity={opacity.toFixed(2)}
      className="flex h-screen w-screen select-none items-center justify-between gap-2 px-3 text-left text-foreground"
      style={{
        backgroundColor: `color-mix(in oklch, var(--card) ${(opacity * 100).toFixed(0)}%, transparent)`,
      }}
    >
      <span className="text-sm font-medium tabular-nums leading-none">{formatClock(now)}</span>
      <span className="text-xs text-muted-foreground tabular-nums leading-none">
        {temp ?? formatDate(now)}
      </span>
    </button>
  );
}

export default TaskbarStrip;
