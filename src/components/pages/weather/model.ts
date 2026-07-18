export interface WeatherAlert {
  title: string;
  alertType: string;
  level: string;
  text: string;
  publishTime: string;
  publisher: string;
}

export interface WeatherNow {
  province: string;
  city: string;
  district: string | null;
  weather: string;
  weatherIcon: string;
  temperature: number;
  windDirection: string;
  windPower: string;
  humidity: number;
  reportTime: string;
  alerts: WeatherAlert[];
  offline: boolean;
  fetchedAt: number;
}

export interface WeatherLocation {
  queryName: string;
  displayName: string;
  province: string | null;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  providerId: string;
}

export interface WeatherDay {
  date: string;
  weather: string;
  weatherIcon: string;
  tempMin: number;
  tempMax: number;
  precipitationProbability: number | null;
}

export interface WeatherSourceInfo {
  current: string;
  forecast: string;
  attribution: string | null;
  attributionUrl: string | null;
  license: string | null;
}

export interface WeatherBundle {
  now: WeatherNow;
  forecast: WeatherDay[];
  source: WeatherSourceInfo;
  location: WeatherLocation;
  timezone: string;
  offline: boolean;
  partial: boolean;
  fetchedAt: number;
}

export interface WeatherCommandError {
  code: "ambiguous_location" | "not_found" | "unavailable";
  message: string;
  candidates?: WeatherLocation[];
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function isoDayNumber(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function weatherDayLabel(date: string, timezone: string, todayDate: string): string {
  const target = isoDayNumber(date);
  const today = isoDayNumber(todayDate);
  if (target === null || today === null) return date;
  const difference = target - today;
  if (difference === 0) return "今天";
  if (difference === 1) return "明天";
  const noonUtc = new Date(`${date}T12:00:00Z`);
  try {
    const weekday = new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone,
      weekday: "short",
    }).format(noonUtc);
    return weekday.replace("星期", "周");
  } catch {
    return WEEKDAYS[noonUtc.getUTCDay()];
  }
}

export function dateInTimezone(timezone: string, date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function hasPrecipitation(day: WeatherDay): boolean {
  return day.precipitationProbability !== null;
}

export function displayForecast(days: WeatherDay[]): WeatherDay[] {
  return days.slice(0, 7);
}

export function wheelDeltaToHorizontal(deltaX: number, deltaY: number): number {
  return Math.abs(deltaX) > 0 ? deltaX : deltaY;
}

export class RequestGate {
  private current = 0;

  next(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(id: number): boolean {
    return id === this.current;
  }
}

export function parseWeatherCommandError(error: unknown): WeatherCommandError | null {
  if (!error || typeof error !== "object") return null;
  const value = error as Record<string, unknown>;
  if (
    (value.code === "ambiguous_location" || value.code === "not_found" || value.code === "unavailable") &&
    typeof value.message === "string"
  ) {
    return value as unknown as WeatherCommandError;
  }
  return null;
}

// ---- 按城市的在途请求状态机（B5b：pending/error/generation + 请求去重）----
//
// 每个城市一条独立的 CityFetchEntry，互不覆盖：
// - generation：单调递增，标识「第几次发起」，供 UI 区分新旧；
// - token：本进程内唯一的在途凭据。begin 时若该城市已有 inflight，则复用旧 token（去重），
//   否则发新 token 并 generation+1。响应回抵时凭 token 判定「是不是当前这次」，
//   晚到的旧响应（token 不匹配 / 城市不符 / 已不在途）一律忽略。

export interface CityFetchEntry {
  /** 本进程唯一的在途凭据；0 表示从未发起 */
  token: number;
  /** 单调递增的发起代数，去重不递增 */
  generation: number;
  /** 是否曾有请求被发起且尚未被显式丢弃（供「天气…」首载判定） */
  pending: boolean;
  /** 是否有在途请求（决定去重与晚到判定） */
  inflight: boolean;
  /** 最近一次失败的兜底错误信息（定位失败等整页错误）；普通失败只置离线缓存 */
  error: string | null;
  /** 最近一次 ambiguous_location 的候选地点；成功/新发起时清空 */
  candidates: WeatherLocation[] | null;
}

export function emptyCityFetchEntry(): CityFetchEntry {
  return { token: 0, generation: 0, pending: false, inflight: false, error: null, candidates: null };
}

/** 城市维度响应（fetchWeather 把 invoke 结果归一化成它，与组件解耦便于测试） */
export type CityFetchResult =
  | { kind: "ok"; city: string }
  | { kind: "error"; city: string; message: string }
  | { kind: "ambiguous"; city: string; candidates: WeatherLocation[] };

let nextFetchToken = 0;

export interface BeginCityFetch {
  entry: CityFetchEntry;
  /** 本次应使用的凭据；去重时等于既有 token */
  token: number;
  /** true 表示复用了在途请求，不应再次 invoke */
  deduped: boolean;
}

export function beginCityFetch(prev: CityFetchEntry | null, _city: string): BeginCityFetch {
  const base = prev ?? emptyCityFetchEntry();
  if (base.inflight) {
    // 请求去重：该城市已有在途请求，复用其 token，generation 不递增。
    return { entry: base, token: base.token, deduped: true };
  }
  const token = ++nextFetchToken;
  return {
    entry: {
      ...base,
      token,
      generation: base.generation + 1,
      pending: true,
      inflight: true,
      error: null,
      candidates: null,
    },
    token,
    deduped: false,
  };
}

export type CityFetchOutcome =
  | { kind: "ignored" }
  | { kind: "result"; entry: CityFetchEntry };

/**
 * 响应归位：仅当 (city 匹配 且 token 仍是当前在途凭据) 时接受，
 * 否则返回 { kind: "ignored" }（晚到 / 串城市 / 已被丢弃）。
 */
export function cityFetchOutcome(
  entry: CityFetchEntry,
  city: string,
  token: number,
  result: CityFetchResult,
): CityFetchOutcome {
  if (result.city !== city) return { kind: "ignored" };
  if (!entry.inflight || token !== entry.token) return { kind: "ignored" };
  if (result.kind === "error") {
    return {
      kind: "result",
      entry: { ...entry, inflight: false, pending: false, error: result.message, candidates: null },
    };
  }
  if (result.kind === "ambiguous") {
    return {
      kind: "result",
      entry: { ...entry, inflight: false, pending: false, error: null, candidates: result.candidates },
    };
  }
  return {
    kind: "result",
    entry: { ...entry, inflight: false, pending: false, error: null, candidates: null },
  };
}

/** 显式把某城市标记为失败（不清 generation），用于刷新失败但保留离线缓存的场景。 */
export function failCityFetch(entry: CityFetchEntry, message: string): CityFetchEntry {
  return { ...entry, inflight: false, pending: false, error: message, candidates: null };
}

/** 成功落缓存后归位到空闲（保留既有 error，由 UI 依据缓存/离线徽标自行决定显隐）。 */
export function resolveCityFetch(entry: CityFetchEntry): CityFetchEntry {
  return { ...entry, inflight: false, pending: false };
}
