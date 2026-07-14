use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

use crate::storage::Db;

const SAYING_URL: &str = "https://uapis.cn/api/v1/saying";
const HISTORY_URL: &str = "https://uapis.cn/api/v1/history/programmer/today";
const SAYING_CACHE: &str = "time:data:saying:last";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Deserialize, Debug)]
struct ApiSaying {
    #[serde(default)]
    text: String,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Saying {
    pub text: String,
    pub source: Option<String>,
    pub offline: bool,
}

/// 纯解析：text 为空视为失败（不写入空缓存）。
pub fn parse_saying(json: &str) -> Result<Saying, String> {
    let api: ApiSaying = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if api.text.trim().is_empty() {
        return Err("一言内容为空".into());
    }
    Ok(Saying {
        text: api.text,
        source: api.source,
        offline: false,
    })
}

async fn try_saying(client: &reqwest::Client) -> Result<Saying, String> {
    let resp = client
        .get(SAYING_URL)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    parse_saying(&body)
}

#[tauri::command]
pub async fn time_saying_get(
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
) -> Result<Saying, String> {
    match try_saying(http.inner()).await {
        Ok(s) => {
            let _ = db.setting_set(SAYING_CACHE, &serde_json::to_string(&s).unwrap_or_default());
            Ok(s)
        }
        Err(e) => match db
            .setting_get(SAYING_CACHE)
            .and_then(|s| serde_json::from_str::<Saying>(&s).ok())
        {
            Some(mut c) => {
                c.offline = true;
                Ok(c)
            }
            None => Err(format!("一言获取失败且无缓存：{e}")),
        },
    }
}

#[derive(Deserialize, Debug)]
struct ApiHistory {
    #[serde(default)]
    date: String,
    #[serde(default)]
    events: Vec<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProgrammerEvent {
    pub year: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub importance: i64,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProgrammerHistory {
    pub date: String,
    pub events: Vec<ProgrammerEvent>,
    pub offline: bool,
}

fn val_str(v: &serde_json::Value, key: &str) -> String {
    match v.get(key) {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Null) | None => String::new(),
        Some(x) => x.to_string(),
    }
}

fn val_i64(v: &serde_json::Value, key: &str) -> i64 {
    v.get(key)
        .and_then(|x| x.as_i64())
        .or_else(|| {
            v.get(key)
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse().ok())
        })
        .unwrap_or(0)
}

fn val_str_array(v: &serde_json::Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .map(|x| match x {
                    serde_json::Value::String(s) => s.clone(),
                    x => x.to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_event(v: &serde_json::Value) -> ProgrammerEvent {
    ProgrammerEvent {
        year: val_str(v, "year"),
        title: val_str(v, "title"),
        description: val_str(v, "description"),
        category: val_str(v, "category"),
        tags: val_str_array(v, "tags"),
        importance: val_i64(v, "importance"),
        source: val_str(v, "source"),
    }
}

/// 纯解析：宽容字段类型（year 可数字或字符串），事件为空也算成功（只是当日无事件）。
pub fn parse_history(json: &str) -> Result<ProgrammerHistory, String> {
    let api: ApiHistory = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let events: Vec<ProgrammerEvent> = api.events.iter().map(map_event).collect();
    Ok(ProgrammerHistory {
        date: api.date,
        events,
        offline: false,
    })
}

fn history_cache_key() -> String {
    let md = chrono::Local::now().format("%m-%d").to_string();
    format!("time:data:programmer_history:{md}")
}

async fn try_history(client: &reqwest::Client) -> Result<ProgrammerHistory, String> {
    let resp = client
        .get(HISTORY_URL)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    parse_history(&body)
}

#[tauri::command]
pub async fn time_programmer_history_get(
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
) -> Result<ProgrammerHistory, String> {
    let key = history_cache_key();
    match try_history(http.inner()).await {
        Ok(h) => {
            let _ = db.setting_set(&key, &serde_json::to_string(&h).unwrap_or_default());
            Ok(h)
        }
        Err(e) => match db
            .setting_get(&key)
            .and_then(|s| serde_json::from_str::<ProgrammerHistory>(&s).ok())
        {
            Some(mut c) => {
                c.offline = true;
                Ok(c)
            }
            None => Err(format!("程序员历史获取失败且无缓存：{e}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_saying_ok() {
        let s = parse_saying(r#"{"text":"你好","source":"uapis"}"#).unwrap();
        assert_eq!(s.text, "你好");
        assert_eq!(s.source.as_deref(), Some("uapis"));
    }

    #[test]
    fn parse_saying_empty_rejected() {
        assert!(parse_saying(r#"{"text":"  "}"#).is_err());
    }

    #[test]
    fn parse_saying_malformed() {
        assert!(parse_saying("{bad").is_err());
    }

    #[test]
    fn parse_history_lenient_year() {
        let json = r#"{"date":"07-12","events":[{"year":1991,"title":"Python 发布","description":"d","category":"lang","tags":["py"],"importance":5,"source":"s"}]}"#;
        let h = parse_history(json).unwrap();
        assert_eq!(h.events.len(), 1);
        assert_eq!(h.events[0].year, "1991");
        assert_eq!(h.events[0].title, "Python 发布");
        assert_eq!(h.events[0].tags, vec!["py".to_string()]);
    }

    #[test]
    fn parse_history_empty_events_ok() {
        let h = parse_history(r#"{"date":"07-12","events":[]}"#).unwrap();
        assert!(h.events.is_empty());
    }

    #[test]
    fn parse_history_malformed() {
        assert!(parse_history("{bad").is_err());
    }
}
