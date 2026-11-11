//! `GET|POST /api/admin/season3`: the Season 3 admin dashboard, the ops report and the admin
//! actions.
//!
//! Port of `app/api/admin/season3/route.ts` (plan Phase 3 stage B) over
//! [`crate::season3::admin`]. Auth is `isAdminRequest`: `?secret=`, the `x-race-secret` header,
//! or (POST only) a string `body.secret` ([`AdminCandidates`]), failing with
//! `401 {"error":"Unauthorized"}`.
//!
//! - `GET` → the dashboard of the active season (`{"season":null}` without one);
//!   `GET ?report=ops` → the ops report with the replay-track gate.
//! - `POST` → `{ action, … }`. The body is parsed before the auth check, as in TS: a body that
//!   isn't JSON is `400 {"error":"Invalid JSON"}` even without a secret. `start-race` runs on the
//!   live hub ([`crate::live::start`], Phase 5); `reseed-week` is new (see
//!   [`crate::season3::admin::actions`]).
//!
//! The TS GET has no try/catch, so its failures are Next's empty-body 500; Rust answers the API
//! error shape (`uncaught-throw-500-body` in the accept list).

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::http::Uri;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::Value;

use crate::auth::admin::AdminCandidates;
use crate::auth::query_param;
use crate::cosmetics::js;
use crate::error::{ApiError, ApiResult};
use crate::http::AppState;
use crate::season3::admin::{actions, dashboard, ops};

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/season3", get(get_dashboard).post(post_action))
}

async fn get_dashboard(
    candidates: AdminCandidates,
    State(state): State<AppState>,
    uri: Uri,
) -> ApiResult<Response> {
    if !candidates.authorized(None) {
        return Err(ApiError::unauthorized());
    }
    let mut conn = state.db().reader.acquire().await?;
    if query_param(uri.query(), "report").as_deref() == Some("ops") {
        let report = ops::load(&mut conn).await?;
        return Ok(Json(report).into_response());
    }
    let dashboard = dashboard::load(&mut conn)
        .await
        .map_err(|error| ApiError::internal(format!("{error:#}")))?;
    Ok(Json(dashboard).into_response())
}

async fn post_action(
    candidates: AdminCandidates,
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Response> {
    let bytes = body?;
    let Some(body) = js::parse_body(&bytes) else {
        return Err(ApiError::bad_request("Invalid JSON"));
    };
    // `typeof body?.secret === 'string' ? body.secret : null`.
    let body_secret = js::property(&body, "secret").and_then(Value::as_str);
    if !candidates.authorized(body_secret) {
        return Err(ApiError::unauthorized());
    }
    // Phase 5: start-race runs on the live hub (`crate::live::start`).
    if !body.is_null()
        && js::property(&body, "action").and_then(Value::as_str) == Some("start-race")
    {
        return crate::live::start::start_race(state.live(), state.db(), &body).await;
    }
    actions::run(state.db(), &body)
        .await
        .map_err(actions::ActionError::into_api_error)
}
