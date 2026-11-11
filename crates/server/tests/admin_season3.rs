//! `/api/admin/season3` end to end on a baseline-schema DB (every action, auth, the ops report
//! and the new `reseed-week`), plus a run on a dev.db copy when `AUTODUCK_TEST_DEV_DB` is set.
//! Byte-for-byte parity with the TS route is checked by the admin Season 3 diff (TS handler vs
//! `autoduck serve` with `test-rng`, see `docs/rewrite/phase3-notes.md`).

// Server code, not the engine: the D4(b) type bans do not apply (see src/lib.rs).
#![allow(clippy::disallowed_types)]

mod common;

use std::path::Path;

use autoduck_server::db::{Db, DbTime};
use autoduck_server::http::{self, AppState};
use autoduck_server::season3::loadout::auto_loadout_json;
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;

const SECRET: &str = "admin-season3-test-secret-0123456789";
const PATH: &str = "/api/admin/season3";

struct Fixture {
    _dir: tempfile::TempDir,
    app: axum::Router,
    db: Db,
}

/// Baseline DB with four users (one is the ghost duck) and no season.
async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("autoduck.db");
    let mut conn = common::create_db(&path).await;
    common::mark_all_migrations(&mut conn).await;
    let now = DbTime::now();
    for (id, name) in [
        (1, "Zịt An"),
        (2, "Zịt Bình"),
        (3, "Zịt Cường"),
        (4, "Thomas"),
    ] {
        sqlx::query(
            r#"INSERT INTO "User" ("id", "name", "createdAt", "updatedAt") VALUES (?, ?, ?, ?)"#,
        )
        .bind(id)
        .bind(name)
        .bind(now)
        .bind(now)
        .execute(&mut conn)
        .await
        .unwrap();
    }
    drop(conn);
    open(dir, &path).await
}

async fn open(dir: tempfile::TempDir, path: &Path) -> Fixture {
    let db = Db::open(path).await.unwrap();
    let config = common::config(dir.path(), path, &[("RACE_SECRET_KEY", SECRET)]);
    let state = AppState::new(config, db.clone());
    Fixture {
        app: http::router(state),
        db,
        _dir: dir,
    }
}

async fn send(f: &Fixture, request: Request<Body>) -> (StatusCode, Value) {
    let response = f.app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn get(f: &Fixture, uri: &str) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .header("x-race-secret", SECRET)
        .body(Body::empty())
        .unwrap();
    send(f, request).await
}

async fn post_raw(f: &Fixture, body: &str, secret: Option<&str>) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(PATH)
        .header("content-type", "application/json");
    if let Some(secret) = secret {
        request = request.header("x-race-secret", secret);
    }
    send(f, request.body(Body::from(body.to_owned())).unwrap()).await
}

async fn post(f: &Fixture, body: Value) -> (StatusCode, Value) {
    post_raw(f, &body.to_string(), Some(SECRET)).await
}

async fn scalar<T>(f: &Fixture, sql: &str) -> T
where
    T: for<'r> sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite> + Send + Unpin,
{
    sqlx::query_scalar::<_, T>(sqlx::AssertSqlSafe(sql.to_owned()))
        .fetch_one(&f.db.reader)
        .await
        .unwrap()
}

async fn exec(f: &Fixture, sql: &str) {
    sqlx::raw_sql(sqlx::AssertSqlSafe(sql.to_owned()))
        .execute(&f.db.writer)
        .await
        .unwrap();
}

fn error(message: &str) -> Value {
    json!({ "error": message })
}

#[tokio::test]
async fn auth_and_body_parsing() {
    let f = fixture().await;
    let request = Request::builder().uri(PATH).body(Body::empty()).unwrap();
    assert_eq!(
        send(&f, request).await,
        (StatusCode::UNAUTHORIZED, error("Unauthorized"))
    );
    let query = format!("{PATH}?secret={SECRET}");
    let request = Request::builder().uri(&query).body(Body::empty()).unwrap();
    assert_eq!(
        send(&f, request).await,
        (StatusCode::OK, json!({ "season": null }))
    );
    // The body is parsed before the secret is checked.
    assert_eq!(
        post_raw(&f, "{bad", None).await,
        (StatusCode::BAD_REQUEST, error("Invalid JSON"))
    );
    assert_eq!(
        post_raw(&f, "{}", None).await,
        (StatusCode::UNAUTHORIZED, error("Unauthorized"))
    );
    assert_eq!(
        post_raw(&f, r#"{"secret":123}"#, None).await,
        (StatusCode::UNAUTHORIZED, error("Unauthorized"))
    );
    let body = json!({ "secret": format!(" {SECRET} "), "action": "lock" }).to_string();
    assert_eq!(
        post_raw(&f, &body, None).await,
        (StatusCode::NOT_FOUND, error("Chưa có Season active"))
    );
    // `body.action` on null throws inside the try block.
    assert_eq!(
        post_raw(&f, "null", Some(SECRET)).await,
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            error("Season 3 action failed")
        )
    );
}

#[tokio::test]
async fn season_lifecycle() {
    let f = fixture().await;
    assert_eq!(
        post(&f, json!({ "action": "create-season", "userIds": [1] })).await,
        (
            StatusCode::BAD_REQUEST,
            error("Season cần ít nhất 2 players")
        )
    );
    assert_eq!(
        post(&f, json!({ "action": "create-season", "userIds": "ab" }))
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    let (status, created) = post(&f, json!({ "action": "create-season", "weeks": "3" })).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["ok"], true);
    let week_id = created["weekId"].as_i64().unwrap();
    // Players come back in (seasonId, userId) index order; names joined by userId.
    let names: Vec<&str> = created["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|player| player["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Zịt An", "Zịt Bình", "Zịt Cường", "Thomas"]);
    assert_eq!(
        scalar::<i64>(&f, r#"SELECT "weeks" FROM "Season""#).await,
        3
    );
    assert_eq!(
        scalar::<i64>(&f, r#"SELECT COUNT(*) FROM "SeasonReward""#).await,
        5
    );
    assert!(scalar::<i64>(&f, r#"SELECT COUNT(*) FROM "PlayerAppearance""#).await == 4);
    assert_eq!(
        post(&f, json!({ "action": "create-season", "key": "S9" })).await,
        (StatusCode::CONFLICT, error("Đã có Season active"))
    );

    let (status, dashboard) = get(&f, PATH).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(dashboard["season"]["key"], "S3");
    // Players by name: "Thomas" sorts before "Zịt …".
    assert_eq!(dashboard["players"][0]["name"], "Thomas");
    assert!(
        dashboard["players"][0]["personalLink"]
            .as_str()
            .unwrap()
            .starts_with("/season-3?token=")
    );
    assert_eq!(
        dashboard["weeks"][0]["missingLoadoutUserIds"],
        json!([4, 1, 2, 3])
    );
    assert_eq!(dashboard["rewards"][0]["key"], "sticker");
    assert_eq!(
        dashboard["balance"],
        json!({ "items": [], "loadouts": [], "pickups": [] })
    );

    // toggle-skip
    assert_eq!(
        post(
            &f,
            json!({ "action": "toggle-skip", "weekId": week_id, "userId": 99 })
        )
        .await,
        (StatusCode::BAD_REQUEST, error("Dzịt không thuộc Season"))
    );
    let (status, toggled) = post(
        &f,
        json!({ "action": "toggle-skip", "weekId": week_id, "userId": 3 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(toggled["skippedPlayerIds"], json!([3]));
    let (_, toggled) = post(
        &f,
        json!({ "action": "toggle-skip", "weekId": week_id, "userId": 2 }),
    )
    .await;
    assert_eq!(toggled["skippedPlayerIds"], json!([3, 2]));
    // Only the ghost would be left besides user 1… then nobody but the ghost: refused.
    assert_eq!(
        post(
            &f,
            json!({ "action": "toggle-skip", "weekId": week_id, "userId": 1 })
        )
        .await,
        (StatusCode::BAD_REQUEST, error("Race cần 2–16 dzịt active"))
    );
    let stored: String = scalar(&f, r#"SELECT "skippedPlayerIdsJson" FROM "SeasonWeek""#).await;
    assert_eq!(stored, "[2,3]");
    let (_, toggled) = post(
        &f,
        json!({ "action": "toggle-skip", "weekId": week_id, "userId": 2 }),
    )
    .await;
    assert_eq!(toggled["skippedPlayerIds"], json!([3]));

    // set-chaos
    let (status, set) = post(
        &f,
        json!({ "action": "set-chaos", "weekId": week_id, "chaosType": "BOUNTY_HUNT", "targetUserId": 2 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(set["week"]["chaosTargetUserId"], 2);
    assert_eq!(
        post(
            &f,
            json!({ "action": "set-chaos", "weekId": week_id, "chaosType": "BOUNTY_HUNT", "targetUserId": 3 })
        )
        .await,
        (
            StatusCode::BAD_REQUEST,
            error("Mục tiêu Truy nã phải là một tuyển thủ đang tham gia tuần này")
        )
    );
    let (_, manual) = post(
        &f,
        json!({ "action": "set-chaos", "weekId": week_id, "chaosType": "DUO", "groups": [[1, 2], "x"] }),
    )
    .await;
    assert_eq!(manual["week"]["chaosPayload"], r#"[[1,2],"x"]"#);
    // The dashboard only shows groups that are an array of arrays.
    let (_, dashboard) = get(&f, PATH).await;
    assert!(dashboard["weeks"][0].get("chaosGroups").is_none());
    assert_eq!(
        post(
            &f,
            json!({ "action": "set-chaos", "weekId": week_id, "chaosType": "duo" })
        )
        .await,
        (StatusCode::BAD_REQUEST, error("Lá bài Chaos không hợp lệ"))
    );

    // lock writes auto loadouts for the active players only, from the race seed.
    let (status, locked) = post(&f, json!({ "action": "lock" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(locked["week"]["status"], "locked");
    let seed = locked["week"]["raceSeed"].as_str().unwrap().to_owned();
    assert_eq!(seed.len(), 64);
    assert_eq!(
        scalar::<i64>(
            &f,
            r#"SELECT COUNT(*) FROM "SeasonLoadout" WHERE "status" = 'auto'"#
        )
        .await,
        3
    );
    let items: String = scalar(
        &f,
        r#"SELECT "itemIdsJson" FROM "SeasonLoadout" WHERE "userId" = 1"#,
    )
    .await;
    assert_eq!(items, auto_loadout_json(&seed, 1));
    assert_eq!(
        post(&f, json!({ "action": "lock" })).await,
        (StatusCode::CONFLICT, error("Tuần không ở trạng thái open"))
    );
    assert_eq!(
        post(&f, json!({ "action": "start-race" })).await,
        (StatusCode::BAD_REQUEST, error("weekId là bắt buộc"))
    );
    // start-race itself is tested in tests/live.rs; an unknown week is refused before any write.
    assert_eq!(
        post(
            &f,
            json!({ "action": "start-race", "weekId": week_id + 99, "allowOffSchedule": true })
        )
        .await,
        (StatusCode::CONFLICT, error("Season không active"))
    );
    let (status, unlocked) = post(&f, json!({ "action": "unlock" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unlocked["week"]["predictionsLockedAt"], Value::Null);
    assert_eq!(unlocked["week"]["raceSeed"], seed.as_str());

    // open-week / extend-season
    assert_eq!(
        post(&f, json!({ "action": "open-week" })).await,
        (StatusCode::CONFLICT, error("Tuần hiện tại chưa resolve"))
    );
    exec(&f, r#"UPDATE "SeasonWeek" SET "status" = 'resolved'"#).await;
    let (status, opened) = post(
        &f,
        json!({ "action": "open-week", "chaosType": "DUO", "groups": [[2, 1]] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(opened["week"]["weekNumber"], 2);
    assert_eq!(opened["week"]["chaosPayload"], "[[2,1]]");
    assert_eq!(
        post(&f, json!({ "action": "extend-season", "weeks": 3 })).await,
        (
            StatusCode::BAD_REQUEST,
            error("Season đang có 3 tuần — số tuần mới phải lớn hơn")
        )
    );
    assert_eq!(
        post(&f, json!({ "action": "extend-season", "weeks": 2.5 })).await,
        (
            StatusCode::BAD_REQUEST,
            error("Số tuần không hợp lệ (1–52)")
        )
    );
    let (status, extended) = post(&f, json!({ "action": "extend-season" })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(extended["season"]["weeks"], 4);

    // end-season: FK-checked champion, echo of the raw number.
    assert_eq!(
        post(&f, json!({ "action": "end-season", "championUserId": 99 }))
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    exec(
        &f,
        r#"UPDATE "SeasonPlayer" SET "championshipPoints" = 5 WHERE "userId" = 2"#,
    )
    .await;
    let (status, ended) = post(&f, json!({ "action": "end-season", "championUserId": 2.9 })).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ended["championUserId"], 2.9);
    assert_eq!(ended["season"]["championUserId"], 2);
    assert_eq!(ended["season"]["status"], "completed");
    assert_eq!(
        get(&f, PATH).await,
        (StatusCode::OK, json!({ "season": null }))
    );
    assert_eq!(
        post(&f, json!({ "action": "lock" })).await,
        (StatusCode::NOT_FOUND, error("Chưa có Season active"))
    );
    // The default key `S3` is taken by the completed season (unique key): 500 as in TS.
    assert_eq!(
        post(&f, json!({ "action": "create-season" })).await,
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            error("Season 3 action failed")
        )
    );
}

/// A season with week 1 locked, as `lock` leaves it.
async fn locked_season(f: &Fixture) -> (i64, String) {
    let (_, created) = post(f, json!({ "action": "create-season" })).await;
    let week_id = created["weekId"].as_i64().unwrap();
    let (_, locked) = post(f, json!({ "action": "lock" })).await;
    (
        week_id,
        locked["week"]["raceSeed"].as_str().unwrap().to_owned(),
    )
}

#[tokio::test]
async fn reseed_week_after_a_failed_race() {
    let f = fixture().await;
    let (week_id, seed) = locked_season(&f).await;
    let refused = (
        StatusCode::CONFLICT,
        error("Chỉ re-seed được khi tuần đang locked và race gần nhất của seed hiện tại đã failed"),
    );
    assert_eq!(
        post(&f, json!({ "action": "reseed-week" })).await,
        (StatusCode::BAD_REQUEST, error("weekId là bắt buộc"))
    );
    assert_eq!(
        post(&f, json!({ "action": "reseed-week", "weekId": 999 })).await,
        (StatusCode::NOT_FOUND, error("Tuần không tồn tại"))
    );
    // No race ran with this seed yet.
    assert_eq!(
        post(&f, json!({ "action": "reseed-week", "weekId": week_id })).await,
        refused
    );
    let now = DbTime::now().to_db_string();
    // A finished race, then a test race with the same seed: neither allows a re-seed.
    exec(
        &f,
        &format!(
            r#"INSERT INTO "Race" ("id", "status", "createdAt", "isTest", "engineState", "raceSeed")
               VALUES (10, 'finished', '{now}', 0, 'RESOLVED', '{seed}'), (11, 'failed', '{now}', 1, 'LOCKED', '{seed}')"#
        ),
    )
    .await;
    assert_eq!(
        post(&f, json!({ "action": "reseed-week", "weekId": week_id })).await,
        refused
    );
    // A race that failed after it finished (shown live, or resolution failed) is never re-rolled.
    let finished_refusal = (
        StatusCode::CONFLICT,
        error(
            "Race gần nhất của seed hiện tại đã chạy xong (đã phát live hoặc đã resolve): không re-seed được",
        ),
    );
    for (id, engine_state) in [(12, "FINISHED"), (13, "RESOLVED"), (14, "ARCHIVED")] {
        exec(
            &f,
            &format!(
                r#"INSERT INTO "Race" ("id", "status", "createdAt", "isTest", "engineState", "raceSeed")
                   VALUES ({id}, 'failed', '{now}', 0, '{engine_state}', '{seed}')"#
            ),
        )
        .await;
        assert_eq!(
            post(&f, json!({ "action": "reseed-week", "weekId": week_id })).await,
            finished_refusal,
            "{engine_state}"
        );
    }
    // Pre-finish engine state, but a CHAOS_RESOLVED event exists: refused too.
    exec(
        &f,
        &format!(
            r#"INSERT INTO "Race" ("id", "status", "createdAt", "isTest", "engineState", "raceSeed")
               VALUES (15, 'failed', '{now}', 0, 'RACING', '{seed}');
               INSERT INTO "RaceEngineEvent" ("raceId", "type", "tick", "timestampWithinRaceMs", "metadataJson", "createdAt")
               VALUES (15, 'CHAOS_RESOLVED', 0, 0, '{{}}', '{now}')"#
        ),
    )
    .await;
    assert_eq!(
        post(&f, json!({ "action": "reseed-week", "weekId": week_id })).await,
        finished_refusal
    );
    // The latest official race with the seed failed while racing (the week went back to locked,
    // raceId NULL).
    exec(
        &f,
        &format!(
            r#"INSERT INTO "Race" ("id", "status", "createdAt", "isTest", "engineState", "raceSeed")
               VALUES (16, 'failed', '{now}', 0, 'RACING', '{seed}')"#
        ),
    )
    .await;
    // A resolved week is never re-seeded, whatever its races say.
    exec(
        &f,
        &format!(r#"UPDATE "SeasonWeek" SET "resolvedAt" = '{now}'"#),
    )
    .await;
    assert_eq!(
        post(&f, json!({ "action": "reseed-week", "weekId": week_id })).await,
        refused
    );
    exec(&f, r#"UPDATE "SeasonWeek" SET "resolvedAt" = NULL"#).await;
    let (status, body) = post(&f, json!({ "action": "reseed-week", "weekId": week_id })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["failedRaceId"], 16);
    assert_eq!(body["previousRaceSeedCount"], 1);
    assert_eq!(body["weekId"], week_id);
    let new_seed: String = scalar(&f, r#"SELECT "raceSeed" FROM "SeasonWeek""#).await;
    assert_ne!(new_seed, seed);
    // The answer carries a commitment, never a seed (D17).
    assert_eq!(
        body["seedCommit"].as_str().unwrap(),
        autoduck_server::season3::admin::seed::seed_commit(&new_seed)
    );
    let text = body.to_string();
    assert!(!text.contains(&new_seed) && !text.contains(&seed), "{text}");
    assert_eq!(
        body.as_object().unwrap().keys().collect::<Vec<_>>(),
        [
            "ok",
            "weekId",
            "seedCommit",
            "failedRaceId",
            "previousRaceSeedCount"
        ]
    );
    let status_now: String = scalar(&f, r#"SELECT "status" FROM "SeasonWeek""#).await;
    assert_eq!(status_now, "locked");
    let stored: String = scalar(&f, r#"SELECT "previousRaceSeeds" FROM "SeasonWeek""#).await;
    assert_eq!(stored, serde_json::to_string(&[&seed]).unwrap());
    // Auto loadouts follow the new seed.
    let items: String = scalar(
        &f,
        r#"SELECT "itemIdsJson" FROM "SeasonLoadout" WHERE "userId" = 2"#,
    )
    .await;
    assert_eq!(items, auto_loadout_json(&new_seed, 2));
    // Nothing failed with the new seed: refused again.
    assert_eq!(
        post(&f, json!({ "action": "reseed-week", "weekId": week_id })).await,
        refused
    );
    // An open week is refused.
    exec(&f, r#"UPDATE "SeasonWeek" SET "status" = 'open'"#).await;
    assert_eq!(
        post(&f, json!({ "action": "reseed-week", "weekId": week_id })).await,
        refused
    );
}

#[tokio::test]
async fn ops_report_and_replay_track_gate() {
    let f = fixture().await;
    let now = DbTime::now().to_db_string();
    exec(
        &f,
        &format!(
            r#"INSERT INTO "Race" ("id", "status", "createdAt", "isTest", "engineState", "engineVersion", "balanceVersion", "engineConfigJson")
               VALUES (1, 'finished', '{now}', 0, 'RESOLVED', '1.2.0', 'S3.15', '{{}}'),
                      (2, 'finished', '{now}', 1, 'RESOLVED', '1.2.0', 'S3.15', '{{}}'),
                      (3, 'failed', '{now}', 0, 'FINISHED', '1.2.0', 'S3.15', '{{}}'),
                      (4, 'finished', '{now}', 0, 'FINISHED', NULL, NULL, NULL);
               INSERT INTO "RaceReplayTrack" ("raceId", "format", "source", "fidelity", "engineImpl", "engineVersion",
                      "balanceVersion", "trackVersion", "tickRate", "tickCount", "createdAt")
               VALUES (2, 'dtrk/1', 'LIVE_TS', 'RECORDED', 'ts', '1.2.0', 'S3.15', 'river-01-v2', 30, 100, '{now}')"#
        ),
    )
    .await;
    let (status, report) = get(&f, &format!("{PATH}?report=ops")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(report["report"], "ops");
    assert_eq!(report["inFlightRaces"][0]["id"], 3);
    assert_eq!(
        report["replayTrackGate"],
        json!({ "missingCount": 1, "missing": [{ "raceId": 1, "balanceVersion": "S3.15" }] })
    );
    assert_eq!(
        report["replayTrackFidelity"],
        json!([{ "fidelity": "RECORDED", "balanceVersion": "S3.15", "isTest": true, "count": 1 }])
    );
    // Group-by order: isTest, status, then NULL versions first.
    let counts: Vec<(Value, Value, Value)> = report["raceCounts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["isTest"].clone(),
                row["status"].clone(),
                row["engineVersion"].clone(),
            )
        })
        .collect();
    assert_eq!(
        counts,
        [
            (json!(false), json!("failed"), json!("1.2.0")),
            (json!(false), json!("finished"), Value::Null),
            (json!(false), json!("finished"), json!("1.2.0")),
            (json!(true), json!("finished"), json!("1.2.0")),
        ]
    );
    let unauthorized = Request::builder()
        .uri(format!("{PATH}?report=ops"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(send(&f, unauthorized).await.0, StatusCode::UNAUTHORIZED);
}

/// The admin actions on a bootstrapped dev.db copy (`AUTODUCK_TEST_DEV_DB`).
#[tokio::test]
async fn dev_db_copy_admin_actions() {
    let dir = tempfile::tempdir().unwrap();
    let Some(path) = common::dev_db_copy(dir.path()).await else {
        return;
    };
    let f = open(dir, &path).await;
    let (status, dashboard) = get(&f, PATH).await;
    assert_eq!(status, StatusCode::OK);
    let Some(week) = dashboard["weeks"]
        .as_array()
        .and_then(|weeks| weeks.last())
        .cloned()
    else {
        eprintln!("dev.db copy has no active season; nothing to check");
        return;
    };
    assert_eq!(
        get(&f, &format!("{PATH}?report=ops")).await.0,
        StatusCode::OK
    );
    let week_id = week["id"].as_i64().unwrap();
    let players = dashboard["players"].as_array().unwrap();
    let user_id = players.last().unwrap()["id"].as_i64().unwrap();
    if week["status"] == "open" {
        for body in [
            json!({ "action": "toggle-skip", "weekId": week_id, "userId": user_id }),
            json!({ "action": "toggle-skip", "weekId": week_id, "userId": user_id }),
            json!({ "action": "set-chaos", "weekId": week_id }),
            json!({ "action": "set-chaos", "weekId": week_id, "chaosType": "CONSTRUCTORS" }),
            json!({ "action": "lock", "weekId": week_id }),
            json!({ "action": "unlock", "weekId": week_id }),
        ] {
            let (status, response) = post(&f, body.clone()).await;
            assert_eq!(status, StatusCode::OK, "{body} → {response}");
        }
    }
    assert_eq!(
        post(&f, json!({ "action": "reseed-week", "weekId": week_id }))
            .await
            .0,
        StatusCode::CONFLICT
    );
    let (status, extended) = post(&f, json!({ "action": "extend-season" })).await;
    assert_eq!(status, StatusCode::OK, "{extended}");
    let (status, ended) = post(&f, json!({ "action": "end-season" })).await;
    assert_eq!(status, StatusCode::OK, "{ended}");
    let (status, created) = post(&f, json!({ "action": "create-season", "key": "S-test" })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(
        created["players"].as_array().unwrap().len(),
        usize::try_from(scalar::<i64>(&f, r#"SELECT COUNT(*) FROM "User""#).await).unwrap()
    );
    let (status, dashboard) = get(&f, PATH).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(dashboard["season"]["key"], "S-test");
}
