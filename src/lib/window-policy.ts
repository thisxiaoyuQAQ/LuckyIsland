import { invoke } from "@tauri-apps/api/core";

export type IslandState = "hidden" | "compact" | "expanded";

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
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (hovered: boolean, delay: number) => {
    const currentGeneration = ++generation;
    clearTimer();
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

  return { enter, leave, disable, dispose };
}

interface IslandTransitionControllerOptions {
  shrinkDelay: number;
  setVisualState: (state: IslandState) => void;
  submit: (state: IslandState) => Promise<WindowPolicySnapshot>;
  acceptSnapshot: (snapshot: WindowPolicySnapshot) => void;
  recover: () => void | Promise<void>;
}

export function createIslandTransitionController({
  shrinkDelay,
  setVisualState,
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

  const request = async (state: IslandState): Promise<void> => {
    const currentGeneration = ++generation;
    clearPendingDelay();
    setVisualState(state);

    if (state === "compact") {
      await new Promise<void>((resolve) => {
        finishDelay = resolve;
        timer = setTimeout(() => {
          timer = undefined;
          finishDelay = undefined;
          resolve();
        }, shrinkDelay);
      });
      if (currentGeneration !== generation) return;
    }

    try {
      const snapshot = await submit(state);
      if (currentGeneration === generation) acceptSnapshot(snapshot);
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
