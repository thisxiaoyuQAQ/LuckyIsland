import { beforeEach, describe, expect, it, vi } from "vitest";
import { offsetFromWindowPosition } from "@/lib/island-drag";

const mocks = vi.hoisted(() => ({
  windowDragBegin: vi.fn<() => Promise<number | null>>(),
  windowDragCancel: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/lib/settings", () => ({
  windowDragBegin: mocks.windowDragBegin,
  windowDragCancel: mocks.windowDragCancel,
}));

import { DRAG_SAFETY_TIMEOUT_MS, createIslandDragController } from "@/lib/island-drag-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function altMouseDown() {
  return {
    button: 0,
    altKey: true,
    target: {},
    preventDefault: vi.fn(),
  } as unknown as MouseEvent;
}

function controller(options: Partial<Parameters<typeof createIslandDragController>[0]> = {}) {
  const states: boolean[] = [];
  const recover = vi.fn(async () => undefined);
  const instance = createIslandDragController({
    setDragging: (value) => states.push(value),
    recoverAfterSettleFailure: recover,
    ...options,
  });
  return { instance, states, recover };
}

beforeEach(() => {
  vi.stubGlobal("Element", class {});
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.windowDragBegin.mockResolvedValue(7);
  mocks.windowDragCancel.mockResolvedValue(undefined);
});

// 2026-11-09 真机反馈：Windows 上 startDragging 立即返回、网页收不到松手 mouseup，
// 前端按 mouseup/超时结算会落在系统拖动循环中途。改为 Rust 判定结束并广播 drag-settled。
describe("createIslandDragController", () => {
  it("enters the drag presentation and asks Rust to start the native drag", async () => {
    const { instance, states } = controller();

    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toEqual([true]);
    expect(mocks.windowDragBegin).toHaveBeenCalledTimes(1);
    instance.dispose();
  });

  it("stays in drag mode however long the drag takes until Rust reports the settle", async () => {
    const { instance, states } = controller();

    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(states).toEqual([true]);

    instance.onSettled({ id: 7, ok: true, edge: "top", error: null });
    expect(states).toEqual([true, false]);
    instance.dispose();
  });

  it("ignores settle events for other drags", async () => {
    const { instance, states } = controller();

    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(0);
    instance.onSettled({ id: 6, ok: true, edge: "top", error: null });

    expect(states).toEqual([true]);
    instance.dispose();
  });

  it("accepts a settle that arrives before the begin reply", async () => {
    const begin = deferred<number | null>();
    mocks.windowDragBegin.mockReturnValue(begin.promise);
    const { instance, states } = controller();

    instance.onMouseDown(altMouseDown());
    instance.onSettled({ id: 7, ok: true, edge: "left", error: null });
    expect(states).toEqual([true]);

    begin.resolve(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual([true, false]);
    instance.dispose();
  });

  it("recovers frontend state when Rust reports a failed settle", async () => {
    const { instance, states, recover } = controller();

    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(0);
    instance.onSettled({ id: 7, ok: false, edge: null, error: "读取拖动落点失败" });
    await vi.advanceTimersByTimeAsync(0);

    expect(recover).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true, false]);
    instance.dispose();
  });

  it("leaves drag mode when the drag did not start (taskbar mode)", async () => {
    mocks.windowDragBegin.mockResolvedValue(null);
    const { instance, states } = controller();

    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toEqual([true, false]);
    expect(mocks.windowDragCancel).not.toHaveBeenCalled();
    instance.dispose();
  });

  it("leaves drag mode and recovers when starting the drag fails", async () => {
    mocks.windowDragBegin.mockRejectedValue(new Error("开始拖动失败"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { instance, states, recover } = controller();

    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(0);

    expect(states).toEqual([true, false]);
    expect(recover).toHaveBeenCalledTimes(1);
    error.mockRestore();
    instance.dispose();
  });

  it("cancels through Rust if no settle ever arrives", async () => {
    const { instance, states, recover } = controller();

    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(DRAG_SAFETY_TIMEOUT_MS - 1);
    expect(mocks.windowDragCancel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.windowDragCancel).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true, false]);
    // 先等 Rust 取消完成再恢复界面状态。
    await vi.advanceTimersByTimeAsync(0);
    expect(recover).toHaveBeenCalledTimes(1);
    instance.dispose();
  });

  it("ignores a second Alt+press while a drag is in progress", async () => {
    const { instance } = controller();

    instance.onMouseDown(altMouseDown());
    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.windowDragBegin).toHaveBeenCalledTimes(1);
    instance.dispose();
  });

  it("does not enter dragging for a normal left click, when disabled, or on a button", () => {
    const { instance, states } = controller({ canDrag: () => false });
    instance.onMouseDown(altMouseDown());

    const plain = controller();
    const event = altMouseDown();
    Object.assign(event, { altKey: false });
    plain.instance.onMouseDown(event);

    const onButton = controller();
    class FakeElement {
      closest() {
        return {};
      }
    }
    vi.stubGlobal("Element", FakeElement);
    const buttonEvent = altMouseDown();
    Object.assign(buttonEvent, { target: new FakeElement() });
    onButton.instance.onMouseDown(buttonEvent);

    expect(mocks.windowDragBegin).not.toHaveBeenCalled();
    expect(states).toEqual([]);
    expect(plain.states).toEqual([]);
    expect(onButton.states).toEqual([]);
  });

  it("cancels an in-progress drag on dispose and ignores its late settle", async () => {
    const { instance, states } = controller();

    instance.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(0);
    instance.dispose();
    instance.onSettled({ id: 7, ok: true, edge: "top", error: null });

    expect(mocks.windowDragCancel).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true, false]);
  });

  it("cancels a drag whose begin reply arrives after dispose", async () => {
    const begin = deferred<number | null>();
    mocks.windowDragBegin.mockReturnValue(begin.promise);
    const { instance } = controller();

    instance.onMouseDown(altMouseDown());
    instance.dispose();
    begin.resolve(7);
    await vi.advanceTimersByTimeAsync(0);

    // dispose 时已取消一次；晚到的 begin 不再重复进入拖动态。
    expect(mocks.windowDragCancel).toHaveBeenCalledTimes(1);
  });
});

describe("offsetFromWindowPosition", () => {
  it("returns zero at the island floating top-center baseline", () => {
    expect(
      offsetFromWindowPosition(
        { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
        { x: 600, y: 16 },
        { width: 720, height: 400 },
        16,
      ),
    ).toEqual([0, 0]);
  });

  it("calculates offsets on monitors with negative desktop coordinates", () => {
    expect(
      offsetFromWindowPosition(
        { position: { x: -2560, y: -200 }, size: { width: 2560, height: 1440 } },
        { x: -1750, y: 50 },
        { width: 1080, height: 600 },
        16,
      ),
    ).toEqual([70, 234]);
  });

  it("uses the zero-gap baseline for classisland", () => {
    expect(
      offsetFromWindowPosition(
        { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
        { x: 500, y: 120 },
        { width: 720, height: 400 },
        0,
      ),
    ).toEqual([-100, 120]);
  });
});
