//! One race, start to finish (D23): countdown → RACING → driver thread → T1 → T2 → best-effort
//! stats/telemetry. Any failure before T2 commits marks the race `failed` and returns an
//! official week to `locked` ([`fail_race`]), as `executeSeason3Race`'s catch does.

use std::sync::Arc;
use std::time::Duration;

use race_core::replay::RaceOutcome;
use serde_json::{Value, json};
use sqlx::{AssertSqlSafe, SqliteConnection};

use super::driver::{self, DriverInput, DriverOutput, StoredTrack};
use super::resolve::{T2Error, T2Outcome, resolve_finished_race};
use super::session::LiveSession;
use super::{LaunchSpec, LiveHub};
use crate::cosmetics::js::stringify;
use crate::db::{Db, DbTime};

/// Engine events per multi-row INSERT in T1 (D15, D23).
pub const EVENT_CHUNK: usize = 500;

pub(crate) async fn run(hub: &LiveHub, session: &Arc<LiveSession>, spec: LaunchSpec) {
    let db = hub.db().clone();
    let race_id = spec.race_id;
    let is_test = spec.is_test;
    if let Err(reason) = drive(hub, session, spec).await {
        tracing::error!(race = race_id, tick = session.server_tick(), %reason, "race failed");
        fail_race(&db, race_id, is_test).await;
        session.failed();
    }
}

async fn drive(hub: &LiveHub, session: &Arc<LiveSession>, spec: LaunchSpec) -> Result<(), String> {
    let db = hub.db();
    let options = hub.options();
    let race_id = spec.race_id;

    let deadline = tokio::time::Instant::now() + options.countdown;
    session.set_countdown(deadline);
    tokio::time::sleep_until(deadline).await;

    begin_racing(db, race_id, spec.is_test)
        .await
        .map_err(|error| format!("COUNTDOWN → RACING: {error}"))?;
    session.start(Arc::from(spec.engine_config_json.as_str()));

    let receiver = driver::spawn(
        race_id,
        DriverInput {
            config: spec.config.clone(),
            session: Arc::clone(session),
            pacing: options.pacing,
            snapshot_every_ticks: options.snapshot_every_ticks,
            record_track: options.record_track,
            panic_at_tick: options.panic_at_tick,
        },
    );
    let output = match receiver.await {
        Ok(Ok(output)) => output,
        Ok(Err(failure)) => return Err(failure.to_string()),
        Err(_) => return Err("driver thread ended without a result".into()),
    };

    write_t1(db, race_id, &output)
        .await
        .map_err(|error| format!("T1: {error:#}"))?;
    session.finished(output.final_tick, &finished_frame(&output));
    if options.stop_after_t1 {
        tracing::warn!(
            race = race_id,
            "stop_after_t1: leaving the race in FINISHED"
        );
        session.close();
        return Ok(());
    }

    let final_verdict = match resolve_finished_race(db, race_id, Some(spec.week_id)).await {
        Ok(T2Outcome::Resolved { final_verdict, .. }) => final_verdict,
        Ok(T2Outcome::NotFinished { engine_state }) => {
            return Err(format!("T2: race is {engine_state}, not FINISHED"));
        }
        Err(error) => return Err(format!("T2: {error}")),
    };

    session.resolved(&json!({
        "raceId": race_id.to_string(),
        "finalVerdict": final_verdict,
    }));
    tracing::info!(race = race_id, "race resolved");

    if options.post_race {
        post_race(db, race_id, spec, output.outcome.result).await;
    }
    Ok(())
}

fn finished_frame(output: &DriverOutput) -> Value {
    let standings: Vec<Value> = output
        .outcome
        .envelope
        .standings
        .iter()
        .map(|standing| serde_json::to_value(standing).unwrap_or(Value::Null))
        .collect();
    json!({
        "finalTick": output.final_tick,
        "digest": output.outcome.result_digest,
        "standings": standings,
    })
}

/// COUNTDOWN → RACING and `status = 'running'`; an official race also needs its week still
/// `racing` on it (`executeSeason3Race`'s validity check).
async fn begin_racing(db: &Db, race_id: i64, is_test: bool) -> anyhow::Result<()> {
    let mut tx = db.begin_write().await?;
    if !is_test {
        let claimed: Option<i64> = sqlx::query_scalar(
            r#"SELECT "id" FROM "SeasonWeek" WHERE "raceId" = ? AND "status" = 'racing'"#,
        )
        .bind(race_id)
        .fetch_optional(&mut *tx)
        .await?;
        anyhow::ensure!(claimed.is_some(), "Season 3 official race không còn hợp lệ");
    }
    let moved = sqlx::query(
        r#"UPDATE "Race" SET "engineState" = 'RACING', "status" = 'running'
           WHERE "id" = ? AND "engineState" = 'COUNTDOWN' AND "status" = 'pending'"#,
    )
    .bind(race_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    anyhow::ensure!(moved == 1, "Race {race_id} is no longer in COUNTDOWN");
    tx.commit().await?;
    Ok(())
}

/// T1 (D23): events in 500-row chunks, the raw engine ranks on the participants, the result
/// digest and versions, the `RaceReplayTrack` row, RACING → FINISHED. `status` stays `running`.
async fn write_t1(db: &Db, race_id: i64, output: &DriverOutput) -> anyhow::Result<()> {
    let outcome = &output.outcome;
    let now = DbTime::now();
    let mut tx = db.begin_write().await?;
    insert_engine_events(&mut tx, race_id, &outcome.result.events, now).await?;
    for entry in &outcome.result.standings {
        let user_id: i64 = entry.player_id.as_str().parse()?;
        sqlx::query(
            r#"UPDATE "RaceParticipant" SET "initialRank" = ?
               WHERE "raceId" = ? AND "userId" = ? AND "cloneIndex" IS NULL"#,
        )
        .bind(i64::from(entry.rank))
        .bind(race_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        r#"UPDATE "Race" SET "resultDigest" = ?, "engineVersion" = ?, "balanceVersion" = ?,
             "trackVersion" = ?
           WHERE "id" = ?"#,
    )
    .bind(&outcome.result_digest)
    .bind(&outcome.result.engine_version)
    .bind(&outcome.result.balance_version)
    .bind(&outcome.result.track_version)
    .bind(race_id)
    .execute(&mut *tx)
    .await?;
    if let Some(track) = &output.track {
        insert_track(&mut tx, race_id, outcome, track, now).await?;
    }
    let moved = sqlx::query(
        r#"UPDATE "Race" SET "engineState" = 'FINISHED' WHERE "id" = ? AND "engineState" = 'RACING'"#,
    )
    .bind(race_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    anyhow::ensure!(moved == 1, "Race {race_id} is no longer in RACING");
    tx.commit().await?;
    Ok(())
}

/// `persistRaceEvents`: one row per event, `metadataJson = JSON.stringify(metadata)`.
async fn insert_engine_events(
    conn: &mut SqliteConnection,
    race_id: i64,
    events: &[race_protocol::events::RaceEvent],
    now: DbTime,
) -> anyhow::Result<()> {
    for chunk in events.chunks(EVENT_CHUNK) {
        let values = vec!["(?, ?, ?, ?, ?, ?, ?, ?)"; chunk.len()].join(", ");
        let sql = format!(
            r#"INSERT INTO "RaceEngineEvent" ("raceId", "type", "tick", "timestampWithinRaceMs",
                 "sourcePlayerId", "targetPlayerId", "metadataJson", "createdAt") VALUES {values}"#
        );
        let mut query = sqlx::query(AssertSqlSafe(sql));
        for event in chunk {
            let value = serde_json::to_value(event)?;
            let metadata = value
                .get("metadata")
                .map_or_else(|| "{}".to_owned(), stringify);
            query = query
                .bind(race_id)
                .bind(event.type_name())
                .bind(i64::from(event.tick))
                .bind(event.timestamp_within_race_ms)
                .bind(
                    event
                        .source_player_id
                        .as_ref()
                        .map(|id| id.as_str().to_owned()),
                )
                .bind(
                    event
                        .target_player_id
                        .as_ref()
                        .map(|id| id.as_str().to_owned()),
                )
                .bind(metadata)
                .bind(now);
        }
        query.execute(&mut *conn).await?;
    }
    Ok(())
}

async fn insert_track(
    conn: &mut SqliteConnection,
    race_id: i64,
    outcome: &RaceOutcome,
    track: &StoredTrack,
    now: DbTime,
) -> anyhow::Result<()> {
    let result = &outcome.result;
    sqlx::query(
        r#"INSERT INTO "RaceReplayTrack" ("raceId", "format", "source", "fidelity", "engineImpl",
             "engineCommit", "engineBuild", "engineVersion", "balanceVersion", "trackVersion",
             "trackGeometry", "tickRate", "tickCount", "stride", "reproducedDigest", "byteSha256",
             "bytes", "statsJson", "note", "createdAt")
           VALUES (?, 'dtrk/1', 'LIVE_RUST', 'RECORDED', 'rust', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?,
             NULL, ?, ?)"#,
    )
    .bind(race_id)
    .bind(
        std::env::var("SOURCE_COMMIT")
            .ok()
            .or_else(|| std::env::var("GIT_SHA").ok())
            .filter(|value| !value.is_empty()),
    )
    .bind(race_core::ENGINE_BUILD_ID)
    .bind(&result.engine_version)
    .bind(&result.balance_version)
    .bind(&result.track_version)
    .bind(race_core::replay::TRACK_GEOMETRY_ID)
    .bind(i64::from(result.tick_rate))
    .bind(i64::from(track.encoded.tick_count))
    .bind(&outcome.result_digest)
    .bind(&track.encoded.byte_sha256)
    .bind(track.gzip.as_slice())
    .bind(track.encoded.note.as_deref())
    .bind(now)
    .execute(conn)
    .await?;
    Ok(())
}

/// `executeSeason3Race`'s catch: `status = 'failed'`; an official week still `racing` on this race
/// goes back to `locked` with no race. Retried a few times, since a week left `racing` on a
/// failed race can only be fixed by hand.
pub async fn fail_race(db: &Db, race_id: i64, is_test: bool) {
    for attempt in 1..=5_u32 {
        match try_fail_race(db, race_id, is_test).await {
            Ok(()) => return,
            Err(error) => {
                tracing::error!(race = race_id, attempt, %error, "cannot mark the race failed");
                tokio::time::sleep(Duration::from_millis(500 * u64::from(attempt))).await;
            }
        }
    }
}

async fn try_fail_race(db: &Db, race_id: i64, is_test: bool) -> Result<(), sqlx::Error> {
    let now = DbTime::now();
    let mut tx = db.begin_write().await?;
    sqlx::query(
        r#"UPDATE "Race" SET "status" = 'failed' WHERE "id" = ? AND "status" IN ('pending', 'running')"#,
    )
    .bind(race_id)
    .execute(&mut *tx)
    .await?;
    if !is_test {
        sqlx::query(
            r#"UPDATE "SeasonWeek" SET "status" = 'locked', "raceId" = NULL, "updatedAt" = ?
               WHERE "status" = 'racing' AND "raceId" = ?"#,
        )
        .bind(now)
        .bind(race_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

/// After T2, best effort (D23): never fails the race, only logs.
async fn post_race(
    db: &Db,
    race_id: i64,
    spec: LaunchSpec,
    result: race_protocol::result::RaceResult,
) {
    let stored = async {
        let inputs = super::post::load(db, race_id, spec.is_test, spec.config, result).await?;
        let post = tokio::task::spawn_blocking(move || super::post::compute(&inputs)).await?;
        super::post::store(db, race_id, &post).await
    };
    if let Err(error) = stored.await {
        tracing::warn!(race = race_id, error = %format!("{error:#}"), "post-race stats/telemetry not stored");
    }
}

/// Crash recovery (D22) of a race whose T1 committed: T2 from the DB. A permanent failure
/// (the meta refuses the result, inputs are missing) fails the race as the live path would; a DB
/// error leaves it in FINISHED for the next boot.
///
/// # Errors
/// A DB error from T2.
pub async fn recover_finished(db: &Db, race_id: i64, is_test: bool) -> Result<T2Outcome, T2Error> {
    match resolve_finished_race(db, race_id, None).await {
        Ok(outcome) => Ok(outcome),
        Err(error) if error.is_permanent() => {
            tracing::error!(race = race_id, %error, "T2 cannot resolve the race; marking it failed");
            fail_race(db, race_id, is_test).await;
            Err(error)
        }
        Err(error) => Err(error),
    }
}
