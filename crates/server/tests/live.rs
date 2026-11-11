//! Live races end to end on a baseline-schema DB (plan Phase 5): start-race → countdown →
//! driver → T1 → T2 → SSE frames; test races; MAX_LIVE_RACES and shutdown; a panicking sim;
//! both crash-recovery branches with a T2 that applies the meta once.
//!
//! The driver runs unpaced and the countdown is short, so these use real time (sqlx works on
//! its own threads, which `tokio::time::pause` would race). The stream layer is tested under a
//! paused clock in `src/live/sse.rs`.

// Server code, not the engine: the D4(b) type bans do not apply (see src/lib.rs).
#![allow(clippy::disallowed_types)]

mod common;

use std::io::Read as _;
use std::path::Path;
use std::time::Duration;

use autoduck_server::boot::recovery;
use autoduck_server::db::{Db, DbTime};
use autoduck_server::http::{self, AppState};
use autoduck_server::live::{LiveHub, LiveOptions, Pacing, T2Outcome, resolve_finished_race};
use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use http_body_util::BodyExt;
use race_core::replay::RaceRun;
use race_core::sim::SimOptions;
use serde_json::{Value, json};
use tower::ServiceExt;

const SECRET: &str = "live-race-test-secret-0123456789";
const ADMIN: &str = "/api/admin/season3";

struct Fixture {
    _dir: tempfile::TempDir,
    app: axum::Router,
    db: Db,
    hub: LiveHub,
}

fn options() -> LiveOptions {
    LiveOptions {
        countdown: Duration::from_millis(300),
        pacing: Pacing::Unpaced,
        linger: Duration::from_secs(60),
        ..LiveOptions::default()
    }
}

/// Baseline DB with four users (one is the ghost duck "Thomas") and a season with week 1.
async fn fixture(options: LiveOptions) -> Fixture {
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
    open(dir, &path, options).await
}

async fn open(dir: tempfile::TempDir, path: &Path, options: LiveOptions) -> Fixture {
    let db = Db::open(path).await.unwrap();
    let config = common::config(dir.path(), path, &[("RACE_SECRET_KEY", SECRET)]);
    let hub = LiveHub::new(db.clone(), options);
    let state = AppState::with_live(config, db.clone(), hub.clone());
    Fixture {
        app: http::router(state),
        db,
        hub,
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

async fn admin(f: &Fixture, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(Method::POST)
        .uri(ADMIN)
        .header("content-type", "application/json")
        .header("x-race-secret", SECRET)
        .body(Body::from(body.to_string()))
        .unwrap();
    send(f, request).await
}

async fn get(f: &Fixture, uri: &str) -> (StatusCode, Value) {
    send(f, Request::get(uri).body(Body::empty()).unwrap()).await
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

/// `create-season` (all four users) and `lock` week 1. Returns the week id.
async fn locked_week(f: &Fixture) -> i64 {
    let (status, created) = admin(f, json!({ "action": "create-season" })).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let week_id = created["weekId"].as_i64().unwrap();
    let (status, locked) = admin(f, json!({ "action": "lock" })).await;
    assert_eq!(status, StatusCode::OK, "{locked}");
    week_id
}

/// SSE events from `GET /api/races/:id/live` until the stream ends (or `limit` events).
struct Sse {
    body: Body,
    buffer: String,
}

#[derive(Debug, Clone)]
struct Event {
    id: Option<u64>,
    event: String,
    data: Value,
}

impl Sse {
    async fn open(
        f: &Fixture,
        race_id: i64,
        last_event_id: Option<u64>,
        query: &str,
    ) -> (StatusCode, Self) {
        let mut request = Request::get(format!("/api/races/{race_id}/live{query}"));
        if let Some(id) = last_event_id {
            request = request.header("last-event-id", id.to_string());
        }
        let response = f
            .app
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        if status == StatusCode::OK {
            assert_eq!(response.headers()["x-accel-buffering"], "no");
            assert!(
                response.headers()["content-type"]
                    .to_str()
                    .unwrap()
                    .starts_with("text/event-stream")
            );
        }
        (
            status,
            Self {
                body: response.into_body(),
                buffer: String::new(),
            },
        )
    }

    async fn next(&mut self) -> Option<Event> {
        loop {
            if let Some(end) = self.buffer.find("\n\n") {
                let block = self.buffer[..end].to_owned();
                self.buffer.drain(..end + 2);
                if block.starts_with(':') {
                    continue;
                }
                let mut event = Event {
                    id: None,
                    event: String::new(),
                    data: Value::Null,
                };
                for line in block.lines() {
                    if let Some(id) = line.strip_prefix("id: ") {
                        event.id = Some(id.parse().unwrap());
                    } else if let Some(name) = line.strip_prefix("event: ") {
                        event.event = name.to_owned();
                    } else if let Some(data) = line.strip_prefix("data: ") {
                        event.data = serde_json::from_str(data).unwrap();
                    }
                }
                return Some(event);
            }
            let frame = tokio::time::timeout(Duration::from_secs(120), self.body.frame())
                .await
                .expect("SSE stalled")?
                .ok()?;
            if let Ok(data) = frame.into_data() {
                self.buffer.push_str(std::str::from_utf8(&data).unwrap());
            }
        }
    }

    async fn all(mut self) -> Vec<Event> {
        let mut events = Vec::new();
        while let Some(event) = self.next().await {
            events.push(event);
        }
        events
    }
}

async fn wait_for<F>(what: &str, mut check: F)
where
    F: AsyncFnMut() -> bool,
{
    for _ in 0..600 {
        if check().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("timed out waiting for {what}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn official_race_end_to_end() {
    let f = fixture(options()).await;
    let week_id = locked_week(&f).await;
    let (status, started) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "allowOffSchedule": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    assert_eq!(started["ok"], true);
    assert_eq!(started["status"], "pending");
    let race_id = started["raceId"].as_i64().unwrap();

    // The claim: week racing on this race, race in COUNTDOWN with its commitment.
    assert_eq!(
        scalar::<String>(
            &f,
            &format!(r#"SELECT "status" FROM "SeasonWeek" WHERE "id" = {week_id}"#)
        )
        .await,
        "racing"
    );
    let (engine_state, config_json, seed_commit, engine_version, balance_version): (String, String, String, String, String) =
        sqlx::query_as(r#"SELECT "engineState", "engineConfigJson", "seedCommit", "engineVersion", "balanceVersion" FROM "Race" WHERE "id" = ?"#)
            .bind(race_id)
            .fetch_one(&f.db.reader)
            .await
            .unwrap();
    assert!(
        matches!(engine_state.as_str(), "COUNTDOWN" | "RACING"),
        "{engine_state}"
    );
    assert_eq!(
        (engine_version.as_str(), balance_version.as_str()),
        ("2.0.0", "S3.17")
    );
    assert_eq!(
        seed_commit,
        race_core::digest::sha256_hex(config_json.as_bytes())
    );
    // D17: the detail hides seed and config until RACING.
    let (_, detail) = get(&f, &format!("/api/races/{race_id}")).await;
    if detail["engine"]["state"] == "COUNTDOWN" {
        assert_eq!(detail["engine"]["config"], Value::Null);
        assert_eq!(detail["engine"]["seed"], Value::Null);
        assert_eq!(detail["engine"]["players"].as_array().unwrap().len(), 4);
    }

    // A second start for the same week: it is `racing`, not `locked` (TS order of checks).
    let (status, again) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "allowOffSchedule": true }),
    )
    .await;
    assert_eq!(
        (status, again),
        (
            StatusCode::CONFLICT,
            json!({ "error": "Phải lock prep trước khi đua" })
        )
    );

    let (status, sse) = Sse::open(&f, race_id, None, "").await;
    assert_eq!(status, StatusCode::OK);
    let events = sse.all().await;
    let names: Vec<&str> = events.iter().map(|event| event.event.as_str()).collect();
    assert_eq!(names.first(), Some(&"hello"));
    assert_eq!(events[0].data["engineVersion"], "2.0.0");
    assert!(
        !names.contains(&"engine-event"),
        "engine events are snapshot-only"
    );
    let start = events.iter().find(|event| event.event == "start").unwrap();
    assert_eq!(start.data["configJcs"], config_json.as_str());
    let clocks: Vec<&Event> = events
        .iter()
        .filter(|event| event.event == "clock")
        .collect();
    assert!(clocks.len() > 100, "{} clock frames", clocks.len());
    let mut previous = 0;
    for clock in &clocks {
        let tick = clock.data["tick"].as_u64().unwrap();
        assert!(tick > previous);
        assert!(tick % 3 == 0 || std::ptr::eq(*clock, *clocks.last().unwrap()));
        assert_eq!(
            clock.data.get("hash").is_some(),
            tick % 60 == 0,
            "tick {tick}"
        );
        previous = tick;
    }
    let ids: Vec<u64> = events.iter().filter_map(|event| event.id).collect();
    assert!(ids.windows(2).all(|pair| pair[0] < pair[1]));
    let finished = events
        .iter()
        .find(|event| event.event == "finished")
        .unwrap();
    assert_eq!(names.last(), Some(&"resolved"));
    let final_tick = finished.data["finalTick"].as_u64().unwrap();
    assert_eq!(final_tick, previous);

    // DB after T1 + T2.
    let (status_db, engine_state, result_digest): (String, String, String) = sqlx::query_as(
        r#"SELECT "status", "engineState", "resultDigest" FROM "Race" WHERE "id" = ?"#,
    )
    .bind(race_id)
    .fetch_one(&f.db.reader)
    .await
    .unwrap();
    assert_eq!(
        (status_db.as_str(), engine_state.as_str()),
        ("finished", "RESOLVED")
    );
    assert_eq!(finished.data["digest"], result_digest.as_str());
    assert_eq!(
        scalar::<String>(
            &f,
            &format!(r#"SELECT "status" FROM "SeasonWeek" WHERE "id" = {week_id}"#)
        )
        .await,
        "resolved"
    );
    assert_eq!(
        scalar::<i64>(&f, &format!(r#"SELECT COUNT(*) FROM "RaceEngineEvent" WHERE "raceId" = {race_id} AND "type" = 'CHAOS_RESOLVED'"#)).await,
        1
    );
    // Official players (not the ghost) raced once; championship points handed out.
    assert_eq!(
        scalar::<i64>(&f, r#"SELECT SUM("raceCount") FROM "SeasonPlayer""#).await,
        3
    );
    assert_eq!(
        scalar::<i64>(
            &f,
            r#"SELECT SUM("championshipPoints") FROM "SeasonPlayer""#
        )
        .await,
        6
    );
    assert_eq!(
        scalar::<i64>(&f, &format!(r#"SELECT COUNT(*) FROM "RaceParticipant" WHERE "raceId" = {race_id} AND "initialRank" IS NOT NULL"#)).await,
        4
    );
    assert!(
        scalar::<i64>(&f, &format!(r#"SELECT COUNT(*) FROM "CurrencyTransaction" WHERE "raceId" = {race_id} AND "reason" = 'RACE_WIN'"#)).await
            == 1
    );

    // Determinism: re-simulating the stored config natively gives the stored digest.
    let config: race_protocol::config::ResolvedRaceConfig =
        serde_json::from_str(&config_json).unwrap();
    let mut run = RaceRun::new(config, SimOptions::default(), false);
    run.run_to_end().unwrap();
    let outcome = run.outcome().unwrap();
    assert_eq!(outcome.result_digest, result_digest);
    assert_eq!(outcome.engine_config_json, config_json);
    assert_eq!(u64::from(run.tick()), final_tick);

    // The Rust-recorded track (T1) and the frozen stats (after T2, best effort).
    let (byte_sha, bytes, engine_impl, tick_count): (String, Vec<u8>, String, i64) = sqlx::query_as(
        r#"SELECT "byteSha256", "bytes", "engineImpl", "tickCount" FROM "RaceReplayTrack" WHERE "raceId" = ?"#,
    )
    .bind(race_id)
    .fetch_one(&f.db.reader)
    .await
    .unwrap();
    assert_eq!(engine_impl, "rust");
    assert_eq!(u64::try_from(tick_count).unwrap(), final_tick);
    let mut payload = Vec::new();
    flate2::read::GzDecoder::new(bytes.as_slice())
        .read_to_end(&mut payload)
        .unwrap();
    assert_eq!(race_core::digest::sha256_hex(&payload), byte_sha);
    wait_for("statsJson", async || {
        scalar::<i64>(&f, &format!(r#"SELECT COUNT(*) FROM "RaceReplayTrack" WHERE "raceId" = {race_id} AND "statsJson" IS NOT NULL"#)).await == 1
    })
    .await;
    wait_for("item telemetry", async || {
        scalar::<i64>(
            &f,
            &format!(r#"SELECT COUNT(*) FROM "RaceItemTelemetry" WHERE "raceId" = {race_id}"#),
        )
        .await
            == 6
    })
    .await;

    let (status, detail) = get(&f, &format!("/api/races/{race_id}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["status"], "finished");
    assert_eq!(detail["engine"]["config"]["raceId"], race_id.to_string());
    assert_eq!(detail["engine"]["liveTick"], Value::Null);
    assert_eq!(detail["engine"]["replay"]["mode"], "track");
    assert!(detail["engine"]["postRaceStats"].is_object());

    // Resume while the session lingers: only frames after Last-Event-ID.
    let resume_from = finished.id.unwrap() - 1;
    let (status, sse) = Sse::open(&f, race_id, Some(resume_from), "").await;
    assert_eq!(status, StatusCode::OK);
    let resumed = sse.all().await;
    let names: Vec<&str> = resumed.iter().map(|event| event.event.as_str()).collect();
    assert_eq!(names[0], "hello");
    assert_eq!(resumed[0].data["state"], "RESOLVED");
    assert!(
        resumed[1..]
            .iter()
            .all(|event| event.id.unwrap() > resume_from)
    );
    assert_eq!(&names[names.len() - 2..], ["finished", "resolved"]);

    // The week is resolved: no second race.
    let (status, refused) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "allowOffSchedule": true }),
    )
    .await;
    assert_eq!(
        (status, refused),
        (
            StatusCode::CONFLICT,
            json!({ "error": "Phải lock prep trước khi đua" })
        )
    );
    // Not live in this process (anymore): 204, which stops EventSource reconnects.
    assert_eq!(Sse::open(&f, 999, None, "").await.0, StatusCode::NO_CONTENT);
    assert_eq!(
        get(&f, "/api/races/abc/live").await.0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn test_race_limits_routes_and_shutdown() {
    let f = fixture(LiveOptions {
        countdown: Duration::from_millis(1500),
        max_live_races: 1,
        ..options()
    })
    .await;
    let (status, created) = admin(&f, json!({ "action": "create-season" })).await;
    assert_eq!(status, StatusCode::CREATED);
    let week_id = created["weekId"].as_i64().unwrap();

    // Official needs a locked week; a test race runs during prep and never claims it.
    let (status, refused) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "allowOffSchedule": true }),
    )
    .await;
    assert_eq!(
        (status, refused),
        (
            StatusCode::CONFLICT,
            json!({ "error": "Phải lock prep trước khi đua" })
        )
    );
    let (status, started) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "test": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let race_id = started["raceId"].as_i64().unwrap();
    assert_eq!(
        scalar::<String>(
            &f,
            &format!(r#"SELECT "status" FROM "SeasonWeek" WHERE "id" = {week_id}"#)
        )
        .await,
        "open"
    );
    // MAX_LIVE_RACES (1 here).
    let (status, full) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "test": true }),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{full}");

    // Wild items are off (D16); desync reports are accepted and logged.
    let wild = Request::post(format!("/api/races/{race_id}/wild-item"))
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(send(&f, wild).await.0, StatusCode::GONE);
    let desync = Request::post(format!("/api/races/{race_id}/desync"))
        .header("content-type", "application/json")
        .body(Body::from(
            json!({ "tick": 60, "clientHash": "aa", "serverHash": "bb", "engineBuildId": "x" })
                .to_string(),
        ))
        .unwrap();
    assert_eq!(send(&f, desync).await.0, StatusCode::NO_CONTENT);
    let bad = Request::post(format!("/api/races/{race_id}/desync"))
        .body(Body::from("nope"))
        .unwrap();
    assert_eq!(send(&f, bad).await.0, StatusCode::BAD_REQUEST);

    // Snapshot subscribers get engine events and snapshots too.
    let (status, sse) = Sse::open(&f, race_id, None, "?snapshots=1").await;
    assert_eq!(status, StatusCode::OK);

    // Shutdown (D21): refuses new races at once, waits for the running one.
    f.hub.begin_shutdown();
    let (status, refused) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "test": true }),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{refused}");
    assert!(
        f.hub.shutdown().await,
        "the race finished within the grace period"
    );
    assert_eq!(f.hub.running(), 0);

    let events = sse.all().await;
    let names: Vec<&str> = events.iter().map(|event| event.event.as_str()).collect();
    assert!(names.contains(&"engine-event"));
    assert!(names.contains(&"snapshot"));
    let snapshot = events
        .iter()
        .find(|event| event.event == "snapshot")
        .unwrap();
    assert_eq!(snapshot.data["type"], "STATE_SNAPSHOT");
    assert_eq!(names.last(), Some(&"resolved"));

    // A test race ends ARCHIVED and leaves the season alone.
    let (status_db, engine_state): (String, String) =
        sqlx::query_as(r#"SELECT "status", "engineState" FROM "Race" WHERE "id" = ?"#)
            .bind(race_id)
            .fetch_one(&f.db.reader)
            .await
            .unwrap();
    assert_eq!(
        (status_db.as_str(), engine_state.as_str()),
        ("finished", "ARCHIVED")
    );
    assert_eq!(
        scalar::<i64>(&f, r#"SELECT SUM("raceCount") FROM "SeasonPlayer""#).await,
        0
    );
    assert_eq!(
        scalar::<String>(
            &f,
            &format!(r#"SELECT "status" FROM "SeasonWeek" WHERE "id" = {week_id}"#)
        )
        .await,
        "open"
    );
    assert_eq!(
        scalar::<i64>(&f, r#"SELECT COUNT(*) FROM "SeasonLoadout""#).await,
        0
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn panicking_sim_fails_the_race_and_the_server_stays_up() {
    let f = fixture(LiveOptions {
        panic_at_tick: Some(40),
        ..options()
    })
    .await;
    let week_id = locked_week(&f).await;
    let (status, started) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "allowOffSchedule": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let race_id = started["raceId"].as_i64().unwrap();
    let (_, sse) = Sse::open(&f, race_id, None, "").await;
    let events = sse.all().await;
    assert_eq!(events.last().unwrap().event, "failed");
    let last_clock = events.iter().rfind(|event| event.event == "clock").unwrap();
    assert_eq!(last_clock.data["tick"], 39);

    let (status_db, engine_state): (String, String) =
        sqlx::query_as(r#"SELECT "status", "engineState" FROM "Race" WHERE "id" = ?"#)
            .bind(race_id)
            .fetch_one(&f.db.reader)
            .await
            .unwrap();
    assert_eq!(
        (status_db.as_str(), engine_state.as_str()),
        ("failed", "RACING")
    );
    let (week_status, week_race): (String, Option<i64>) =
        sqlx::query_as(r#"SELECT "status", "raceId" FROM "SeasonWeek" WHERE "id" = ?"#)
            .bind(week_id)
            .fetch_one(&f.db.reader)
            .await
            .unwrap();
    assert_eq!((week_status.as_str(), week_race), ("locked", None));
    assert_eq!(
        scalar::<i64>(&f, r#"SELECT COUNT(*) FROM "RaceEngineEvent""#).await,
        0
    );
    assert_eq!(get(&f, "/api/health").await.0, StatusCode::OK);
    // The week can be re-seeded (the race failed before it finished) and raced again.
    let (status, reseeded) = admin(&f, json!({ "action": "reseed-week", "weekId": week_id })).await;
    assert_eq!(status, StatusCode::OK, "{reseeded}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn crash_recovery_both_branches() {
    // Branch 1: a race interrupted before T1 (found in COUNTDOWN at "boot").
    let f = fixture(LiveOptions {
        countdown: Duration::from_secs(2),
        ..options()
    })
    .await;
    let week_id = locked_week(&f).await;
    let (_, started) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "allowOffSchedule": true }),
    )
    .await;
    let first = started["raceId"].as_i64().unwrap();
    let report = recovery::recover(&f.db).await.unwrap();
    assert_eq!(report.failed, [first]);
    assert_eq!(report.weeks_unlocked, [first]);
    // The orphaned task then cannot move the failed race to RACING.
    wait_for("the orphaned task", async || f.hub.running() == 0).await;
    let (status_db, engine_state): (String, String) =
        sqlx::query_as(r#"SELECT "status", "engineState" FROM "Race" WHERE "id" = ?"#)
            .bind(first)
            .fetch_one(&f.db.reader)
            .await
            .unwrap();
    assert_eq!(
        (status_db.as_str(), engine_state.as_str()),
        ("failed", "COUNTDOWN")
    );

    // Branch 2: T1 committed, then the process died (stop_after_t1): T2 resumes from the DB.
    let dir = f._dir;
    let path = dir.path().join("autoduck.db");
    f.db.close().await;
    let f = open(
        dir,
        &path,
        LiveOptions {
            stop_after_t1: true,
            ..options()
        },
    )
    .await;
    let (status, started) = admin(
        &f,
        json!({ "action": "start-race", "weekId": week_id, "allowOffSchedule": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{started}");
    let second = started["raceId"].as_i64().unwrap();
    assert_ne!(second, first);
    wait_for("T1", async || f.hub.running() == 0).await;
    let (status_db, engine_state): (String, String) =
        sqlx::query_as(r#"SELECT "status", "engineState" FROM "Race" WHERE "id" = ?"#)
            .bind(second)
            .fetch_one(&f.db.reader)
            .await
            .unwrap();
    assert_eq!(
        (status_db.as_str(), engine_state.as_str()),
        ("running", "FINISHED")
    );
    assert_eq!(
        scalar::<i64>(&f, r#"SELECT SUM("raceCount") FROM "SeasonPlayer""#).await,
        0
    );

    let report = recovery::recover(&f.db).await.unwrap();
    assert_eq!(report.resolved, [second]);
    assert!(report.failed.is_empty() && report.awaiting_t2.is_empty());
    let (status_db, engine_state): (String, String) =
        sqlx::query_as(r#"SELECT "status", "engineState" FROM "Race" WHERE "id" = ?"#)
            .bind(second)
            .fetch_one(&f.db.reader)
            .await
            .unwrap();
    assert_eq!(
        (status_db.as_str(), engine_state.as_str()),
        ("finished", "RESOLVED")
    );
    assert_eq!(
        scalar::<String>(
            &f,
            &format!(r#"SELECT "status" FROM "SeasonWeek" WHERE "id" = {week_id}"#)
        )
        .await,
        "resolved"
    );
    let meta = async |f: &Fixture| -> (i64, i64, i64) {
        (
            scalar(f, r#"SELECT SUM("raceCount") FROM "SeasonPlayer""#).await,
            scalar(f, r#"SELECT COUNT(*) FROM "CurrencyTransaction""#).await,
            scalar(
                f,
                r#"SELECT COUNT(*) FROM "RaceEngineEvent" WHERE "type" = 'CHAOS_RESOLVED'"#,
            )
            .await,
        )
    };
    let applied = meta(&f).await;
    assert_eq!(applied.0, 3);
    assert_eq!(applied.2, 1);

    // Idempotent: T2 again (directly and through a second boot) changes nothing.
    assert_eq!(
        resolve_finished_race(&f.db, second, None).await.unwrap(),
        T2Outcome::NotFinished {
            engine_state: "RESOLVED".into()
        }
    );
    let again = recovery::recover(&f.db).await.unwrap();
    assert_eq!(again.rows_changed, 0);
    assert_eq!(meta(&f).await, applied);
}
