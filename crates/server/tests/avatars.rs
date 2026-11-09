//! `/api/avatars/{userId}` through the router on a baseline DB: the TS responses for each
//! branch, and the SSRF guard refusing inward targets.

mod common;

use autoduck_server::db::{Db, DbTime};
use autoduck_server::http::{self, AppState};
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use http_body_util::BodyExt;
use sqlx::Connection;
use tower::ServiceExt;

async fn app() -> (tempfile::TempDir, axum::Router) {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    common::populated_db(&db).await;
    let mut conn = sqlx::SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new().filename(&db),
    )
    .await
    .unwrap();
    let now = DbTime::now();
    let avatars = [
        (10, "  data:image/png;base64,UE5H  "),
        (11, "data:image/svg+xml,%3Csvg%2F%3E"),
        (12, "data:image/png;charset=x,abc"),
        (13, "not a url"),
        (14, "ftp://example.com/a.png"),
        (15, "http://127.0.0.1:9/a.png"),
        (16, "http://169.254.169.254/latest/meta-data/"),
        (17, "http://localhost:9/a.png"),
        (18, "http://[::1]:9/a.png"),
        (19, "   "),
    ];
    for (id, url) in avatars {
        sqlx::query(
            r#"INSERT INTO "User" ("id", "name", "avatarUrl", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?)"#,
        )
        .bind(id)
        .bind(format!("user {id}"))
        .bind(url)
        .bind(now)
        .bind(now)
        .execute(&mut conn)
        .await
        .unwrap();
    }
    drop(conn);
    let config = common::config(dir.path(), &db, &[]);
    let state = AppState::new(config, Db::open(&db).await.unwrap());
    (dir, http::router(state))
}

async fn get(app: &axum::Router, uri: &str) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let response = app
        .clone()
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, headers, body.to_vec())
}

#[tokio::test]
async fn avatar_route_matches_ts_responses() {
    let (_dir, app) = app().await;
    let cases: [(&str, StatusCode, &[u8]); 9] = [
        ("/api/avatars/abc", StatusCode::BAD_REQUEST, b"Invalid user"),
        (
            "/api/avatars/99999999999999999999",
            StatusCode::BAD_REQUEST,
            b"Invalid user",
        ),
        // User 1 has no avatar; 404 for unknown ids and blank URLs too.
        ("/api/avatars/1", StatusCode::NOT_FOUND, b"No avatar"),
        ("/api/avatars/404", StatusCode::NOT_FOUND, b"No avatar"),
        ("/api/avatars/19", StatusCode::NOT_FOUND, b"No avatar"),
        (
            "/api/avatars/12",
            StatusCode::UNPROCESSABLE_ENTITY,
            b"Bad avatar",
        ),
        (
            "/api/avatars/13",
            StatusCode::UNPROCESSABLE_ENTITY,
            b"Bad avatar",
        ),
        (
            "/api/avatars/14",
            StatusCode::UNPROCESSABLE_ENTITY,
            b"Bad avatar",
        ),
        // parseInt: trailing junk is ignored.
        ("/api/avatars/1x", StatusCode::NOT_FOUND, b"No avatar"),
    ];
    for (uri, status, body) in cases {
        let (got, headers, bytes) = get(&app, uri).await;
        assert_eq!(got, status, "{uri}");
        assert_eq!(bytes, body, "{uri}");
        assert_eq!(
            headers[header::CONTENT_TYPE],
            "text/plain;charset=UTF-8",
            "{uri}"
        );
    }

    let (status, headers, body) = get(&app, "/api/avatars/10").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"PNG");
    assert_eq!(headers[header::CONTENT_TYPE], "image/png");
    assert_eq!(
        headers[header::CONTENT_SECURITY_POLICY],
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"
    );
    assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    assert_eq!(
        headers[header::CACHE_CONTROL],
        "public, max-age=3600, stale-while-revalidate=86400"
    );
    let (status, headers, body) = get(&app, "/api/avatars/11").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, b"<svg/>");
    assert_eq!(headers[header::CONTENT_TYPE], "image/svg+xml");
}

#[tokio::test]
async fn avatar_proxy_refuses_inward_targets() {
    let (_dir, app) = app().await;
    for id in 15..=18 {
        let (status, _, body) = get(&app, &format!("/api/avatars/{id}")).await;
        assert_eq!(status, StatusCode::BAD_GATEWAY, "user {id}");
        assert_eq!(body, b"Avatar unavailable", "user {id}");
    }
}
