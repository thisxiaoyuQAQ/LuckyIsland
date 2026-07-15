import { describe, expect, it } from "vitest";
import { parseSettingsTab, shouldCheckUpdateOnNavigation } from "../settings";

describe("parseSettingsTab", () => {
  it("accepts known tabs including About", () => {
    expect(parseSettingsTab("about")).toBe("about");
    expect(parseSettingsTab("general")).toBe("general");
    expect(parseSettingsTab("time_appearance")).toBe("time_appearance");
  });

  it("rejects arbitrary event payloads", () => {
    expect(parseSettingsTab("unknown-panel")).toBeNull();
    expect(parseSettingsTab(null)).toBeNull();
    expect(parseSettingsTab({ tab: "about" })).toBeNull();
  });

  it("checks in About only when the settings-side store has no active result", () => {
    expect(shouldCheckUpdateOnNavigation("about", "idle")).toBe(true);
    expect(shouldCheckUpdateOnNavigation("about", "error")).toBe(true);
    expect(shouldCheckUpdateOnNavigation("about", "available")).toBe(false);
    expect(shouldCheckUpdateOnNavigation("general", "idle")).toBe(false);
  });
});
