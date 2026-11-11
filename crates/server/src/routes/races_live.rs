//! Live race routes (plan Phase 5, D16):
//!
//! - `GET /api/races/{id}/live[?snapshots=1]`: the SSE v2 stream ([`crate::live::sse`]); 204
//!   when the race is not live.
//! - `POST /api/races/{id}/wild-item`: **410** while manual wild items are off (D16, Q4). The
//!   engine and protocol keep input support.
//! - `POST /api/races/{id}/desync` `{tick, clientHash, serverHash, engineBuildId}`: a client
//!   whose local hash differs from the server's reports it here; it is logged (rate-limited) and
//!   answered 204. The client then switches to snapshots.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::Bytes;
use axum::extract::rejection::BytesRejection;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde_json::Value;

use super::races::{RaceIdParam, parse_race_id};
use crate::auth::query_param;
use crate::error::ApiError;
use crate::http::AppState;
use crate::live::sse;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/races/{id}/live", get(live))
        .route("/races/{id}/wild-item", post(wild_item))
        .route("/races/{id}/desync", post(desync))
}

fn race_id(segment: &str) -> Result<i64, ApiError> {
    match parse_race_id(segment) {
        RaceIdParam::Invalid => Err(ApiError::bad_request("Invalid race ID")),
        RaceIdParam::NotFound => Err(ApiError::not_found("Race not found")),
        RaceIdParam::Id(id) => Ok(id),
    }
}

async fn live(
    State(state): State<AppState>,
    Path(segment): Path<String>,
    headers: HeaderMap,
    uri: Uri,
) -> Response {
    let race_id = match race_id(&segment) {
        Ok(id) => id,
        Err(error) => return error.into_response(),
    };
    let snapshots = query_param(uri.query(), "snapshots").as_deref() == Some("1");
    sse::stream(
        state.live().session(race_id),
        sse::last_event_id(&headers),
        snapshots,
    )
}

async fn wild_item(Path(segment): Path<String>) -> Response {
    if let Err(error) = race_id(&segment) {
        return error.into_response();
    }
    ApiError::new(
        StatusCode::GONE,
        "Manual wild items are disabled for this race",
    )
    .into_response()
}

/// Desync reports logged per minute (the rest are counted and dropped).
const DESYNC_LOGS_PER_MINUTE: u32 = 30;

static DESYNC_WINDOW: Mutex<Option<(Instant, u32)>> = Mutex::new(None);

fn desync_allowed() -> bool {
    let mut window = DESYNC_WINDOW
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let now = Instant::now();
    match window.as_mut() {
        Some((started, count)) if now.duration_since(*started) < Duration::from_secs(60) => {
            *count += 1;
            *count <= DESYNC_LOGS_PER_MINUTE
        }
        _ => {
            *window = Some((now, 1));
            true
        }
    }
}

fn short(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(text)) => text.chars().take(80).collect(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

async fn desync(
    State(state): State<AppState>,
    Path(segment): Path<String>,
    body: Result<Bytes, BytesRejection>,
) -> Result<StatusCode, ApiError> {
    let race_id = race_id(&segment)?;
    let bytes = body?;
    let Ok(report) = serde_json::from_slice::<Value>(&bytes) else {
        return Err(ApiError::bad_request("Invalid JSON"));
    };
    if !report.is_object() {
        return Err(ApiError::bad_request("Invalid desync report"));
    }
    if desync_allowed() {
        tracing::warn!(
            target: "autoduck::desync",
            race = race_id,
            live = state.live().session(race_id).is_some(),
            server_tick = state.live().live_tick(race_id),
            tick = %short(report.get("tick")),
            client_hash = %short(report.get("clientHash")),
            server_hash = %short(report.get("serverHash")),
            client_build = %short(report.get("engineBuildId")),
            server_build = race_core::ENGINE_BUILD_ID,
            "client reported a live desync"
        );
    }
    Ok(StatusCode::NO_CONTENT)
}
