import { beforeEach, describe, expect, it } from "vitest";
import { KEYS, UI_MODES, modeKey, parseUiMode } from "@/lib/settings";
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

describe("modeKey（13a.2 三模式独立外观键）", () => {
  it("每个模式的外观键互不相同", () => {
    expect(modeKey(KEYS.windowOpacity, "corner")).toBe("window:opacity:corner");
    expect(modeKey(KEYS.windowOffsetX, "island")).toBe("window:offset_x:island");
    expect(modeKey(KEYS.windowOffsetY, "classisland")).toBe("window:offset_y:classisland");
    // 三模式 × 三个外观项 = 9 个互不相同的键（「共享同一份值」的回归护栏）。
    const keys = UI_MODES.flatMap((mode) =>
      [KEYS.windowOpacity, KEYS.windowOffsetX, KEYS.windowOffsetY].map((base) =>
        modeKey(base, mode),
      ),
    );
    expect(new Set(keys).size).toBe(9);
  });

  it("与后端 monitor::mode_key 的裸键前缀保持一致", () => {
    // 后端按 `window:offset_` 前缀判定导入是否需要重新上屏，键必须仍以裸键开头。
    for (const mode of UI_MODES) {
      expect(modeKey(KEYS.windowOffsetX, mode).startsWith(KEYS.windowOffsetX)).toBe(true);
      expect(modeKey(KEYS.windowOffsetY, mode).startsWith(KEYS.windowOffsetY)).toBe(true);
      // 可迁移设置白名单按 `window:` 前缀放行，后缀键必须仍然命中。
      expect(modeKey(KEYS.windowOpacity, mode).startsWith("window:")).toBe(true);
    }
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
