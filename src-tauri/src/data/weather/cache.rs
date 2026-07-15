use serde::{Deserialize, Serialize};

use super::{model::WeatherDay, WeatherNow};

#[derive(Clone, Debug)]
pub struct MergedWeather {
    pub now: WeatherNow,
    pub forecast: Vec<WeatherDay>,
    pub timezone: String,
    pub offline: bool,
    pub partial: bool,
    pub fetched_at: i64,
    pub now_fresh: bool,
    pub forecast_fresh: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedWeather {
    pub location_key: String,
    pub now: Option<WeatherNow>,
    pub now_fetched_at: Option<i64>,
    pub forecast: Option<Vec<WeatherDay>>,
    pub forecast_timezone: Option<String>,
    pub forecast_fetched_at: Option<i64>,
}

fn normalize_city(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(['市', '区', '县'])
        .to_lowercase()
}

pub fn migrate_legacy_current(
    requested_city: &str,
    target_query: &str,
    current: WeatherNow,
) -> Option<WeatherNow> {
    let requested = normalize_city(requested_city);
    let target = normalize_city(target_query);
    let cached = normalize_city(&current.city);
    (requested == target && cached == target).then_some(current)
}

pub fn merge_weather(
    now_result: Result<WeatherNow, String>,
    forecast_result: Result<(String, Vec<WeatherDay>), String>,
    cached: Option<CachedWeather>,
    target_location_key: &str,
    fetched_at: i64,
) -> Result<MergedWeather, String> {
    let cached = cached.filter(|value| value.location_key == target_location_key);
    let fresh_now = now_result.ok();
    let fresh_forecast = forecast_result.ok().filter(|(_, days)| !days.is_empty());
    let mut now = fresh_now
        .clone()
        .or_else(|| cached.as_ref().and_then(|value| value.now.clone()))
        .ok_or_else(|| "current weather unavailable for this location".to_string())?;
    let (timezone, forecast) = fresh_forecast
        .clone()
        .or_else(|| {
            let value = cached.as_ref()?;
            let days = value.forecast.clone()?;
            if days.is_empty() {
                return None;
            }
            Some((value.forecast_timezone.clone()?, days))
        })
        .ok_or_else(|| "forecast unavailable for this location".to_string())?;
    let now_fresh = fresh_now.is_some();
    let forecast_fresh = fresh_forecast.is_some();
    now.offline = !now_fresh;
    if now_fresh {
        now.fetched_at = fetched_at;
    }
    Ok(MergedWeather {
        now,
        forecast,
        timezone,
        offline: !now_fresh && !forecast_fresh,
        partial: now_fresh != forecast_fresh,
        fetched_at,
        now_fresh,
        forecast_fresh,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current(city: &str) -> WeatherNow {
        WeatherNow {
            province: "江苏".into(),
            city: city.into(),
            district: None,
            weather: "晴".into(),
            weather_icon: "☀️".into(),
            temperature: 28.0,
            wind_direction: "东".into(),
            wind_power: "2".into(),
            humidity: 50.0,
            report_time: "2026-07-16 10:00".into(),
            alerts: vec![],
            offline: false,
            fetched_at: 100,
        }
    }

    fn forecast(count: usize) -> (String, Vec<WeatherDay>) {
        (
            "Asia/Shanghai".into(),
            (0..count)
                .map(|index| WeatherDay {
                    date: format!("2026-07-{}", 16 + index),
                    weather: "晴".into(),
                    weather_icon: "☀️".into(),
                    temp_min: 20.0,
                    temp_max: 30.0,
                    precipitation_probability: None,
                })
                .collect(),
        )
    }

    fn cache(key: &str, with_now: bool, forecast_days: usize) -> CachedWeather {
        CachedWeather {
            location_key: key.into(),
            now: with_now.then(|| current("无锡")),
            now_fetched_at: with_now.then_some(80),
            forecast: (forecast_days > 0).then(|| forecast(forecast_days).1),
            forecast_timezone: (forecast_days > 0).then(|| "Asia/Shanghai".into()),
            forecast_fetched_at: (forecast_days > 0).then_some(90),
        }
    }

    #[test]
    fn both_fresh_is_online_and_complete() {
        let merged = merge_weather(Ok(current("无锡")), Ok(forecast(7)), None, "loc", 100).unwrap();
        assert!(!merged.offline);
        assert!(!merged.partial);
        assert_eq!(merged.forecast.len(), 7);
        assert!(merged.now_fresh);
        assert!(merged.forecast_fresh);
        assert_eq!(merged.now.fetched_at, 100);
        assert!(!merged.now.offline);
    }

    #[test]
    fn fresh_now_and_cached_forecast_is_partial() {
        let merged = merge_weather(
            Ok(current("无锡")),
            Err("forecast".into()),
            Some(cache("loc", false, 7)),
            "loc",
            100,
        )
        .unwrap();
        assert!(merged.partial);
        assert!(!merged.offline);
        assert!(merged.now_fresh);
        assert!(!merged.forecast_fresh);
    }

    #[test]
    fn fresh_forecast_and_cached_now_is_partial() {
        let merged = merge_weather(
            Err("now".into()),
            Ok(forecast(7)),
            Some(cache("loc", true, 0)),
            "loc",
            100,
        )
        .unwrap();
        assert!(merged.partial);
        assert!(!merged.offline);
        assert!(!merged.now_fresh);
        assert!(merged.forecast_fresh);
        assert!(merged.now.offline);
    }

    #[test]
    fn both_failed_with_complete_same_location_cache_is_offline() {
        let merged = merge_weather(
            Err("now".into()),
            Err("forecast".into()),
            Some(cache("loc", true, 7)),
            "loc",
            100,
        )
        .unwrap();
        assert!(merged.offline);
        assert!(!merged.partial);
    }

    #[test]
    fn fresh_now_without_forecast_cache_is_error() {
        assert!(merge_weather(
            Ok(current("无锡")),
            Err("forecast".into()),
            None,
            "loc",
            100
        )
        .is_err());
    }

    #[test]
    fn fresh_forecast_without_current_cache_is_error() {
        assert!(merge_weather(Err("now".into()), Ok(forecast(7)), None, "loc", 100).is_err());
    }

    #[test]
    fn both_failed_without_cache_is_error() {
        assert!(
            merge_weather(Err("now".into()), Err("forecast".into()), None, "loc", 100).is_err()
        );
    }

    #[test]
    fn other_location_cache_is_never_used() {
        assert!(merge_weather(
            Err("now".into()),
            Err("forecast".into()),
            Some(cache("other", true, 7)),
            "loc",
            100,
        )
        .is_err());
    }

    #[test]
    fn old_current_cache_migrates_only_for_matching_normalized_city() {
        assert!(migrate_legacy_current("无锡市", "无锡", current("无锡")).is_some());
        assert!(migrate_legacy_current("北京", "无锡", current("北京")).is_none());
    }

    #[test]
    fn honest_short_forecast_is_not_padded() {
        let merged = merge_weather(Ok(current("无锡")), Ok(forecast(3)), None, "loc", 100).unwrap();
        assert_eq!(merged.forecast.len(), 3);
    }
}
