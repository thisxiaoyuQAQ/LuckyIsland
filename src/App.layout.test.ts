import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const topBarSource = readFileSync(new URL("./pages/IslandTopBar.tsx", import.meta.url), "utf8");
const dockNavigationSource = readFileSync(new URL("./pages/DockNavigation.tsx", import.meta.url), "utf8");
const dragPresentationSource = readFileSync(new URL("./pages/DragPresentation.tsx", import.meta.url), "utf8");
const islandBodySource = readFileSync(new URL("./pages/IslandBody.tsx", import.meta.url), "utf8");
const islandLayoutSource = readFileSync(new URL("./lib/island-layout.ts", import.meta.url), "utf8");

describe("island top bar layout", () => {
  it("keeps the top bar at the same vertical position and height in both states", () => {
    expect(appSource).not.toContain('expanded ? "h-[380px] py-3" : "h-14 py-0"');
    expect(topBarSource).not.toContain('expanded ? "h-[380px] py-3" : "h-14 py-0"');
    expect(appSource).toContain("height: heightTargetPx");
    // 模块 14 短岛展开页签换行后，h-14 通过条件 class 保留（基础单行 / wrapTabs 多行）。
    expect(topBarSource).toContain('"flex h-14 shrink-0 gap-3"');
  });

  // BUG-20260719-01 回归：胶囊进出过渡宽度必须与高度同帧动画，遮住原生 resize 跳变。
  // 模块 14：条状/展开容器宽度改读 islandWidth（window:width:<mode>），胶囊仍固定 240。
  // BUG-20261108-01：尺寸计算移入 island-layout.ts，具体数值由 lib/__tests__/island-layout.test.ts 断言。
  it("animates container width between capsule and island widths", () => {
    expect(appSource).toContain("width: containerWidthPx");
    expect(appSource).toContain("islandShellLayout(");
    expect(appSource).toContain("islandWidth,");
    expect(appSource).toContain("capsuleLike: capsule || collapsingToCapsule");
    expect(islandLayoutSource).toContain("CAPSULE_WIDTH_PX");
    // 容器宽度不再由 ISLAND_STRIP_WIDTH_PX 常量决定（已改为 window:width:<mode>）。
    expect(appSource).not.toContain("ISLAND_STRIP_WIDTH_PX");
  });

  it("uses an independent 240x80 drag presentation", () => {
    expect(appSource).toContain('data-presentation={presentation}');
    expect(appSource).toContain("<DragPresentation");
    expect(dragPresentationSource).toContain('data-drag-presentation');
    expect(dragPresentationSource).toContain("拖动调整位置");
    expect(appSource).toContain("dragging,");
    expect(islandLayoutSource).toContain("if (input.dragging)");
  });

  it("uses icon-only vertical navigation and inward right-edge mirroring", () => {
    expect(appSource).toContain("<DockNavigation");
    expect(appSource).toContain('dockEdge === "right" && isVerticalDock && "flex-row-reverse"');
    expect(islandBodySource).toContain('"relative min-h-0 min-w-0 flex-1 overflow-hidden p-2"');
    expect(dockNavigationSource).toContain('data-dock-navigation');
    expect(dockNavigationSource).toContain('className="flex h-full min-h-0 w-14');
    expect(dockNavigationSource).not.toContain("DockedStrip");
    expect(dockNavigationSource).not.toContain("rotate-");
    expect(appSource).toContain('isVerticalDock ? "flex-row p-0"');
  });
});
