import { beforeEach, describe, expect, it } from "vitest";
import { parseUiMode } from "@/lib/settings";
import { applyUiModeSetting, getUiMode } from "@/lib/ui-mode";

describe("parseUiMode", () => {
  it("falls back to island for missing and invalid values", () => {
    expect(parseUiMode(null)).toBe("island");
    expect(parseUiMode(undefined)).toBe("island");
    expect(parseUiMode("")).toBe("island");
    expect(parseUiMode("CLASSISLAND")).toBe("island");
    expect(parseUiMode("CORNER")).toBe("island");
    expect(parseUiMode("docked")).toBe("island");
    expect(parseUiMode("classislandd")).toBe("island");
  });

  it("accepts the exact classisland and corner values", () => {
    expect(parseUiMode("classisland")).toBe("classisland");
    expect(parseUiMode("corner")).toBe("corner");
    expect(parseUiMode("island")).toBe("island");
  });
});

describe("ui mode store", () => {
  beforeEach(() => {
    applyUiModeSetting("island");
  });

  it("defaults to island before any setting is applied", () => {
    expect(getUiMode()).toBe("island");
  });

  it("applies and reverts modes through the parser", () => {
    applyUiModeSetting("classisland");
    expect(getUiMode()).toBe("classisland");
    applyUiModeSetting("corner");
    expect(getUiMode()).toBe("corner");
    applyUiModeSetting("garbage");
    expect(getUiMode()).toBe("island");
    applyUiModeSetting("classisland");
    expect(getUiMode()).toBe("classisland");
    applyUiModeSetting(null);
    expect(getUiMode()).toBe("island");
  });
});
