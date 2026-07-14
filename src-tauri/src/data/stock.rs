use chrono::{Datelike, Local, NaiveTime, Weekday};
use encoding_rs::GBK;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::storage::Db;

const QT_URL: &str = "https://qt.gtimg.cn/q=";
const SETTING_CACHE: &str = "stock:last";
/// A 股交易时段轮询间隔（秒）
const POLL_TRADING_SEC: u64 = 5;
/// 非交易时段轮询间隔（秒）
const POLL_OFF_SEC: u64 = 30;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Quote {
    pub symbol: String,
    pub name: String,
    pub code: String,
    pub current: f64,
    pub yesterday_close: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    /// 涨跌额（current - yesterday_close）
    pub change: f64,
    /// 涨跌幅（%）
    pub change_percent: f64,
    /// YYYYMMDDHHMMSS
    pub time: String,
    // —— 详情面板额外字段（腾讯 qt 下标，已对茅台样本校验）——
    pub volume: f64,           // 6  成交量（手）
    pub amount: f64,           // 37 成交额（万元）
    pub turnover_rate: f64,    // 38 换手率（%）
    pub pe: f64,               // 39 市盈率
    pub amplitude: f64,        // 43 振幅（%）
    pub circ_market_cap: f64,  // 44 流通市值（亿）
    pub total_market_cap: f64, // 45 总市值（亿）
    pub pb: f64,               // 46 市净率
    pub limit_up: f64,         // 47 涨停价
    pub limit_down: f64,       // 48 跌停价
    pub volume_ratio: f64,     // 49 量比
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KBar {
    pub date: String,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
    pub volume: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WatchItem {
    pub symbol: String,
    pub sort: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchResult {
    pub name: String,
    pub symbol: String,
    pub market: String,
}

fn now_ts() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// 规整代码：前缀小写（sh/sz/us/hk/bj），代码部分保留大小写（usAAPL）。
/// 非法返回 None。
fn normalize_symbol(input: &str) -> Option<String> {
    let s = input.trim();
    if s.is_empty() {
        return None;
    }
    let lower = s.to_lowercase();
    for pre in ["sh", "sz", "us", "hk", "bj"] {
        if let Some(rest_lower) = lower.strip_prefix(pre) {
            if !rest_lower.is_empty() && rest_lower.chars().all(|c| c.is_ascii_alphanumeric()) {
                let original_rest = &s[pre.len()..];
                return Some(format!("{pre}{original_rest}"));
            }
        }
    }
    None
}

/// 解析腾讯行情文本（GBK 解码后）。每个 symbol 一行：v_sh600519="...~...";
fn parse_quotes(body: &str, symbols: &[String]) -> Vec<Quote> {
    let mut out = Vec::with_capacity(symbols.len());
    for sym in symbols {
        let prefix = format!("v_{sym}=\"");
        let Some(start) = body.find(&prefix) else {
            continue;
        };
        let rest = &body[start + prefix.len()..];
        let Some(end) = rest.find("\";") else {
            continue;
        };
        let payload = &rest[..end];
        let fields: Vec<&str> = payload.split('~').collect();
        if fields.len() < 35 {
            continue;
        }
        let name = fields[1].trim();
        if name.is_empty() {
            continue;
        }
        let parse = |i: usize| -> f64 {
            fields
                .get(i)
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0.0)
        };
        out.push(Quote {
            symbol: sym.clone(),
            name: name.to_string(),
            code: fields[2].to_string(),
            current: parse(3),
            yesterday_close: parse(4),
            open: parse(5),
            high: parse(33),
            low: parse(34),
            change: parse(31),
            change_percent: parse(32),
            time: fields[30].to_string(),
            volume: parse(6),
            amount: parse(37),
            turnover_rate: parse(38),
            pe: parse(39),
            amplitude: parse(43),
            circ_market_cap: parse(44),
            total_market_cap: parse(45),
            pb: parse(46),
            limit_up: parse(47),
            limit_down: parse(48),
            volume_ratio: parse(49),
        });
    }
    out
}

async fn fetch_quotes(client: &reqwest::Client, symbols: &[String]) -> Result<Vec<Quote>, String> {
    if symbols.is_empty() {
        return Ok(vec![]);
    }
    let url = format!("{QT_URL}{}", symbols.join(","));
    let resp = client
        .get(&url)
        .header("Referer", "https://gu.qq.com/")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let (text, _, _) = GBK.decode(&bytes);
    Ok(parse_quotes(&text, symbols))
}

/// 从 `var suggestdata="...";` 中抠出 payload
fn extract_suggest_payload(body: &str) -> Option<&str> {
    let start = body.find("=\"")? + 2;
    let end = body.rfind("\";")?;
    (end > start).then_some(&body[start..end])
}

/// 解析 sina suggest 结果，过滤股票类型并规整符号：
/// 11/12/13/14 沪深A/B（已是 sh/sz 前缀）, 31 港股（补 hk）, 103 美股（补 us + 大写）
fn parse_suggest(payload: &str) -> Vec<SearchResult> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for entry in payload.split(';') {
        let f: Vec<&str> = entry.split(',').collect();
        if f.len() < 4 {
            continue;
        }
        let name = f[0].trim();
        let typ: i64 = f[1].parse().unwrap_or(-1);
        let sym_raw = f[3].trim();
        if name.is_empty() || sym_raw.is_empty() {
            continue;
        }
        let (sym, market) = match typ {
            11 => (sym_raw.to_string(), "沪"),
            12 => (sym_raw.to_string(), "深"),
            13 => (sym_raw.to_string(), "沪B"),
            14 => (sym_raw.to_string(), "深B"),
            31 => (format!("hk{sym_raw}"), "港"),
            103 => (format!("us{}", sym_raw.to_uppercase()), "美"),
            _ => continue,
        };
        if normalize_symbol(&sym).is_none() {
            continue;
        }
        if !seen.insert(sym.clone()) {
            continue;
        }
        out.push(SearchResult {
            name: name.to_string(),
            symbol: sym,
            market: market.to_string(),
        });
    }
    out
}

/// 按名字/代码/拼音搜索股票（sina suggest3，GBK）
#[tauri::command]
pub async fn stock_search(
    query: String,
    http: State<'_, reqwest::Client>,
) -> Result<Vec<SearchResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let resp = http
        .get("https://suggest3.sinajs.cn/suggest/type=")
        .query(&[("key", q), ("name", "suggestdata")])
        .header("Referer", "https://finance.sina.com.cn/")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let (text, _, _) = GBK.decode(&bytes);
    let payload = extract_suggest_payload(text.trim()).unwrap_or_default();
    let mut results = parse_suggest(payload);
    results.truncate(10);
    Ok(results)
}

/// 拉取 K 线（腾讯 fqkline，前复权）。period: day/week/month
#[tauri::command]
pub async fn stock_kline(
    symbol: String,
    period: String,
    http: State<'_, reqwest::Client>,
) -> Result<Vec<KBar>, String> {
    let sym = normalize_symbol(&symbol).ok_or("代码格式无效")?;
    let p = match period.as_str() {
        "day" | "week" | "month" => period.as_str(),
        _ => return Err("period 需为 day/week/month".into()),
    };
    let url =
        format!("https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},{p},,,320,qfq");
    let resp = http
        .get(&url)
        .header("Referer", "https://gu.qq.com/")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let key = format!("qfq{p}");
    let arr = v
        .get("data")
        .and_then(|d| d.get(sym.as_str()))
        .and_then(|s| s.get(key.as_str()))
        .and_then(|k| k.as_array())
        .ok_or("K线数据缺失")?;
    // 每条 [date, open, close, high, low, volume]（close 在 high 之前，注意顺序）
    let bars = arr
        .iter()
        .filter_map(|b| {
            let a = b.as_array()?;
            if a.len() < 6 {
                return None;
            }
            let num = |i: usize| {
                a.get(i)
                    .and_then(|x| {
                        x.as_str()
                            .and_then(|s| s.parse().ok())
                            .or_else(|| x.as_f64())
                    })
                    .unwrap_or(0.0)
            };
            Some(KBar {
                date: a[0].as_str()?.to_string(),
                open: num(1),
                close: num(2),
                high: num(3),
                low: num(4),
                volume: num(5),
            })
        })
        .collect();
    Ok(bars)
}

/// 是否处于 A 股交易时段（周一至周五 9:30-11:30 / 13:00-15:00，本地时间）
fn is_a_share_trading(now: chrono::DateTime<Local>) -> bool {
    use Weekday::*;
    match now.weekday() {
        Sat | Sun => return false,
        _ => {}
    }
    let t = now.time();
    let morning =
        NaiveTime::from_hms_opt(9, 30, 0).unwrap()..=NaiveTime::from_hms_opt(11, 30, 0).unwrap();
    let afternoon =
        NaiveTime::from_hms_opt(13, 0, 0).unwrap()..=NaiveTime::from_hms_opt(15, 0, 0).unwrap();
    morning.contains(&t) || afternoon.contains(&t)
}

fn watchlist_load(db: &State<'_, Db>) -> Vec<String> {
    let Ok(conn) = db.0.lock() else {
        return vec![];
    };
    let Ok(mut stmt) =
        conn.prepare("SELECT symbol FROM stock_watchlist ORDER BY sort ASC, added_at ASC")
    else {
        return vec![];
    };
    let rows = stmt.query_map([], |r| r.get::<_, String>(0));
    match rows {
        Ok(rs) => rs.filter_map(|r| r.ok()).collect(),
        Err(_) => vec![],
    }
}

fn cache_write(db: &State<'_, Db>, qs: &[Quote]) -> Result<(), String> {
    let s = serde_json::to_string(qs).map_err(|e| e.to_string())?;
    db.setting_set(SETTING_CACHE, &s)
}

fn cache_read(db: &State<'_, Db>) -> Option<Vec<Quote>> {
    let s = db.setting_get(SETTING_CACHE)?;
    serde_json::from_str(&s).ok()
}

/// 一次性拉取当前自选股行情（前端首屏用）。失败回退缓存。
#[tauri::command]
pub async fn stock_get(
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
) -> Result<Vec<Quote>, String> {
    let symbols = watchlist_load(&db);
    if symbols.is_empty() {
        return Ok(vec![]);
    }
    match fetch_quotes(http.inner(), &symbols).await {
        Ok(qs) => {
            let _ = cache_write(&db, &qs);
            Ok(qs)
        }
        Err(_) => Ok(cache_read(&db).unwrap_or_default()),
    }
}

#[tauri::command]
pub fn stock_watchlist_list(db: State<'_, Db>) -> Result<Vec<WatchItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT symbol, sort FROM stock_watchlist ORDER BY sort ASC, added_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WatchItem {
                symbol: r.get(0)?,
                sort: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn stock_watchlist_add(symbol: String, db: State<'_, Db>) -> Result<(), String> {
    let Some(s) = normalize_symbol(&symbol) else {
        return Err("代码格式无效，应为 sh/sz/us/hk/bj + 数字/字母".into());
    };
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let next_sort: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort),-1)+1 FROM stock_watchlist",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT OR IGNORE INTO stock_watchlist (symbol, sort, added_at) VALUES (?1, ?2, ?3)",
        params![s, next_sort, now_ts()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn stock_watchlist_remove(symbol: String, db: State<'_, Db>) -> Result<(), String> {
    let s = normalize_symbol(&symbol).unwrap_or_else(|| symbol.trim().to_string());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM stock_watchlist WHERE symbol=?1", params![s])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 按给定顺序重排自选股（前端拖拽后调用，重写 sort）
#[tauri::command]
pub fn stock_watchlist_reorder(symbols: Vec<String>, db: State<'_, Db>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (i, s) in symbols.iter().enumerate() {
        conn.execute(
            "UPDATE stock_watchlist SET sort=?1 WHERE symbol=?2",
            params![i as i64, s],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 后台轮询：交易时段 5s / 非交易 30s，emit `stock://tick`。
/// 失败时 emit 缓存（若有）以便前端显示离线态。
pub async fn poll_loop(app: AppHandle) {
    loop {
        let symbols = {
            let db = app.state::<Db>();
            watchlist_load(&db)
        };

        if symbols.is_empty() {
            tokio::time::sleep(Duration::from_secs(POLL_OFF_SEC)).await;
            continue;
        }

        let fetched = {
            let http = app.state::<reqwest::Client>();
            fetch_quotes(http.inner(), &symbols).await
        };

        match fetched {
            Ok(qs) => {
                {
                    let db = app.state::<Db>();
                    let _ = cache_write(&db, &qs);
                }
                let _ = app.emit("stock://tick", &qs);
            }
            Err(_) => {
                let cached = {
                    let db = app.state::<Db>();
                    cache_read(&db)
                };
                if let Some(c) = cached {
                    let _ = app.emit("stock://tick", &c);
                }
            }
        }

        let secs = if is_a_share_trading(Local::now()) {
            POLL_TRADING_SEC
        } else {
            POLL_OFF_SEC
        };
        tokio::time::sleep(Duration::from_secs(secs)).await;
    }
}
