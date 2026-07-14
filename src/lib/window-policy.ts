import { invoke } from "@tauri-apps/api/core";

export type IslandState = "hidden" | "compact" | "expanded";
export type IslandVisualPhase = "compact" | "expanding" | "expanded" | "collapsing";

export function containerExpandedForPhase(phase: IslandVisualPhase): boolean {
  return phase !== "compact";
}

export function shouldSyncExternalVisualPhase(phase: IslandVisualPhase): boolean {
  return phase === "compact" || phase === "expanded";
}

export interface WindowPolicySnapshot {
  desiredState: IslandState;
  effectiveState: IslandState;
  shouldFocus: boolean;
  clickThrough: boolean;
  hoverExpand: boolean;
  hovered: boolean;
  hideInFullscreen: boolean;
  fullscreenSupported: boolean;
  fullscreenBlock: boolean;
  priorityOverrideActive: boolean;
  priorityOverrideGeneration: number;
}

export function windowPolicyGet(): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_policy_get");
}

export function setIslandState(state: IslandState): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("set_island_state", { state });
}

export function windowClickThroughSet(
  enabled: boolean,
): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_click_through_set", { enabled });
}

export function windowHoverSet(hovered: boolean): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_hover_set", { hovered });
}

export function windowHoverExpandSet(
  enabled: boolean,
): Promise<WindowPolicySnapshot> {
  return invoke<WindowPolicySnapshot>("window_hover_expand_set", { enabled });
}

interface HoverControllerOptions {
  enterDelay: number;
  leaveDelay: number;
  submit: (hovered: boolean) => void;
}

export function createHoverController({
  enterDelay,
  leaveDelay,
  submit,
}: HoverControllerOptions) {
  let generation = 0;
  let active = false;
  let suppressed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (hovered: boolean, delay: number) => {
    const currentGeneration = ++generation;
    clearTimer();
    if (suppressed) {
      if (!hovered) suppressed = false;
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (currentGeneration !== generation) return;
      if (!hovered && !active) return;
      active = hovered;
      submit(hovered);
    }, delay);
  };

  const enter = () => schedule(true, enterDelay);
  const leave = () => schedule(false, leaveDelay);
  const suppressCurrentCycle = () => {
    generation += 1;
    clearTimer();
    suppressed = true;
  };
  const disable = () => {
    generation += 1;
    clearTimer();
    if (active) {
      active = false;
      submit(false);
    }
  };
  const dispose = () => {
    generation += 1;
    clearTimer();
  };

  return { enter, leave, suppressCurrentCycle, disable, dispose };
}

interface IslandTransitionControllerOptions {
  collapseDelay: number;
  reducedMotion: () => boolean;
  setVisualPhase: (phase: IslandVisualPhase) => void;
  submit: (state: IslandState) => Promise<WindowPolicySnapshot>;
  acceptSnapshot: (snapshot: WindowPolicySnapshot) => void;
  recover: () => void | Promise<void>;
}

export function createIslandTransitionController({
  collapseDelay,
  reducedMotion,
  setVisualPhase,
  submit,
  acceptSnapshot,
  recover,
}: IslandTransitionControllerOptions) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishDelay: (() => void) | undefined;

  const clearPendingDelay = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    finishDelay?.();
    finishDelay = undefined;
  };

  const wait = async (delay: number) => {
    await new Promise<void>((resolve) => {
      finishDelay = resolve;
      timer = setTimeout(() => {
        timer = undefined;
        finishDelay = undefined;
        resolve();
      }, delay);
    });
  };

  const request = async (
    state: IslandState,
    submitState: (state: IslandState) => Promise<WindowPolicySnapshot> = submit,
  ): Promise<void> => {
    const currentGeneration = ++generation;
    clearPendingDelay();
    if (state === "compact") {
      setVisualPhase("compact");
      if (!reducedMotion()) {
        await wait(collapseDelay);
        if (currentGeneration !== generation) return;
      }
    } else if (state === "expanded") {
      setVisualPhase("expanding");
    }

    try {
      const snapshot = await submitState(state);
      if (currentGeneration === generation) {
        acceptSnapshot(snapshot);
        setVisualPhase(snapshot.effectiveState === "expanded" ? "expanded" : "compact");
      }
    } catch (error) {
      if (currentGeneration === generation) await recover();
      throw error;
    }
  };

  const dispose = () => {
    generation += 1;
    clearPendingDelay();
  };

  return { request, dispose };
}
