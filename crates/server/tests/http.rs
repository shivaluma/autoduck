//! Router behaviour: static `dist/` with SPA fallback, cache headers, JSON 404 for `/api`,
//! security headers and `/api/health`.

mod common;

use autoduck_server::db::Db;
use autoduck_server::http::{self, AppState};
use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use tower::ServiceExt;

struct Fixture {
    _dir: tempfile::TempDir,
    app: axum::Router,
}

async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    common::populated_db(&db).await;
    let dist = dir.path().join("dist");
    std::fs::create_dir_all(dist.join("assets")).unwrap();
    std::fs::create_dir_all(dist.join("race-tracks")).unwrap();
    std::fs::write(dist.join("index.html"), "<!doctype html><title>SPA</title>").unwrap();
    std::fs::write(dist.join("assets/index-Ab12Cd34.js"), "console.log(1)").unwrap();
    std::fs::write(dist.join("race-tracks/river-01-v2@deadbeef.json"), "{}").unwrap();
    std::fs::write(dist.join("robots.txt"), "User-agent: *").unwrap();
    let config = common::config(dir.path(), &db, &[]);
    let state = AppState::new(config, Db::open(&db).await.unwrap());
    Fixture {
        app: http::router(state),
        _dir: dir,
    }
}

struct Reply {
    status: StatusCode,
    headers: axum::http::HeaderMap,
    body: String,
}

async fn call(app: &axum::Router, method: Method, uri: &str) -> Reply {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    }
}

fn header(reply: &Reply, name: header::HeaderName) -> &str {
    reply
        .headers
        .get(name)
        .map(|v| v.to_str().unwrap())
        .unwrap_or("")
}

#[tokio::test]
async fn spa_fallback_for_extensionless_paths() {
    let f = fixture().await;
    for path in [
        "/",
        "/season-3",
        "/season-3/race/12?token=abc",
        "/admin/season-3",
        "/apix",
    ] {
        let reply = call(&f.app, Method::GET, path).await;
        assert_eq!(reply.status, StatusCode::OK, "{path}");
        assert!(reply.body.contains("<title>SPA</title>"), "{path}");
        assert_eq!(header(&reply, header::CACHE_CONTROL), "no-cache", "{path}");
        assert!(header(&reply, header::CONTENT_TYPE).starts_with("text/html"));
    }
    let explicit = call(&f.app, Method::GET, "/index.html").await;
    assert_eq!(explicit.status, StatusCode::OK);
    assert_eq!(header(&explicit, header::CACHE_CONTROL), "no-cache");
}

#[tokio::test]
async fn files_and_cache_rules() {
    let f = fixture().await;
    let asset = call(&f.app, Method::GET, "/assets/index-Ab12Cd34.js").await;
    assert_eq!(asset.status, StatusCode::OK);
    assert_eq!(asset.body, "console.log(1)");
    assert_eq!(
        header(&asset, header::CACHE_CONTROL),
        "public, max-age=31536000, immutable"
    );
    assert!(header(&asset, header::CONTENT_TYPE).contains("javascript"));

    let track = call(
        &f.app,
        Method::GET,
        "/race-tracks/river-01-v2@deadbeef.json",
    )
    .await;
    assert_eq!(track.status, StatusCode::OK);
    assert_eq!(
        header(&track, header::CACHE_CONTROL),
        "public, max-age=31536000, immutable"
    );

    let robots = call(&f.app, Method::GET, "/robots.txt").await;
    assert_eq!(robots.status, StatusCode::OK);
    assert_eq!(header(&robots, header::CACHE_CONTROL), "public, max-age=0");

    let head = call(&f.app, Method::HEAD, "/assets/index-Ab12Cd34.js").await;
    assert_eq!(head.status, StatusCode::OK);
    assert!(head.body.is_empty());
}

#[tokio::test]
async fn missing_files_are_404_not_the_spa() {
    let f = fixture().await;
    for path in [
        "/assets/missing-00000000.js",
        "/favicon.ico",
        "/../Cargo.toml",
        "/assets/../../autoduck.db",
    ] {
        let reply = call(&f.app, Method::GET, path).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{path}");
        assert!(!reply.body.contains("SPA"), "{path}");
    }
}

#[tokio::test]
async fn api_misses_are_json_404() {
    let f = fixture().await;
    for path in [
        "/api",
        "/api/nope",
        "/api/races/1/nope",
        "/api/season-3.json",
    ] {
        let reply = call(&f.app, Method::GET, path).await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND, "{path}");
        assert_eq!(reply.body, r#"{"error":"Not found"}"#, "{path}");
        assert!(header(&reply, header::CONTENT_TYPE).starts_with("application/json"));
    }
    let post = call(&f.app, Method::POST, "/api/nope").await;
    assert_eq!(post.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn non_get_pages_are_405() {
    let f = fixture().await;
    let reply = call(&f.app, Method::POST, "/season-3").await;
    assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header(&reply, header::ALLOW), "GET, HEAD");
}

#[tokio::test]
async fn health_reports_db() {
    let f = fixture().await;
    let reply = call(&f.app, Method::GET, "/api/health").await;
    assert_eq!(reply.status, StatusCode::OK);
    assert_eq!(reply.body, r#"{"ok":true,"db":true}"#);
    assert_eq!(header(&reply, header::CACHE_CONTROL), "no-store");
}

#[tokio::test]
async fn security_headers_on_every_response() {
    let f = fixture().await;
    for path in [
        "/",
        "/api/health",
        "/api/nope",
        "/assets/index-Ab12Cd34.js",
        "/missing.css",
    ] {
        let reply = call(&f.app, Method::GET, path).await;
        assert_eq!(
            header(&reply, header::REFERRER_POLICY),
            "same-origin",
            "{path}"
        );
        assert_eq!(
            header(&reply, header::X_CONTENT_TYPE_OPTIONS),
            "nosniff",
            "{path}"
        );
        assert_eq!(
            header(&reply, header::X_FRAME_OPTIONS),
            "SAMEORIGIN",
            "{path}"
        );
        assert!(
            header(&reply, header::CONTENT_SECURITY_POLICY_REPORT_ONLY)
                .contains("default-src 'self'"),
            "{path}"
        );
        assert!(
            reply.headers.get(header::CONTENT_SECURITY_POLICY).is_none(),
            "CSP must stay report-only"
        );
    }
}

#[tokio::test]
async fn missing_dist_still_serves_the_api() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    common::populated_db(&db).await;
    let config = common::config(dir.path(), &db, &[]); // dist/ doesn't exist
    let app = http::router(AppState::new(config, Db::open(&db).await.unwrap()));
    assert_eq!(
        call(&app, Method::GET, "/").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&app, Method::GET, "/api/health").await.status,
        StatusCode::OK
    );
}

async fn send(app: &axum::Router, request: Request<Body>) -> Reply {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    Reply {
        status,
        headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    }
}

/// Review 3, findings 3 and 4: Next answers OPTIONS with 204 + Allow, lists methods its own
/// way on 405, and 308-redirects trailing and repeated slashes.
#[tokio::test]
async fn next_style_methods_and_canonical_paths() {
    let f = fixture().await;
    let reply = call(&f.app, Method::OPTIONS, "/api/health").await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    assert_eq!(header(&reply, header::ALLOW), "GET, HEAD, OPTIONS");
    let reply = call(&f.app, Method::OPTIONS, "/api/gacha/pull").await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    assert_eq!(header(&reply, header::ALLOW), "OPTIONS, POST");
    let reply = call(&f.app, Method::DELETE, "/api/cosmetics/shop").await;
    assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED);
    assert_eq!(header(&reply, header::ALLOW), "GET, HEAD, OPTIONS, POST");
    assert_eq!(
        call(&f.app, Method::OPTIONS, "/api/nope").await.status,
        StatusCode::NOT_FOUND
    );

    for (from, to) in [
        ("/api/races/14/", "/api/races/14"),
        ("/api/", "/api"),
        ("/api/health/", "/api/health"),
        ("/api//health", "/api/health"),
        ("//evil.example/x", "/evil.example/x"),
        ("/season-3/?token=a", "/season-3?token=a"),
    ] {
        let reply = call(&f.app, Method::GET, from).await;
        assert_eq!(reply.status, StatusCode::PERMANENT_REDIRECT, "{from}");
        assert_eq!(header(&reply, header::LOCATION), to, "{from}");
    }
}

/// Review 2 finding 4 / review 3 finding 5: framework rejections keep the JSON error shape.
#[tokio::test]
async fn framework_rejections_are_json() {
    let f = fixture().await;
    let big = vec![b' '; autoduck_server::http::BODY_LIMIT + 1];
    let reply = send(
        &f.app,
        Request::builder()
            .method(Method::POST)
            .uri("/api/gacha/pull")
            .body(Body::from(big))
            .unwrap(),
    )
    .await;
    assert_eq!(reply.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(reply.body, r#"{"error":"Payload Too Large"}"#);
    assert_eq!(header(&reply, header::CONTENT_TYPE), "application/json");

    let reply = call(&f.app, Method::GET, "/api/cosmetics/profile/%FF").await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert!(reply.body.starts_with(r#"{"error":"#), "{}", reply.body);
    let reply = call(&f.app, Method::GET, "/api/avatars/%FF").await;
    assert_eq!(reply.status, StatusCode::BAD_REQUEST);
    assert_eq!(reply.body, "Invalid user");
}

/// Review 2, finding 8: personal API answers say `no-store` unless the route chose a policy.
#[tokio::test]
async fn api_answers_are_no_store_by_default() {
    let f = fixture().await;
    for uri in ["/api/cosmetics/shop?token=x", "/api/races/999", "/api/nope"] {
        let reply = call(&f.app, Method::GET, uri).await;
        assert_eq!(header(&reply, header::CACHE_CONTROL), "no-store", "{uri}");
    }
    let reply = call(&f.app, Method::GET, "/assets/index-Ab12Cd34.js").await;
    assert_ne!(header(&reply, header::CACHE_CONTROL), "no-store");
}

/// Review 2, finding 3: the report-only CSP posts somewhere that logs it.
#[tokio::test]
async fn csp_reports_are_accepted_and_capped() {
    let f = fixture().await;
    let reply = call(&f.app, Method::GET, "/").await;
    assert!(
        header(
            &reply,
            header::HeaderName::from_static("content-security-policy-report-only")
        )
        .ends_with("report-uri /api/csp-report")
    );
    let post = |body: Vec<u8>| {
        Request::builder()
            .method(Method::POST)
            .uri("/api/csp-report")
            .header(header::CONTENT_TYPE, "application/csp-report")
            .body(Body::from(body))
            .unwrap()
    };
    let reply = send(
        &f.app,
        post(br#"{"csp-report":{"violated-directive":"img-src"}}"#.to_vec()),
    )
    .await;
    assert_eq!(reply.status, StatusCode::NO_CONTENT);
    let reply = send(&f.app, post(vec![b'x'; 20 * 1024])).await;
    assert_eq!(reply.status, StatusCode::PAYLOAD_TOO_LARGE);
}
