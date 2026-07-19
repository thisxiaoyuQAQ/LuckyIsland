import { beforeEach, describe, expect, it } from "vitest";
import { parseVisualStyle } from "@/lib/settings";
import { applyVisualStyleSetting, getVisualStyle } from "@/lib/visual-style";

describe("parseVisualStyle", () => {
  it("falls back to new for missing and invalid values", () => {
    expect(parseVisualStyle(null)).toBe("new");
    expect(parseVisualStyle(undefined)).toBe("new");
    expect(parseVisualStyle("")).toBe("new");
    expect(parseVisualStyle("NEW")).toBe("new");
    expect(parseVisualStyle("legacyy")).toBe("new");
    expect(parseVisualStyle("classic")).toBe("new");
  });

  it("accepts only the exact legacy value", () => {
    expect(parseVisualStyle("legacy")).toBe("legacy");
    expect(parseVisualStyle("new")).toBe("new");
  });
});

describe("visual style store", () => {
  beforeEach(() => {
    applyVisualStyleSetting("new");
  });

  it("defaults to new before any setting is applied", () => {
    expect(getVisualStyle()).toBe("new");
  });

  it("applies and reverts styles through the parser", () => {
    applyVisualStyleSetting("legacy");
    expect(getVisualStyle()).toBe("legacy");
    applyVisualStyleSetting("garbage");
    expect(getVisualStyle()).toBe("new");
    applyVisualStyleSetting(null);
    expect(getVisualStyle()).toBe("new");
  });
});
