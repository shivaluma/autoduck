//! `GET /api/races/{id}/track?h=<byteSha256>` (plan §4.6; there is no TS route on `main`).
//!
//! Serves the stored `RaceReplayTrack.bytes` (gzip of the DTRK/1 payload) as they are:
//!
//! - `Content-Encoding: gzip` when the client accepts gzip; otherwise the payload is gunzipped
//!   with `flate2` (and checked against `byteSha256`).
//! - `ETag: "<byteSha256>"` (the hash of the **uncompressed** payload, so both encodings share
//!   it) and `Vary: Accept-Encoding`. `If-None-Match` answers 304.
//! - `Cache-Control: public, max-age=31536000, immutable` only when `h` equals `byteSha256`;
//!   without `h`, or with a stale one, `no-cache`, so a re-recorded track is never pinned.
//! - Not found: no row, or an `UNAVAILABLE` row without bytes → 404 `{"error":"Replay track not
//!   found"}`. A bad id → 400 `{"error":"Invalid race ID"}` (same `parseInt` rules as the detail
//!   route); an unreadable row → 500 `{"error":"Failed to fetch replay track"}`.

use std::io::Read;

use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use flate2::read::MultiGzDecoder;
use sha2::{Digest, Sha256};

use super::{RaceIdParam, parse_race_id};
use crate::auth::query_param;
use crate::error::ApiError;
use crate::http::AppState;

pub const IMMUTABLE: &str = "public, max-age=31536000, immutable";
pub const NO_CACHE: &str = "no-cache";
pub const CONTENT_TYPE: &str = "application/octet-stream";

pub async fn get(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
    uri: axum::http::Uri,
    request_headers: HeaderMap,
) -> Response {
    let segment = match path {
        Ok(Path(segment)) => segment,
        Err(_) => return ApiError::bad_request("Invalid race ID").into_response(),
    };
    let race_id = match parse_race_id(&segment) {
        RaceIdParam::Invalid => return ApiError::bad_request("Invalid race ID").into_response(),
        // No row can have this id; Prisma would have thrown, but this route is ours.
        RaceIdParam::OutOfRange => return not_found(),
        RaceIdParam::Id(id) => id,
    };

    let row = sqlx::query!(
        r#"SELECT "byteSha256" AS "byte_sha256?", "bytes" AS "bytes?: Vec<u8>"
           FROM "RaceReplayTrack" WHERE "raceId" = ?"#,
        race_id
    )
    .fetch_optional(&state.db().reader)
    .await;
    let row = match row {
        Ok(row) => row,
        Err(error) => return failed(&error),
    };
    let Some((sha, gzip)) = row.and_then(|row| Some((row.byte_sha256?, row.bytes?))) else {
        return not_found();
    };

    let hinted = query_param(uri.query(), "h").is_some_and(|h| h == sha);
    let etag = format!("\"{sha}\"");
    let Ok(etag_value) = HeaderValue::from_str(&etag) else {
        return failed(&format!("race {race_id}: byteSha256 is not a valid ETag"));
    };
    let mut headers = HeaderMap::new();
    headers.insert(header::ETAG, etag_value);
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if hinted { IMMUTABLE } else { NO_CACHE }),
    );
    headers.insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));

    if if_none_match(&request_headers, &etag) {
        return (StatusCode::NOT_MODIFIED, headers).into_response();
    }

    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(CONTENT_TYPE));
    if accepts_gzip(&request_headers) {
        headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
        return (StatusCode::OK, headers, gzip).into_response();
    }
    let expected = sha.clone();
    match tokio::task::spawn_blocking(move || gunzip_checked(&gzip, &expected)).await {
        Ok(Ok(payload)) => (StatusCode::OK, headers, payload).into_response(),
        Ok(Err(error)) => failed(&format!("race {race_id}: {error}")),
        Err(error) => failed(&error),
    }
}

fn not_found() -> Response {
    ApiError::not_found("Replay track not found").into_response()
}

fn failed(error: &dyn std::fmt::Display) -> Response {
    tracing::error!(%error, "failed to fetch replay track");
    ApiError::new(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Failed to fetch replay track",
    )
    .into_response()
}

/// Largest payload [`gunzip_checked`] inflates. A real DTRK/1 track is a few hundred KiB; the
/// cap only guards against a corrupt or hostile row (review 2, finding 9).
pub const MAX_TRACK_PAYLOAD: u64 = 64 * 1024 * 1024;

/// Gunzips the stored bytes and checks the payload against `byteSha256`.
pub fn gunzip_checked(gzip: &[u8], expected_sha256: &str) -> Result<Vec<u8>, String> {
    let mut payload = Vec::new();
    MultiGzDecoder::new(gzip)
        .take(MAX_TRACK_PAYLOAD + 1)
        .read_to_end(&mut payload)
        .map_err(|error| format!("stored track is not valid gzip: {error}"))?;
    if payload.len() as u64 > MAX_TRACK_PAYLOAD {
        return Err(format!(
            "stored track inflates past {MAX_TRACK_PAYLOAD} bytes"
        ));
    }
    let actual = hex(&Sha256::digest(&payload));
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err(format!(
            "stored track payload sha256 {actual} differs from byteSha256 {expected_sha256}"
        ));
    }
    Ok(payload)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    bytes
        .iter()
        .flat_map(|b| [DIGITS[usize::from(b >> 4)], DIGITS[usize::from(b & 0x0f)]])
        .map(char::from)
        .collect()
}

/// RFC 9110 §13.1.2 weak comparison: `*`, or any listed tag equal to ours (`W/` ignored).
fn if_none_match(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .any(|tag| tag == "*" || tag.strip_prefix("W/").unwrap_or(tag) == etag)
}

/// `Accept-Encoding` lists `gzip`, `x-gzip` or `*` with a non-zero q-value. An explicit
/// `gzip;q=0` wins over `*`. A missing header means identity only (RFC 9110 §12.5.3 allows any
/// coding, but the track must stay readable by `fetch` without a header).
pub fn accepts_gzip(headers: &HeaderMap) -> bool {
    let mut gzip: Option<bool> = None;
    let mut star: Option<bool> = None;
    for value in headers.get_all(header::ACCEPT_ENCODING) {
        let Ok(value) = value.to_str() else { continue };
        for item in value.split(',') {
            let mut parts = item.split(';');
            let coding = parts.next().unwrap_or("").trim().to_ascii_lowercase();
            let mut q_positive = true;
            for param in parts {
                if let Some((name, q)) = param.split_once('=')
                    && name.trim().eq_ignore_ascii_case("q")
                {
                    q_positive = q.trim().parse::<f64>().is_ok_and(|q| q > 0.0);
                }
            }
            match coding.as_str() {
                "gzip" | "x-gzip" => gzip = Some(gzip.unwrap_or(false) || q_positive),
                "*" => star = Some(star.unwrap_or(false) || q_positive),
                _ => {}
            }
        }
    }
    gzip.or(star).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use std::io::Write;

    fn with(name: header::HeaderName, values: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for value in values {
            headers.append(name.clone(), HeaderValue::from_str(value).unwrap());
        }
        headers
    }

    #[test]
    fn accept_encoding() {
        let yes = [
            "gzip",
            "gzip, deflate, br, zstd",
            "br;q=1.0, GZIP;q=0.5",
            "x-gzip",
            "*",
            "identity, *;q=0.1",
        ];
        for value in yes {
            assert!(
                accepts_gzip(&with(header::ACCEPT_ENCODING, &[value])),
                "{value}"
            );
        }
        let no = [
            "",
            "identity",
            "br, deflate",
            "gzip;q=0",
            "gzip; q=0.000",
            "gzip;q=0, *",
            "*;q=0",
        ];
        for value in no {
            assert!(
                !accepts_gzip(&with(header::ACCEPT_ENCODING, &[value])),
                "{value}"
            );
        }
        assert!(!accepts_gzip(&HeaderMap::new()));
        assert!(accepts_gzip(&with(
            header::ACCEPT_ENCODING,
            &["br", "gzip"]
        )));
    }

    #[test]
    fn etag_matching() {
        let etag = "\"abc\"";
        assert!(if_none_match(
            &with(header::IF_NONE_MATCH, &["\"abc\""]),
            etag
        ));
        assert!(if_none_match(
            &with(header::IF_NONE_MATCH, &["W/\"abc\""]),
            etag
        ));
        assert!(if_none_match(
            &with(header::IF_NONE_MATCH, &["\"x\", \"abc\""]),
            etag
        ));
        assert!(if_none_match(&with(header::IF_NONE_MATCH, &["*"]), etag));
        assert!(!if_none_match(
            &with(header::IF_NONE_MATCH, &["\"abd\""]),
            etag
        ));
        assert!(!if_none_match(&HeaderMap::new(), etag));
    }

    #[test]
    fn gunzip_checks_the_payload_hash() {
        let payload = b"DTRK\x01\x00\x00\x00payload".to_vec();
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&payload).unwrap();
        let gzip = encoder.finish().unwrap();
        let sha = hex(&Sha256::digest(&payload));
        assert_eq!(gunzip_checked(&gzip, &sha).unwrap(), payload);
        assert!(gunzip_checked(&gzip, &"0".repeat(64)).is_err());
        assert!(gunzip_checked(b"not gzip", &sha).is_err());
    }
}
