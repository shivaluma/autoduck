//! The economy routes end to end on a baseline-schema DB: profile, shop, gacha and admin
//! cosmetics. (Byte-for-byte parity with the TS routes is checked by the TS-vs-Rust diff on a
//! dev.db copy; these tests keep every statement exercised against the schema in CI.)

// Server code, not the engine: the D4(b) type bans (HashMap/HashSet, serde_json::Value) do
// not apply (see src/lib.rs).
#![allow(clippy::disallowed_types)]

mod common;

use autoduck_server::cosmetics::catalog;
use autoduck_server::cosmetics::inventory::grant_starter_cosmetics;
use autoduck_server::db::Db;
use autoduck_server::http::{self, AppState};
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

const SECRET: &str = "economy-test-secret-0123456789";

struct Fixture {
    _dir: tempfile::TempDir,
    app: axum::Router,
    db: Db,
}

async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("autoduck.db");
    common::populated_db(&path).await;
    let db = Db::open(&path).await.unwrap();
    let mut tx = db.begin_write().await.unwrap();
    grant_starter_cosmetics(&mut tx, 1).await.unwrap();
    tx.commit().await.unwrap();
    let config = common::config(dir.path(), &path, &[("RACE_SECRET_KEY", SECRET)]);
    let state = AppState::new(config, db.clone());
    Fixture {
        app: http::router(state),
        db,
        _dir: dir,
    }
}

async fn call(
    f: &Fixture,
    method: Method,
    uri: &str,
    admin: bool,
    body: Option<&str>,
) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(uri);
    if admin {
        request = request.header("x-race-secret", SECRET);
    }
    let response = f
        .app
        .clone()
        .oneshot(
            request
                .body(body.map_or_else(Body::empty, |body| Body::from(body.to_owned())))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value)
}

async fn admin_post(f: &Fixture, body: Value) -> (StatusCode, Value) {
    call(
        f,
        Method::POST,
        "/api/admin/cosmetics",
        true,
        Some(&body.to_string()),
    )
    .await
}

async fn count(f: &Fixture, table: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        r#"SELECT COUNT(*) FROM "{table}""#
    )))
    .fetch_one(&f.db.reader)
    .await
    .unwrap()
}

#[tokio::test]
async fn profile_lookup_owner_and_validation() {
    let f = fixture().await;
    let (status, body) = call(&f, Method::GET, "/api/cosmetics/profile/1", false, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["userId"], 1);
    assert_eq!(body["name"], "Zịt Test");
    assert_eq!(body["season"], "Season 3");
    assert_eq!(body["isOwner"], false);
    assert_eq!(body["personalLink"], Value::Null);
    assert_eq!(body["collectionCount"], catalog().starter_ids.len());
    assert_eq!(body["appearance"]["bodyColorId"], "body-sunshine");
    assert_eq!(body["stats"]["isKing"], false);
    let keys: Vec<&str> = body
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(
        keys,
        [
            "userId",
            "name",
            "avatarUrl",
            "season",
            "appearance",
            "favoriteId",
            "collectionCount",
            "recentCosmetics",
            "stats",
            "isOwner",
            "isGoogleLinked",
            "googleEmail",
            "personalLink"
        ]
    );

    let (_, owner) = call(
        &f,
        Method::GET,
        "/api/cosmetics/profile/0x1?token=token-1",
        false,
        None,
    )
    .await;
    assert_eq!(owner["isOwner"], true);
    assert_eq!(owner["personalLink"], "/season-3?token=token-1");

    for (path, status) in [
        ("/api/cosmetics/profile/abc", StatusCode::BAD_REQUEST),
        ("/api/cosmetics/profile/1.5", StatusCode::BAD_REQUEST),
        ("/api/cosmetics/profile/2", StatusCode::NOT_FOUND),
        (
            "/api/cosmetics/profile/1e20",
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        assert_eq!(
            call(&f, Method::GET, path, false, None).await.0,
            status,
            "{path}"
        );
    }
}

#[tokio::test]
async fn shop_rotation_and_purchase() {
    let f = fixture().await;
    let (status, body) = call(&f, Method::GET, "/api/cosmetics/shop", false, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "Personal link không hợp lệ");

    let (status, shop) = call(
        &f,
        Method::GET,
        "/api/cosmetics/shop?token=token-1",
        false,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(shop["balance"], 0);
    assert_eq!(
        shop["prices"],
        json!({"common":2,"uncommon":4,"rare":7,"epic":12,"legendary":20})
    );
    let items = shop["items"].as_array().unwrap();
    assert!(items.len() >= 7);
    assert!(items.iter().all(|item| item.get("limitedLabel").is_none()));
    call(
        &f,
        Method::GET,
        "/api/cosmetics/shop?token=token-1",
        false,
        None,
    )
    .await;
    assert_eq!(count(&f, "ShopRotation").await, 1);

    let target = items[0]["id"].as_str().unwrap().to_owned();
    let price = items[0]["price"].as_i64().unwrap();
    let buy = json!({"token": "token-1", "cosmeticId": target, "idempotencyKey": "k1"}).to_string();
    let (status, body) = call(&f, Method::POST, "/api/cosmetics/shop", false, Some(&buy)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "Không đủ QP");

    let (status, _) = admin_post(
        &f,
        json!({"action": "adjust-qp", "playerId": 1, "amount": 50}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = call(&f, Method::POST, "/api/cosmetics/shop", false, Some(&buy)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert_eq!(body["balance"], 50 - price);
    assert_eq!(body["cosmeticId"], target);
    assert_eq!(body["item"]["id"], target);
    // Replay with the same key: same answer, nothing charged twice.
    let (_, replay) = call(&f, Method::POST, "/api/cosmetics/shop", false, Some(&buy)).await;
    assert_eq!(replay, body);
    assert_eq!(count(&f, "ShopPurchase").await, 1);

    let (status, _) = call(
        &f,
        Method::POST,
        "/api/cosmetics/shop",
        false,
        Some(r#"{"token":"token-1","cosmeticId":"nope","idempotencyKey":"k2"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(&f, Method::POST, "/api/cosmetics/shop", false, Some("{bad")).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn gacha_pull_and_idempotency() {
    let f = fixture().await;
    let pull = r#"{"token":"token-1","idempotencyKey":"egg-1"}"#;
    let (status, body) = call(&f, Method::POST, "/api/gacha/pull", false, Some(pull)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"], "Cần 3 QP để mở Mystery Egg");
    let (status, _) = call(&f, Method::POST, "/api/gacha/pull", false, Some("{}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &f,
        Method::POST,
        "/api/gacha/pull",
        false,
        Some(r#"{"token":"bad","idempotencyKey":"x"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    admin_post(
        &f,
        json!({"action": "adjust-qp", "playerId": 1, "amount": 10}),
    )
    .await;
    let (status, first) = call(&f, Method::POST, "/api/gacha/pull", false, Some(pull)).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["ok"], true);
    assert_eq!(first["config"]["cost"], 3);
    assert_eq!(first["pull"]["cost"], 3);
    assert_eq!(first["pull"]["rarePityBefore"], 0);
    let refund = first["pull"]["refundAmount"].as_i64().unwrap();
    assert_eq!(first["balance"], 10 - 3 + refund);
    let (_, replay) = call(&f, Method::POST, "/api/gacha/pull", false, Some(pull)).await;
    assert_eq!(replay, first);
    assert_eq!(count(&f, "GachaPull").await, 1);
}

#[tokio::test]
async fn admin_dashboard_and_actions() {
    let f = fixture().await;
    let (status, _) = call(&f, Method::GET, "/api/admin/cosmetics", false, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    for body in [
        json!({"action": "adjust-qp", "playerId": 1, "amount": 7}),
        json!({"action": "configure", "cosmeticId": "body-mint", "priceOverride": 1, "2": "x"}),
        json!({"action": "grant", "playerId": 1, "cosmeticId": "body-golden"}),
        json!({"action": "revoke-all", "playerId": 1, "slot": "pet"}),
    ] {
        let (status, reply) = admin_post(&f, body.clone()).await;
        assert_eq!(status, StatusCode::OK, "{body} → {reply}");
        assert_eq!(reply, json!({"ok": true}));
    }
    // Parity with main: grant-all always fails there (Prisma rejects skipDuplicates on SQLite).
    let (status, _) = admin_post(&f, json!({"action": "grant-all", "playerId": 1})).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    for (body, status) in [
        (
            json!({"action": "adjust-qp", "playerId": 1, "amount": 0}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"action": "grant", "playerId": 1, "cosmeticId": "nope"}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"action": "configure", "cosmeticId": "body-mint", "enabled": null}),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
        (json!({"action": "nope"}), StatusCode::BAD_REQUEST),
        (
            json!({"action": "grant", "playerId": "1", "cosmeticId": "body-golden"}),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        assert_eq!(admin_post(&f, body.clone()).await.0, status, "{body}");
    }

    let (status, dashboard) = call(&f, Method::GET, "/api/admin/cosmetics", true, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        dashboard["catalog"].as_array().unwrap().len(),
        catalog().items.len()
    );
    let player = &dashboard["players"][0];
    assert_eq!(player["quackPoints"], 7);
    assert!(
        player["ownedCosmeticIds"]
            .as_array()
            .unwrap()
            .contains(&json!("body-golden"))
    );
    assert_eq!(dashboard["analytics"]["qpEarned"], 7);
    assert_eq!(dashboard["analytics"]["qpSpent"], 0);
    assert_eq!(dashboard["analytics"]["duplicateRefundRate"], 0);
    assert_eq!(dashboard["configs"][0]["priceOverride"], 1);
    let events: Vec<&str> = dashboard["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|event| event["action"].as_str().unwrap())
        .collect();
    assert_eq!(events.len(), 4);
    let configure = dashboard["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|event| event["action"] == "CONFIGURE_COSMETIC")
        .unwrap();
    // JSON.stringify(body): array-index keys first.
    assert_eq!(
        configure["metadataJson"],
        r#"{"2":"x","action":"configure","cosmeticId":"body-mint","priceOverride":1}"#
    );
    assert_eq!(
        dashboard["analytics"]["mostEquipped"]["heads"],
        json!([{"cosmeticId": "head-cap-red", "count": 1}])
    );
}

/// Review 1, finding 1: Rust must never write a QP value Prisma can't read back. TS answers
/// 409 (the read-back throws and the transaction rolls back) once the balance would pass
/// 2^53−1; so must Rust, and nothing may be written.
#[tokio::test]
async fn adjust_qp_never_writes_an_unsafe_balance() {
    let f = fixture().await;
    let max_safe: i64 = 9_007_199_254_740_991;
    let (status, _) = admin_post(
        &f,
        json!({"action": "adjust-qp", "playerId": 1, "amount": max_safe}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let ledger = count(&f, "CurrencyTransaction").await;
    let (status, reply) = admin_post(
        &f,
        json!({"action": "adjust-qp", "playerId": 1, "amount": 1}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{reply}");
    assert_eq!(count(&f, "CurrencyTransaction").await, ledger);
    let balance: i64 =
        sqlx::query_scalar(r#"SELECT "quackPoints" FROM "SeasonPlayer" WHERE "id" = 1"#)
            .fetch_one(&f.db.reader)
            .await
            .unwrap();
    assert_eq!(balance, max_safe);
    // Spending back down to zero works; going below it is the usual P2025 → 409.
    let (status, _) = admin_post(
        &f,
        json!({"action": "adjust-qp", "playerId": 1, "amount": -max_safe}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = admin_post(
        &f,
        json!({"action": "adjust-qp", "playerId": 1, "amount": -1}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "spend below zero is refused");
}
