import { applyMeritClick, rolloverMerit, type MeritState } from "./date";

export interface LoadedWoodenFishState {
  state: MeritState;
  rolledOver: boolean;
  canInteract: boolean;
}

function isMeritState(value: unknown): value is MeritState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<MeritState>;
  return (
    typeof state.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(state.date) &&
    typeof state.todayCount === "number" &&
    Number.isSafeInteger(state.todayCount) &&
    state.todayCount >= 0 &&
    typeof state.totalCount === "number" &&
    Number.isSafeInteger(state.totalCount) &&
    state.totalCount >= 0 &&
    state.totalCount >= state.todayCount &&
    (state.lastMilestone === null ||
      (typeof state.lastMilestone === "number" &&
        Number.isSafeInteger(state.lastMilestone) &&
        state.lastMilestone >= 0))
  );
}

export async function loadWoodenFishState(
  read: () => Promise<string | null>,
  currentDay: () => string,
): Promise<LoadedWoodenFishState> {
  let stored: string | null;
  try {
    stored = await read();
  } catch {
    const day = currentDay();
    return {
      state: rolloverMerit(null, day),
      rolledOver: false,
      canInteract: false,
    };
  }

  let parsed: MeritState | null = null;
  let canInteract = stored === null;
  if (stored) {
    try {
      const value: unknown = JSON.parse(stored);
      if (isMeritState(value)) {
        parsed = value;
        canInteract = true;
      }
    } catch {
      canInteract = false;
    }
  }

  const day = currentDay();
  return {
    state: rolloverMerit(parsed, day),
    rolledOver: parsed !== null && parsed.date !== day,
    canInteract,
  };
}

export function prepareWoodenFishKnock(state: MeritState, currentDay: string) {
  return applyMeritClick(rolloverMerit(state, currentDay));
}
