function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export interface SayingConfig {
  refreshOnEnter: boolean;
  clickToRefresh: boolean;
}
export const DEFAULT_SAYING: SayingConfig = { refreshOnEnter: true, clickToRefresh: true };
export function parseSayingConfig(v: string | null): SayingConfig {
  if (!v) return DEFAULT_SAYING;
  try {
    const p = JSON.parse(v) as Partial<SayingConfig>;
    return { refreshOnEnter: bool(p.refreshOnEnter, true), clickToRefresh: bool(p.clickToRefresh, true) };
  } catch {
    return DEFAULT_SAYING;
  }
}

export interface HistoryConfig {
  showCategory: boolean;
  autoRotate: boolean;
}
export const DEFAULT_HISTORY: HistoryConfig = { showCategory: true, autoRotate: false };
export function parseHistoryConfig(v: string | null): HistoryConfig {
  if (!v) return DEFAULT_HISTORY;
  try {
    const p = JSON.parse(v) as Partial<HistoryConfig>;
    return { showCategory: bool(p.showCategory, true), autoRotate: bool(p.autoRotate, false) };
  } catch {
    return DEFAULT_HISTORY;
  }
}

export interface FortuneConfig {
  animation: boolean;
}
export const DEFAULT_FORTUNE: FortuneConfig = { animation: true };
export function parseFortuneConfig(v: string | null): FortuneConfig {
  if (!v) return DEFAULT_FORTUNE;
  try {
    const p = JSON.parse(v) as Partial<FortuneConfig>;
    return { animation: bool(p.animation, true) };
  } catch {
    return DEFAULT_FORTUNE;
  }
}

export interface WoodenFishConfig {
  sound: boolean;
  volume: number;
  animation: boolean;
  crazyThursday: boolean;
}
export const DEFAULT_WOODEN_FISH: WoodenFishConfig = {
  sound: true,
  volume: 0.5,
  animation: true,
  crazyThursday: true,
};
export function parseWoodenFishConfig(v: string | null): WoodenFishConfig {
  if (!v) return DEFAULT_WOODEN_FISH;
  try {
    const p = JSON.parse(v) as Partial<WoodenFishConfig>;
    const vol = typeof p.volume === "number" ? Math.min(1, Math.max(0, p.volume)) : 0.5;
    return {
      sound: bool(p.sound, true),
      volume: vol,
      animation: bool(p.animation, true),
      crazyThursday: bool(p.crazyThursday, true),
    };
  } catch {
    return DEFAULT_WOODEN_FISH;
  }
}

export interface MoodConfig {
  showStreak: boolean;
}
export const DEFAULT_MOOD: MoodConfig = { showStreak: true };
export function parseMoodConfig(v: string | null): MoodConfig {
  if (!v) return DEFAULT_MOOD;
  try {
    const p = JSON.parse(v) as Partial<MoodConfig>;
    return { showStreak: bool(p.showStreak, true) };
  } catch {
    return DEFAULT_MOOD;
  }
}
