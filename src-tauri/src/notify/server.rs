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
struct TokenQuery {
    token: Option<String>,
}

#[derive(Serialize)]
struct Health {
    ok: bool,
    port: u16,
}

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
    let state = ServerState {
        app,
        token: Arc::new(token),
    };
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

async fn health() -> Json<Health> {
    Json(Health { ok: true, port: PORT })
}

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
    if token_query.is_some_and(|t| t == expected) {
        return true;
    }
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| t == expected)
}
