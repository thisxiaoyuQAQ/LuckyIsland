import { describe, expect, it } from "vitest";
import {
  beginCityFetch,
  cityFetchOutcome,
  emptyCityFetchEntry,
  failCityFetch,
  resolveCityFetch,
  type CityFetchResult,
  type WeatherLocation,
} from "../model";

const ok = (city: string): CityFetchResult => ({ kind: "ok", city });
const ambiguous = (city: string, names: string[]): CityFetchResult => ({
  kind: "ambiguous",
  city,
  candidates: names.map((name): WeatherLocation => ({
    queryName: name,
    displayName: name,
    province: null,
    country: "中国",
    latitude: 0,
    longitude: 0,
    timezone: "Asia/Shanghai",
    providerId: name,
  })),
});

describe("weather per-city fetch machine", () => {
  it("begins a first request as generation 1, pending and inflight", () => {
    const begin = beginCityFetch(null, "北京");
    expect(begin.deduped).toBe(false);
    expect(begin.token).toBeGreaterThan(0);
    expect(begin.entry.generation).toBe(1);
    expect(begin.entry.pending).toBe(true);
    expect(begin.entry.inflight).toBe(true);
    expect(begin.entry.error).toBeNull();
    expect(begin.entry.candidates).toBeNull();
    expect(begin.entry.token).toBe(begin.token);
  });

  it("keeps each city's generation independent", () => {
    const beijing = beginCityFetch(null, "北京");
    const shanghai = beginCityFetch(null, "上海");

    expect(beijing.entry.generation).toBe(1);
    expect(shanghai.entry.generation).toBe(1);
    expect(beijing.token).not.toBe(shanghai.token);

    // 重启北京（先归位）不影响上海：上海的旧 token 依旧有效。
    const beijing2 = beginCityFetch(resolveCityFetch(beijing.entry), "北京");
    expect(beijing2.entry.generation).toBe(2);
    expect(cityFetchOutcome(shanghai.entry, "上海", shanghai.token, ok("上海")).kind).toBe("result");
  });

  it("dedupes a second begin while the same city is inflight", () => {
    const first = beginCityFetch(null, "北京");
    const deduped = beginCityFetch(first.entry, "北京");

    expect(deduped.deduped).toBe(true);
    expect(deduped.token).toBe(first.token);
    expect(deduped.entry.generation).toBe(1);
    expect(deduped.entry.inflight).toBe(true);
  });

  it("starts a fresh generation after the previous fetch settled", () => {
    const first = beginCityFetch(null, "北京");
    const resolved = resolveCityFetch(first.entry);
    expect(resolved.inflight).toBe(false);
    expect(resolved.pending).toBe(false);

    const second = beginCityFetch(resolved, "北京");
    expect(second.deduped).toBe(false);
    expect(second.token).not.toBe(first.token);
    expect(second.entry.generation).toBe(2);
    expect(second.entry.inflight).toBe(true);
  });

  it("ignores a stale response superseded by a newer begin", () => {
    const first = beginCityFetch(null, "北京");
    const second = beginCityFetch(resolveCityFetch(first.entry), "北京");

    expect(cityFetchOutcome(second.entry, "北京", first.token, ok("北京")).kind).toBe("ignored");
    const outcome = cityFetchOutcome(second.entry, "北京", second.token, ok("北京"));
    expect(outcome.kind).toBe("result");
    if (outcome.kind === "result") {
      expect(outcome.entry.inflight).toBe(false);
      expect(outcome.entry.error).toBeNull();
    }
  });

  it("ignores a response that arrives after the inflight entry was dropped", () => {
    const begin = beginCityFetch(null, "北京");
    const dropped = { ...begin.entry, inflight: false, pending: false };
    expect(cityFetchOutcome(dropped, "北京", begin.token, ok("北京")).kind).toBe("ignored");
  });

  it("ignores a response addressed to a different city", () => {
    const begin = beginCityFetch(null, "北京");
    expect(cityFetchOutcome(begin.entry, "北京", begin.token, ok("上海")).kind).toBe("ignored");
  });

  it("stores a failure with its message and clears pending", () => {
    const begin = beginCityFetch(null, "北京");
    const outcome = cityFetchOutcome(begin.entry, "北京", begin.token, {
      kind: "error",
      city: "北京",
      message: "网络超时",
    });

    expect(outcome.kind).toBe("result");
    if (outcome.kind === "result") {
      expect(outcome.entry.error).toBe("网络超时");
      expect(outcome.entry.pending).toBe(false);
      expect(outcome.entry.inflight).toBe(false);
      expect(outcome.entry.candidates).toBeNull();
    }
  });

  it("stores ambiguous candidates without treating them as an error", () => {
    const begin = beginCityFetch(null, "北京");
    const outcome = cityFetchOutcome(begin.entry, "北京", begin.token, ambiguous("北京", ["北京市", "北京城区"]));

    expect(outcome.kind).toBe("result");
    if (outcome.kind === "result") {
      expect(outcome.entry.candidates?.map((location) => location.displayName)).toEqual(["北京市", "北京城区"]);
      expect(outcome.entry.error).toBeNull();
      expect(outcome.entry.inflight).toBe(false);
    }
  });

  it("clears candidates when a new fetch begins", () => {
    const begin = beginCityFetch(null, "北京");
    const withCandidates = cityFetchOutcome(begin.entry, "北京", begin.token, ambiguous("北京", ["北京市"]));
    if (withCandidates.kind !== "result") throw new Error("expected result");
    const restarted = beginCityFetch(withCandidates.entry, "北京");
    expect(restarted.entry.candidates).toBeNull();
    expect(restarted.entry.error).toBeNull();
  });

  it("fails an inflight city explicitly without touching its generation", () => {
    const begin = beginCityFetch(null, "北京");
    const failed = failCityFetch(begin.entry, "定位失败");
    expect(failed.error).toBe("定位失败");
    expect(failed.inflight).toBe(false);
    expect(failed.pending).toBe(false);
    expect(failed.generation).toBe(begin.entry.generation);
  });

  it("resolves an inflight entry to idle", () => {
    const begin = beginCityFetch(null, "北京");
    const resolved = resolveCityFetch(begin.entry);
    expect(resolved.inflight).toBe(false);
    expect(resolved.pending).toBe(false);
    expect(resolved.generation).toBe(begin.entry.generation);
  });

  it("provides a clean empty entry", () => {
    expect(emptyCityFetchEntry()).toEqual({
      token: 0,
      generation: 0,
      pending: false,
      inflight: false,
      error: null,
      candidates: null,
    });
  });
});
