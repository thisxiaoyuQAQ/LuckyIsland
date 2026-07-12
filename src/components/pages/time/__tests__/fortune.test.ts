import { describe, it, expect } from "vitest";
import { generateFortune, ensureTodayFortune, type Fortune } from "../fortuneContent";

describe("generateFortune", () => {
  it("生成合法字段", () => {
    const f = generateFortune("2026-07-12");
    expect(f.date).toBe("2026-07-12");
    expect(f.level.length).toBeGreaterThan(0);
    expect(f.blessing.length).toBeGreaterThan(0);
    expect(f.stars).toBeGreaterThanOrEqual(1);
    expect(f.stars).toBeLessThanOrEqual(5);
    expect(f.luckyNumber).toBeGreaterThanOrEqual(0);
    expect(f.luckyNumber).toBeLessThanOrEqual(9);
    expect(f.luckyColor.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("ensureTodayFortune", () => {
  it("同日期返回已存", () => {
    const stored: Fortune = {
      date: "2026-07-12",
      level: "大吉",
      blessing: "x",
      stars: 5,
      luckyNumber: 7,
      luckyColor: { name: "竹青", hex: "#6c9a8b" },
    };
    expect(ensureTodayFortune(stored, "2026-07-12")).toBe(stored);
  });
  it("跨日期重新生成", () => {
    const stored: Fortune = {
      date: "2026-07-11",
      level: "大吉",
      blessing: "x",
      stars: 5,
      luckyNumber: 7,
      luckyColor: { name: "竹青", hex: "#6c9a8b" },
    };
    const f = ensureTodayFortune(stored, "2026-07-12");
    expect(f.date).toBe("2026-07-12");
  });
  it("无存档生成", () => {
    expect(ensureTodayFortune(null, "2026-07-12").date).toBe("2026-07-12");
  });
});
