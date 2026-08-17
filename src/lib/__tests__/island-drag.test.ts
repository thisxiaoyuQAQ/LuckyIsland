import { beforeEach, describe, expect, it, vi } from "vitest";
import { offsetFromWindowPosition } from "@/lib/island-drag";

const mocks = vi.hoisted(() => ({
  startDragging: vi.fn<() => Promise<void>>(),
  windowDragDropSettle: vi.fn<() => Promise<string>>(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ startDragging: mocks.startDragging }),
}));

vi.mock("@/lib/settings", () => ({ windowDragDropSettle: mocks.windowDragDropSettle }));

import { createIslandDragController } from "@/lib/island-drag-controller";

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

beforeEach(() => {
  vi.stubGlobal("Element", class {});
  vi.useFakeTimers();
  vi.clearAllMocks();
});

describe("createIslandDragController", () => {
  it("does not finish merely because the window pauses during native dragging", async () => {
    const nativeDrag = deferred<void>();
    mocks.startDragging.mockReturnValue(nativeDrag.promise);
    mocks.windowDragDropSettle.mockResolvedValue("top");
    const states: boolean[] = [];
    const controller = createIslandDragController({ setDragging: (value) => states.push(value) });

    controller.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(180);

    expect(mocks.windowDragDropSettle).not.toHaveBeenCalled();
    expect(states).toEqual([true]);
    controller.dispose();
  });

  it("settles only once when mouseup and mocks.startDragging resolution both signal completion", async () => {
    const nativeDrag = deferred<void>();
    const settle = deferred<string>();
    mocks.startDragging.mockReturnValue(nativeDrag.promise);
    mocks.windowDragDropSettle.mockReturnValue(settle.promise);
    const states: boolean[] = [];
    const controller = createIslandDragController({ setDragging: (value) => states.push(value) });

    controller.onMouseDown(altMouseDown());
    controller.onMouseUp();
    nativeDrag.resolve();
    await Promise.resolve();

    expect(mocks.windowDragDropSettle).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true]);
    settle.resolve("top");
    await Promise.resolve();
    await Promise.resolve();
    expect(states).toEqual([true, false]);
  });

  it("releases dragging after settle failure", async () => {
    mocks.startDragging.mockResolvedValue();
    mocks.windowDragDropSettle.mockRejectedValue(new Error("settle failed"));
    const states: boolean[] = [];
    const controller = createIslandDragController({ setDragging: (value) => states.push(value) });

    controller.onMouseDown(altMouseDown());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(states).toEqual([true, false]);
  });

  it("releases dragging when native drag startup fails", async () => {
    mocks.startDragging.mockRejectedValue(new Error("start failed"));
    const states: boolean[] = [];
    const controller = createIslandDragController({ setDragging: (value) => states.push(value) });

    controller.onMouseDown(altMouseDown());
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.windowDragDropSettle).not.toHaveBeenCalled();
    expect(states).toEqual([true, false]);
  });

  it("does not enter dragging for a normal left click", () => {
    const states: boolean[] = [];
    const controller = createIslandDragController({ setDragging: (value) => states.push(value) });
    const event = altMouseDown();
    Object.assign(event, { altKey: false });

    controller.onMouseDown(event);

    expect(mocks.startDragging).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  it("releases dragging on dispose and ignores stale native completion", async () => {
    const nativeDrag = deferred<void>();
    mocks.startDragging.mockReturnValue(nativeDrag.promise);
    mocks.windowDragDropSettle.mockResolvedValue("top");
    const states: boolean[] = [];
    const controller = createIslandDragController({ setDragging: (value) => states.push(value) });

    controller.onMouseDown(altMouseDown());
    controller.dispose();
    nativeDrag.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.windowDragDropSettle).not.toHaveBeenCalled();
    expect(states).toEqual([true, false]);
  });

  it("uses timeout only as a fallback and releases dragging", async () => {
    mocks.startDragging.mockReturnValue(new Promise<void>(() => undefined));
    mocks.windowDragDropSettle.mockResolvedValue("top");
    const states: boolean[] = [];
    const controller = createIslandDragController({ setDragging: (value) => states.push(value) });

    controller.onMouseDown(altMouseDown());
    await vi.advanceTimersByTimeAsync(3000);

    expect(mocks.windowDragDropSettle).toHaveBeenCalledTimes(1);
    expect(states).toEqual([true, false]);
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
