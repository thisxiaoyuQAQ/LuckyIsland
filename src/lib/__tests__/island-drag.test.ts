import { describe, expect, it } from "vitest";
import { offsetFromWindowPosition } from "@/lib/island-drag";

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
