export type MoodLevel = "great" | "good" | "neutral" | "tired" | "down";

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function moodStreak(records: Record<string, MoodLevel>, todayKey: string): number {
  let streak = 0;
  let d = parseDateKey(todayKey);
  if (!records[todayKey]) d.setDate(d.getDate() - 1);
  while (records[localDateKey(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function isCrazyThursday(d: Date): boolean {
  return d.getDay() === 4;
}

export const MERIT_MILESTONES: number[] = [10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

export function meritMilestoneCrossed(prev: number, next: number): number | null {
  let crossed: number | null = null;
  for (const m of MERIT_MILESTONES) if (prev < m && m <= next) crossed = m;
  return crossed;
}

export interface MeritState {
  date: string;
  todayCount: number;
  totalCount: number;
  lastMilestone: number | null;
}

export function rolloverMerit(stored: MeritState | null, today: string): MeritState {
  if (stored && stored.date === today) return stored;
  return { date: today, todayCount: 0, totalCount: stored?.totalCount ?? 0, lastMilestone: null };
}

export function applyMeritClick(state: MeritState): { state: MeritState; crossed: number | null } {
  const todayCount = state.todayCount + 1;
  const totalCount = state.totalCount + 1;
  const crossed = meritMilestoneCrossed(state.todayCount, todayCount);
  return {
    state: { ...state, todayCount, totalCount, lastMilestone: crossed ?? state.lastMilestone },
    crossed,
  };
}
