import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  HOVER_ENTER_DELAY_MS,
  HOVER_LEAVE_DELAY_MS,
  createHoverStageController,
  createIslandTransitionController,
  containerExpandedForPhase,
  islandStyleRecipe,
  scrollIndicatorGeometry,
  shouldSyncExternalVisualPhase,
  type HoverStage,
  type WindowPolicySnapshot,
} from "../window-policy";

afterEach(() => vi.useRealTimers());

const ENTER = HOVER_ENTER_DELAY_MS;
const LEAVE = HOVER_LEAVE_DELAY_MS;

type SubmitMock = Mock<(stage: HoverStage, previous: HoverStage) => void>;

function stageController(submit: SubmitMock) {
  return createHoverStageController({
    enterDelay: ENTER,
    leaveDelay: LEAVE,
    submit,
  });
}

function snapshot(effectiveState: WindowPolicySnapshot["effectiveState"]): WindowPolicySnapshot {
  return {
    desiredState: effectiveState,
    effectiveState,
    shouldFocus: false,
    clickThrough: false,
    hoverExpand: false,
    floatingBall: false,
    hoverStage: 0,
    hideInFullscreen: false,
    fullscreenSupported: true,
    fullscreenBlock: false,
    priorityOverrideActive: false,
    priorityOverrideGeneration: 0,
  };
}

describe("hover stage controller", () => {
  it("uses the frozen 180/300 delays", () => {
    expect(ENTER).toBe(180);
    expect(LEAVE).toBe(300);
  });

  it("floating ball alone submits stage 1 (strip) after the enter delay and nothing more", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setStageOneEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER - 1);
    expect(submit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(submit.mock.calls).toEqual([[1, 0]]);

    vi.advanceTimersByTime(5000);
    expect(submit.mock.calls).toEqual([[1, 0]]);
  });

  it("hover expand promotes directly to stage 2, skipping the strip even with floating ball", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setStageOneEnabled(true);
    controller.setPromotionEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER);
    expect(submit.mock.calls).toEqual([[2, 0]]);

    vi.advanceTimersByTime(5000);
    expect(submit.mock.calls).toEqual([[2, 0]]);
  });

  it("hover expand without floating ball keeps the baseline single-stage timing", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setPromotionEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER);
    expect(submit.mock.calls).toEqual([[2, 0]]);
  });

  it("with both switches off enter submits nothing", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);

    controller.enter();
    vi.advanceTimersByTime(ENTER * 3);
    controller.leave();
    vi.advanceTimersByTime(LEAVE);

    expect(submit).not.toHaveBeenCalled();
  });

  it("quick pass never submits any stage", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setStageOneEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER - 20);
    controller.leave();
    vi.advanceTimersByTime(LEAVE * 2);

    expect(submit).not.toHaveBeenCalled();
  });

  it("leave submits stage 0 after the leave delay with the previous stage", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setPromotionEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER);
    controller.leave();
    vi.advanceTimersByTime(LEAVE - 1);
    expect(submit.mock.calls).toEqual([[2, 0]]);

    vi.advanceTimersByTime(1);
    expect(submit.mock.calls).toEqual([
      [2, 0],
      [0, 2],
    ]);
  });

  it("leave from the strip reports previous stage 1", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setStageOneEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER);
    controller.leave();
    vi.advanceTimersByTime(LEAVE);

    expect(submit.mock.calls).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("re-enter during the leave delay cancels the collapse without resubmitting", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setPromotionEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER);
    controller.leave();
    vi.advanceTimersByTime(LEAVE - 10);
    controller.enter();
    vi.advanceTimersByTime(LEAVE * 2);
    expect(submit.mock.calls).toEqual([[2, 0]]);

    controller.leave();
    vi.advanceTimersByTime(LEAVE);
    expect(submit.mock.calls).toEqual([
      [2, 0],
      [0, 2],
    ]);
  });

  it("manual action suppresses the rest of the hover cycle including the leave submit", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setPromotionEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER);
    controller.suppressCurrentCycle();
    controller.leave();
    vi.advanceTimersByTime(LEAVE * 2);

    expect(submit.mock.calls).toEqual([[2, 0]]);
  });

  it("manual action before the enter delay cancels automatic stages until a leave", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setPromotionEnabled(true);

    controller.enter();
    controller.suppressCurrentCycle();
    vi.advanceTimersByTime(ENTER * 3);
    controller.leave();
    vi.advanceTimersByTime(LEAVE);

    expect(submit).not.toHaveBeenCalled();
  });

  it("suppression resets the owned stage so a later leave does not collapse a manual expanded", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setStageOneEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER);
    controller.suppressCurrentCycle();
    controller.leave();
    vi.advanceTimersByTime(LEAVE);

    // 手动 expanded 后再次悬停右侧只重新上报 stage 1，leave 只能回到 stage 0(prev=1)，
    // 绝不产生 prev=2 的收起提交（那会触发前端折叠动画与手动展开打架）。
    controller.enter();
    vi.advanceTimersByTime(ENTER);
    controller.leave();
    vi.advanceTimersByTime(LEAVE);

    expect(submit.mock.calls).toEqual([
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
  });

  it("disabled controller ignores pointer events until re-enabled", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setStageOneEnabled(true);

    controller.disable();
    controller.enter();
    vi.advanceTimersByTime(ENTER * 3);
    controller.leave();
    vi.advanceTimersByTime(LEAVE);
    expect(submit).not.toHaveBeenCalled();

    controller.enable();
    controller.enter();
    vi.advanceTimersByTime(ENTER);
    expect(submit.mock.calls).toEqual([[1, 0]]);
  });

  it("disable submits stage 0 once with the previous stage and dispose stays silent", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setPromotionEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER);
    controller.disable();
    controller.dispose();
    vi.runAllTimers();

    expect(submit.mock.calls).toEqual([
      [2, 0],
      [0, 2],
    ]);
  });

  it("disable without an active stage does not submit", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);
    controller.setStageOneEnabled(true);

    controller.enter();
    vi.advanceTimersByTime(ENTER - 1);
    controller.disable();
    vi.runAllTimers();

    expect(submit).not.toHaveBeenCalled();
  });

  it("switch changes mid-dwell affect what the pending enter submits", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const controller = stageController(submit);

    controller.enter();
    vi.advanceTimersByTime(ENTER - 1);
    controller.setPromotionEnabled(true);
    vi.advanceTimersByTime(1);

    expect(submit.mock.calls).toEqual([[2, 0]]);
  });
});


describe("visual phases", () => {
  it("keeps the container expanded while content is collapsing", () => {
    expect(containerExpandedForPhase("compact")).toBe(false);
    expect(containerExpandedForPhase("expanding")).toBe(true);
    expect(containerExpandedForPhase("expanded")).toBe(true);
    expect(containerExpandedForPhase("collapsing")).toBe(true);
  });

  it("preserves an in-flight local animation phase", () => {
    expect(shouldSyncExternalVisualPhase("expanding")).toBe(false);
    expect(shouldSyncExternalVisualPhase("collapsing")).toBe(false);
    expect(shouldSyncExternalVisualPhase("compact")).toBe(true);
    expect(shouldSyncExternalVisualPhase("expanded")).toBe(true);
  });
});

describe("island style recipe", () => {
  it("legacy keeps leading dots and the baseline compact clock", () => {
    const recipe = islandStyleRecipe("legacy");
    expect(recipe.showLeadingDots).toBe(true);
    expect(recipe.compactClockClass).toBe("text-sm font-medium tabular-nums");
    expect(recipe.showScrollIndicator).toBe(false);
  });

  it("new removes leading dots, enlarges the compact clock and moves the indicator right", () => {
    const recipe = islandStyleRecipe("new");
    expect(recipe.showLeadingDots).toBe(false);
    expect(recipe.compactClockClass).toBe("text-lg font-medium tabular-nums");
    expect(recipe.compactClockClass).toContain("font-medium tabular-nums");
    expect(recipe.showScrollIndicator).toBe(true);
  });
});

describe("scroll indicator geometry", () => {
  it("returns null for a single page to avoid a misleading hint", () => {
    expect(scrollIndicatorGeometry(0, 1, 24)).toBeNull();
    expect(scrollIndicatorGeometry(0, 0, 24)).toBeNull();
  });

  it("pins the thumb to the track ends at the first and last page", () => {
    const track = 24;
    const count = 4;
    const thumb = track / count;
    expect(scrollIndicatorGeometry(0, count, track)).toEqual({ thumb, offset: 0 });
    expect(scrollIndicatorGeometry(count - 1, count, track)).toEqual({
      thumb,
      offset: track - thumb,
    });
  });

  it("distributes intermediate positions linearly", () => {
    const geometry = scrollIndicatorGeometry(1, 3, 30);
    expect(geometry).not.toBeNull();
    expect(geometry!.thumb).toBe(10);
    expect(geometry!.offset).toBe(10);
  });

  it("clamps an out-of-range index", () => {
    const track = 24;
    const thumb = track / 3;
    expect(scrollIndicatorGeometry(9, 3, track)).toEqual({ thumb, offset: track - thumb });
    expect(scrollIndicatorGeometry(-2, 3, track)).toEqual({ thumb, offset: 0 });
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

  it("waits for the parallel frontend collapse before submitting compact", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const controller = createIslandTransitionController({
      collapseDelay: 240,
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
    // 收起路径：先进入 collapsing 相位（保留 expanded 内容 + 开始 height 折叠动画），
    // 动画时长结束后才切到 compact 并提交原生 resize（11a.4 修复闪动的关键）。
    expect(calls).toEqual(["phase:collapsing"]);

    await vi.advanceTimersByTimeAsync(239);
    expect(calls).toEqual(["phase:collapsing"]);

    await vi.advanceTimersByTimeAsync(1);
    await request;
    expect(calls).toEqual([
      "phase:collapsing",
      "phase:compact",
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
