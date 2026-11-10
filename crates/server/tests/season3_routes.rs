//! `/api/season3` (GET/POST, every action) and `/api/season3/redeem` end to end on a
//! baseline-schema DB, plus a smoke run on a dev.db copy (`AUTODUCK_TEST_DEV_DB`).
//!
//! Byte-for-byte parity with the TS routes is checked by the TS-vs-Rust diff on dev.db copies
//! (`docs/rewrite/phase3-notes.md`, "Stage B: player routes"); these tests keep every statement
//! exercised against the schema in CI and pin the behaviour the diff found.

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
use sqlx::Connection;
use tower::ServiceExt;

struct Fixture {
    _dir: tempfile::TempDir,
    app: axum::Router,
    db: Db,
}

async fn exec(db: &Db, sql: &str) {
    let mut tx = db.begin_write().await.unwrap();
    sqlx::raw_sql(sqlx::AssertSqlSafe(sql.to_owned()))
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

/// Three players (Alpha has a Shield and 5 points, Charlie is skipped this week and has no
/// starter cosmetics yet), week 1 resolved, week 2 open, two rewards.
async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("autoduck.db");
    let mut conn = common::create_db(&path).await;
    common::mark_all_migrations(&mut conn).await;
    conn.close().await.unwrap();
    let db = Db::open(&path).await.unwrap();
    let t = "2026-08-13T08:30:17.247+00:00";
    exec(
        &db,
        &format!(
            r#"
        INSERT INTO "User" ("id", "name", "googleId", "createdAt", "updatedAt") VALUES
          (1, 'Alpha', NULL, '{t}', '{t}'), (2, 'Bravo', '1234567890', '{t}', '{t}'), (3, 'Charlie', NULL, '{t}', '{t}');
        INSERT INTO "Season" ("id", "key", "name", "year", "status", "createdAt") VALUES (1, 'S3', 'Season 3', 2026, 'active', '{t}');
        INSERT INTO "SeasonPlayer" ("id", "seasonId", "userId", "accessToken", "shields", "predictionPoints", "createdAt", "updatedAt") VALUES
          (1, 1, 1, 'token-1', 1, 5, '{t}', '{t}'), (2, 1, 2, 'token-2', 0, 2, '{t}', '{t}'), (3, 1, 3, 'token-3', 0, 0, '{t}', '{t}');
        INSERT INTO "SeasonWeek" ("id", "seasonId", "weekNumber", "status", "chaosType", "recap", "resolvedAt", "chaosRevealedAt", "createdAt", "updatedAt") VALUES
          (1, 1, 1, 'resolved', 'STANDARD', 'Recap 1', '{t}', '{t}', '{t}', '{t}');
        INSERT INTO "SeasonWeek" ("id", "seasonId", "weekNumber", "status", "chaosType", "chaosTargetUserId", "chaosPayload", "skippedPlayerIdsJson", "chaosRevealedAt", "createdAt", "updatedAt") VALUES
          (2, 1, 2, 'open', 'DUO', 2, '[[1,2.0],[3,-0]]', '[3, 1.5, "1"]', '{t}', '{t}', '{t}');
        INSERT INTO "SeasonPrediction" ("weekId", "predictorPlayerId", "predictorUserId", "targetUserId", "pointsAwarded", "createdAt") VALUES (1, 2, 2, 1, 2, '{t}');
        INSERT INTO "SeasonReward" ("id", "seasonId", "key", "name", "cost", "stock", "active", "createdAt") VALUES
          (1, 1, 'limited', 'Limited', 4, 1, 1, '{t}'), (2, 1, 'sticker', 'Sticker', 2, NULL, 1, '{t}'), (3, 1, 'off', 'Off', 1, NULL, 0, '{t}');
        "#
        ),
    )
    .await;
    let mut tx = db.begin_write().await.unwrap();
    grant_starter_cosmetics(&mut tx, 1).await.unwrap();
    grant_starter_cosmetics(&mut tx, 2).await.unwrap();
    tx.commit().await.unwrap();
    let config = common::config(dir.path(), &path, &[]);
    let state = AppState::new(config, db.clone());
    Fixture {
        app: http::router(state),
        db,
        _dir: dir,
    }
}

async fn call(f: &Fixture, method: Method, uri: &str, body: Option<&str>) -> (StatusCode, String) {
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json")
        .body(body.map_or_else(Body::empty, |body| Body::from(body.to_owned())))
        .unwrap();
    let response = f.app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8(bytes.to_vec()).unwrap())
}

async fn get(f: &Fixture, query: &str) -> Value {
    let (status, body) = call(f, Method::GET, &format!("/api/season3{query}"), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    serde_json::from_str(&body).unwrap()
}

async fn post(f: &Fixture, body: &Value) -> (StatusCode, Value) {
    let (status, text) = call(f, Method::POST, "/api/season3", Some(&body.to_string())).await;
    (status, serde_json::from_str(&text).unwrap())
}

async fn redeem(f: &Fixture, body: &Value) -> (StatusCode, Value) {
    let (status, text) = call(
        f,
        Method::POST,
        "/api/season3/redeem",
        Some(&body.to_string()),
    )
    .await;
    (status, serde_json::from_str(&text).unwrap())
}

fn error(message: &str) -> Value {
    json!({ "error": message })
}

async fn count(f: &Fixture, sql: &str) -> i64 {
    let mut conn = f.db.reader.acquire().await.unwrap();
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
        .fetch_one(&mut *conn)
        .await
        .unwrap()
}

#[tokio::test]
async fn get_without_a_viewer() {
    let f = fixture().await;
    let (status, text) = call(&f, Method::GET, "/api/season3", None).await;
    assert_eq!(status, StatusCode::OK);
    // JSON.stringify output: `2.0` → `2`, `-0` → `0`; the key order is TS's.
    assert!(text.contains(r#""chaosGroups":[[1,2],[3,0]],"skippedPlayerIds":[3],"viewerSkipped":false,"chaosTargetName":"Bravo","chaosTargetName2":null"#), "{text}");
    let body: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        body["season"],
        json!({"key": "S3", "name": "Season 3", "year": 2026, "weeks": 12, "status": "active"})
    );
    assert_eq!(body["viewer"], Value::Null);
    assert_eq!(body["personalLink"], Value::Null);
    assert_eq!(body["liveRace"], Value::Null);
    assert_eq!(body["raceItems"].as_array().unwrap().len(), 9);
    assert_eq!(body["raceItems"][0]["itemClass"], "SPEED");
    assert_eq!(
        body["cosmeticCatalog"].as_array().unwrap().len(),
        catalog().items.len()
    );
    let names: Vec<&str> = body["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Alpha", "Bravo", "Charlie"]);
    assert_eq!(body["players"][2]["appearance"], Value::Null);
    let week = &body["currentWeek"];
    assert_eq!(week["weekNumber"], 2);
    assert_eq!(week["loadout"], json!({"itemIds": [], "status": "draft"}));
    assert_eq!(week["predictions"], json!([]));
    assert_eq!(
        body["latestReveal"],
        json!({"weekNumber": 1, "recap": "Recap 1", "predictions": [
            {"predictorName": "Bravo", "targetName": "Alpha", "pointsAwarded": 2}
        ]})
    );
    assert_eq!(body["history"].as_array().unwrap().len(), 1);
    let rewards: Vec<&str> = body["rewards"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["key"].as_str().unwrap())
        .collect();
    assert_eq!(rewards, ["sticker", "limited"], "active only, by cost");
}

#[tokio::test]
async fn get_grants_starters_to_a_new_viewer() {
    let f = fixture().await;
    assert_eq!(
        count(
            &f,
            r#"SELECT COUNT(*) FROM "PlayerCosmetic" WHERE "seasonPlayerId" = 3"#
        )
        .await,
        0
    );
    let body = get(&f, "?token=token-3").await;
    let viewer = &body["viewer"];
    assert_eq!(viewer["userId"], 3);
    assert_eq!(viewer["appearance"]["seasonPlayerId"], 3);
    assert_eq!(
        viewer["inventory"].as_array().unwrap().len(),
        catalog().starter_ids.len()
    );
    assert_eq!(body["currentWeek"]["viewerSkipped"], true);
    assert_eq!(body["personalLink"], "/season-3?token=token-3");
    let bravo = get(&f, "?token=token-2").await;
    assert_eq!(bravo["viewer"]["isGoogleLinked"], true);
    assert_eq!(bravo["viewer"]["cosmeticPresets"], json!([]));
}

#[tokio::test]
async fn post_rejections_follow_ts() {
    let f = fixture().await;
    for raw in ["{bad", "null"] {
        let (status, text) = call(&f, Method::POST, "/api/season3", Some(raw)).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(text, r#"{"error":"Failed to save prediction"}"#);
    }
    for body in [json!({}), json!([]), json!({"token": ""})] {
        assert_eq!(
            post(&f, &body).await,
            (StatusCode::BAD_REQUEST, error("Token là bắt buộc"))
        );
    }
    for token in [json!("nope"), json!(5)] {
        assert_eq!(
            post(&f, &json!({"token": token})).await,
            (
                StatusCode::UNAUTHORIZED,
                error("Personal link không hợp lệ")
            )
        );
    }
    let (status, _) = call(&f, Method::GET, "/api/season3/redeem", None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn shield_choice() {
    let f = fixture().await;
    let ok = post(&f, &json!({"token": "token-1", "action": "shield"})).await;
    assert_eq!(
        ok,
        (
            StatusCode::OK,
            json!({"ok": true, "shieldConfirmed": true, "message": "Đã xác nhận dùng Shield tuần này."})
        )
    );
    post(&f, &json!({"token": "token-1", "action": "shield"})).await;
    assert_eq!(
        count(&f, r#"SELECT COUNT(*) FROM "SeasonShieldChoice""#).await,
        1
    );
    assert_eq!(
        get(&f, "?token=token-1").await["currentWeek"]["shieldConfirmed"],
        true
    );
    let off = post(
        &f,
        &json!({"token": "token-1", "action": "shield", "useShield": false}),
    )
    .await;
    assert_eq!(off.1["shieldConfirmed"], false);
    assert_eq!(
        count(&f, r#"SELECT COUNT(*) FROM "SeasonShieldChoice""#).await,
        0
    );
    assert_eq!(
        post(&f, &json!({"token": "token-2", "action": "shield"})).await,
        (
            StatusCode::BAD_REQUEST,
            error("Bạn không có Shield để xác nhận")
        )
    );
    assert_eq!(
        post(&f, &json!({"token": "token-3", "action": "shield"})).await,
        (
            StatusCode::CONFLICT,
            error("Host đã cho bạn nghỉ race tuần này")
        )
    );
}

#[tokio::test]
async fn loadouts() {
    let f = fixture().await;
    let failed = (
        StatusCode::INTERNAL_SERVER_ERROR,
        error("Failed to save prediction"),
    );
    for item_ids in [
        json!("x"),
        json!(["NOPE"]),
        json!(["NITRO", "HOMING_ROCKET"]),
    ] {
        let body = json!({"token": "token-1", "action": "loadout", "itemIds": item_ids});
        assert_eq!(post(&f, &body).await, failed);
    }
    assert_eq!(
        post(
            &f,
            &json!({"token": "token-1", "action": "loadout", "itemIds": ["NITRO"], "ready": true})
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("Loadout cần dùng đủ 3 Prep Credits với 1 Major + 1 Minor")
        )
    );
    assert_eq!(
        post(
            &f,
            &json!({"token": "token-1", "action": "loadout", "itemIds": ["NITRO"]})
        )
        .await,
        (
            StatusCode::OK,
            json!({"ok": true, "status": "draft", "message": "Đã lưu loadout."})
        )
    );
    let ready = json!({"token": "token-1", "action": "loadout", "itemIds": ["NITRO", "BANANA"], "ready": 1});
    assert_eq!(post(&f, &ready).await.1["status"], "ready");
    let week = get(&f, "?token=token-1").await["currentWeek"].clone();
    assert_eq!(
        week["loadout"],
        json!({"itemIds": ["NITRO", "BANANA"], "status": "ready"})
    );
    assert_eq!(week["loadoutReadyCount"], 1);
    assert_eq!(
        count(&f, r#"SELECT COUNT(*) FROM "SeasonLoadout" WHERE "lockedAt" IS NOT NULL AND "itemIdsJson" = '["NITRO","BANANA"]'"#).await,
        1
    );
}

#[tokio::test]
async fn predictions() {
    let f = fixture().await;
    let cases = [
        (json!({}), "targetUserId là bắt buộc"),
        (json!({"targetUserId": "2"}), "targetUserId là bắt buộc"),
        (json!({"targetUserId": 1}), "Không được pick bản thân"),
        (json!({"targetUserId": 99}), "Target không đua tuần này"),
        (json!({"targetUserId": 3}), "Target không đua tuần này"),
        (json!({"targetUserId": 1.5}), "Target không đua tuần này"),
    ];
    for (extra, message) in cases {
        let mut body = extra.clone();
        body["token"] = json!("token-1");
        assert_eq!(
            post(&f, &body).await,
            (StatusCode::BAD_REQUEST, error(message)),
            "{extra}"
        );
    }
    let ok = post(&f, &json!({"token": "token-1", "targetUserId": 2.0})).await;
    assert_eq!(
        ok,
        (
            StatusCode::OK,
            json!({"ok": true, "message": "Prediction đã khóa cho tuần này."})
        )
    );
    let week = get(&f, "?token=token-1").await["currentWeek"].clone();
    assert_eq!(week["predictionSubmitted"], true);
    assert_eq!(week["predictionTargetName"], "Bravo");
    assert_eq!(week["predictionCount"], 1);
}

#[tokio::test]
async fn appearance_presets_and_favorites() {
    let f = fixture().await;
    let failed = (
        StatusCode::INTERNAL_SERVER_ERROR,
        error("Failed to save prediction"),
    );
    assert_eq!(
        post(&f, &json!({"token": "token-1", "action": "appearance"})).await,
        (StatusCode::BAD_REQUEST, error("Thiếu appearance"))
    );
    for appearance in [
        json!(true),
        json!({"bodyColorId": "nope"}),
        json!({"bodyColorId": "body-golden"}),
    ] {
        let body = json!({"token": "token-1", "action": "appearance", "appearance": appearance});
        assert_eq!(post(&f, &body).await, failed);
    }
    let (status, saved) = post(
        &f,
        &json!({"token": "token-3", "action": "appearance", "appearance": {"bodyColorId": "body-sunshine"}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["appearance"]["faceId"], Value::Null);
    assert_eq!(
        count(
            &f,
            r#"SELECT "cosmeticsOnboarded" FROM "SeasonPlayer" WHERE "id" = 3"#
        )
        .await,
        1
    );

    let starter = catalog().starter_ids[0].clone();
    let (status, favorite) = post(
        &f,
        &json!({"token": "token-1", "action": "favorite", "cosmeticId": starter}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(favorite["appearance"]["favoriteId"], json!(starter));
    assert_eq!(
        post(
            &f,
            &json!({"token": "token-1", "action": "favorite", "cosmeticId": "body-golden"})
        )
        .await,
        (StatusCode::CONFLICT, error("Bạn chưa sở hữu cosmetic này"))
    );
    assert_eq!(
        post(
            &f,
            &json!({"token": "token-1", "action": "favorite", "cosmeticId": 5})
        )
        .await,
        failed
    );

    for index in [json!(0), json!(4), json!(1.5), json!("1")] {
        let body = json!({"token": "token-1", "action": "save-preset", "presetIndex": index, "appearance": {"bodyColorId": "body-sunshine"}});
        assert_eq!(
            post(&f, &body).await,
            (StatusCode::BAD_REQUEST, error("Preset không hợp lệ"))
        );
    }
    let long = format!("  {}😀xyz", "a".repeat(29));
    let (status, preset) = post(
        &f,
        &json!({"token": "token-1", "action": "save-preset", "presetIndex": 2, "presetName": long, "appearance": {"bodyColorId": "body-sunshine"}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        preset["preset"]["name"],
        format!("{}\u{FFFD}", "a".repeat(29))
    );
    let stored: Value =
        serde_json::from_str(preset["preset"]["appearanceJson"].as_str().unwrap()).unwrap();
    assert_eq!(stored["seasonPlayerId"], 1);
    assert_eq!(stored["favoriteId"], json!(starter));
    let (_, unnamed) = post(
        &f,
        &json!({"token": "token-1", "action": "save-preset", "presetIndex": 3, "presetName": "   ", "appearance": {"bodyColorId": "body-sunshine"}}),
    )
    .await;
    assert_eq!(unnamed["preset"]["name"], "Preset 3");
    assert_eq!(
        post(&f, &json!({"token": "token-1", "action": "save-preset", "presetIndex": 1, "presetName": 5, "appearance": {"bodyColorId": "body-sunshine"}})).await,
        failed
    );
    assert_eq!(
        count(&f, r#"SELECT COUNT(*) FROM "CosmeticPreset""#).await,
        2
    );

    let (status, loaded) = post(
        &f,
        &json!({"token": "token-1", "action": "load-preset", "presetIndex": 2}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(loaded["appearance"]["bodyColorId"], "body-sunshine");
    assert_eq!(
        post(
            &f,
            &json!({"token": "token-1", "action": "load-preset", "presetIndex": 9})
        )
        .await,
        (StatusCode::NOT_FOUND, error("Preset chưa được lưu"))
    );
    assert_eq!(
        post(
            &f,
            &json!({"token": "token-1", "action": "load-preset", "presetIndex": 1e19})
        )
        .await,
        failed
    );

    exec(&f.db, r#"UPDATE "PlayerCosmetic" SET "isNew" = 1"#).await;
    assert_eq!(
        post(&f, &json!({"token": "token-1", "action": "seen-cosmetics"})).await,
        (StatusCode::OK, json!({"ok": true}))
    );
    assert_eq!(
        count(
            &f,
            r#"SELECT COUNT(*) FROM "PlayerCosmetic" WHERE "isNew" = 1 AND "seasonPlayerId" = 1"#
        )
        .await,
        0
    );
}

#[tokio::test]
async fn redeem_rewards() {
    let f = fixture().await;
    for raw in ["{bad", "null"] {
        let (status, text) = call(&f, Method::POST, "/api/season3/redeem", Some(raw)).await;
        assert_eq!(
            (status, text.as_str()),
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"error":"Redeem failed"}"#
            )
        );
    }
    assert_eq!(
        redeem(&f, &json!({"token": "token-1"})).await,
        (
            StatusCode::BAD_REQUEST,
            error("Token và rewardKey là bắt buộc")
        )
    );
    assert_eq!(
        redeem(&f, &json!({"token": "nope", "rewardKey": "nope"})).await,
        (
            StatusCode::UNAUTHORIZED,
            error("Personal link không hợp lệ")
        )
    );
    assert_eq!(
        redeem(&f, &json!({"token": "token-1", "rewardKey": "off"})).await,
        (
            StatusCode::NOT_FOUND,
            error("Reward không tồn tại hoặc đã tắt")
        )
    );
    let (status, ok) = redeem(&f, &json!({"token": "token-1", "rewardKey": "limited"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ok["reward"], "Limited");
    assert_eq!(ok["redemption"]["pointsSpent"], 4);
    assert_eq!(ok["redemption"]["status"], "requested");
    assert_eq!(
        redeem(&f, &json!({"token": "token-2", "rewardKey": "limited"})).await,
        (StatusCode::CONFLICT, error("Cần 4 🔮")),
        "points are checked before stock"
    );
    exec(
        &f.db,
        r#"UPDATE "SeasonPlayer" SET "predictionPoints" = 9 WHERE "id" = 2"#,
    )
    .await;
    assert_eq!(
        redeem(&f, &json!({"token": "token-2", "rewardKey": "limited"})).await,
        (StatusCode::CONFLICT, error("Reward đã hết stock"))
    );
    assert_eq!(
        redeem(&f, &json!({"token": "token-1", "rewardKey": "sticker"})).await,
        (StatusCode::CONFLICT, error("Cần 2 🔮"))
    );
    assert_eq!(
        count(
            &f,
            r#"SELECT "predictionPoints" FROM "SeasonPlayer" WHERE "id" = 1"#
        )
        .await,
        1
    );
    assert_eq!(
        count(&f, r#"SELECT "stock" FROM "SeasonReward" WHERE "id" = 1"#).await,
        0
    );
}

#[tokio::test]
async fn closed_week_and_no_active_season() {
    let f = fixture().await;
    exec(
        &f.db,
        r#"UPDATE "SeasonWeek" SET "status" = 'locked' WHERE "id" = 2"#,
    )
    .await;
    assert_eq!(
        post(&f, &json!({"token": "token-1", "targetUserId": 2})).await,
        (StatusCode::CONFLICT, error("Tuần đã đóng hoặc đã resolve"))
    );
    exec(&f.db, r#"UPDATE "Season" SET "status" = 'completed'"#).await;
    let (status, text) = call(&f, Method::GET, "/api/season3?token=token-1", None).await;
    assert_eq!(
        (status, text.as_str()),
        (StatusCode::OK, r#"{"season":null}"#)
    );
    assert_eq!(
        post(&f, &json!({"token": "token-1", "action": "seen-cosmetics"})).await,
        (StatusCode::NOT_FOUND, error("Chưa có Season 3 active"))
    );
    // Redeem still finds a completed season.
    let (status, _) = redeem(&f, &json!({"token": "token-1", "rewardKey": "limited"})).await;
    assert_eq!(status, StatusCode::OK);
}

/// Every player's page on a dev.db copy answers 200 with the TS keys.
#[tokio::test]
async fn dev_db_copy_serves_every_player() {
    let dir = tempfile::tempdir().unwrap();
    let Some(path) = common::dev_db_copy(dir.path()).await else {
        return;
    };
    let db = Db::open(&path).await.unwrap();
    let tokens: Vec<String> = {
        let mut conn = db.reader.acquire().await.unwrap();
        sqlx::query_scalar(r#"SELECT "accessToken" FROM "SeasonPlayer" ORDER BY "id""#)
            .fetch_all(&mut *conn)
            .await
            .unwrap()
    };
    let state = AppState::new(common::config(dir.path(), &path, &[]), db.clone());
    let f = Fixture {
        app: http::router(state),
        db,
        _dir: dir,
    };
    let anonymous = get(&f, "").await;
    let keys: Vec<&String> = anonymous.as_object().unwrap().keys().collect();
    if anonymous["season"].is_null() {
        eprintln!("dev.db copy has no active season");
        return;
    }
    assert_eq!(
        keys,
        [
            "season",
            "viewer",
            "personalLink",
            "liveRace",
            "raceItems",
            "cosmeticCatalog",
            "players",
            "currentWeek",
            "latestReveal",
            "history",
            "rewards"
        ]
    );
    for token in &tokens {
        let body = get(&f, &format!("?token={token}")).await;
        if body["viewer"].is_null() {
            continue; // a player of another season
        }
        assert!(body["viewer"]["appearance"].is_object());
    }
}
