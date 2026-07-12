import { describe, it, expect } from "vitest";
import {
  parseSayingConfig,
  parseHistoryConfig,
  parseFortuneConfig,
  parseWoodenFishConfig,
  parseMoodConfig,
} from "../widgetConfig";

describe("widget config defaults", () => {
  it("saying", () => {
    expect(parseSayingConfig(null)).toEqual({ refreshOnEnter: true, clickToRefresh: true });
  });
  it("history", () => {
    expect(parseHistoryConfig(null)).toEqual({ showCategory: true, autoRotate: false });
  });
  it("fortune", () => {
    expect(parseFortuneConfig(null)).toEqual({ animation: true });
  });
  it("wooden_fish", () => {
    expect(parseWoodenFishConfig(null)).toEqual({
      sound: true,
      volume: 0.5,
      animation: true,
      crazyThursday: true,
    });
  });
  it("wooden_fish volume clamp", () => {
    expect(
      parseWoodenFishConfig(
        JSON.stringify({ sound: false, volume: 5, animation: false, crazyThursday: false }),
      ).volume,
    ).toBe(1);
  });
  it("mood", () => {
    expect(parseMoodConfig(null)).toEqual({ showStreak: true });
  });
});
