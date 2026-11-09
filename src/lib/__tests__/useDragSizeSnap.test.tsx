// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import { useDragSizeSnap } from "@/lib/island-layout";

function Probe({ dragging }: { dragging: boolean }) {
  return <div data-testid="snap" data-snap={String(useDragSizeSnap(dragging))} />;
}

const snap = () => document.querySelector('[data-testid="snap"]')?.getAttribute("data-snap");

// happy-dom 的 requestAnimationFrame 会在 async act 内触发；手动收集回调以确定性地推进「下一帧」。
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("useDragSizeSnap (review #8)", () => {
  it("snaps while dragging and for one frame after the drag ends, then animates again", async () => {
    const tree = await mountReactTree(<Probe dragging={false} />);
    expect(snap()).toBe("false");

    await act(async () => tree.root.render(<Probe dragging />));
    expect(snap()).toBe("true");

    // 拖动结束的这一帧原生窗口已由落点结算改回停靠几何，容器同步到位，避免溢出 80px 窗口被裁。
    await act(async () => tree.root.render(<Probe dragging={false} />));
    expect(snap()).toBe("true");

    expect(frames).toHaveLength(1);
    await act(async () => frames.splice(0).forEach((callback) => callback(0)));
    await flushReactWork();
    expect(snap()).toBe("false");
    await tree.unmount();
  });
});
