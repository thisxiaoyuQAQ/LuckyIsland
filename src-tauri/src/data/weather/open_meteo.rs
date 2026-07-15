use serde::Deserialize;

use super::model::{WeatherDay, WeatherLocation, WeatherSourceInfo};

const GEOCODING_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";

#[derive(Debug, Deserialize)]
struct GeocodingResponse {
    #[serde(default)]
    results: Vec<GeocodingResult>,
}

#[derive(Debug, Deserialize)]
struct GeocodingResult {
    id: Option<u64>,
    name: String,
    latitude: f64,
    longitude: f64,
    country: Option<String>,
    country_code: Option<String>,
    admin1: Option<String>,
    #[allow(dead_code)]
    admin2: Option<String>,
    timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ForecastResponse {
    timezone: String,
    daily: ForecastDaily,
}

#[derive(Debug, Deserialize)]
struct ForecastDaily {
    time: Vec<String>,
    weather_code: Vec<i32>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    precipitation_probability_max: Option<Vec<f64>>,
}

fn parse_locations(query: &str, json: &str) -> Result<Vec<WeatherLocation>, String> {
    let response: GeocodingResponse =
        serde_json::from_str(json).map_err(|error| error.to_string())?;
    let mut locations = response
        .results
        .into_iter()
        .filter(|result| {
            result.country_code.as_deref() == Some("CN")
                || result.country.as_deref() == Some("中国")
        })
        .filter_map(|result| {
            let country = result.country?;
            let timezone = result.timezone?;
            if !valid_timezone(&timezone)
                || !result.latitude.is_finite()
                || !result.longitude.is_finite()
                || !(-90.0..=90.0).contains(&result.latitude)
                || !(-180.0..=180.0).contains(&result.longitude)
            {
                return None;
            }
            let display_name = match result.admin2.as_deref() {
                Some(admin2) if !admin2.is_empty() => format!("{} · {admin2}", result.name),
                _ => result.name.clone(),
            };
            Some(WeatherLocation {
                query_name: query.to_string(),
                display_name,
                province: result.admin1,
                country,
                latitude: result.latitude,
                longitude: result.longitude,
                timezone,
                provider_id: result.id.map(|id| id.to_string()).unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    locations.sort_by_key(|location| location.display_name != query);
    Ok(locations)
}

fn parse_forecast(json: &str) -> Result<(String, Vec<WeatherDay>), String> {
    let response: ForecastResponse =
        serde_json::from_str(json).map_err(|error| error.to_string())?;
    if !valid_timezone(&response.timezone) {
        return Err("invalid forecast timezone".into());
    }
    let daily = response.daily;
    let mut length = daily
        .time
        .len()
        .min(daily.weather_code.len())
        .min(daily.temperature_2m_max.len())
        .min(daily.temperature_2m_min.len())
        .min(7);
    if let Some(precipitation) = &daily.precipitation_probability_max {
        length = length.min(precipitation.len());
    }
    let mut days = (0..length)
        .filter_map(|index| {
            let date = daily.time[index].clone();
            if !valid_date(&date) {
                return None;
            }
            let (weather, weather_icon) = map_wmo_code(daily.weather_code[index]);
            Some(WeatherDay {
                date,
                weather: weather.into(),
                weather_icon: weather_icon.into(),
                temp_min: daily.temperature_2m_min[index],
                temp_max: daily.temperature_2m_max[index],
                precipitation_probability: daily
                    .precipitation_probability_max
                    .as_ref()
                    .map(|values| values[index]),
            })
        })
        .collect::<Vec<_>>();
    days.sort_by(|left, right| left.date.cmp(&right.date));
    days.dedup_by(|left, right| left.date == right.date);
    Ok((response.timezone, days))
}

fn valid_timezone(value: &str) -> bool {
    !value.is_empty() && value.contains('/') && !value.chars().any(char::is_whitespace)
}

fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn map_wmo_code(code: i32) -> (&'static str, &'static str) {
    match code {
        0 => ("晴", "☀️"),
        1 | 2 => ("多云", "🌤️"),
        3 => ("阴", "☁️"),
        45 | 48 => ("雾", "🌫️"),
        51 | 53 | 55 | 56 | 57 => ("毛毛雨", "🌦️"),
        61 | 63 | 65 | 66 | 67 | 80 | 81 | 82 => ("雨", "🌧️"),
        71 | 73 | 75 | 77 | 85 | 86 => ("雪", "🌨️"),
        95 | 96 | 99 => ("雷暴", "⛈️"),
        _ => ("未知", "🌡️"),
    }
}

pub async fn search_locations(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<WeatherLocation>, String> {
    let response = client
        .get(GEOCODING_URL)
        .query(&[
            ("name", query),
            ("count", "10"),
            ("language", "zh"),
            ("format", "json"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Open-Meteo geocoding HTTP {}", response.status()));
    }
    parse_locations(
        query,
        &response.text().await.map_err(|error| error.to_string())?,
    )
}

pub async fn fetch_forecast(
    client: &reqwest::Client,
    location: &WeatherLocation,
) -> Result<(String, Vec<WeatherDay>), String> {
    let response = client
        .get(FORECAST_URL)
        .query(&[
            ("latitude", location.latitude.to_string()),
            ("longitude", location.longitude.to_string()),
            (
                "daily",
                "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
                    .into(),
            ),
            ("timezone", "auto".into()),
            ("forecast_days", "7".into()),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Open-Meteo forecast HTTP {}", response.status()));
    }
    parse_forecast(&response.text().await.map_err(|error| error.to_string())?)
}

pub fn source_info() -> WeatherSourceInfo {
    WeatherSourceInfo {
        current: "uapis.cn".into(),
        forecast: "Open-Meteo".into(),
        attribution: Some("Weather data by Open-Meteo; geocoding data by GeoNames".into()),
        attribution_url: Some("https://open-meteo.com/".into()),
        license: Some("CC BY 4.0".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_geocoding_results_returns_empty_candidates() {
        assert!(parse_locations("不存在", "{}").unwrap().is_empty());
    }

    #[test]
    fn keeps_ambiguous_cn_candidates_instead_of_silently_selecting_first() {
        let json = r#"{"results":[
          {"id":1,"name":"滨湖","latitude":32.0,"longitude":118.7,"country":"中国","country_code":"CN","admin1":"安徽","admin2":"合肥市","timezone":"Asia/Shanghai"},
          {"id":2,"name":"滨湖","latitude":31.4,"longitude":120.2,"country":"中国","country_code":"CN","admin1":"江苏","admin2":"无锡市","timezone":"Asia/Shanghai"}
        ]}"#;
        let locations = parse_locations("滨湖", json).unwrap();
        assert_eq!(locations.len(), 2);
        assert_eq!(locations[1].province.as_deref(), Some("江苏"));
    }

    #[test]
    fn admin2_disambiguates_candidates_with_the_same_name_and_province() {
        let json = r#"{"results":[
          {"id":1,"name":"滨湖","latitude":32.0,"longitude":118.7,"country":"中国","country_code":"CN","admin1":"江苏","admin2":"南京市","timezone":"Asia/Shanghai"},
          {"id":2,"name":"滨湖","latitude":31.4,"longitude":120.2,"country":"中国","country_code":"CN","admin1":"江苏","admin2":"无锡市","timezone":"Asia/Shanghai"}
        ]}"#;
        let locations = parse_locations("滨湖", json).unwrap();
        assert_eq!(locations[0].display_name, "滨湖 · 南京市");
        assert_eq!(locations[1].display_name, "滨湖 · 无锡市");
    }

    #[test]
    fn filters_non_cn_and_invalid_timezone_candidates() {
        let json = r#"{"results":[
          {"id":1,"name":"无锡","latitude":31.5,"longitude":120.2,"country":"中国","country_code":"CN","admin1":"江苏","timezone":"Asia/Shanghai"},
          {"id":2,"name":"Wuxi","latitude":1.0,"longitude":2.0,"country":"美国","country_code":"US","timezone":"America/New_York"},
          {"id":3,"name":"坏时区","latitude":1.0,"longitude":2.0,"country":"中国","country_code":"CN","timezone":"UTC"}
        ]}"#;
        let locations = parse_locations("无锡", json).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].provider_id, "1");
    }

    #[test]
    fn forecast_truncates_to_shortest_array_and_seven_days() {
        let json = r#"{"timezone":"Asia/Shanghai","daily":{"time":["2026-07-15","2026-07-16","2026-07-17"],"weather_code":[0,3],"temperature_2m_max":[30,31,32],"temperature_2m_min":[20,21,22],"precipitation_probability_max":[1,2,3]}}"#;
        let (_, days) = parse_forecast(json).unwrap();
        assert_eq!(days.len(), 2);
    }

    #[test]
    fn forecast_without_precipitation_keeps_none() {
        let json = r#"{"timezone":"Asia/Shanghai","daily":{"time":["2026-07-15"],"weather_code":[61],"temperature_2m_max":[30],"temperature_2m_min":[20],"precipitation_probability_max":null}}"#;
        let (_, days) = parse_forecast(json).unwrap();
        assert_eq!(days[0].precipitation_probability, None);
        assert_eq!(days[0].weather, "雨");
    }

    #[test]
    fn forecast_sorts_and_deduplicates_dates() {
        let json = r#"{"timezone":"Asia/Shanghai","daily":{"time":["2026-07-17","2026-07-15","2026-07-15"],"weather_code":[0,1,2],"temperature_2m_max":[32,30,31],"temperature_2m_min":[22,20,21]}}"#;
        let (_, days) = parse_forecast(json).unwrap();
        assert_eq!(
            days.iter().map(|day| day.date.as_str()).collect::<Vec<_>>(),
            vec!["2026-07-15", "2026-07-17"]
        );
    }

    #[test]
    fn invalid_timezone_is_rejected() {
        let json = r#"{"timezone":"UTC","daily":{"time":[],"weather_code":[],"temperature_2m_max":[],"temperature_2m_min":[]}}"#;
        assert!(parse_forecast(json).is_err());
    }

    #[test]
    fn wmo_mapping_covers_clear_rain_snow_thunder_and_unknown() {
        assert_eq!(map_wmo_code(0).0, "晴");
        assert_eq!(map_wmo_code(63).0, "雨");
        assert_eq!(map_wmo_code(75).0, "雪");
        assert_eq!(map_wmo_code(95).0, "雷暴");
        assert_eq!(map_wmo_code(999).0, "未知");
    }

    #[tokio::test]
    #[ignore]
    async fn probes_target_cities() {
        let client = reqwest::Client::new();
        for query in ["北京", "无锡", "滨湖"] {
            let candidates = search_locations(&client, query).await.unwrap();
            println!("{query}: {} candidates", candidates.len());
            assert!(!candidates.is_empty());
        }
        let beijing = search_locations(&client, "北京").await.unwrap().remove(0);
        let (timezone, days) = fetch_forecast(&client, &beijing).await.unwrap();
        println!("forecast: {timezone}, {} days", days.len());
        assert!((1..=7).contains(&days.len()));
    }
}
