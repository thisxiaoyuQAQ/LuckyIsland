use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::storage::Db;

const API_URL: &str = "https://uapis.cn/api/v1/misc/weather";
const MYIP_URL: &str = "https://uapis.cn/api/v1/network/myip";
const SETTING_CITY: &str = "weather:city";
const SETTING_CACHE: &str = "weather:last";
const DEFAULT_CITY: &str = "北京";

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
pub struct WeatherAlert {
    pub title: String,
    pub alert_type: String,
    pub level: String,
    pub text: String,
    pub publish_time: String,
    pub publisher: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
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

fn cache_write(db: &State<'_, Db>, w: &WeatherNow) -> Result<(), String> {
    let s = serde_json::to_string(w).map_err(|e| e.to_string())?;
    db.setting_set(SETTING_CACHE, &s)
}

fn cache_read(db: &State<'_, Db>) -> Option<WeatherNow> {
    let s = db.setting_get(SETTING_CACHE)?;
    serde_json::from_str(&s).ok()
}

/// 拉取当前天气：成功则刷新缓存；失败则回退最近一次缓存（offline=true）；都没有则报错。
#[tauri::command]
pub async fn weather_get(
    city: Option<String>,
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
) -> Result<WeatherNow, String> {
    let city = city
        .or_else(|| db.setting_get(SETTING_CITY))
        .unwrap_or_else(|| DEFAULT_CITY.to_string());

    match try_fetch(http.inner(), &city).await {
        Ok(mut w) => {
            w.fetched_at = now_ts();
            let _ = cache_write(&db, &w);
            Ok(w)
        }
        Err(e) => match cache_read(&db) {
            Some(mut c) => {
                c.offline = true;
                Ok(c)
            }
            None => Err(format!("天气获取失败且无缓存：{e}")),
        },
    }
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
