import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("island top bar layout", () => {
  it("keeps the top bar at the same vertical position and height in both states", () => {
    expect(appSource).not.toContain('expanded ? "h-[380px] py-3" : "h-14 py-0"');
    expect(appSource).toContain("height: expanded ? 380 : 56");
    expect(appSource).toContain('className="flex h-14 shrink-0 items-center gap-3"');
  });
});
