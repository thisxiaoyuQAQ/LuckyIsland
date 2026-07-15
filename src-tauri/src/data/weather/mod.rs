use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::storage::Db;

pub(crate) mod cache;
pub mod model;
pub(crate) mod open_meteo;

use cache::{merge_weather, migrate_legacy_current, CachedWeather};
use model::{WeatherBundle, WeatherLocation};

const API_URL: &str = "https://uapis.cn/api/v1/misc/weather";
const MYIP_URL: &str = "https://uapis.cn/api/v1/network/myip";
const SETTING_CITY: &str = "weather:city";
const SETTING_CACHE: &str = "weather:last";
const LOCATION_PREFIX: &str = "weather:location:";
const CACHE_PREFIX: &str = "weather:cache:open-meteo:";
const DEFAULT_CITY: &str = "北京";

#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum WeatherCommandError {
    AmbiguousLocation {
        message: String,
        candidates: Vec<WeatherLocation>,
    },
    NotFound {
        message: String,
    },
    Unavailable {
        message: String,
    },
}

impl fmt::Display for WeatherCommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AmbiguousLocation { message, .. }
            | Self::NotFound { message }
            | Self::Unavailable { message } => formatter.write_str(message),
        }
    }
}

impl std::error::Error for WeatherCommandError {}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// uapis.cn 接口原始响应（字段与 API 一致；除 city/province 外都可能缺，全 default）
#[derive(Deserialize, Debug)]
struct ApiWeather {
    #[serde(default)]
    province: String,
    #[serde(default)]
    city: String,
    #[serde(default)]
    district: Option<String>,
    #[serde(default)]
    weather: String,
    #[serde(default)]
    weather_icon: String,
    #[serde(default)]
    temperature: f64,
    #[serde(default)]
    wind_direction: String,
    #[serde(default)]
    wind_power: String,
    #[serde(default)]
    humidity: f64,
    #[serde(default)]
    report_time: String,
    #[serde(default)]
    alerts: Vec<ApiAlert>,
}

#[derive(Deserialize, Debug)]
struct ApiAlert {
    #[serde(default)]
    title: String,
    #[serde(rename = "type", default)]
    alert_type: String,
    #[serde(default)]
    level: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    publish_time: String,
    #[serde(default)]
    publisher: String,
}

/// 对前端暴露的天气数据
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WeatherAlert {
    pub title: String,
    pub alert_type: String,
    pub level: String,
    pub text: String,
    pub publish_time: String,
    pub publisher: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WeatherNow {
    pub province: String,
    pub city: String,
    pub district: Option<String>,
    pub weather: String,
    pub weather_icon: String,
    pub temperature: f64,
    pub wind_direction: String,
    pub wind_power: String,
    pub humidity: f64,
    pub report_time: String,
    pub alerts: Vec<WeatherAlert>,
    /// true = 取自缓存（当前离线）
    pub offline: bool,
    pub fetched_at: i64,
}

fn map_weather(api: ApiWeather) -> WeatherNow {
    WeatherNow {
        province: api.province,
        city: api.city,
        district: api.district,
        weather: api.weather,
        weather_icon: api.weather_icon,
        temperature: api.temperature,
        wind_direction: api.wind_direction,
        wind_power: api.wind_power,
        humidity: api.humidity,
        report_time: api.report_time,
        alerts: api
            .alerts
            .into_iter()
            .map(|a| WeatherAlert {
                title: a.title,
                alert_type: a.alert_type,
                level: a.level,
                text: a.text,
                publish_time: a.publish_time,
                publisher: a.publisher,
            })
            .collect(),
        offline: false,
        fetched_at: 0,
    }
}

async fn try_fetch(client: &reqwest::Client, city: &str) -> Result<WeatherNow, String> {
    let resp = client
        .get(API_URL)
        .query(&[("city", city)])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let api: ApiWeather = resp.json().await.map_err(|e| e.to_string())?;
    Ok(map_weather(api))
}

fn cache_read(db: &State<'_, Db>) -> Option<WeatherNow> {
    let s = db.setting_get(SETTING_CACHE)?;
    serde_json::from_str(&s).ok()
}

fn normalize_city(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(['市', '区', '县'])
        .to_lowercase()
}

fn location_setting_key(city: &str) -> String {
    format!("{LOCATION_PREFIX}{}", normalize_city(city))
}

fn location_cache_key(location: &WeatherLocation) -> String {
    if !location.provider_id.is_empty() {
        format!("{CACHE_PREFIX}{}", location.provider_id)
    } else {
        format!(
            "{CACHE_PREFIX}{:.4}:{:.4}",
            location.latitude, location.longitude
        )
    }
}

fn valid_selected_location(location: &WeatherLocation, candidates: &[WeatherLocation]) -> bool {
    !location.provider_id.is_empty()
        && location.latitude.is_finite()
        && location.longitude.is_finite()
        && (-90.0..=90.0).contains(&location.latitude)
        && (-180.0..=180.0).contains(&location.longitude)
        && !location.display_name.is_empty()
        && !location.country.is_empty()
        && !location.timezone.is_empty()
        && candidates.iter().any(|candidate| candidate == location)
}

fn uniquely_matching_candidate(
    city: &str,
    candidates: &[WeatherLocation],
) -> Option<WeatherLocation> {
    let city = normalize_city(city);
    let matches = candidates
        .iter()
        .filter(|candidate| {
            let display = candidate.display_name.split(" · ").next().unwrap_or("");
            normalize_city(display) == city
                && candidate
                    .province
                    .as_deref()
                    .is_some_and(|province| normalize_city(province) == city)
        })
        .cloned()
        .collect::<Vec<_>>();
    (matches.len() == 1).then(|| matches[0].clone())
}

async fn resolve_location(
    client: &reqwest::Client,
    db: &Db,
    city: &str,
    selected: Option<WeatherLocation>,
) -> Result<WeatherLocation, WeatherCommandError> {
    let candidates = open_meteo::search_locations(client, city)
        .await
        .map_err(|error| WeatherCommandError::Unavailable {
            message: format!("地点查询失败：{error}"),
        })?;
    if candidates.is_empty() {
        return Err(WeatherCommandError::NotFound {
            message: format!("未找到城市：{city}"),
        });
    }
    if let Some(location) = selected {
        if !valid_selected_location(&location, &candidates) {
            return Err(WeatherCommandError::Unavailable {
                message: "所选地点无效或已过期，请重新选择".into(),
            });
        }
        let value =
            serde_json::to_string(&location).map_err(|error| WeatherCommandError::Unavailable {
                message: error.to_string(),
            })?;
        db.setting_set(&location_setting_key(city), &value)
            .map_err(|message| WeatherCommandError::Unavailable { message })?;
        return Ok(location);
    }
    if let Some(stored) = db.setting_get(&location_setting_key(city)) {
        if let Ok(location) = serde_json::from_str::<WeatherLocation>(&stored) {
            if valid_selected_location(&location, &candidates) {
                return Ok(location);
            }
        }
    }
    if candidates.len() == 1 {
        return Ok(candidates.into_iter().next().unwrap());
    }
    if let Some(location) = uniquely_matching_candidate(city, &candidates) {
        return Ok(location);
    }
    Err(WeatherCommandError::AmbiguousLocation {
        message: format!("“{city}”对应多个地点，请选择具体地区"),
        candidates,
    })
}

fn read_location_cache(db: &Db, key: &str) -> Option<CachedWeather> {
    db.setting_get(key)
        .and_then(|json| serde_json::from_str(&json).ok())
}

fn write_location_cache(db: &Db, key: &str, cache: &CachedWeather) -> Result<(), String> {
    let json = serde_json::to_string(cache).map_err(|error| error.to_string())?;
    db.setting_set(key, &json)
}

/// 拉取同一地点的当前天气与未来预报；仅允许同地点缓存补齐失败侧。
#[tauri::command]
pub async fn weather_get(
    city: Option<String>,
    location: Option<WeatherLocation>,
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
) -> Result<WeatherBundle, WeatherCommandError> {
    let city = city
        .or_else(|| db.setting_get(SETTING_CITY))
        .unwrap_or_else(|| DEFAULT_CITY.to_string());
    let location = resolve_location(http.inner(), db.inner(), &city, location).await?;
    let location_key = location_cache_key(&location);
    let mut cached = read_location_cache(db.inner(), &location_key);
    if cached.is_none() {
        if let Some(legacy) = cache_read(&db)
            .and_then(|current| migrate_legacy_current(&city, &location.query_name, current))
        {
            cached = Some(CachedWeather {
                location_key: location_key.clone(),
                now_fetched_at: Some(legacy.fetched_at),
                now: Some(legacy),
                forecast: None,
                forecast_timezone: None,
                forecast_fetched_at: None,
            });
        }
    }

    let fetched_at = now_ts();
    let (now_result, forecast_result) = tokio::join!(
        try_fetch(http.inner(), &city),
        open_meteo::fetch_forecast(http.inner(), &location)
    );
    let merged = merge_weather(
        now_result,
        forecast_result,
        cached.clone(),
        &location_key,
        fetched_at,
    )
    .map_err(|message| WeatherCommandError::Unavailable { message })?;

    let next_cache = CachedWeather {
        location_key: location_key.clone(),
        now: Some(merged.now.clone()),
        now_fetched_at: if merged.now_fresh {
            Some(fetched_at)
        } else {
            cached.as_ref().and_then(|value| value.now_fetched_at)
        },
        forecast: Some(merged.forecast.clone()),
        forecast_timezone: Some(merged.timezone.clone()),
        forecast_fetched_at: if merged.forecast_fresh {
            Some(fetched_at)
        } else {
            cached.as_ref().and_then(|value| value.forecast_fetched_at)
        },
    };
    let _ = write_location_cache(db.inner(), &location_key, &next_cache);

    Ok(WeatherBundle {
        now: merged.now,
        forecast: merged.forecast,
        source: open_meteo::source_info(),
        location,
        timezone: merged.timezone,
        offline: merged.offline,
        partial: merged.partial,
        fetched_at: merged.fetched_at,
    })
}

#[tauri::command]
pub async fn weather_location_search(
    query: String,
    http: State<'_, reqwest::Client>,
) -> Result<Vec<WeatherLocation>, WeatherCommandError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(WeatherCommandError::NotFound {
            message: "城市不能为空".into(),
        });
    }
    open_meteo::search_locations(http.inner(), query)
        .await
        .map_err(|error| WeatherCommandError::Unavailable {
            message: format!("地点查询失败：{error}"),
        })
}

#[tauri::command]
pub fn weather_get_city(db: State<'_, Db>) -> Result<String, String> {
    Ok(db
        .setting_get(SETTING_CITY)
        .unwrap_or_else(|| DEFAULT_CITY.to_string()))
}

#[tauri::command]
pub fn weather_set_city(city: String, db: State<'_, Db>) -> Result<(), String> {
    let c = city.trim();
    if c.is_empty() {
        return Err("城市不能为空".into());
    }
    db.setting_set(SETTING_CITY, c)
}

/// IP 定位本机城市（uapis /network/myip，region 末段取城市）
#[derive(Serialize, Deserialize, Debug)]
pub struct LocatedCity {
    pub city: String,
    pub region: String,
    pub ip: String,
}

#[derive(Deserialize)]
struct ApiMyIp {
    #[serde(default)]
    ip: String,
    #[serde(default)]
    region: String,
}

#[tauri::command]
pub async fn weather_locate(http: State<'_, reqwest::Client>) -> Result<LocatedCity, String> {
    let resp = http.get(MYIP_URL).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let info: ApiMyIp = resp.json().await.map_err(|e| e.to_string())?;
    // region 形如 "中国 福建省 漳州市"，取末段并去掉"市"后缀，与城市白名单统一
    let city = info
        .region
        .split_whitespace()
        .last()
        .unwrap_or("")
        .trim()
        .trim_end_matches('市')
        .to_string();
    if city.is_empty() {
        return Err("无法解析所在城市".into());
    }
    Ok(LocatedCity {
        city,
        region: info.region,
        ip: info.ip,
    })
}

/// 多城市：列表 / 增 / 删（持久化在 weather_cities 表）
#[tauri::command]
pub fn weather_cities_list(db: State<'_, Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT city FROM weather_cities ORDER BY sort ASC, added_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn weather_cities_add(city: String, db: State<'_, Db>) -> Result<(), String> {
    let c = city.trim();
    if c.is_empty() {
        return Err("城市不能为空".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let next_sort: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort),-1)+1 FROM weather_cities",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT OR IGNORE INTO weather_cities (city, sort, added_at) VALUES (?1, ?2, ?3)",
        params![c, next_sort, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn weather_cities_remove(city: String, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM weather_cities WHERE city=?1",
        params![city.trim()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 按给定顺序重排城市（前端拖拽后调用，重写 sort）
#[tauri::command]
pub fn weather_cities_reorder(cities: Vec<String>, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (i, c) in cities.iter().enumerate() {
        conn.execute(
            "UPDATE weather_cities SET sort=?1 WHERE city=?2",
            params![i as i64, c],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn location(id: &str, name: &str, province: Option<&str>) -> WeatherLocation {
        WeatherLocation {
            query_name: name.into(),
            display_name: name.into(),
            province: province.map(str::to_string),
            country: "中国".into(),
            latitude: 31.5,
            longitude: 120.2,
            timezone: "Asia/Shanghai".into(),
            provider_id: id.into(),
        }
    }

    #[test]
    fn location_keys_use_provider_id_without_user_text() {
        let value = location("1790923", "无锡", Some("江苏"));
        assert_eq!(
            location_cache_key(&value),
            "weather:cache:open-meteo:1790923"
        );
        assert_eq!(location_setting_key(" 无锡市 "), "weather:location:无锡");
    }

    #[test]
    fn selected_location_must_match_a_fresh_candidate_exactly() {
        let candidate = location("1790923", "无锡", Some("江苏"));
        assert!(valid_selected_location(
            &candidate,
            std::slice::from_ref(&candidate)
        ));
        let mut forged = candidate.clone();
        forged.latitude = 0.0;
        assert!(!valid_selected_location(&forged, &[candidate]));
    }

    #[test]
    fn exact_city_and_province_can_resolve_one_candidate_but_not_many() {
        let beijing = location("1", "北京", Some("北京市"));
        let other = location("2", "北京 · 万州区", Some("重庆市"));
        assert_eq!(
            uniquely_matching_candidate("北京", &[beijing.clone(), other])
                .unwrap()
                .provider_id,
            "1"
        );
        assert!(uniquely_matching_candidate(
            "滨湖",
            &[
                location("3", "滨湖 · 南京市", Some("江苏")),
                location("4", "滨湖 · 无锡市", Some("江苏")),
            ]
        )
        .is_none());
    }

    #[test]
    fn current_weather_serializes_with_frontend_camel_case_fields() {
        let now = WeatherNow {
            province: "江苏".into(),
            city: "无锡".into(),
            district: None,
            weather: "晴".into(),
            weather_icon: "☀️".into(),
            temperature: 28.0,
            wind_direction: "东".into(),
            wind_power: "2".into(),
            humidity: 50.0,
            report_time: "10:00".into(),
            alerts: vec![WeatherAlert {
                title: "高温".into(),
                alert_type: "高温".into(),
                level: "黄色".into(),
                text: "测试".into(),
                publish_time: "09:00".into(),
                publisher: "气象台".into(),
            }],
            offline: false,
            fetched_at: 1,
        };
        let value = serde_json::to_value(now).unwrap();
        assert_eq!(value["weatherIcon"], "☀️");
        assert_eq!(value["windDirection"], "东");
        assert_eq!(value["alerts"][0]["publishTime"], "09:00");
        assert!(value.get("weather_icon").is_none());
    }

    #[test]
    fn structured_weather_errors_keep_code_and_candidates() {
        let error = WeatherCommandError::AmbiguousLocation {
            message: "请选择".into(),
            candidates: vec![location("1", "滨湖 · 无锡市", Some("江苏"))],
        };
        let json = serde_json::to_value(error).unwrap();
        assert_eq!(json["code"], "ambiguous_location");
        assert_eq!(json["candidates"][0]["providerId"], "1");
    }
}
