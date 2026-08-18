import { beforeEach, describe, expect, it } from "vitest";
import { KEYS, UI_MODES, modeKey, parseUiMode } from "@/lib/settings";
import { applyUiModeSetting, getUiMode } from "@/lib/ui-mode";

describe("parseUiMode", () => {
  it("falls back to island for missing and invalid values", () => {
    expect(parseUiMode(null)).toBe("island");
    expect(parseUiMode(undefined)).toBe("island");
    expect(parseUiMode("")).toBe("island");
    expect(parseUiMode("CLASSISLAND")).toBe("island");
    expect(parseUiMode("docked")).toBe("island");
    expect(parseUiMode("corner")).toBe("island");
    expect(parseUiMode("classislandd")).toBe("island");
  });

  it("accepts the exact classisland and taskbar values", () => {
    expect(parseUiMode("classisland")).toBe("classisland");
    expect(parseUiMode("taskbar")).toBe("taskbar");
    expect(parseUiMode("island")).toBe("island");
  });
});

describe("modeKey（每种界面模式独立外观键）", () => {
  it("每个模式的外观键互不相同", () => {
    expect(modeKey(KEYS.windowOpacity, "island")).toBe("window:opacity:island");
    expect(modeKey(KEYS.windowOffsetX, "classisland")).toBe("window:offset_x:classisland");
    expect(modeKey(KEYS.windowOffsetY, "island")).toBe("window:offset_y:island");
    expect(modeKey(KEYS.windowWidth, "taskbar")).toBe("window:width:taskbar");
    expect(modeKey(KEYS.windowOpacity, "taskbar")).toBe("window:opacity:taskbar");
    expect(modeKey(KEYS.windowOffsetX, "taskbar")).toBe("window:offset_x:taskbar");
    // 三模式 × 三个外观项 = 9 个互不相同的键（taskbar 不得读取 island/classisland 的值）。
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
    applyUiModeSetting("taskbar");
    expect(getUiMode()).toBe("taskbar");
    applyUiModeSetting("corner");
    expect(getUiMode()).toBe("island");
    applyUiModeSetting("classisland");
    expect(getUiMode()).toBe("classisland");
    applyUiModeSetting(null);
    expect(getUiMode()).toBe("island");
  });
});
