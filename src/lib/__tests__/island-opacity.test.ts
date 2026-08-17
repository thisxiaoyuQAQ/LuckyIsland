import { beforeEach, describe, expect, it } from "vitest";
import { KEYS, modeKey, phaseOpacityKey, resolvePhaseOpacity } from "@/lib/settings";
import { applyIslandOpacity, getIslandOpacity } from "@/lib/island-opacity";

describe("resolvePhaseOpacity（模块 14 T2 三级回退）", () => {
  it("相位专属键存在时优先，合法值 clamp 到 0.1~1.0", () => {
    expect(resolvePhaseOpacity("0.9", "0.3")).toBe(0.9);
    expect(resolvePhaseOpacity("0.2", null)).toBe(0.2);
    expect(resolvePhaseOpacity("5", null)).toBe(1); // 超界 clamp
    expect(resolvePhaseOpacity("0", null)).toBe(0.1);
  });

  it("相位键缺失时回落该模式旧裸键", () => {
    expect(resolvePhaseOpacity(null, "0.4")).toBe(0.4);
    expect(resolvePhaseOpacity(undefined, "0.4")).toBe(0.4);
    expect(resolvePhaseOpacity("", "0.4")).toBe(0.4);
    // 相位键非法（非空但解析失败）按 0.7，不再看裸键。
    expect(resolvePhaseOpacity("abc", "0.4")).toBe(0.7);
  });

  it("两者都缺时回退全局默认 0.7", () => {
    expect(resolvePhaseOpacity(null, null)).toBe(0.7);
    expect(resolvePhaseOpacity(undefined, undefined)).toBe(0.7);
    expect(resolvePhaseOpacity("", "")).toBe(0.7);
  });
});

describe("phaseOpacityKey（模块 14 T2 相位键命名）", () => {
  it("生成 window:opacity:<mode>:<phase>，命中 window: 前缀白名单", () => {
    expect(phaseOpacityKey("island", "expanded")).toBe("window:opacity:island:expanded");
    expect(phaseOpacityKey("island", "compact")).toBe("window:opacity:island:compact");
    expect(phaseOpacityKey("classisland", "expanded")).toBe("window:opacity:classisland:expanded");
    expect(phaseOpacityKey("island", "expanded").startsWith("window:")).toBe(true);
    // 与该模式旧裸键（回退来源）区分。
    expect(phaseOpacityKey("island", "compact")).not.toBe(modeKey(KEYS.windowOpacity, "island"));
  });
});

describe("island opacity store", () => {
  beforeEach(() => {
    applyIslandOpacity(null, null, null, null);
  });

  it("defaults to 0.7/0.7 before any setting is applied", () => {
    expect(getIslandOpacity()).toEqual({ expanded: 0.7, compact: 0.7 });
  });

  it("keeps the two phases independent", () => {
    applyIslandOpacity("0.9", null, "0.4", null);
    expect(getIslandOpacity()).toEqual({ expanded: 0.9, compact: 0.4 });
  });

  it("falls back to the mode bare key per phase when the phase key is missing", () => {
    applyIslandOpacity(null, "0.6", null, "0.6");
    expect(getIslandOpacity()).toEqual({ expanded: 0.6, compact: 0.6 });
  });
});
