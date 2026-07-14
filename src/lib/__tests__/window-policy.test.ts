import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHoverController,
  createIslandTransitionController,
  shouldSyncExternalVisualPhase,
  type WindowPolicySnapshot,
} from "../window-policy";

afterEach(() => vi.useRealTimers());

function snapshot(effectiveState: WindowPolicySnapshot["effectiveState"]): WindowPolicySnapshot {
  return {
    desiredState: effectiveState,
    effectiveState,
    shouldFocus: false,
    clickThrough: false,
    hoverExpand: false,
    hovered: false,
    hideInFullscreen: false,
    fullscreenSupported: true,
    fullscreenBlock: false,
    priorityOverrideActive: false,
    priorityOverrideGeneration: 0,
  };
}

describe("hover controller", () => {
  it("quick pass never submits true", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = createHoverController({
      enterDelay: 180,
      leaveDelay: 300,
      submit,
    });

    controller.enter();
    vi.advanceTimersByTime(100);
    controller.leave();
    vi.advanceTimersByTime(400);

    expect(submit).not.toHaveBeenCalledWith(true);
  });

  it("opposite events invalidate stale generations", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = createHoverController({
      enterDelay: 180,
      leaveDelay: 300,
      submit,
    });

    controller.enter();
    vi.advanceTimersByTime(180);
    controller.leave();
    vi.advanceTimersByTime(100);
    controller.enter();
    vi.advanceTimersByTime(300);

    expect(submit.mock.calls).toEqual([[true], [true]]);
  });

  it("manual action suppresses automatic actions for the rest of the hover cycle", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = createHoverController({
      enterDelay: 180,
      leaveDelay: 300,
      submit,
    });

    controller.enter();
    vi.advanceTimersByTime(180);
    controller.suppressCurrentCycle();
    controller.leave();
    vi.advanceTimersByTime(300);
    controller.enter();
    vi.advanceTimersByTime(180);

    expect(submit.mock.calls).toEqual([[true], [true]]);
  });

  it("manual action before enter delay cancels automatic expand until leave", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = createHoverController({
      enterDelay: 180,
      leaveDelay: 300,
      submit,
    });

    controller.enter();
    controller.suppressCurrentCycle();
    vi.advanceTimersByTime(500);
    controller.leave();
    vi.advanceTimersByTime(300);

    expect(submit).not.toHaveBeenCalled();
  });

  it("disable and dispose clear timers and submit false once", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = createHoverController({
      enterDelay: 180,
      leaveDelay: 300,
      submit,
    });

    controller.enter();
    vi.advanceTimersByTime(180);
    controller.disable();
    controller.dispose();
    vi.runAllTimers();

    expect(submit.mock.calls).toEqual([[true], [false]]);
  });
});

describe("external policy snapshots", () => {
  it("preserves an in-flight local animation phase", () => {
    expect(shouldSyncExternalVisualPhase("expanding")).toBe(false);
    expect(shouldSyncExternalVisualPhase("collapsing")).toBe(false);
    expect(shouldSyncExternalVisualPhase("compact")).toBe(true);
    expect(shouldSyncExternalVisualPhase("expanded")).toBe(true);
  });
});

describe("island transition controller", () => {
  it("marks expanding and submits expanded immediately", async () => {
    const calls: string[] = [];
    const controller = createIslandTransitionController({
      collapseDelay: 120,
      reducedMotion: () => false,
      setVisualPhase: (phase) => calls.push(`phase:${phase}`),
      submit: async (state) => {
        calls.push(`submit:${state}`);
        return snapshot(state);
      },
      acceptSnapshot: () => calls.push("snapshot"),
      recover: vi.fn(),
    });

    await controller.request("expanded");

    expect(calls).toEqual([
      "phase:expanding",
      "submit:expanded",
      "snapshot",
      "phase:expanded",
    ]);
  });

  it("waits for content exit before submitting compact", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const controller = createIslandTransitionController({
      collapseDelay: 120,
      reducedMotion: () => false,
      setVisualPhase: (phase) => calls.push(`phase:${phase}`),
      submit: async (state) => {
        calls.push(`submit:${state}`);
        return snapshot(state);
      },
      acceptSnapshot: () => calls.push("snapshot"),
      recover: vi.fn(),
    });

    const request = controller.request("compact");
    expect(calls).toEqual(["phase:collapsing"]);

    await vi.advanceTimersByTimeAsync(119);
    expect(calls).toEqual(["phase:collapsing"]);

    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(calls).toEqual([
      "phase:collapsing",
      "submit:compact",
      "snapshot",
      "phase:compact",
    ]);
  });

  it("cancels a pending compact resize when expand is requested", async () => {
    vi.useFakeTimers();
    const submit = vi.fn(async (state) => snapshot(state));
    const controller = createIslandTransitionController({
      collapseDelay: 120,
      reducedMotion: () => false,
      setVisualPhase: vi.fn(),
      submit,
      acceptSnapshot: vi.fn(),
      recover: vi.fn(),
    });

    void controller.request("compact");
    await controller.request("expanded");
    await vi.runAllTimersAsync();

    expect(submit.mock.calls.map(([state]) => state)).toEqual(["expanded"]);
  });

  it("reduced motion submits compact without waiting", async () => {
    vi.useFakeTimers();
    const submit = vi.fn(async (state) => snapshot(state));
    const controller = createIslandTransitionController({
      collapseDelay: 120,
      reducedMotion: () => true,
      setVisualPhase: vi.fn(),
      submit,
      acceptSnapshot: vi.fn(),
      recover: vi.fn(),
    });

    await controller.request("compact");

    expect(submit).toHaveBeenCalledWith("compact");
    expect(vi.getTimerCount()).toBe(0);
  });
});
