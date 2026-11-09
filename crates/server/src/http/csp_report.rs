//! `POST /api/csp-report`: the sink for the report-only CSP (D24: "report-only until staging
//! shows no violations"; without a sink nobody could tell). Rust only, no TS counterpart.
//!
//! Anyone can post here, so it stores nothing: each report is logged once at WARN, cut to
//! [`MAX_LOGGED`] bytes, with control characters escaped by `tracing`'s `Debug` formatting.
//! Bodies over [`MAX_BODY`] are refused before they are buffered.

use axum::body::Bytes;
use axum::extract::DefaultBodyLimit;
use axum::extract::rejection::BytesRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{MethodRouter, post};

use super::AppState;
use crate::error::ApiError;

/// Browsers send one violation per report (`application/csp-report`), well under 4 KiB.
pub const MAX_BODY: usize = 16 * 1024;
const MAX_LOGGED: usize = 2 * 1024;

pub fn route() -> MethodRouter<AppState> {
    post(report).layer(DefaultBodyLimit::max(MAX_BODY))
}

async fn report(body: Result<Bytes, BytesRejection>) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(rejection) => return ApiError::from(rejection).into_response(),
    };
    let text = String::from_utf8_lossy(&body[..body.len().min(MAX_LOGGED)]);
    tracing::warn!(target: "autoduck::csp", report = ?text, bytes = body.len(), "CSP violation report");
    StatusCode::NO_CONTENT.into_response()
}
