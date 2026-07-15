use serde::{Deserialize, Serialize};

use super::WeatherNow;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeatherLocation {
    pub query_name: String,
    pub display_name: String,
    pub province: Option<String>,
    pub country: String,
    pub latitude: f64,
    pub longitude: f64,
    pub timezone: String,
    pub provider_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeatherDay {
    pub date: String,
    pub weather: String,
    pub weather_icon: String,
    pub temp_min: f64,
    pub temp_max: f64,
    pub precipitation_probability: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeatherSourceInfo {
    pub current: String,
    pub forecast: String,
    pub attribution: Option<String>,
    pub attribution_url: Option<String>,
    pub license: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherBundle {
    pub now: WeatherNow,
    pub forecast: Vec<WeatherDay>,
    pub source: WeatherSourceInfo,
    pub location: WeatherLocation,
    pub timezone: String,
    pub offline: bool,
    pub partial: bool,
    pub fetched_at: i64,
}
