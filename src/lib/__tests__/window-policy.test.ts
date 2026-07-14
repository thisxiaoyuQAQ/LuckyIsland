import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHoverController,
  createIslandTransitionController,
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

describe("island transition controller", () => {
  it("starts expand visuals immediately before the backend round trip", async () => {
    const calls: string[] = [];
    const controller = createIslandTransitionController({
      shrinkDelay: 280,
      setVisualState: (state) => calls.push(`visual:${state}`),
      submit: async (state) => {
        calls.push(`submit:${state}`);
        return snapshot(state);
      },
      acceptSnapshot: () => calls.push("snapshot"),
      recover: vi.fn(),
    });

    await controller.request("expanded");

    expect(calls).toEqual(["visual:expanded", "submit:expanded", "snapshot"]);
  });

  it("starts compact visuals immediately and delays only the platform resize", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const controller = createIslandTransitionController({
      shrinkDelay: 280,
      setVisualState: (state) => calls.push(`visual:${state}`),
      submit: async (state) => {
        calls.push(`submit:${state}`);
        return snapshot(state);
      },
      acceptSnapshot: () => calls.push("snapshot"),
      recover: vi.fn(),
    });

    const request = controller.request("compact");
    expect(calls).toEqual(["visual:compact"]);

    await vi.advanceTimersByTimeAsync(279);
    expect(calls).toEqual(["visual:compact"]);

    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(calls).toEqual(["visual:compact", "submit:compact", "snapshot"]);
  });

  it("cancels a pending compact resize when expand is requested", async () => {
    vi.useFakeTimers();
    const submit = vi.fn(async (state) => snapshot(state));
    const controller = createIslandTransitionController({
      shrinkDelay: 280,
      setVisualState: vi.fn(),
      submit,
      acceptSnapshot: vi.fn(),
      recover: vi.fn(),
    });

    void controller.request("compact");
    await controller.request("expanded");
    await vi.runAllTimersAsync();

    expect(submit.mock.calls.map(([state]) => state)).toEqual(["expanded"]);
  });
});
