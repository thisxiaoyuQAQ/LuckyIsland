use clap::{Parser, ValueEnum};
use reqwest::blocking::Client;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Serialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
enum Priority {
    Normal,
    High,
    Critical,
}

#[derive(Parser, Debug)]
#[command(name = "lucky-notify", about = "Send a notification to LuckyIsland")]
struct Args {
    #[arg(long)]
    title: String,
    #[arg(long)]
    body: Option<String>,
    #[arg(long, default_value = "custom")]
    source: String,
    #[arg(long, default_value = "info")]
    level: String,
    #[arg(long, value_enum, default_value_t = Priority::Normal)]
    priority: Priority,
    #[arg(long)]
    cwd: Option<String>,
    #[arg(long, default_value_t = 9753)]
    port: u16,
    #[arg(long)]
    token: Option<String>,
}

#[derive(Serialize)]
struct Action {
    #[serde(rename = "type")]
    action_type: String,
    cwd: String,
}

#[derive(Serialize)]
struct Payload {
    title: String,
    body: Option<String>,
    source: String,
    level: String,
    priority: Priority,
    action: Option<Action>,
}

fn main() {
    let args = Args::parse();
    if let Err(e) = run(args) {
        eprintln!("lucky-notify: {e}");
        std::process::exit(1);
    }
}

fn run(args: Args) -> Result<(), String> {
    let token = args
        .token
        .or_else(|| std::env::var("LUCKY_TOKEN").ok())
        .or_else(read_token_from_db)
        .ok_or_else(|| "token not found; start LuckyIsland once or set LUCKY_TOKEN".to_string())?;
    let action = args.cwd.filter(|s| !s.trim().is_empty()).map(|cwd| Action {
        action_type: "open_terminal".into(),
        cwd,
    });
    let payload = Payload {
        title: args.title,
        body: args.body,
        source: args.source,
        level: args.level,
        priority: args.priority,
        action,
    };
    let url = format!("http://127.0.0.1:{}/notify", args.port);
    // 强制直连本地，禁用 env/系统代理：开 Clash 等代理时 127.0.0.1 会被代理拦截返回 502
    let resp = Client::builder()
        .no_proxy()
        .build()
        .map_err(|e| format!("build http client: {e}"))?
        .post(&url)
        .bearer_auth(token)
        .json(&payload)
        .send()
        .map_err(|e| format!("failed to connect to LuckyIsland at {url}: {e}"))?;
    if resp.status().is_success() {
        println!("ok");
        Ok(())
    } else {
        Err(format!(
            "server returned {}: {}",
            resp.status(),
            resp.text().unwrap_or_default()
        ))
    }
}

fn read_token_from_db() -> Option<String> {
    let mut path = appdata_dir()?;
    path.push("com.luckyisland.app");
    path.push("data.db");
    let conn = Connection::open(path).ok()?;
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        params!["notify:http_token"],
        |r| r.get(0),
    )
    .ok()
}

fn appdata_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}
