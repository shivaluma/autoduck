//! Port of `tests/google-auth.test.ts` (main, step 0.2) plus Rust-only checks of the remote JWKS
//! cache and the `/api/auth/google` route on a baseline DB.
//!
//! Keys: `tests/fixtures/google/{google-test,other-test}.der` are throwaway 2048-bit RSA keys
//! (PKCS#1 DER) made for these tests only; `jwks.json` publishes `google-test` as kid `test-key`.

// Server tests aren't engine code: the D4(b) `serde_json::Value` ban doesn't apply (see lib.rs).
#![allow(clippy::disallowed_types)]

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use autoduck_server::auth::admin::is_admin_secret;
use autoduck_server::auth::base64::base64url_encode;
use autoduck_server::auth::google::{
    GoogleProfile, Jwks, KeySource, KeysUnavailable, RemoteJwks, google_audiences,
    google_client_id, has_google_link, verify_google_id_token,
};
use autoduck_server::db::{Db, DbTime};
use autoduck_server::http::{self, AppState};
use axum::body::Body;
use axum::http::{Method, Request, StatusCode, header};
use http_body_util::BodyExt;
use jsonwebtoken::{Algorithm, EncodingKey};
use serde_json::{Value, json};
use sqlx::Connection;
use tower::ServiceExt;

const AUDIENCE: &str = "1234567890-test.apps.googleusercontent.com";
const ISSUER: &str = "https://accounts.google.com";
const SUB: &str = "109876543210987654321";

const GOOGLE_KEY: &[u8] = include_bytes!("fixtures/google/google-test.der");
const OTHER_KEY: &[u8] = include_bytes!("fixtures/google/other-test.der");
const JWKS_JSON: &str = include_str!("fixtures/google/jwks.json");

fn local_jwks() -> Jwks {
    Jwks::from_value(serde_json::from_str(JWKS_JSON).unwrap()).unwrap()
}

fn now() -> i64 {
    i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    )
    .unwrap()
}

fn good_claims() -> Value {
    json!({
        "sub": SUB,
        "email": "Duck@Example.com",
        "email_verified": true,
        "name": "Dzịt Test",
        "picture": "https://example.com/a.png",
    })
}

#[derive(Default)]
struct SignOpts<'a> {
    iss: Option<&'a str>,
    aud: Option<&'a str>,
    /// `None`: one hour from now; `Some(None)`: no `exp` claim.
    exp: Option<Option<i64>>,
    no_iat: bool,
    key: Option<&'a [u8]>,
    kid: Option<&'a str>,
}

fn b64_json(value: &Value) -> String {
    base64url_encode(serde_json::to_string(value).unwrap().as_bytes())
}

/// `new SignJWT(payload).setProtectedHeader({alg, kid}).setIssuer().setAudience()
/// .setIssuedAt().setExpirationTime('1h').sign(key)`.
fn sign(payload: Value, opts: SignOpts<'_>) -> String {
    let mut claims = payload.as_object().unwrap().clone();
    claims.insert("iss".into(), opts.iss.unwrap_or(ISSUER).into());
    claims.insert("aud".into(), opts.aud.unwrap_or(AUDIENCE).into());
    if !opts.no_iat {
        claims.insert("iat".into(), now().into());
    }
    match opts.exp {
        None => {
            claims.insert("exp".into(), (now() + 3600).into());
        }
        Some(Some(exp)) => {
            claims.insert("exp".into(), exp.into());
        }
        Some(None) => {}
    }
    let header = json!({ "alg": "RS256", "kid": opts.kid.unwrap_or("test-key") });
    let signing_input = format!("{}.{}", b64_json(&header), b64_json(&Value::Object(claims)));
    let key = EncodingKey::from_rsa_der(opts.key.unwrap_or(GOOGLE_KEY));
    let signature =
        jsonwebtoken::crypto::sign(signing_input.as_bytes(), &key, Algorithm::RS256).unwrap();
    format!("{signing_input}.{signature}")
}

fn aud(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).to_owned()).collect()
}

async fn verify(token: &str, audience: &[&str]) -> Option<GoogleProfile> {
    let jwks = local_jwks();
    verify_google_id_token(token, &aud(audience), KeySource::Local(&jwks))
        .await
        .unwrap()
}

#[tokio::test]
async fn accepts_a_correctly_signed_google_id_token() {
    let profile = verify(&sign(good_claims(), SignOpts::default()), &[AUDIENCE]).await;
    assert_eq!(
        profile,
        Some(GoogleProfile {
            google_id: SUB.into(),
            email: Some("duck@example.com".into()),
            name: Some("Dzịt Test".into()),
            picture: Some("https://example.com/a.png".into()),
            email_verified: true,
        })
    );
}

#[tokio::test]
async fn accepts_the_bare_accounts_google_com_issuer() {
    let token = sign(
        good_claims(),
        SignOpts {
            iss: Some("accounts.google.com"),
            ..Default::default()
        },
    );
    assert_eq!(verify(&token, &[AUDIENCE]).await.unwrap().google_id, SUB);
}

#[tokio::test]
async fn rejects_another_audience_issuer_or_expired() {
    let wrong_aud = sign(
        good_claims(),
        SignOpts {
            aud: Some("someone-else.apps.googleusercontent.com"),
            ..Default::default()
        },
    );
    assert_eq!(verify(&wrong_aud, &[AUDIENCE]).await, None);
    let wrong_iss = sign(
        good_claims(),
        SignOpts {
            iss: Some("https://evil.example.com"),
            ..Default::default()
        },
    );
    assert_eq!(verify(&wrong_iss, &[AUDIENCE]).await, None);
    let expired = sign(
        good_claims(),
        SignOpts {
            exp: Some(Some(now() - 3600)),
            ..Default::default()
        },
    );
    assert_eq!(verify(&expired, &[AUDIENCE]).await, None);
    // Inside the 30 s clock tolerance it still verifies.
    let just_expired = sign(
        good_claims(),
        SignOpts {
            exp: Some(Some(now() - 10)),
            ..Default::default()
        },
    );
    assert!(verify(&just_expired, &[AUDIENCE]).await.is_some());
}

#[tokio::test]
async fn rejects_forged_unsigned_and_tampered_tokens() {
    // Signed by a key that isn't Google's.
    let forged = sign(
        good_claims(),
        SignOpts {
            key: Some(OTHER_KEY),
            ..Default::default()
        },
    );
    assert_eq!(verify(&forged, &[AUDIENCE]).await, None);
    // alg=none, no signature.
    let mut claims = good_claims();
    claims["iss"] = ISSUER.into();
    claims["aud"] = AUDIENCE.into();
    claims["exp"] = (now() + 3600).into();
    let unsigned = format!(
        "{}.{}.",
        b64_json(&json!({"alg": "none", "typ": "JWT"})),
        b64_json(&claims)
    );
    assert_eq!(verify(&unsigned, &[AUDIENCE]).await, None);
    // Valid signature, payload swapped for another account.
    let signed = sign(good_claims(), SignOpts::default());
    let parts: Vec<&str> = signed.split('.').collect();
    let mut victim = claims.clone();
    victim["sub"] = "1".into();
    victim["email"] = "victim@example.com".into();
    let tampered = format!("{}.{}.{}", parts[0], b64_json(&victim), parts[2]);
    assert_eq!(verify(&tampered, &[AUDIENCE]).await, None);
    // HS256 with the public key as the secret (algorithm confusion).
    let confused = format!(
        "{}.{}.{}",
        b64_json(&json!({"alg": "HS256", "kid": "test-key"})),
        parts[1],
        parts[2]
    );
    assert_eq!(verify(&confused, &[AUDIENCE]).await, None);
}

#[tokio::test]
async fn rejects_raw_emails_json_payloads_and_missing_subject() {
    assert_eq!(verify("victim@example.com", &[AUDIENCE]).await, None);
    assert_eq!(
        verify(
            &json!({"sub": "1", "email": "victim@example.com"}).to_string(),
            &[AUDIENCE]
        )
        .await,
        None
    );
    assert_eq!(verify("", &[AUDIENCE]).await, None);
    let no_sub = sign(
        json!({"email": "nosub@example.com", "email_verified": true}),
        SignOpts::default(),
    );
    assert_eq!(verify(&no_sub, &[AUDIENCE]).await, None);
    let empty_sub = sign(json!({"sub": ""}), SignOpts::default());
    assert_eq!(verify(&empty_sub, &[AUDIENCE]).await, None);
}

#[tokio::test]
async fn refuses_to_verify_without_a_configured_audience() {
    let token = sign(good_claims(), SignOpts::default());
    assert_eq!(verify(&token, &[""]).await, None);
    assert_eq!(verify(&token, &[]).await, None);
}

#[tokio::test]
async fn treats_only_boolean_email_verified_true_as_verified() {
    let mut claims = good_claims();
    claims["email_verified"] = "true".into();
    let profile = verify(&sign(claims, SignOpts::default()), &[AUDIENCE])
        .await
        .unwrap();
    assert!(!profile.email_verified);
}

#[tokio::test]
async fn accepts_any_of_our_client_ids_and_checks_azp() {
    let other = "second-client.apps.googleusercontent.com";
    let for_other = sign(
        good_claims(),
        SignOpts {
            aud: Some(other),
            ..Default::default()
        },
    );
    assert_eq!(
        verify(&for_other, &[AUDIENCE, other])
            .await
            .unwrap()
            .google_id,
        SUB
    );
    let mut attacker = good_claims();
    attacker["azp"] = "attacker.apps.googleusercontent.com".into();
    assert_eq!(
        verify(&sign(attacker, SignOpts::default()), &[AUDIENCE]).await,
        None
    );
    let mut ours = good_claims();
    ours["azp"] = AUDIENCE.into();
    assert_eq!(
        verify(&sign(ours, SignOpts::default()), &[AUDIENCE])
            .await
            .unwrap()
            .google_id,
        SUB
    );
    let mut null_azp = good_claims();
    null_azp["azp"] = Value::Null;
    assert_eq!(
        verify(&sign(null_azp, SignOpts::default()), &[AUDIENCE]).await,
        None
    );
}

#[tokio::test]
async fn requires_exp_and_iat() {
    let no_exp = sign(
        good_claims(),
        SignOpts {
            exp: Some(None),
            ..Default::default()
        },
    );
    assert_eq!(verify(&no_exp, &[AUDIENCE]).await, None);
    let no_iat = sign(
        good_claims(),
        SignOpts {
            no_iat: true,
            ..Default::default()
        },
    );
    assert_eq!(verify(&no_iat, &[AUDIENCE]).await, None);
}

#[tokio::test]
async fn unknown_kid_is_rejected_not_unavailable() {
    let token = sign(
        good_claims(),
        SignOpts {
            kid: Some("rotated-away"),
            ..Default::default()
        },
    );
    assert_eq!(verify(&token, &[AUDIENCE]).await, None);
}

/// A port nothing listens on.
async fn closed_port_url() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    format!("http://{addr}/certs")
}

#[tokio::test]
async fn reports_unreachable_google_keys_instead_of_rejecting_the_user() {
    let remote = RemoteJwks::new(&closed_port_url().await);
    let token = sign(good_claims(), SignOpts::default());
    let result =
        verify_google_id_token(&token, &aud(&[AUDIENCE]), KeySource::Remote(&remote)).await;
    assert!(matches!(result, Err(KeysUnavailable(_))), "{result:?}");
    // A token that fails before key resolution is judged without Google.
    let result = verify_google_id_token(
        "victim@example.com",
        &aud(&[AUDIENCE]),
        KeySource::Remote(&remote),
    )
    .await;
    assert_eq!(result, Ok(None));
}

#[test]
fn has_google_link_only_counts_real_numeric_google_ids() {
    assert!(has_google_link(Some(SUB)));
    assert!(!has_google_link(Some("duck@example.com")));
    assert!(!has_google_link(Some("google-user-123")));
    assert!(!has_google_link(Some("")));
    assert!(!has_google_link(None));
}

#[test]
fn google_audiences_accepts_both_ids_and_the_button_uses_the_public_one() {
    let both = google_audiences(Some("server-id"), Some("public-id"));
    assert_eq!(both, ["server-id", "public-id"]);
    assert_eq!(google_client_id(&both), "public-id");
    assert_eq!(
        google_audiences(Some(" same-id "), Some("same-id")),
        ["same-id"]
    );
    let none = google_audiences(None, None);
    assert!(none.is_empty());
    assert_eq!(google_client_id(&none), "");
}

#[test]
fn admin_secret_fails_closed_and_compares_any_length() {
    assert!(!is_admin_secret("", None));
    assert!(!is_admin_secret("", Some("")));
    assert!(!is_admin_secret("   ", Some("   ")));
    // The config loader trims the key (`process.env.RACE_SECRET_KEY?.trim()`).
    let key = autoduck_server::auth::js_trim("correct-horse-battery-staple\n");
    assert!(is_admin_secret(key, Some("correct-horse-battery-staple")));
    assert!(!is_admin_secret(key, Some("wrong")));
    assert!(!is_admin_secret(
        key,
        Some("correct-horse-battery-staple-and-more")
    ));
    assert!(!is_admin_secret(key, None));
}

// ---------------------------------------------------------------------------------------------
// Remote JWKS (Rust-only): cache, cooldown and fetch failures, against a local server.

struct JwksServer {
    url: String,
    fetches: Arc<AtomicUsize>,
}

async fn jwks_server(status: StatusCode, body: &'static str) -> JwksServer {
    let fetches = Arc::new(AtomicUsize::new(0));
    let counter = fetches.clone();
    let app = axum::Router::new()
        .route(
            "/certs",
            axum::routing::get(move || {
                counter.fetch_add(1, Ordering::SeqCst);
                async move { (status, [(header::CONTENT_TYPE, "application/json")], body) }
            }),
        )
        .route(
            "/moved",
            axum::routing::get(|| async { (StatusCode::FOUND, [(header::LOCATION, "/certs")]) }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    JwksServer {
        url: format!("http://{addr}/certs"),
        fetches,
    }
}

#[tokio::test]
async fn remote_jwks_is_cached_and_cooldown_limits_refetches() {
    let server = jwks_server(StatusCode::OK, JWKS_JSON).await;
    let remote = RemoteJwks::new(&server.url);
    let audience = aud(&[AUDIENCE]);
    for _ in 0..3 {
        let token = sign(good_claims(), SignOpts::default());
        let profile = verify_google_id_token(&token, &audience, KeySource::Remote(&remote))
            .await
            .unwrap();
        assert_eq!(profile.unwrap().google_id, SUB);
    }
    assert_eq!(server.fetches.load(Ordering::SeqCst), 1);
    // Unknown kid right after a fetch: no re-fetch inside the 30 s cooldown, token rejected.
    let token = sign(
        good_claims(),
        SignOpts {
            kid: Some("rotated-away"),
            ..Default::default()
        },
    );
    let result = verify_google_id_token(&token, &audience, KeySource::Remote(&remote)).await;
    assert_eq!(result, Ok(None));
    assert_eq!(server.fetches.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn remote_jwks_fetch_failures_are_unavailable() {
    let token = sign(good_claims(), SignOpts::default());
    let audience = aud(&[AUDIENCE]);
    let cases = [
        jwks_server(StatusCode::INTERNAL_SERVER_ERROR, JWKS_JSON)
            .await
            .url,
        jwks_server(StatusCode::OK, "not json").await.url,
        jwks_server(StatusCode::OK, r#"{"keys": "nope"}"#).await.url,
        jwks_server(StatusCode::OK, r#"{"keys": [1]}"#).await.url,
        // jose fetches with `redirect: 'manual'`, so a redirect is a non-200 answer.
        jwks_server(StatusCode::OK, JWKS_JSON)
            .await
            .url
            .replace("/certs", "/moved"),
        // The matched key can't be used (too short to be an RS256 key).
        jwks_server(
            StatusCode::OK,
            r#"{"keys":[{"kty":"RSA","kid":"test-key","n":"AQAB","e":"AQAB"}]}"#,
        )
        .await
        .url,
    ];
    for url in cases {
        let remote = RemoteJwks::new(&url);
        let result = verify_google_id_token(&token, &audience, KeySource::Remote(&remote)).await;
        assert!(
            matches!(result, Err(KeysUnavailable(_))),
            "{url}: {result:?}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The route (`/api/auth/google`) on a baseline DB.

struct Fixture {
    _dir: tempfile::TempDir,
    db_path: std::path::PathBuf,
    app: axum::Router,
}

async fn fixture(extra: &[(&str, &str)]) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("autoduck.db");
    common::populated_db(&db).await;
    // A second player in the same season, and a user who is in no season.
    let mut conn = sqlx::SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new().filename(&db),
    )
    .await
    .unwrap();
    let now = DbTime::now();
    for statement in [
        r#"INSERT INTO "User" ("id", "name", "email", "createdAt", "updatedAt") VALUES (2, 'Dzịt Hai', 'hai@example.com', ?1, ?1)"#,
        r#"INSERT INTO "SeasonPlayer" ("id", "seasonId", "userId", "accessToken", "createdAt", "updatedAt") VALUES (2, 1, 2, 'token-2', ?1, ?1)"#,
        r#"INSERT INTO "User" ("id", "name", "googleId", "createdAt", "updatedAt") VALUES (3, 'Dzịt Ba', '555', ?1, ?1)"#,
    ] {
        sqlx::query(statement)
            .bind(now)
            .execute(&mut conn)
            .await
            .unwrap();
    }
    drop(conn);
    let mut vars = vec![("AUTODUCK_ENV", "dev")];
    vars.extend_from_slice(extra);
    let config = common::config(dir.path(), &db, &vars);
    let state = AppState::new(config, Db::open(&db).await.unwrap());
    Fixture {
        app: http::router(state),
        db_path: db,
        _dir: dir,
    }
}

async fn call(app: &axum::Router, method: Method, uri: &str, body: &str) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_owned()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| panic!("{uri}: not JSON: {:?}", String::from_utf8_lossy(&bytes))),
    )
}

async fn post(app: &axum::Router, body: Value) -> (StatusCode, Value) {
    call(app, Method::POST, "/api/auth/google", &body.to_string()).await
}

async fn user_row(db: &std::path::Path, id: i64) -> (Option<String>, Option<String>, String) {
    let mut conn = sqlx::SqliteConnection::connect_with(
        &sqlx::sqlite::SqliteConnectOptions::new()
            .filename(db)
            .read_only(true),
    )
    .await
    .unwrap();
    sqlx::query_as(r#"SELECT "googleId", "email", "updatedAt" FROM "User" WHERE "id" = ?"#)
        .bind(id)
        .fetch_one(&mut conn)
        .await
        .unwrap()
}

fn error(message: &str) -> Value {
    json!({ "error": message })
}

#[tokio::test]
async fn route_get_reports_config_and_bound_user() {
    let f = fixture(&[
        ("GOOGLE_CLIENT_ID", "server-id"),
        ("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "public-id"),
    ])
    .await;
    let (status, body) = call(&f.app, Method::GET, "/api/auth/google", "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::to_string(&body).unwrap(),
        r#"{"clientId":"public-id","isConfigured":true,"bound":null}"#
    );
    let (_, body) = call(&f.app, Method::GET, "/api/auth/google?token=token-1", "").await;
    assert_eq!(
        serde_json::to_string(&body["bound"]).unwrap(),
        r#"{"userId":1,"name":"Zịt Test","email":null,"hasGoogle":false}"#
    );
    let (_, body) = call(&f.app, Method::GET, "/api/auth/google?token=nope", "").await;
    assert_eq!(body["bound"], Value::Null);

    let unconfigured = fixture(&[]).await;
    let (_, body) = call(&unconfigured.app, Method::GET, "/api/auth/google", "").await;
    assert_eq!(
        body,
        json!({"clientId": "", "isConfigured": false, "bound": null})
    );
}

#[tokio::test]
async fn route_post_validation_order() {
    let unconfigured = fixture(&[]).await;
    let app = &unconfigured.app;
    for raw in ["", "not json", "[]", "null", "\"x\""] {
        let (status, body) = call(app, Method::POST, "/api/auth/google", raw).await;
        assert_eq!(
            (status, body),
            (StatusCode::BAD_REQUEST, error("Yêu cầu không hợp lệ")),
            "{raw:?}"
        );
    }
    let (status, body) = post(app, json!({"action": null})).await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error("Hành động không hợp lệ"))
    );
    // Unbind doesn't need Google configured.
    let (status, body) = post(app, json!({"action": "unbind"})).await;
    assert_eq!(
        (status, body),
        (StatusCode::BAD_REQUEST, error("Token là bắt buộc"))
    );
    let (status, body) = post(app, json!({"action": "unbind", "token": "nope"})).await;
    assert_eq!(
        (status, body),
        (StatusCode::UNAUTHORIZED, error("Token không hợp lệ"))
    );
    // Login and bind do.
    let (status, body) = post(app, json!({"credential": "x"})).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            error("Đăng nhập Google chưa được cấu hình.")
        )
    );

    let jwks = jwks_server(StatusCode::OK, JWKS_JSON).await;
    let f = fixture(&[
        ("GOOGLE_CLIENT_ID", AUDIENCE),
        ("AUTODUCK_GOOGLE_JWKS_URL", &jwks.url),
    ])
    .await;
    for body in [
        json!({}),
        json!({"credential": "  "}),
        json!({"credential": 5}),
    ] {
        let (status, reply) = post(&f.app, body).await;
        assert_eq!(
            (status, reply),
            (
                StatusCode::BAD_REQUEST,
                error("Thiếu thông tin xác thực Google")
            )
        );
    }
    let (status, body) = post(&f.app, json!({"credential": "victim@example.com"})).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::UNAUTHORIZED,
            error("Không thể xác thực thông tin tài khoản Google")
        )
    );
    // Bind verifies the credential before looking at the token.
    let (status, _) = post(&f.app, json!({"action": "bind", "credential": "bad"})).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let down = closed_port_url().await;
    let f = fixture(&[
        ("GOOGLE_CLIENT_ID", AUDIENCE),
        ("AUTODUCK_GOOGLE_JWKS_URL", &down),
    ])
    .await;
    let token = sign(good_claims(), SignOpts::default());
    let (status, body) = post(&f.app, json!({"credential": token})).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::SERVICE_UNAVAILABLE,
            error("Không kết nối được Google. Vui lòng thử lại sau.")
        )
    );
}

#[tokio::test]
async fn route_bind_login_unbind_flow() {
    let jwks = jwks_server(StatusCode::OK, JWKS_JSON).await;
    let f = fixture(&[
        ("NEXT_PUBLIC_GOOGLE_CLIENT_ID", AUDIENCE),
        ("AUTODUCK_GOOGLE_JWKS_URL", &jwks.url),
    ])
    .await;
    let credential = || sign(good_claims(), SignOpts::default());

    // Not linked yet: login by sub finds nobody.
    let (status, body) = post(&f.app, json!({"credential": credential()})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(
        body["error"]
            .as_str()
            .unwrap()
            .contains("chưa được liên kết")
    );

    let (status, body) = post(
        &f.app,
        json!({"action": "bind", "credential": credential()}),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::BAD_REQUEST,
            error("Token là bắt buộc để liên kết")
        )
    );
    let (status, body) = post(
        &f.app,
        json!({"action": "bind", "credential": credential(), "token": "nope"}),
    )
    .await;
    assert_eq!(
        (status, body),
        (StatusCode::UNAUTHORIZED, error("Token không hợp lệ"))
    );

    let (status, body) = post(
        &f.app,
        json!({"action": "bind", "credential": credential(), "token": "token-1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::to_string(&body).unwrap(),
        r#"{"ok":true,"message":"Đã liên kết tài khoản Google (duck@example.com) với Dzịt Zịt Test!","user":{"id":1,"name":"Zịt Test","email":"duck@example.com"}}"#
    );
    let (google_id, email, updated_at) = user_row(&f.db_path, 1).await;
    assert_eq!(google_id.as_deref(), Some(SUB));
    assert_eq!(email.as_deref(), Some("duck@example.com"));
    // D13: Rust writes the Prisma timestamp format.
    assert!(
        updated_at.len() == 29 && updated_at.ends_with("+00:00") && updated_at.contains('T'),
        "{updated_at}"
    );
    let (_, body) = call(&f.app, Method::GET, "/api/auth/google?token=token-1", "").await;
    assert_eq!(body["bound"]["hasGoogle"], true);

    // One Google account per duck: another player can't bind the same sub.
    let (status, body) = post(
        &f.app,
        json!({"action": "bind", "credential": credential(), "token": "token-2"}),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::CONFLICT,
            error("Tài khoản Google này đã được liên kết với một chú Dzịt khác.")
        )
    );

    let (status, body) = post(
        &f.app,
        json!({"action": "login", "credential": credential()}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::to_string(&body).unwrap(),
        r#"{"ok":true,"message":"Đăng nhập thành công! Chào mừng Dzịt Zịt Test! 🦆","token":"token-1","user":{"id":1,"name":"Zịt Test","email":"duck@example.com"}}"#
    );

    let (status, body) = post(&f.app, json!({"action": "unbind", "token": "token-1"})).await;
    assert_eq!(
        (status, body),
        (
            StatusCode::OK,
            json!({"ok": true, "message": "Đã hủy liên kết tài khoản Google thành công."})
        )
    );
    let (google_id, email, _) = user_row(&f.db_path, 1).await;
    assert_eq!((google_id, email), (None, None));
    let (status, _) = post(&f.app, json!({"credential": credential()})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn route_bind_keeps_email_owned_by_another_user_and_unverified_email() {
    let jwks = jwks_server(StatusCode::OK, JWKS_JSON).await;
    let f = fixture(&[
        ("GOOGLE_CLIENT_ID", AUDIENCE),
        ("AUTODUCK_GOOGLE_JWKS_URL", &jwks.url),
    ])
    .await;
    // Google says hai@example.com, which user 2 already has: user 1 keeps its own (null) email.
    let mut claims = good_claims();
    claims["email"] = "HAI@example.com".into();
    let (status, body) = post(
        &f.app,
        json!({"action": "bind", "credential": sign(claims, SignOpts::default()), "token": "token-1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["user"]["email"], Value::Null);
    assert_eq!(
        body["message"],
        "Đã liên kết tài khoản Google (hai@example.com) với Dzịt Zịt Test!"
    );

    // Unverified email is never stored; the message falls back to the name.
    let mut claims = good_claims();
    claims["sub"] = "424242".into();
    claims["email_verified"] = false.into();
    claims.as_object_mut().unwrap().remove("email");
    let (status, body) = post(
        &f.app,
        json!({"action": "bind", "credential": sign(claims, SignOpts::default()), "token": "token-2"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["user"]["email"], "hai@example.com");
    assert_eq!(
        body["message"],
        "Đã liên kết tài khoản Google (Dzịt Test) với Dzịt Dzịt Hai!"
    );
}

#[tokio::test]
async fn route_login_requires_an_active_season_player_and_never_matches_by_email() {
    let jwks = jwks_server(StatusCode::OK, JWKS_JSON).await;
    let f = fixture(&[
        ("GOOGLE_CLIENT_ID", AUDIENCE),
        ("AUTODUCK_GOOGLE_JWKS_URL", &jwks.url),
    ])
    .await;
    // User 3 is linked to sub 555 but plays in no season.
    let mut claims = good_claims();
    claims["sub"] = "555".into();
    let (status, body) = post(
        &f.app,
        json!({"credential": sign(claims, SignOpts::default())}),
    )
    .await;
    assert_eq!(
        (status, body),
        (
            StatusCode::FORBIDDEN,
            error("Chú Dzịt \"Dzịt Ba\" chưa tham gia Season 3 đang mở. Vui lòng liên hệ Admin.")
        )
    );
    // A verified Google email equal to user 2's email does not log in as user 2 (sub only).
    let mut claims = good_claims();
    claims["sub"] = "777".into();
    claims["email"] = "hai@example.com".into();
    let (status, _) = post(
        &f.app,
        json!({"credential": sign(claims, SignOpts::default())}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
