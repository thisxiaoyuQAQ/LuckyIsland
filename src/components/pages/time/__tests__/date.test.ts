import { describe, it, expect } from "vitest";
import {
  localDateKey,
  moodStreak,
  isCrazyThursday,
  meritMilestoneCrossed,
  rolloverMerit,
  applyMeritClick,
} from "../date";

describe("localDateKey", () => {
  it("本地日期 YYYY-MM-DD", () => {
    expect(localDateKey(new Date(2026, 6, 12))).toBe("2026-07-12");
  });
});

describe("moodStreak", () => {
  it("连续 3 天含今天", () => {
    const rec = { "2026-07-10": "good", "2026-07-11": "good", "2026-07-12": "good" };
    expect(moodStreak(rec, "2026-07-12")).toBe(3);
  });
  it("漏记一天中断", () => {
    const rec = { "2026-07-09": "good", "2026-07-11": "good", "2026-07-12": "good" };
    expect(moodStreak(rec, "2026-07-12")).toBe(2);
  });
  it("今天未记则从昨天起算", () => {
    const rec = { "2026-07-10": "good", "2026-07-11": "good" };
    expect(moodStreak(rec, "2026-07-12")).toBe(2);
  });
  it("今天修改不重复增加连续", () => {
    const rec = { "2026-07-12": "good" };
    expect(moodStreak(rec, "2026-07-12")).toBe(1);
  });
});

describe("isCrazyThursday", () => {
  it("2026-07-16 是周四", () => {
    expect(isCrazyThursday(new Date(2026, 6, 16))).toBe(true);
  });
  it("2026-07-12 不是周四", () => {
    expect(isCrazyThursday(new Date(2026, 6, 12))).toBe(false);
  });
});

describe("merit", () => {
  it("9->10 跨越 10", () => {
    expect(meritMilestoneCrossed(9, 10)).toBe(10);
  });
  it("10->11 不跨越", () => {
    expect(meritMilestoneCrossed(10, 11)).toBe(null);
  });
  it("99->100 跨越 100", () => {
    expect(meritMilestoneCrossed(99, 100)).toBe(100);
  });
  it("rolloverMerit 跨日期清零今日、保留累计", () => {
    const stored = { date: "2026-07-11", todayCount: 30, totalCount: 100, lastMilestone: 10 };
    expect(rolloverMerit(stored, "2026-07-12")).toEqual({
      date: "2026-07-12",
      todayCount: 0,
      totalCount: 100,
      lastMilestone: null,
    });
  });
  it("rolloverMerit 同日期原样返回", () => {
    const stored = { date: "2026-07-12", todayCount: 5, totalCount: 100, lastMilestone: null };
    expect(rolloverMerit(stored, "2026-07-12")).toBe(stored);
  });
  it("applyMeritClick 跨里程碑返回 crossed", () => {
    const r = applyMeritClick({ date: "2026-07-12", todayCount: 9, totalCount: 100, lastMilestone: null });
    expect(r.crossed).toBe(10);
    expect(r.state.todayCount).toBe(10);
    expect(r.state.lastMilestone).toBe(10);
  });
  it("applyMeritClick 非里程碑 crossed=null", () => {
    const r = applyMeritClick({ date: "2026-07-12", todayCount: 10, totalCount: 100, lastMilestone: 10 });
    expect(r.crossed).toBe(null);
    expect(r.state.todayCount).toBe(11);
  });
});
