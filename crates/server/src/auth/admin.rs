//! Admin secret checks, ported from `lib/auth/admin-secret.ts` (D24):
//! - fails closed when `RACE_SECRET_KEY` is unset or blank;
//! - warns once when it is shorter than 16 characters;
//! - compares `sha256(given.trim())` with `sha256(expected)` in constant time.
//!
//! Where the secret may come from differs per route, exactly as in TS:
//! - `admin/cosmetics`: the `x-race-secret` header only → [`RequireAdminHeader`];
//! - `admin/season3`: `?secret=`, the header, or `body.secret` → [`AdminCandidates`] plus the
//!   body value once the handler has parsed it.

use std::sync::atomic::{AtomicBool, Ordering};

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use super::{js_trim, query_param};
use crate::error::ApiError;
use crate::http::AppState;

pub const SECRET_HEADER: &str = "x-race-secret";

static WARNED_SHORT: AtomicBool = AtomicBool::new(false);

fn digest(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}

/// `isAdminSecret(given)` against `expected` (already trimmed by the config loader).
pub fn is_admin_secret(expected: &str, given: Option<&str>) -> bool {
    let expected = js_trim(expected);
    if expected.is_empty() {
        return false;
    }
    if expected.encode_utf16().count() < 16 && !WARNED_SHORT.swap(true, Ordering::Relaxed) {
        tracing::warn!(
            "RACE_SECRET_KEY is shorter than 16 characters; rotate it to a longer random value."
        );
    }
    let Some(given) = given.filter(|given| !given.is_empty()) else {
        return false;
    };
    digest(js_trim(given)).ct_eq(&digest(expected)).into()
}

/// `request.headers.get('x-race-secret')`: repeated headers are joined with `", "` like Fetch.
pub fn header_secret(parts: &Parts) -> Option<String> {
    let values: Vec<&str> = parts
        .headers
        .get_all(SECRET_HEADER)
        .iter()
        .map(|value| value.to_str().unwrap_or(""))
        .collect();
    (!values.is_empty()).then(|| values.join(", "))
}

/// Header-only admin check (`admin/cosmetics`). Rejects with `401 {"error":"Unauthorized"}`.
#[derive(Debug, Clone, Copy)]
pub struct RequireAdminHeader;

impl FromRequestParts<AppState> for RequireAdminHeader {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        if is_admin_secret(
            &state.config().race_secret_key,
            header_secret(parts).as_deref(),
        ) {
            Ok(RequireAdminHeader)
        } else {
            Err(ApiError::unauthorized())
        }
    }
}

/// The query and header candidates of `isAdminRequest(request, body)`; the handler adds
/// `body.secret` (only when it is a string) with [`AdminCandidates::authorized`].
#[derive(Clone)]
pub struct AdminCandidates {
    pub query: Option<String>,
    pub header: Option<String>,
    expected: String,
}

/// Never prints a candidate or the expected secret (review 2, finding 5).
impl std::fmt::Debug for AdminCandidates {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let present = |value: &Option<String>| value.as_deref().map(crate::config::redacted);
        f.debug_struct("AdminCandidates")
            .field("query", &present(&self.query))
            .field("header", &present(&self.header))
            .field("expected", &crate::config::redacted(&self.expected))
            .finish()
    }
}

impl AdminCandidates {
    pub fn authorized(&self, body_secret: Option<&str>) -> bool {
        [self.query.as_deref(), self.header.as_deref(), body_secret]
            .into_iter()
            .any(|candidate| is_admin_secret(&self.expected, candidate))
    }
}

impl FromRequestParts<AppState> for AdminCandidates {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        Ok(AdminCandidates {
            query: query_param(parts.uri.query(), "secret"),
            header: header_secret(parts),
            expected: state.config().race_secret_key.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "0123456789abcdef-long-enough";

    #[test]
    fn fails_closed_without_a_key() {
        assert!(!is_admin_secret("", Some("")));
        assert!(!is_admin_secret("   ", Some("   ")));
        assert!(!is_admin_secret("", Some("anything")));
    }

    #[test]
    fn compares_trimmed_values() {
        assert!(is_admin_secret(KEY, Some(KEY)));
        assert!(is_admin_secret(KEY, Some(&format!("  {KEY}\n"))));
        assert!(!is_admin_secret(KEY, Some("wrong")));
        assert!(!is_admin_secret(KEY, Some("")));
        assert!(!is_admin_secret(KEY, None));
        // Wrong length never panics (sha256 makes both sides 32 bytes).
        assert!(!is_admin_secret(KEY, Some(&KEY[..5])));
        assert!(!is_admin_secret(
            "short",
            Some("shorter-than-key-and-longer")
        ));
        assert!(is_admin_secret("short", Some("short")));
    }

    #[test]
    fn candidates_any_source() {
        let candidates = AdminCandidates {
            query: Some("nope".into()),
            header: None,
            expected: KEY.into(),
        };
        assert!(!candidates.authorized(None));
        assert!(candidates.authorized(Some(KEY)));
        let header = AdminCandidates {
            query: None,
            header: Some(KEY.into()),
            expected: KEY.into(),
        };
        assert!(header.authorized(None));
    }
}
