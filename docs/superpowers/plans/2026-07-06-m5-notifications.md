# M5 Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build LuckyIsland M5 notifications: localhost HTTP receive endpoint, SQLite history, island notification page, `lucky-notify` CLI wrapper, and hook documentation.

**Architecture:** Main Tauri process owns notification storage and dispatch. External callers send JSON to `127.0.0.1:9753/notify` with token auth; `lucky-notify.exe` is a thin CLI that finds the token and posts to the HTTP endpoint. Frontend listens for `notify://incoming`, expands the island, switches to the notification page, and renders persisted history.

**Tech Stack:** Rust/Tauri 2, rusqlite, axum + tokio, reqwest blocking client for CLI, React 19 + TypeScript + Tailwind, existing SQLite `settings` KV.

## Global Constraints

- Project path: `E:\Code\Tauri\LuckyIsland`.
- User runs `pnpm tauri dev`; do **not** run `cargo check/build` because it may lock `src-tauri/target`.
- Use direct cargo path only if explicitly needed later: `/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe`.
- Each independently working feature point gets a local git commit; do not push.
- HTTP endpoint: `127.0.0.1:9753/notify`, token required via `Authorization: Bearer <token>` or `?token=`.
- Token priority: `LUCKY_TOKEN` env first, otherwise generated UUID stored in SQLite `settings` key `notify:http_token`.
- No named pipe or offline pending queue in M5.
- CLI first version wraps HTTP only.

---

## File Structure

Create/modify these files:

- Modify `src-tauri/Cargo.toml`
  - Add `axum`, `tower-http` if needed, and `clap` for CLI; `reqwest` already exists with async JSON and can be reused, but CLI may need `blocking` feature.
- Modify `src-tauri/src/storage/mod.rs`
  - Add `notifications` table creation to `Db::init`.
- Create `src-tauri/src/notify/mod.rs`
  - Own data types, validation, DB insert/list/read updates, token generation, `dispatch_notification`, and Tauri commands.
- Create `src-tauri/src/notify/server.rs`
  - Own axum router and auth extractor logic for `/notify` and `/health`.
- Create `src-tauri/src/bin/lucky-notify.rs`
  - CLI wrapper that parses args, resolves token, and posts HTTP.
- Modify `src-tauri/src/lib.rs`
  - Register `notify` module, Tauri commands, and spawn HTTP server after DB init.
- Create `src/components/pages/notify/NotifyCard.tsx`
  - Present one notification card and optional action button.
- Create `src/components/pages/notify/NotifyPage.tsx`
  - Load history and listen for incoming notifications.
- Modify `src/App.tsx`
  - Add Notify page and global incoming listener that expands and switches to notify page.
- Create `docs/Claude-Codex-hook配置.md`
  - Hook setup and direct HTTP examples.
- Modify `docs/开发进度.md` and `项目备忘录.md` only after GUI verification.

---

### Task 1: Notification Backend Storage, Types, Token, and Tauri Commands

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/storage/mod.rs`
- Create: `src-tauri/src/notify/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `crate::storage::Db`, existing `Db::setting_get`, `Db::setting_set`, Tauri `AppHandle`.
- Produces:
  - `notify::NotifyInput`
  - `notify::Notification`
  - `notify::ensure_http_token(db: &Db) -> Result<String, String>`
  - `notify::dispatch_notification(app: &AppHandle, db: &Db, input: NotifyInput) -> Result<Notification, String>`
  - Tauri commands: `notify_list(limit: Option<i64>)`, `notify_mark_read(id: Option<String>)`, `notify_create(input: NotifyInput)`, `notify_get_token()`

- [ ] **Step 1: Add backend dependencies**

Edit `src-tauri/Cargo.toml` dependencies:

```toml
axum = "0.7"
clap = { version = "4", features = ["derive"] }
```

Also update existing `reqwest` dependency to include blocking for CLI:

```toml
reqwest = { version = "0.12", features = ["json", "blocking"] }
```

Expected: user `pnpm tauri dev` will later refresh `Cargo.lock`.

- [ ] **Step 2: Add notifications table**

In `src-tauri/src/storage/mod.rs`, append this SQL to the existing `execute_batch` after `stock_watchlist`:

```rust
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT,
    source TEXT NOT NULL,
    level TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    action_type TEXT,
    action_cwd TEXT
);
```

Keep the existing seeding logic unchanged.

- [ ] **Step 3: Create `notify/mod.rs` types and validation**

Create `src-tauri/src/notify/mod.rs` with these top-level definitions:

```rust
pub mod server;

use crate::storage::Db;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const TOKEN_KEY: &str = "notify:http_token";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotifyAction {
    #[serde(rename = "type")]
    pub action_type: String,
    pub cwd: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NotifyInput {
    pub title: String,
    pub body: Option<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default = "default_level")]
    pub level: String,
    pub action: Option<NotifyAction>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Notification {
    pub id: String,
    pub title: String,
    pub body: Option<String>,
    pub source: String,
    pub level: String,
    pub created_at: i64,
    pub read: bool,
    pub action: Option<NotifyAction>,
}

fn default_source() -> String { "custom".into() }
fn default_level() -> String { "info".into() }

fn now_ts() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

fn normalize_source(s: &str) -> Result<String, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "claude" => Ok("claude".into()),
        "codex" => Ok("codex".into()),
        "custom" | "" => Ok("custom".into()),
        other => Err(format!("invalid source: {other}")),
    }
}

fn normalize_level(s: &str) -> Result<String, String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "info" => Ok("info".into()),
        "success" => Ok("success".into()),
        "warn" | "warning" => Ok("warn".into()),
        "error" => Ok("error".into()),
        other => Err(format!("invalid level: {other}")),
    }
}

fn validate_input(input: NotifyInput) -> Result<NotifyInput, String> {
    let title = input.title.trim().to_string();
    if title.is_empty() { return Err("title cannot be empty".into()); }
    if title.chars().count() > 200 { return Err("title too long (max 200 chars)".into()); }

    let body = input.body.map(|b| b.trim().to_string()).filter(|b| !b.is_empty());
    if body.as_ref().map(|b| b.chars().count()).unwrap_or(0) > 2000 {
        return Err("body too long (max 2000 chars)".into());
    }

    let action = input.action.and_then(|a| {
        let cwd = a.cwd.trim().to_string();
        if a.action_type == "open_terminal" && !cwd.is_empty() {
            Some(NotifyAction { action_type: "open_terminal".into(), cwd })
        } else {
            None
        }
    });

    Ok(NotifyInput {
        title,
        body,
        source: normalize_source(&input.source)?,
        level: normalize_level(&input.level)?,
        action,
    })
}
```

- [ ] **Step 4: Implement token and DB functions**

Append to `notify/mod.rs`:

```rust
pub fn ensure_http_token(db: &Db) -> Result<String, String> {
    if let Ok(t) = std::env::var("LUCKY_TOKEN") {
        let t = t.trim().to_string();
        if !t.is_empty() {
            db.setting_set(TOKEN_KEY, &t)?;
            return Ok(t);
        }
    }
    if let Some(t) = db.setting_get(TOKEN_KEY) {
        if !t.trim().is_empty() { return Ok(t); }
    }
    let token = Uuid::new_v4().to_string();
    db.setting_set(TOKEN_KEY, &token)?;
    Ok(token)
}

fn insert_notification(db: &Db, input: NotifyInput) -> Result<Notification, String> {
    let input = validate_input(input)?;
    let id = Uuid::new_v4().to_string();
    let created_at = now_ts();
    let action_type = input.action.as_ref().map(|a| a.action_type.clone());
    let action_cwd = input.action.as_ref().map(|a| a.cwd.clone());
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO notifications (id,title,body,source,level,created_at,read,action_type,action_cwd)
         VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8)",
        params![id, input.title, input.body, input.source, input.level, created_at, action_type, action_cwd],
    ).map_err(|e| e.to_string())?;
    Ok(Notification {
        id,
        title: input.title,
        body: input.body,
        source: input.source,
        level: input.level,
        created_at,
        read: false,
        action: input.action,
    })
}

pub fn list_notifications(db: &Db, limit: Option<i64>) -> Result<Vec<Notification>, String> {
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id,title,body,source,level,created_at,read,action_type,action_cwd
         FROM notifications ORDER BY created_at DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![limit], |row| {
        let action_type: Option<String> = row.get(7)?;
        let action_cwd: Option<String> = row.get(8)?;
        let action = match (action_type, action_cwd) {
            (Some(action_type), Some(cwd)) if action_type == "open_terminal" => Some(NotifyAction { action_type, cwd }),
            _ => None,
        };
        Ok(Notification {
            id: row.get(0)?, title: row.get(1)?, body: row.get(2)?, source: row.get(3)?,
            level: row.get(4)?, created_at: row.get(5)?, read: row.get::<_, i64>(6)? != 0, action,
        })
    }).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows { out.push(row.map_err(|e| e.to_string())?); }
    Ok(out)
}

pub fn mark_read(db: &Db, id: Option<String>) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Some(id) = id {
        conn.execute("UPDATE notifications SET read=1 WHERE id=?1", params![id]).map_err(|e| e.to_string())?;
    } else {
        conn.execute("UPDATE notifications SET read=1", []).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Remove `OptionalExtension` import if unused after implementation.

- [ ] **Step 5: Implement dispatch and commands**

Append to `notify/mod.rs`:

```rust
pub fn dispatch_notification(app: &AppHandle, db: &Db, input: NotifyInput) -> Result<Notification, String> {
    let n = insert_notification(db, input)?;
    let _ = app.emit("notify://incoming", n.clone());
    let _ = app.emit("window://state-changed", "expanded".to_string());
    if let Some(window) = app.get_webview_window("island") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(n)
}

#[tauri::command]
pub fn notify_list(limit: Option<i64>, db: State<'_, Db>) -> Result<Vec<Notification>, String> {
    list_notifications(&db, limit)
}

#[tauri::command]
pub fn notify_mark_read(id: Option<String>, db: State<'_, Db>) -> Result<(), String> {
    mark_read(&db, id)
}

#[tauri::command]
pub fn notify_create(
    app: AppHandle,
    input: NotifyInput,
    db: State<'_, Db>,
) -> Result<Notification, String> {
    dispatch_notification(&app, &db, input)
}

#[tauri::command]
pub fn notify_get_token(db: State<'_, Db>) -> Result<String, String> {
    ensure_http_token(&db)
}
```

- [ ] **Step 6: Register module and commands**

In `src-tauri/src/lib.rs`:

1. Add module:

```rust
mod notify;
```

2. Add imports:

```rust
use notify::{notify_create, notify_get_token, notify_list, notify_mark_read};
```

3. Add commands to `tauri::generate_handler![...]`:

```rust
notify_list,
notify_mark_read,
notify_create,
notify_get_token,
```

- [ ] **Step 7: Commit Task 1**

After user confirms Rust rebuild has no compile errors, commit:

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/storage/mod.rs src-tauri/src/notify/mod.rs src-tauri/src/lib.rs
git commit -m "feat(M5): 通知后端类型 + SQLite 历史 + token + Tauri 命令

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Local HTTP Server

**Files:**
- Create: `src-tauri/src/notify/server.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `notify::NotifyInput`, `notify::dispatch_notification`, `notify::ensure_http_token`, `Db` managed state.
- Produces: `notify::server::start(app: tauri::AppHandle)` async task.

- [ ] **Step 1: Implement axum server**

Create `src-tauri/src/notify/server.rs`:

```rust
use super::{dispatch_notification, ensure_http_token, NotifyInput};
use crate::storage::Db;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Manager};

const PORT: u16 = 9753;

#[derive(Clone)]
struct ServerState {
    app: AppHandle,
    token: Arc<String>,
}

#[derive(Deserialize)]
struct TokenQuery { token: Option<String> }

#[derive(Serialize)]
struct Health { ok: bool, port: u16 }

pub async fn start(app: AppHandle) {
    let Some(db) = app.try_state::<Db>() else {
        eprintln!("[notify] db state missing; http server not started");
        return;
    };
    let token = match ensure_http_token(db.inner()) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[notify] token init failed: {e}");
            return;
        }
    };
    let state = ServerState { app, token: Arc::new(token) };
    let router = Router::new()
        .route("/health", get(health))
        .route("/notify", post(post_notify))
        .with_state(state);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], PORT));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[notify] bind {addr} failed: {e}");
            return;
        }
    };
    if let Err(e) = axum::serve(listener, router).await {
        eprintln!("[notify] server error: {e}");
    }
}

async fn health() -> Json<Health> { Json(Health { ok: true, port: PORT }) }

async fn post_notify(
    State(state): State<ServerState>,
    Query(q): Query<TokenQuery>,
    headers: HeaderMap,
    Json(input): Json<NotifyInput>,
) -> impl IntoResponse {
    if !authorized(&headers, q.token.as_deref(), &state.token) {
        return (StatusCode::UNAUTHORIZED, "unauthorized".to_string()).into_response();
    }
    let Some(db) = state.app.try_state::<Db>() else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "db missing".to_string()).into_response();
    };
    match dispatch_notification(&state.app, db.inner(), input) {
        Ok(n) => (StatusCode::OK, Json(n)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, e).into_response(),
    }
}

fn authorized(headers: &HeaderMap, token_query: Option<&str>, expected: &str) -> bool {
    if token_query.is_some_and(|t| t == expected) { return true; }
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| t == expected)
}
```

- [ ] **Step 2: Spawn server in setup**

In `src-tauri/src/lib.rs` after DB is managed and before stock polling:

```rust
// 本地通知 HTTP server：127.0.0.1:9753/notify
let notify_app = app.handle().clone();
tauri::async_runtime::spawn(async move {
    notify::server::start(notify_app).await;
});
```

- [ ] **Step 3: Commit Task 2**

After user confirms Rust rebuild has no compile errors and `GET http://127.0.0.1:9753/health` returns ok, commit:

```bash
git add src-tauri/src/notify/server.rs src-tauri/src/lib.rs
git commit -m "feat(M5): 本地 HTTP 通知端点 + token 鉴权

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Frontend Notification Page and Incoming Routing

**Files:**
- Create: `src/components/pages/notify/NotifyCard.tsx`
- Create: `src/components/pages/notify/NotifyPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes Tauri commands: `notify_list`, `notify_mark_read`, `term_open_wt`.
- Consumes event: `notify://incoming` with `Notification` payload.
- Produces notify page id: `notify` in `PAGES`.

- [ ] **Step 1: Create card component**

Create `src/components/pages/notify/NotifyCard.tsx`:

```tsx
import { invoke } from "@tauri-apps/api/core";
import { Bell, CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NotifyAction { action_type: "open_terminal"; cwd: string; }
export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  source: "claude" | "codex" | "custom" | string;
  level: "info" | "success" | "warn" | "error" | string;
  created_at: number;
  read: boolean;
  action: NotifyAction | null;
}

function icon(level: string) {
  if (level === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (level === "warn") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  if (level === "error") return <XCircle className="h-4 w-4 text-red-500" />;
  return <Info className="h-4 w-4 text-blue-500" />;
}
function sourceLabel(s: string) {
  if (s === "claude") return "Claude";
  if (s === "codex") return "Codex";
  return "Custom";
}
function timeText(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function NotifyCard({ item }: { item: NotificationItem }) {
  const openTerminal = () => {
    if (item.action?.action_type === "open_terminal") {
      void invoke("term_open_wt", { cwd: item.action.cwd });
    }
  };
  return (
    <div className={cn("rounded-lg border border-border/60 bg-background/50 p-3", !item.read && "ring-1 ring-primary/30")}>
      <div className="flex items-start gap-2">
        {icon(item.level)}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{item.title}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{sourceLabel(item.source)}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{timeText(item.created_at)}</span>
          </div>
          {item.body && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>}
          {item.action?.action_type === "open_terminal" && (
            <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={openTerminal}>
              在终端打开
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create page component**

Create `src/components/pages/notify/NotifyPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Bell } from "lucide-react";
import { NotifyCard, type NotificationItem } from "./NotifyCard";

export function NotifyPage({ compact }: { compact: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const unread = items.filter((i) => !i.read).length;

  useEffect(() => {
    void invoke<NotificationItem[]>("notify_list", { limit: 100 }).then(setItems);
    let un: (() => void) | undefined;
    listen<NotificationItem>("notify://incoming", (e) => {
      setItems((xs) => [e.payload, ...xs.filter((x) => x.id !== e.payload.id)]);
    }).then((fn) => { un = fn; });
    return () => un?.();
  }, []);

  useEffect(() => {
    if (!compact && unread > 0) {
      void invoke("notify_mark_read", { id: null });
      setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    }
  }, [compact, unread]);

  if (compact) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Bell className="h-3.5 w-3.5" /> 通知{unread > 0 ? ` ${unread}` : ""}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">通知</div>
          <div className="text-[11px] text-muted-foreground">Claude / Codex / 自定义 hook 历史</div>
        </div>
        {unread > 0 && <span className="text-[11px] text-primary">{unread} 未读</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无通知</div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => <NotifyCard key={item.id} item={item} />)}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add page and routing in App**

In `src/App.tsx`:

1. Import:

```tsx
import { NotifyPage } from "@/components/pages/notify/NotifyPage";
```

2. Add to `PAGES` before terminal:

```tsx
{ id: "notify", label: "通知", Component: NotifyPage },
```

3. Add listener after window-state listener:

```tsx
useEffect(() => {
  let un: (() => void) | undefined;
  listen("notify://incoming", () => {
    const i = PAGES.findIndex((p) => p.id === "notify");
    if (i >= 0) setPage(i);
    setState("expanded");
  }).then((fn) => { un = fn; });
  return () => un?.();
}, [setPage, setState]);
```

- [ ] **Step 4: Run frontend build**

Run:

```bash
pnpm build
```

Expected: PASS; existing bundle-size warning is acceptable.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/components/pages/notify/NotifyCard.tsx src/components/pages/notify/NotifyPage.tsx src/App.tsx
git commit -m "feat(M5): 通知页 + incoming 自动展开跳转

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: lucky-notify CLI and Hook Documentation

**Files:**
- Create: `src-tauri/src/bin/lucky-notify.rs`
- Create: `docs/Claude-Codex-hook配置.md`

**Interfaces:**
- Consumes HTTP endpoint `/notify`.
- Produces CLI binary `lucky-notify` with args from the spec.

- [ ] **Step 1: Implement CLI**

Create `src-tauri/src/bin/lucky-notify.rs`:

```rust
use clap::Parser;
use reqwest::blocking::Client;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "lucky-notify", about = "Send a notification to LuckyIsland")]
struct Args {
    #[arg(long)] title: String,
    #[arg(long)] body: Option<String>,
    #[arg(long, default_value = "custom")] source: String,
    #[arg(long, default_value = "info")] level: String,
    #[arg(long)] cwd: Option<String>,
    #[arg(long, default_value_t = 9753)] port: u16,
    #[arg(long)] token: Option<String>,
}

#[derive(Serialize)]
struct Action { #[serde(rename = "type")] action_type: String, cwd: String }
#[derive(Serialize)]
struct Payload { title: String, body: Option<String>, source: String, level: String, action: Option<Action> }

fn main() {
    let args = Args::parse();
    if let Err(e) = run(args) {
        eprintln!("lucky-notify: {e}");
        std::process::exit(1);
    }
}

fn run(args: Args) -> Result<(), String> {
    let token = args.token.or_else(|| std::env::var("LUCKY_TOKEN").ok()).or_else(read_token_from_db)
        .ok_or_else(|| "token not found; start LuckyIsland once or set LUCKY_TOKEN".to_string())?;
    let action = args.cwd.filter(|s| !s.trim().is_empty()).map(|cwd| Action { action_type: "open_terminal".into(), cwd });
    let payload = Payload { title: args.title, body: args.body, source: args.source, level: args.level, action };
    let url = format!("http://127.0.0.1:{}/notify", args.port);
    let resp = Client::new().post(&url).bearer_auth(token).json(&payload).send()
        .map_err(|e| format!("failed to connect to LuckyIsland at {url}: {e}"))?;
    if resp.status().is_success() {
        println!("ok");
        Ok(())
    } else {
        Err(format!("server returned {}: {}", resp.status(), resp.text().unwrap_or_default()))
    }
}

fn read_token_from_db() -> Option<String> {
    let mut path = appdata_dir()?;
    path.push("com.luckyisland.app");
    path.push("data.db");
    let conn = Connection::open(path).ok()?;
    conn.query_row("SELECT value FROM settings WHERE key=?1", params!["notify:http_token"], |r| r.get(0)).ok()
}

fn appdata_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}
```

- [ ] **Step 2: Write hook documentation**

Create `docs/Claude-Codex-hook配置.md`:

```markdown
# Claude / Codex Hook 配置

LuckyIsland M5 提供本地通知端点 `127.0.0.1:9753/notify` 和 CLI `lucky-notify`。

## CLI 用法

```powershell
lucky-notify --title "Claude 完成" --body "任务已结束" --source claude --level success
```

可选 cwd 动作：

```powershell
lucky-notify --title "Codex 完成" --source codex --level success --cwd "E:\Code\Tauri\LuckyIsland"
```

## Token

LuckyIsland 启动时：

1. 优先使用环境变量 `LUCKY_TOKEN`
2. 否则自动生成 token 并写入 `%APPDATA%\com.luckyisland.app\data.db` 的 `settings.notify:http_token`

CLI 查找顺序相同：`--token` 参数 → `LUCKY_TOKEN` → SQLite settings。

## HTTP 直连示例

```powershell
$token = $env:LUCKY_TOKEN
Invoke-RestMethod -Method POST "http://127.0.0.1:9753/notify" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body (@{ title="测试"; source="custom"; level="info" } | ConvertTo-Json)
```

## Claude Code Stop hook 示例

在 `~/.claude/settings.json` 的 Stop hook 中调用：

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "lucky-notify --title \"Claude 完成\" --source claude --level success"
          }
        ]
      }
    ]
  }
}
```

## Codex completion hook 示例

在 Codex 完成脚本中调用：

```powershell
lucky-notify --title "Codex 完成" --source codex --level success --cwd "$PWD"
```

## 排错

- `failed to connect`：LuckyIsland 没运行，或 9753 端口未启动。
- `401 unauthorized`：token 不匹配；重启 LuckyIsland 后重试，或显式设置 `LUCKY_TOKEN`。
- `400 invalid level/source`：检查 `--source claude|codex|custom` 和 `--level info|success|warn|error`。
```

- [ ] **Step 3: Commit Task 4**

After user confirms CLI compiles in `pnpm tauri dev`, commit:

```bash
git add src-tauri/src/bin/lucky-notify.rs docs/Claude-Codex-hook配置.md
git commit -m "feat(M5): lucky-notify CLI + Claude/Codex hook 文档

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verification Feedback and M5 Completion Docs

**Files:**
- Modify: `docs/开发进度.md`
- Modify: `项目备忘录.md`
- Modify code files only if user reports M5 issues.

**Interfaces:**
- Consumes completed Tasks 1-4.
- Produces M5 status `✅` and project memory/notes updated.

- [ ] **Step 1: Ask user to run M5 manual checks**

Ask user to verify:

```text
1. Rust rebuild passes.
2. POST /health returns ok.
3. notify_get_token works from frontend/debug path if exposed.
4. lucky-notify --title test --source claude --level success triggers island expand + notify page.
5. Wrong token returns 401.
6. Restart app: notification history remains.
7. --cwd notification card shows terminal action.
```

- [ ] **Step 2: Fix reported issues one at a time**

If compile errors appear, fix only the failing file and commit with `fix(M5): ...`.
If GUI issue appears, diagnose with the smallest instrumentation needed, then fix and commit.
Do not mark M5 complete until user says behavior is OK.

- [ ] **Step 3: Update progress docs after user confirms OK**

In `docs/开发进度.md`, change row 06:

```markdown
| 06 | 通知系统 | ✅ | 02,03 | HTTP + lucky-notify CLI + 通知页 + SQLite 历史 + hook 文档 |
```

Append M5 submit records:

```markdown
- feat(M5): 通知后端类型 + SQLite 历史 + token + Tauri 命令
- feat(M5): 本地 HTTP 通知端点 + token 鉴权
- feat(M5): 通知页 + incoming 自动展开跳转
- feat(M5): lucky-notify CLI + Claude/Codex hook 文档
```

- [ ] **Step 4: Update project memo**

In `项目备忘录.md` under “勿动文件”, add:

```markdown
- M5 通知层：`src-tauri/src/notify/*`、`src-tauri/src/bin/lucky-notify.rs`、`src/components/pages/notify/*`、`docs/Claude-Codex-hook配置.md`（HTTP 优先 + CLI 包 HTTP，token 自动生成/读取，SQLite 历史，已验）
```

- [ ] **Step 5: Commit completion docs**

```bash
git add docs/开发进度.md 项目备忘录.md
git commit -m "docs(M5): 通知系统完成，进度翻 ✅ + 勿动文件 + 提交记录补全

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

Spec coverage:

- HTTP endpoint + token auth: Task 2.
- Token generation/settings and `notify_get_token`: Task 1.
- SQLite notifications history: Task 1.
- Frontend notify page + incoming auto expand/switch: Task 3.
- `open_terminal` action first-version external WT handling: Task 3.
- CLI wrapper: Task 4.
- Hook docs: Task 4.
- Verification and progress completion: Task 5.

Placeholder scan: no TBD/TODO placeholders; all file paths and function names are explicit.

Type consistency:

- `NotifyInput`, `NotifyAction`, and `Notification` match across Rust, HTTP, and TS.
- `action_type` is Rust/SQLite/TS runtime field; JSON input uses `{ type: "open_terminal" }` via serde rename.
- Tauri command names match frontend plan calls: `notify_list`, `notify_mark_read`, `notify_create`, `notify_get_token`, `term_open_wt`.
