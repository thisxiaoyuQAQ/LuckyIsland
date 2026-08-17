import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const topBarSource = readFileSync(new URL("./pages/IslandTopBar.tsx", import.meta.url), "utf8");

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
  it("animates container width between capsule and island widths", () => {
    expect(appSource).toContain("width: containerWidthPx");
    expect(appSource).toContain("CAPSULE_WIDTH_PX");
    expect(appSource).toContain("islandWidth");
    expect(appSource).toContain("collapsingToCapsule");
    // 容器宽度不再由 ISLAND_STRIP_WIDTH_PX 常量决定（已改为 window:width:<mode>）。
    expect(appSource).not.toContain("ISLAND_STRIP_WIDTH_PX");
  });
});
