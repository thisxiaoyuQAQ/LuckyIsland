import { describe, expect, it } from "vitest";
import {
  RequestGate,
  displayForecast,
  hasPrecipitation,
  weatherDayLabel,
  wheelDeltaToHorizontal,
  type WeatherDay,
} from "../model";

function day(date: string, precipitationProbability: number | null = null): WeatherDay {
  return {
    date,
    weather: "晴",
    weatherIcon: "☀️",
    tempMin: 20,
    tempMax: 30,
    precipitationProbability,
  };
}

describe("weather forecast model", () => {
  it("labels today, tomorrow and weekdays without host-local date parsing", () => {
    expect(weatherDayLabel("2026-07-16", "Asia/Shanghai", "2026-07-16")).toBe("今天");
    expect(weatherDayLabel("2026-07-17", "Asia/Shanghai", "2026-07-16")).toBe("明天");
    expect(weatherDayLabel("2026-07-18", "Asia/Shanghai", "2026-07-16")).toBe("周六");
  });

  it("shows precipitation only when the supplier provided it", () => {
    expect(hasPrecipitation(day("2026-07-16", null))).toBe(false);
    expect(hasPrecipitation(day("2026-07-16", 0))).toBe(true);
  });

  it("keeps honest one-day and seven-day arrays without padding", () => {
    expect(displayForecast([day("2026-07-16")])).toHaveLength(1);
    expect(displayForecast(Array.from({ length: 7 }, (_, index) => day(`2026-07-${16 + index}`))))
      .toHaveLength(7);
  });

  it("maps vertical wheel to horizontal and prefers native horizontal delta", () => {
    expect(wheelDeltaToHorizontal(0, 80)).toBe(80);
    expect(wheelDeltaToHorizontal(-40, 80)).toBe(-40);
  });

  it("rejects city A after city B starts", () => {
    const gate = new RequestGate();
    const a = gate.next();
    const b = gate.next();
    expect(gate.isCurrent(a)).toBe(false);
    expect(gate.isCurrent(b)).toBe(true);
  });
});
