//! `GET /api/races/{id}` parity with the TS route on main, and `GET /api/races/{id}/track`.
//!
//! The detail goldens (`fixtures/races/detail-golden.jsonl`) are the TS handler's output for
//! `fixtures/races/fixture.sql` on top of [`common::populated_db`]; regenerate them with
//! `scripts/oracle/dump-race-detail-goldens.ts` (usage in its header). Every case must match
//! byte for byte: status, and body (key order, number formatting, row order).

mod common;

use std::io::Write;

use autoduck_server::db::{Db, DbTime};
use autoduck_server::http::{self, AppState};
use axum::body::Body;
use axum::http::{HeaderMap, Method, Request, StatusCode, header};
use flate2::Compression;
use flate2::write::GzEncoder;
use http_body_util::BodyExt;
use sha2::{Digest, Sha256};
use sqlx::{Connection, SqliteConnection};
use tower::ServiceExt;

const FIXTURE_SQL: &str = include_str!("fixtures/races/fixture.sql");
const DETAIL_GOLDEN: &str = include_str!("fixtures/races/detail-golden.jsonl");

struct Fixture {
    _dir: tempfile::TempDir,
    app: axum::Router,
    track_payload: Vec<u8>,
    track_gzip: Vec<u8>,
    track_sha: String,
}

async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    common::populated_db(&db).await;
    let mut conn = SqliteConnection::connect(&format!("sqlite:{}", db.display()))
        .await
        .unwrap();
    sqlx::raw_sql(FIXTURE_SQL).execute(&mut conn).await.unwrap();

    let track_payload: Vec<u8> = b"DTRK\x01\x00\x00\x00"
        .iter()
        .copied()
        .chain((0..20_000u32).map(|i| (i % 251) as u8))
        .collect();
    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(&track_payload).unwrap();
    let track_gzip = encoder.finish().unwrap();
    let track_sha = hex(&Sha256::digest(&track_payload));
    let now = DbTime::now();
    sqlx::query(
        r#"INSERT INTO "RaceReplayTrack" ("raceId","format","source","fidelity","engineImpl",
             "engineVersion","balanceVersion","trackVersion","trackGeometry","tickRate","tickCount",
             "byteSha256","bytes","createdAt")
           VALUES (2,'dtrk/1','LIVE_TS','RECORDED','ts','1.2.0','S3.11','river-01-v2',
             'river-01-v2@deadbeef',60,90,?,?,?),
                  (3,'dtrk/1','BACKFILL','UNAVAILABLE','ts','1.2.0','S3.11','river-01-v2',
             NULL,60,0,NULL,NULL,?)"#,
    )
    .bind(&track_sha)
    .bind(&track_gzip)
    .bind(now)
    .bind(now)
    .execute(&mut conn)
    .await
    .unwrap();
    conn.close().await.unwrap();

    let config = common::config(dir.path(), &db, &[]);
    let state = AppState::new(config, Db::open(&db).await.unwrap());
    Fixture {
        app: http::router(state),
        _dir: dir,
        track_payload,
        track_gzip,
        track_sha,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: header::HeaderName) -> Option<&str> {
        self.headers.get(name).map(|v| v.to_str().unwrap())
    }

    fn text(&self) -> String {
        String::from_utf8(self.body.clone()).unwrap()
    }
}

async fn call(app: &axum::Router, method: Method, uri: &str, headers: &[(&str, &str)]) -> Reply {
    let mut request = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = app
        .clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    Reply {
        status,
        headers,
        body,
    }
}

#[derive(serde::Deserialize)]
struct GoldenCase {
    path: String,
    status: u16,
    body: String,
}

#[tokio::test]
async fn detail_matches_the_ts_route_byte_for_byte() {
    let f = fixture().await;
    let mut checked = 0;
    for line in DETAIL_GOLDEN.lines().filter(|line| !line.trim().is_empty()) {
        let case: GoldenCase = serde_json::from_str(line).unwrap();
        let reply = call(&f.app, Method::GET, &case.path, &[]).await;
        assert_eq!(
            reply.status.as_u16(),
            case.status,
            "status of {}",
            case.path
        );
        assert_eq!(
            reply.header(header::CONTENT_TYPE),
            Some("application/json"),
            "content-type of {}",
            case.path
        );
        let body = reply.text();
        if body != case.body {
            let at = body
                .bytes()
                .zip(case.body.bytes())
                .position(|(a, b)| a != b)
                .unwrap_or(body.len().min(case.body.len()));
            let from = at.saturating_sub(80);
            panic!(
                "body of {} differs at byte {at}:\n rust: {}\n   ts: {}",
                case.path,
                body.get(from..(at + 80).min(body.len())).unwrap_or(&body),
                case.body
                    .get(from..(at + 80).min(case.body.len()))
                    .unwrap_or(&case.body),
            );
        }
        checked += 1;
    }
    assert!(checked >= 20, "only {checked} golden cases");
}

#[tokio::test]
async fn detail_is_read_only_and_head_works() {
    let f = fixture().await;
    let reply = call(&f.app, Method::HEAD, "/api/races/2", &[]).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(reply.body.is_empty());
    // A trailing slash is redirected like Next does (308 to the canonical path).
    let reply = call(&f.app, Method::GET, "/api/races/2/", &[]).await;
    assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT);
    // Unknown sub-paths stay JSON 404s (never the SPA).
    for path in ["/api/races/2/nope", "/api/races"] {
        let reply = call(&f.app, Method::GET, path, &[]).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{path}");
        assert_eq!(reply.text(), r#"{"error":"Not found"}"#, "{path}");
    }
    // Invalid UTF-8 after percent-decoding can't be a number.
    let reply = call(&f.app, Method::GET, "/api/races/%FF", &[]).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.text(), r#"{"error":"Invalid race ID"}"#);
}

#[tokio::test]
async fn track_serves_gzip_with_etag_and_cache_rules() {
    let f = fixture().await;
    let etag = format!("\"{}\"", f.track_sha);

    // Gzip-capable client with the current hash: stored bytes, immutable.
    let uri = format!("/api/races/2/track?h={}", f.track_sha);
    let reply = call(
        &f.app,
        Method::GET,
        &uri,
        &[("accept-encoding", "gzip, deflate, br")],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body, f.track_gzip);
    assert_eq!(reply.header(header::CONTENT_ENCODING), Some("gzip"));
    assert_eq!(
        reply.header(header::CONTENT_TYPE),
        Some("application/octet-stream")
    );
    assert_eq!(
        reply.header(header::CACHE_CONTROL),
        Some("public, max-age=31536000, immutable")
    );
    assert_eq!(reply.header(header::ETAG), Some(etag.as_str()));
    assert_eq!(reply.header(header::VARY), Some("Accept-Encoding"));
    let length = f.track_gzip.len().to_string();
    assert_eq!(reply.header(header::CONTENT_LENGTH), Some(length.as_str()));

    // No `h`, or a stale one: same bytes, but no-cache.
    for uri in [
        "/api/races/2/track".to_owned(),
        "/api/races/2/track?h=0123".to_owned(),
        format!("/api/races/2/track?h={}", f.track_sha.to_uppercase()),
    ] {
        let reply = call(&f.app, Method::GET, &uri, &[("accept-encoding", "gzip")]).await;
        assert_eq!(reply.status, StatusCode::OK, "{uri}");
        assert_eq!(reply.body, f.track_gzip, "{uri}");
        assert_eq!(
            reply.header(header::CACHE_CONTROL),
            Some("no-cache"),
            "{uri}"
        );
        assert_eq!(reply.header(header::ETAG), Some(etag.as_str()), "{uri}");
    }

    // No gzip: decompressed payload, same ETag, no Content-Encoding.
    for accept in [None, Some("identity"), Some("gzip;q=0, br")] {
        let headers: Vec<(&str, &str)> =
            accept.map(|a| ("accept-encoding", a)).into_iter().collect();
        let reply = call(&f.app, Method::GET, &uri, &headers).await;
        assert_eq!(reply.status, StatusCode::OK, "{accept:?}");
        assert_eq!(reply.body, f.track_payload, "{accept:?}");
        assert_eq!(reply.header(header::CONTENT_ENCODING), None, "{accept:?}");
        assert_eq!(reply.header(header::ETAG), Some(etag.as_str()));
        assert_eq!(
            reply.header(header::CACHE_CONTROL),
            Some("public, max-age=31536000, immutable")
        );
    }

    // Conditional request: 304 with the validators and no body.
    let reply = call(
        &f.app,
        Method::GET,
        &uri,
        &[
            ("if-none-match", etag.as_str()),
            ("accept-encoding", "gzip"),
        ],
    )
    .await;
    assert_eq!(reply.status, StatusCode::NOT_MODIFIED);
    assert!(reply.body.is_empty());
    assert_eq!(reply.header(header::ETAG), Some(etag.as_str()));

    // HEAD: headers only.
    let reply = call(&f.app, Method::HEAD, &uri, &[("accept-encoding", "gzip")]).await;
    assert_eq!(reply.status, StatusCode::OK);
    assert!(reply.body.is_empty());
    assert_eq!(reply.header(header::CONTENT_ENCODING), Some("gzip"));
}

#[tokio::test]
async fn track_errors() {
    let f = fixture().await;
    // 3: UNAVAILABLE (no bytes); 1: no row; 404: no race.
    for path in [
        "/api/races/3/track",
        "/api/races/1/track",
        "/api/races/404/track",
    ] {
        let reply = call(&f.app, Method::GET, path, &[("accept-encoding", "gzip")]).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{path}");
        assert_eq!(reply.text(), r#"{"error":"Replay track not found"}"#);
    }
    let reply = call(&f.app, Method::GET, "/api/races/abc/track", &[]).await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.text(), r#"{"error":"Invalid race ID"}"#);
    // `parseInt` rules, as in the detail route.
    let reply = call(
        &f.app,
        Method::GET,
        "/api/races/0x2/track",
        &[("accept-encoding", "gzip")],
    )
    .await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body, f.track_gzip);
}
