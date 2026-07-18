import {
  assertIpc,
  hasNumFields,
  hasStrFields,
  isArr,
  isBool,
  isNullable,
  isNum,
  isObj,
  isOneOf,
  isStr,
  type Guard,
} from "@/lib/ipc-guard";

export type { Guard };

// ---- AI 域 ----

export interface ActionExecLike {
  action: string;
  args: unknown;
  success: boolean;
  message: string;
}

export interface AiResponseLike {
  reply: string;
  action: ActionExecLike | null;
  providerUsed: "claude-cli" | "codex-cli" | "chat-api";
}

export const isActionExec: Guard<ActionExecLike> = (value): value is ActionExecLike => {
  if (!isObj(value)) return false;
  return isStr(value.action) && isBool(value.success) && isStr(value.message);
};

export const isProviderKind = isOneOf("claude-cli", "codex-cli", "chat-api");

export const isAiResponse: Guard<AiResponseLike> = (value): value is AiResponseLike => {
  if (!isObj(value)) return false;
  return isStr(value.reply) && isNullable(isActionExec)(value.action) && isProviderKind(value.providerUsed);
};

export const isAiCancelStatus = isOneOf("cancelled", "already_finished", "not_current");

/** ai_history_list 返回 [role, content][] 元组（后端未使用第3列，但 invoke 声明为三元组）。 */
export const isAiHistoryRow = (value: unknown): value is [string, string, string] => {
  return Array.isArray(value) && value.length >= 2 && isStr(value[0]) && isStr(value[1]);
};

export const isAiHistoryList = isArr(isAiHistoryRow);

// ---- 通知域 ----

export interface NotifyActionLike {
  action_type: "open_terminal";
  cwd: string;
}

export interface NotificationItemLike {
  id: string;
  title: string;
  body: string | null;
  source: string;
  level: string;
  priority: "normal" | "high" | "critical";
  created_at: number;
  read: boolean;
  action: NotifyActionLike | null;
}

export const isNotifyAction: Guard<NotifyActionLike> = (value): value is NotifyActionLike => {
  if (!isObj(value)) return false;
  return value.action_type === "open_terminal" && isStr(value.cwd);
};

export const isNotificationItem: Guard<NotificationItemLike> = (value): value is NotificationItemLike => {
  if (!isObj(value)) return false;
  if (!hasStrFields(value, "id", "title")) return false;
  if (!isNullable(isStr)(value.body)) return false;
  if (!isStr(value.source) || !isStr(value.level)) return false;
  if (!isOneOf("normal", "high", "critical")(value.priority)) return false;
  if (!isNum(value.created_at) || !isBool(value.read)) return false;
  return isNullable(isNotifyAction)(value.action);
};

export const isNotificationList = isArr(isNotificationItem);

// ---- 天气域 ----

export interface WeatherLocationLike {
  queryName: string;
  displayName: string;
  province: string | null;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  providerId: string;
}

export interface WeatherNowLike {
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
  alerts: WeatherAlertLike[];
  offline: boolean;
  fetchedAt: number;
}

export interface WeatherDayLike {
  date: string;
  weather: string;
  weatherIcon: string;
  tempMin: number;
  tempMax: number;
  precipitationProbability: number | null;
}

export interface WeatherSourceInfoLike {
  current: string;
  forecast: string;
  attribution: string | null;
  attributionUrl: string | null;
  license: string | null;
}

export interface WeatherBundleLike {
  now: WeatherNowLike;
  forecast: WeatherDayLike[];
  source: WeatherSourceInfoLike;
  location: WeatherLocationLike;
  timezone: string;
  offline: boolean;
  partial: boolean;
  fetchedAt: number;
}

export const isWeatherLocation: Guard<WeatherLocationLike> = (value): value is WeatherLocationLike => {
  if (!isObj(value)) return false;
  if (!hasStrFields(value, "queryName", "displayName", "country", "timezone", "providerId")) return false;
  if (!isNullable(isStr)(value.province)) return false;
  return hasNumFields(value, "latitude", "longitude");
};

export interface WeatherAlertLike {
  title: string;
  alertType: string;
  level: string;
  text: string;
  publishTime: string;
  publisher: string;
}

export const isWeatherAlertLike: Guard<WeatherAlertLike> = (value): value is WeatherAlertLike => {
  if (!isObj(value)) return false;
  return hasStrFields(value, "title", "alertType", "level", "text", "publishTime", "publisher");
};

export const isWeatherNow: Guard<WeatherNowLike> = (value): value is WeatherNowLike => {
  if (!isObj(value)) return false;
  if (!hasStrFields(value, "province", "city", "weather", "weatherIcon", "windDirection", "windPower", "reportTime")) {
    return false;
  }
  if (!isNullable(isStr)(value.district)) return false;
  if (!hasNumFields(value, "temperature", "humidity", "fetchedAt")) return false;
  if (!isBool(value.offline)) return false;
  return isArr(isWeatherAlertLike)(value.alerts);
};

export const isWeatherDay: Guard<WeatherDayLike> = (value): value is WeatherDayLike => {
  if (!isObj(value)) return false;
  if (!hasStrFields(value, "date", "weather", "weatherIcon")) return false;
  if (!hasNumFields(value, "tempMin", "tempMax")) return false;
  return isNullable(isNum)(value.precipitationProbability);
};

export const isWeatherSourceInfo: Guard<WeatherSourceInfoLike> = (value): value is WeatherSourceInfoLike => {
  if (!isObj(value)) return false;
  if (!hasStrFields(value, "current", "forecast")) return false;
  return isNullable(isStr)(value.attribution) && isNullable(isStr)(value.attributionUrl) && isNullable(isStr)(value.license);
};

export const isWeatherBundle: Guard<WeatherBundleLike> = (value): value is WeatherBundleLike => {
  if (!isObj(value)) return false;
  if (!isWeatherNow(value.now)) return false;
  if (!isArr(isWeatherDay)(value.forecast)) return false;
  if (!isWeatherSourceInfo(value.source)) return false;
  if (!isWeatherLocation(value.location)) return false;
  if (!isStr(value.timezone)) return false;
  if (!isBool(value.offline) || !isBool(value.partial)) return false;
  return isNum(value.fetchedAt);
};

export interface LocatedCityLike {
  city: string;
  region: string;
  ip: string;
}

export const isLocatedCity: Guard<LocatedCityLike> = (value): value is LocatedCityLike => {
  return hasStrFields(value, "city", "region", "ip");
};

export const isWeatherLocationList = isArr(isWeatherLocation);

export const isStringList = isArr(isStr);

// ---- 股票域 ----

export interface QuoteLike {
  symbol: string;
  name: string;
  code: string;
  current: number;
  yesterday_close: number;
  open: number;
  high: number;
  low: number;
  change: number;
  change_percent: number;
  time: string;
  volume: number;
  amount: number;
  turnover_rate: number;
  pe: number;
  amplitude: number;
  circ_market_cap: number;
  total_market_cap: number;
  pb: number;
  limit_up: number;
  limit_down: number;
  volume_ratio: number;
}

export const isQuote: Guard<QuoteLike> = (value): value is QuoteLike => {
  if (!isObj(value)) return false;
  if (!hasStrFields(value, "symbol", "name", "code", "time")) return false;
  return hasNumFields(
    value,
    "current",
    "yesterday_close",
    "open",
    "high",
    "low",
    "change",
    "change_percent",
    "volume",
    "amount",
    "turnover_rate",
    "pe",
    "amplitude",
    "circ_market_cap",
    "total_market_cap",
    "pb",
    "limit_up",
    "limit_down",
    "volume_ratio",
  );
};

export const isQuoteList = isArr(isQuote);

export interface StockSearchResultLike {
  name: string;
  symbol: string;
  market: string;
}

export const isStockSearchResult: Guard<StockSearchResultLike> = (value): value is StockSearchResultLike => {
  return hasStrFields(value, "name", "symbol", "market");
};

export const isStockSearchResultList = isArr(isStockSearchResult);

export interface KBarLike {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export const isKBar: Guard<KBarLike> = (value): value is KBarLike => {
  if (!isObj(value)) return false;
  if (!isStr(value.date)) return false;
  return hasNumFields(value, "open", "close", "high", "low", "volume");
};

export const isKBarList = isArr(isKBar);

export { assertIpc };
