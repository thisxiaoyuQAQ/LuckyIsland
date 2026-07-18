import { describe, expect, it } from "vitest";
import {
  assertIpc,
  isAiCancelStatus,
  isAiHistoryList,
  isAiResponse,
  isKBar,
  isKBarList,
  isLocatedCity,
  isNotificationItem,
  isNotificationList,
  isQuote,
  isQuoteList,
  isStockSearchResultList,
  isWeatherBundle,
  isWeatherLocationList,
  type AiResponseLike,
  type KBarLike,
  type NotificationItemLike,
  type QuoteLike,
  type WeatherBundleLike,
} from "@/lib/ipc-schemas";

const validAiResponse: AiResponseLike = {
  reply: "ok",
  action: null,
  providerUsed: "claude-cli",
};

const validNotification: NotificationItemLike = {
  id: "n1",
  title: "title",
  body: null,
  source: "claude",
  level: "info",
  priority: "normal",
  created_at: 1,
  read: false,
  action: null,
};

const validQuote: QuoteLike = {
  symbol: "sh600519",
  name: "贵州茅台",
  code: "600519",
  current: 1,
  yesterday_close: 1,
  open: 1,
  high: 1,
  low: 1,
  change: 0,
  change_percent: 0,
  time: "2026-07-18 15:00",
  volume: 1,
  amount: 1,
  turnover_rate: 0,
  pe: 0,
  amplitude: 0,
  circ_market_cap: 0,
  total_market_cap: 0,
  pb: 0,
  limit_up: 0,
  limit_down: 0,
  volume_ratio: 0,
};

const validKBar: KBarLike = {
  date: "2026-07-18",
  open: 1,
  close: 1,
  high: 1,
  low: 1,
  volume: 1,
};

const validWeatherBundle: WeatherBundleLike = {
  now: {
    province: "北京",
    city: "北京",
    district: null,
    weather: "晴",
    weatherIcon: "100",
    temperature: 26,
    windDirection: "东风",
    windPower: "2级",
    humidity: 50,
    reportTime: "2026-07-18 12:00",
    alerts: [],
    offline: false,
    fetchedAt: 1,
  },
  forecast: [],
  source: {
    current: "uapis",
    forecast: "open-meteo",
    attribution: null,
    attributionUrl: null,
    license: null,
  },
  location: {
    queryName: "北京",
    displayName: "北京市",
    province: null,
    country: "中国",
    latitude: 0,
    longitude: 0,
    timezone: "Asia/Shanghai",
    providerId: "x",
  },
  timezone: "Asia/Shanghai",
  offline: false,
  partial: false,
  fetchedAt: 1,
};

describe("ipc-schemas AI", () => {
  it("accepts a valid AiResponse with null action", () => {
    expect(isAiResponse(validAiResponse)).toBe(true);
  });

  it("accepts a valid AiResponse with action", () => {
    expect(
      isAiResponse({
        ...validAiResponse,
        action: { action: "add_todo", args: { text: "x" }, success: true, message: "m" },
      }),
    ).toBe(true);
  });

  it("rejects malformed AiResponse", () => {
    expect(isAiResponse(null)).toBe(false);
    expect(isAiResponse({})).toBe(false);
    expect(isAiResponse({ ...validAiResponse, reply: 1 })).toBe(false);
    expect(isAiResponse({ ...validAiResponse, providerUsed: "unknown" })).toBe(false);
    expect(isAiResponse({ ...validAiResponse, action: { action: "x" } })).toBe(false);
  });

  it("validates cancel status", () => {
    expect(isAiCancelStatus("cancelled")).toBe(true);
    expect(isAiCancelStatus("already_finished")).toBe(true);
    expect(isAiCancelStatus("not_current")).toBe(true);
    expect(isAiCancelStatus("other")).toBe(false);
    expect(isAiCancelStatus(1)).toBe(false);
  });

  it("validates history row tuples", () => {
    expect(isAiHistoryList([["user", "hi"]])).toBe(true);
    expect(isAiHistoryList([["user", "hi", "ignored"]])).toBe(true);
    expect(isAiHistoryList([])).toBe(true);
    expect(isAiHistoryList([["user"]])).toBe(false);
    expect(isAiHistoryList([[1, "hi"]])).toBe(false);
    expect(isAiHistoryList("not an array")).toBe(false);
  });
});

describe("ipc-schemas notify", () => {
  it("accepts a valid NotificationItem", () => {
    expect(isNotificationItem(validNotification)).toBe(true);
    expect(
      isNotificationItem({
        ...validNotification,
        action: { action_type: "open_terminal", cwd: "C:\\" },
      }),
    ).toBe(true);
  });

  it("rejects invalid priority and missing fields", () => {
    expect(isNotificationItem({ ...validNotification, priority: "low" })).toBe(false);
    expect(isNotificationItem({ ...validNotification, id: 1 })).toBe(false);
    expect(isNotificationItem({ ...validNotification, action: { action_type: "other", cwd: "x" } })).toBe(false);
    expect(isNotificationItem(null)).toBe(false);
  });

  it("validates a list", () => {
    expect(isNotificationList([validNotification])).toBe(true);
    expect(isNotificationList([validNotification, null])).toBe(false);
  });
});

describe("ipc-schemas weather", () => {
  it("accepts a valid WeatherBundle", () => {
    expect(isWeatherBundle(validWeatherBundle)).toBe(true);
  });

  it("rejects when nested now/forecast/location invalid", () => {
    expect(isWeatherBundle({ ...validWeatherBundle, now: null })).toBe(false);
    expect(isWeatherBundle({ ...validWeatherBundle, forecast: [null] })).toBe(false);
    expect(
      isWeatherBundle({
        ...validWeatherBundle,
        location: { ...validWeatherBundle.location, latitude: "0" },
      }),
    ).toBe(false);
    expect(
      isWeatherBundle({
        ...validWeatherBundle,
        now: { ...validWeatherBundle.now, alerts: [{ title: "t" }] },
      }),
    ).toBe(false);
  });

  it("accepts nullable precipitation and province", () => {
    expect(
      isWeatherBundle({
        ...validWeatherBundle,
        forecast: [
          {
            date: "2026-07-18",
            weather: "晴",
            weatherIcon: "100",
            tempMin: 1,
            tempMax: 2,
            precipitationProbability: null,
          },
        ],
      }),
    ).toBe(true);
  });

  it("validates located city and location search list", () => {
    expect(isLocatedCity({ city: "北京", region: "北京", ip: "1.1.1.1" })).toBe(true);
    expect(isLocatedCity({ city: "北京" })).toBe(false);
    expect(isWeatherLocationList([validWeatherBundle.location])).toBe(true);
    expect(isWeatherLocationList([{ ...validWeatherBundle.location, providerId: 1 }])).toBe(false);
  });
});

describe("ipc-schemas stock", () => {
  it("accepts valid quote/kbar/search results", () => {
    expect(isQuote(validQuote)).toBe(true);
    expect(isQuoteList([validQuote])).toBe(true);
    expect(isKBar(validKBar)).toBe(true);
    expect(isKBarList([validKBar])).toBe(true);
    expect(isStockSearchResultList([{ name: "茅台", symbol: "sh600519", market: "sh" }])).toBe(true);
  });

  it("rejects malformed quote/kbar/search results", () => {
    expect(isQuote({ ...validQuote, current: "1" })).toBe(false);
    expect(isQuote({ ...validQuote, pe: null })).toBe(false);
    expect(isQuoteList([validQuote, { ...validQuote, name: 1 }])).toBe(false);
    expect(isKBar({ ...validKBar, volume: "1" })).toBe(false);
    expect(isStockSearchResultList([{ name: "x", symbol: "y" }])).toBe(false);
  });
});

describe("assertIpc", () => {
  it("returns the value when guard passes", () => {
    expect(assertIpc("test", validAiResponse, isAiResponse)).toBe(validAiResponse);
  });

  it("throws a labeled error when guard fails", () => {
    expect(() => assertIpc("ai_chat", { reply: 1 }, isAiResponse)).toThrow(/\[ipc\] ai_chat/);
  });
});
