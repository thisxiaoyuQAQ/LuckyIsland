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
