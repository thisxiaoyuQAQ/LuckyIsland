import { describe, expect, it } from "vitest";
import { islandShellLayout, shellSizeTransition, type IslandShellInput } from "@/lib/island-layout";
import { ISLAND_EXPAND_DURATION_MS, ISLAND_LAYERED_EASE } from "@/lib/anim";

const base: IslandShellInput = {
  dockEdge: "top",
  docked: false,
  dragging: false,
  expanded: false,
  capsuleLike: false,
  islandWidth: 720,
  taskbar: false,
};

function layout(patch: Partial<IslandShellInput>) {
  return islandShellLayout({ ...base, ...patch });
}

describe("island shell layout (BUG-20261108-01)", () => {
  it("keeps the v0.4.1 shadow inset along a horizontal edge and a full-width capsule", () => {
    expect(layout({})).toMatchObject({ widthPx: 700, heightPx: 56 });
    expect(layout({ expanded: true })).toMatchObject({ widthPx: 700, heightPx: 380 });
    expect(layout({ capsuleLike: true })).toMatchObject({ widthPx: 240, heightPx: 56 });
    expect(layout({ islandWidth: 1000 })).toMatchObject({ widthPx: 980 });
  });

  it("pins a top-docked island to the top and a bottom-docked island to the bottom", () => {
    expect(layout({}).wrapperClass).toBe("items-start justify-center pt-3");
    expect(layout({ docked: true }).wrapperClass).toBe("items-start justify-center");
    // #4：贴底与贴顶镜像——容器贴窗口底边，island 模式在贴屏一侧留同样的 12px。
    expect(layout({ dockEdge: "bottom" }).wrapperClass).toBe("items-end justify-center pb-3");
    expect(layout({ dockEdge: "bottom", docked: true }).wrapperClass).toBe(
      "items-end justify-center",
    );
  });

  it("rotates the horizontal layout for vertical docks (contract: width and height swap)", () => {
    // #5：贴右时容器贴窗口右边，向屏内展开。
    expect(layout({ dockEdge: "right" }).wrapperClass).toBe("items-center justify-end pr-3");
    expect(layout({ dockEdge: "left" }).wrapperClass).toBe("items-center justify-start pl-3");
    expect(layout({ dockEdge: "left", docked: true }).wrapperClass).toBe(
      "items-center justify-start",
    );
    expect(layout({ dockEdge: "left" })).toMatchObject({ widthPx: 56, heightPx: 700 });
    expect(layout({ dockEdge: "right", expanded: true })).toMatchObject({
      widthPx: 380,
      heightPx: 700,
    });
    expect(layout({ dockEdge: "left", capsuleLike: true })).toMatchObject({
      widthPx: 56,
      heightPx: 240,
    });
  });

  it("flattens the screen-side corners only when the island touches the edge", () => {
    expect(layout({}).shapeClass).toBe("rounded-2xl");
    expect(layout({ dockEdge: "bottom" }).shapeClass).toBe("rounded-2xl");
    expect(layout({ dockEdge: "right" }).shapeClass).toBe("rounded-2xl");
    expect(layout({ docked: true }).shapeClass).toBe("rounded-b-2xl rounded-t-none border-t-0");
    expect(layout({ docked: true, dockEdge: "bottom" }).shapeClass).toBe(
      "rounded-t-2xl rounded-b-none border-b-0",
    );
    expect(layout({ docked: true, dockEdge: "left" }).shapeClass).toBe(
      "rounded-r-2xl rounded-l-none border-l-0",
    );
    expect(layout({ docked: true, dockEdge: "right" }).shapeClass).toBe(
      "rounded-l-2xl rounded-r-none border-r-0",
    );
  });

  it("fills the 240x80 native drag window on every edge", () => {
    for (const dockEdge of ["top", "bottom", "left", "right"] as const) {
      expect(layout({ dockEdge, dragging: true, expanded: true, docked: true })).toEqual({
        wrapperClass: "items-center justify-center",
        shapeClass: "rounded-2xl",
        widthPx: 240,
        heightPx: 80,
      });
    }
  });

  it("keeps the taskbar panel geometry unchanged whatever the stored dock edge", () => {
    expect(layout({ taskbar: true, expanded: true, dockEdge: "left" })).toEqual({
      wrapperClass: "items-start justify-center pt-3",
      shapeClass: "rounded-2xl",
      widthPx: 720,
      heightPx: 380,
    });
  });
});

describe("shell size transition", () => {
  it("animates normally and snaps when motion is reduced or the drag capsule takes over", () => {
    expect(shellSizeTransition({ reducedMotion: false, dragging: false })).toEqual({
      duration: ISLAND_EXPAND_DURATION_MS / 1000,
      ease: ISLAND_LAYERED_EASE,
    });
    expect(shellSizeTransition({ reducedMotion: true, dragging: false })).toEqual({ duration: 0 });
    // 进入拖动时原生窗口同步切到 240×80，容器若仍动画会被裁成直角块。
    expect(shellSizeTransition({ reducedMotion: false, dragging: true })).toEqual({ duration: 0 });
  });
});
