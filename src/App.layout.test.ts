import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const topBarSource = readFileSync(new URL("./pages/IslandTopBar.tsx", import.meta.url), "utf8");

describe("island top bar layout", () => {
  it("keeps the top bar at the same vertical position and height in both states", () => {
    expect(appSource).not.toContain('expanded ? "h-[380px] py-3" : "h-14 py-0"');
    expect(topBarSource).not.toContain('expanded ? "h-[380px] py-3" : "h-14 py-0"');
    expect(appSource).toContain("height: expanded ? 380 : 56");
    expect(topBarSource).toContain('className="flex h-14 shrink-0 items-center gap-3"');
  });

  // BUG-20260719-01 回归：胶囊进出过渡宽度必须与高度同帧动画，遮住原生 resize 跳变。
  it("animates container width between capsule and strip widths", () => {
    expect(appSource).toContain("width: containerWidthPx");
    expect(appSource).toContain("CAPSULE_WIDTH_PX");
    expect(appSource).toContain("ISLAND_STRIP_WIDTH_PX");
    expect(appSource).toContain("collapsingToCapsule");
  });
});
