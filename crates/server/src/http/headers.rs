//! Response headers and request logging (D24 "Rust only").

use std::time::{Duration, Instant};

use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::error::ApiError;

/// Total time an `/api` request may take, body upload included. The slowest stage-A handler
/// is the avatar proxy (6 s upstream cap); the JWKS fetch is capped at 5 s and SQLite's
/// `busy_timeout` at 5 s. Node's own limit is 300 s for the whole request. The live SSE
/// route (stage B) must be exempted from this.
pub const API_DEADLINE: Duration = Duration::from_secs(30);

/// Report-only until staging shows no violations (D24: "CSP report-only then enforced").
/// Violations are posted to [`super::csp_report`] (`report-uri`; `report-to` would also need a
/// `Reporting-Endpoints` header and is not needed while report-only).
/// Google Identity Services needs its script, style, frame and connect origins; Phaser and the
/// WASM engine need `blob:` workers and `'wasm-unsafe-eval'`.
pub const CSP_REPORT_ONLY: &str = "default-src 'self'; \
script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client; \
style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; \
img-src 'self' data: blob: https:; \
font-src 'self' data:; \
connect-src 'self' https://accounts.google.com/gsi/; \
frame-src https://accounts.google.com/gsi/; \
worker-src 'self' blob:; \
media-src 'self' blob: https:; \
object-src 'none'; \
base-uri 'self'; \
form-action 'self'; \
frame-ancestors 'self'; \
report-uri /api/csp-report";

const SECURITY_HEADERS: [(&str, &str); 6] = [
    ("x-content-type-options", "nosniff"),
    ("referrer-policy", "same-origin"),
    ("x-frame-options", "SAMEORIGIN"),
    // Google sign-in opens a popup that must be able to post back to the opener.
    ("cross-origin-opener-policy", "same-origin-allow-popups"),
    (
        "permissions-policy",
        "camera=(), microphone=(), geolocation=(), payment=()",
    ),
    ("content-security-policy-report-only", CSP_REPORT_ONLY),
];

/// Adds the security headers to every response that doesn't already set them.
pub async fn security_headers(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    for (name, value) in SECURITY_HEADERS {
        let name = HeaderName::from_static(name);
        if !headers.contains_key(&name) {
            headers.insert(name, HeaderValue::from_static(value));
        }
    }
    response
}

/// `/api` only: the [`API_DEADLINE`] (→ JSON 408; dropping the handler rolls back any open
/// transaction) and `Cache-Control: no-store` on any response that doesn't set its own, since
/// these answers are often personal (token or secret in the request). TS sends no
/// Cache-Control there; shared caches wouldn't store them anyway, this just says so.
pub async fn api_response(request: Request, next: Next) -> Response {
    let mut response = match tokio::time::timeout(API_DEADLINE, next.run(request)).await {
        Ok(response) => response,
        Err(_) => {
            tracing::warn!(target: "autoduck::http", "request exceeded the API deadline");
            ApiError::new(StatusCode::REQUEST_TIMEOUT, "Request Timeout").into_response()
        }
    };
    response
        .headers_mut()
        .entry(header::CACHE_CONTROL)
        .or_insert(HeaderValue::from_static("no-store"));
    response
}

/// Next.js parity for `/api`: `OPTIONS` on a route answers 204 with `Allow`, and a 405 lists
/// methods like Next does (`GET, HEAD, OPTIONS, POST`; axum writes `GET,HEAD,POST`).
/// Review 3, finding 3.
pub async fn api_methods(mut request: Request, next: Next) -> Response {
    let path = request.uri().path();
    if !(path == "/api" || path.starts_with("/api/")) {
        return next.run(request).await;
    }
    let preflight = request.method() == axum::http::Method::OPTIONS;
    if preflight {
        // Route it as an unknown method: axum answers 405 with the route's `Allow`, or 404.
        *request.method_mut() = axum::http::Method::from_bytes(b"AUTODUCK-PROBE")
            .unwrap_or(axum::http::Method::OPTIONS);
    }
    let mut response = next.run(request).await;
    if response.status() != StatusCode::METHOD_NOT_ALLOWED {
        return response;
    }
    let allow = response
        .headers()
        .get(header::ALLOW)
        .and_then(|value| value.to_str().ok())
        .map(next_allow);
    if preflight {
        response = StatusCode::NO_CONTENT.into_response();
    }
    if let Some(allow) = allow.and_then(|allow| HeaderValue::from_str(&allow).ok()) {
        response.headers_mut().insert(header::ALLOW, allow);
    }
    response
}

/// `GET,HEAD,POST` → `GET, HEAD, OPTIONS, POST` (sorted, as Next lists them).
fn next_allow(axum_allow: &str) -> String {
    let mut methods: Vec<&str> = axum_allow
        .split(',')
        .map(str::trim)
        .filter(|method| !method.is_empty())
        .chain(["OPTIONS"])
        .collect();
    methods.sort();
    methods.dedup();
    methods.join(", ")
}

/// Next.js redirects a path with a trailing slash or repeated slashes to its canonical form
/// with 308 (`/api/races/14/` → `/api/races/14`). Repeated slashes are collapsed first, so the
/// `Location` is always a same-origin path (never `//host`). Review 3, finding 4.
pub async fn canonical_path(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let mut canonical = String::with_capacity(path.len());
    for segment in path.split('/').filter(|segment| !segment.is_empty()) {
        canonical.push('/');
        canonical.push_str(segment);
    }
    if canonical.is_empty() {
        canonical.push('/');
    }
    if canonical == path {
        return next.run(request).await;
    }
    if let Some(query) = request.uri().query() {
        canonical.push('?');
        canonical.push_str(query);
    }
    // Next sends the target as the body too, plus `Refresh: 0;url=…`.
    let (Ok(location), Ok(refresh)) = (
        HeaderValue::from_str(&canonical),
        HeaderValue::from_str(&format!("0;url={canonical}")),
    ) else {
        return next.run(request).await;
    };
    let mut response = (StatusCode::PERMANENT_REDIRECT, canonical).into_response();
    let headers = response.headers_mut();
    headers.remove(header::CONTENT_TYPE);
    headers.insert(header::LOCATION, location);
    headers.insert(header::REFRESH, refresh);
    response
}

/// One line per request: method, path (never the query: it carries tokens and secrets),
/// status and latency. API requests log at INFO, static files at DEBUG.
pub async fn request_log(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;
    let status = response.status().as_u16();
    let micros = u64::try_from(started.elapsed().as_micros()).unwrap_or(u64::MAX);
    if path == "/api" || path.starts_with("/api/") {
        tracing::info!(target: "autoduck::http", %method, %path, status, micros, "request");
    } else {
        tracing::debug!(target: "autoduck::http", %method, %path, status, micros, "request");
    }
    response
}

#[cfg(test)]
mod tests {
    use super::next_allow;

    #[test]
    fn allow_lists_like_next() {
        assert_eq!(next_allow("GET,HEAD"), "GET, HEAD, OPTIONS");
        assert_eq!(next_allow("GET,HEAD,POST"), "GET, HEAD, OPTIONS, POST");
    }
}
