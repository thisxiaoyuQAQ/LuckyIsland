import { beforeEach, describe, expect, it } from "vitest";
import { KEYS, modeKey, parseIslandWidth } from "@/lib/settings";
import { applyIslandWidthSetting, getIslandWidth } from "@/lib/island-width";
import { expandedTabsWrap } from "@/lib/window-policy";

describe("expandedTabsWrap（模块 14 短岛展开页签换行）", () => {
  it("窄容器 + 多页签需要换行，宽容器不需要", () => {
    // 7 页签 × 90 + 200 余量 = 830，默认 720 容器需换行。
    expect(expandedTabsWrap(720, 7)).toBe(true);
    // 加宽到 900 后单行放得下。
    expect(expandedTabsWrap(900, 7)).toBe(false);
    // 少页签（如只启用 3 页）在默认 720 也放得下。
    expect(expandedTabsWrap(720, 3)).toBe(false);
    expect(expandedTabsWrap(420, 3)).toBe(true);
  });

  it("无页签不换行", () => {
    expect(expandedTabsWrap(420, 0)).toBe(false);
  });
});

describe("parseIslandWidth（模块 14 岛长度）", () => {
  it("falls back to 720 for missing and invalid values", () => {
    expect(parseIslandWidth(null)).toBe(720);
    expect(parseIslandWidth(undefined)).toBe(720);
    expect(parseIslandWidth("")).toBe(720);
    expect(parseIslandWidth("abc")).toBe(720);
    expect(parseIslandWidth("NaN")).toBe(720);
  });

  it("clamps valid values into 420~1600", () => {
    expect(parseIslandWidth("0")).toBe(420);
    expect(parseIslandWidth("100")).toBe(420);
    expect(parseIslandWidth("420")).toBe(420);
    expect(parseIslandWidth("720")).toBe(720);
    expect(parseIslandWidth("640")).toBe(640);
    expect(parseIslandWidth("1600")).toBe(1600);
    expect(parseIslandWidth("99999")).toBe(1600);
    expect(parseIslandWidth("-50")).toBe(420);
  });

  it("宽度键按界面模式独立且命中 window: 前缀白名单", () => {
    expect(modeKey(KEYS.windowWidth, "island")).toBe("window:width:island");
    expect(modeKey(KEYS.windowWidth, "classisland")).toBe("window:width:classisland");
    expect(modeKey(KEYS.windowWidth, "island")).not.toBe(
      modeKey(KEYS.windowWidth, "classisland"),
    );
    // 可迁移设置白名单按 `window:` 前缀放行，随配置导入导出迁移。
    expect(modeKey(KEYS.windowWidth, "island").startsWith("window:")).toBe(true);
  });
});

describe("island width store", () => {
  beforeEach(() => {
    applyIslandWidthSetting(null);
  });

  it("defaults to 720 before any setting is applied", () => {
    expect(getIslandWidth()).toBe(720);
  });

  it("applies, clamps and reverts widths through the parser", () => {
    applyIslandWidthSetting("900");
    expect(getIslandWidth()).toBe(900);
    applyIslandWidthSetting("100"); // clamp 到 420
    expect(getIslandWidth()).toBe(420);
    applyIslandWidthSetting("99999"); // clamp 到 1600
    expect(getIslandWidth()).toBe(1600);
    applyIslandWidthSetting("garbage"); // 回退 720
    expect(getIslandWidth()).toBe(720);
    applyIslandWidthSetting(null); // 回退 720
    expect(getIslandWidth()).toBe(720);
  });
});
