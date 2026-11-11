//! T2 (D23): the Season meta of a race whose T1 committed, **from the DB only**.
//!
//! The live path and crash recovery (D22) call the same [`resolve_finished_race`], so a T2 cut
//! short by a restart resumes exactly as it would have run. Everything happens in one
//! `BEGIN IMMEDIATE` transaction, in the TS `$transaction` order (`lib/season3-race.ts`):
//!
//! 1. the `CHAOS_RESOLVED` event (TS wrote it before the transaction; D23 moves it inside);
//! 2. `RaceParticipant` result columns (official ducks by rank, then ghosts);
//! 3. official races: King reset, Season players, prediction points, race QP, Golden Box QP and
//!    its `QP_TRACK_REWARD_GRANTED` event;
//! 4. `Race` → `finished`/`RESOLVED` (test races straight to `ARCHIVED`), guarded by
//!    `WHERE "engineState" = 'FINISHED'` returning one row;
//! 5. official races: the week → `resolved` with the recap.
//!
//! A race that is no longer `FINISHED` is left alone ([`T2Outcome::NotFinished`]), so running
//! T2 twice applies the meta once.
//!
//! Inputs, as TS loads them: the week (official: the week whose `raceId` is this race; test: the
//! week the race was started on, or after a restart the newest week of the active season), its
//! season's players in Prisma's include order with their users, the week's Shield choices and
//! predictions, and the engine result read back from T1: standings from the official
//! participants' `initialRank` (T1 writes the raw engine ranks), events from `RaceEngineEvent` in
//! emission order, `durationMs` = the largest official `finishTimeMs`.

use serde_json::Value;
use sqlx::{AssertSqlSafe, SqliteConnection};

use race_protocol::config::ResolvedRaceConfig;

use crate::cosmetics::economy::apply_quack_transaction;
use crate::cosmetics::rows::{SEASON_PLAYER_COLUMNS, SeasonPlayerRow};
use crate::db::{Db, DbTime};
use crate::season3::admin::rows::{SeasonWeekRow, WEEK_COLUMNS};
use crate::season3::mapping::RawStanding;
use crate::season3::resolution::{
    MetaEvent, MetaPlayer, ResolutionError, ResolutionInput, ResolutionPlan, WeekPrediction,
    plan_resolution,
};

/// What [`resolve_finished_race`] did.
#[derive(Debug, Clone, PartialEq)]
pub enum T2Outcome {
    /// T2 committed.
    Resolved {
        final_verdict: String,
        is_test: bool,
    },
    /// The race is not in `FINISHED` (already resolved, or never finished): nothing written.
    NotFinished { engine_state: String },
}

/// Why T2 could not run. Nothing was written (the transaction rolled back).
#[derive(Debug, thiserror::Error)]
pub enum T2Error {
    #[error("race {0} not found")]
    RaceNotFound(i64),
    /// Missing or unreadable inputs (no week, a bad stored config, …): the race cannot resolve.
    #[error("{0}")]
    Data(String),
    /// The Season meta refused the result (TS throws; the race fails).
    #[error("{0}")]
    Resolution(#[from] ResolutionError),
    /// A DB error: worth retrying later (crash recovery leaves the race in FINISHED).
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

impl T2Error {
    /// `true` when retrying can't help: the race should be marked failed.
    #[must_use]
    pub fn is_permanent(&self) -> bool {
        !matches!(self, Self::Db(_))
    }
}

#[derive(sqlx::FromRow)]
struct RaceRow {
    #[sqlx(rename = "isTest")]
    is_test: bool,
    #[sqlx(rename = "engineState")]
    engine_state: String,
    #[sqlx(rename = "engineConfigJson")]
    engine_config_json: Option<String>,
}

#[derive(sqlx::FromRow)]
struct EventRow {
    #[sqlx(rename = "type")]
    kind: String,
    tick: i64,
    #[sqlx(rename = "timestampWithinRaceMs")]
    timestamp_within_race_ms: f64,
    #[sqlx(rename = "sourcePlayerId")]
    source_player_id: Option<String>,
    #[sqlx(rename = "metadataJson")]
    metadata_json: String,
}

struct LoadedEvent {
    row: EventRow,
    finish_time_ms: Option<f64>,
    pickup_id: Option<String>,
}

/// Runs T2 for `race_id` (module docs). `week_hint` is the week a **test** race was started on
/// (the live path knows it); official races always use the week that claimed them.
///
/// # Errors
/// See [`T2Error`].
pub async fn resolve_finished_race(
    db: &Db,
    race_id: i64,
    week_hint: Option<i64>,
) -> Result<T2Outcome, T2Error> {
    let mut tx = db.begin_write().await?;
    let outcome = resolve_in(&mut tx, race_id, week_hint).await?;
    if matches!(outcome, T2Outcome::Resolved { .. }) {
        tx.commit().await?;
    }
    Ok(outcome)
}

async fn resolve_in(
    conn: &mut SqliteConnection,
    race_id: i64,
    week_hint: Option<i64>,
) -> Result<T2Outcome, T2Error> {
    let race: RaceRow = sqlx::query_as(
        r#"SELECT "isTest", "engineState", "engineConfigJson" FROM "Race" WHERE "id" = ?"#,
    )
    .bind(race_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(T2Error::RaceNotFound(race_id))?;
    if race.engine_state != "FINISHED" {
        return Ok(T2Outcome::NotFinished {
            engine_state: race.engine_state,
        });
    }
    let config: ResolvedRaceConfig = race
        .engine_config_json
        .as_deref()
        .ok_or_else(|| T2Error::Data("Race thiếu immutable engine config".into()))
        .and_then(|text| {
            serde_json::from_str(text)
                .map_err(|error| T2Error::Data(format!("stored engine config: {error}")))
        })?;

    let week = load_week(conn, race_id, race.is_test, week_hint).await?;
    let players = load_players(conn, week.season_id).await?;
    let shield_choice_player_ids: Vec<i64> = sqlx::query_scalar(
        r#"SELECT "seasonPlayerId" FROM "SeasonShieldChoice" WHERE "weekId" = ? LIMIT ? OFFSET ?"#,
    )
    .bind(week.id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(&mut *conn)
    .await?;
    let predictions: Vec<WeekPrediction> = sqlx::query_as::<_, (i64, i64, i64)>(
        r#"SELECT "id", "predictorUserId", "targetUserId" FROM "SeasonPrediction"
           WHERE "weekId" = ? LIMIT ? OFFSET ?"#,
    )
    .bind(week.id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|(id, predictor_user_id, target_user_id)| WeekPrediction {
        id,
        predictor_user_id,
        target_user_id,
    })
    .collect();

    let configured_user_ids: Vec<i64> = config
        .players
        .iter()
        .map(|player| {
            player.player_id.as_str().parse::<i64>().map_err(|_| {
                T2Error::Data(format!(
                    "config player id {} is not a user id",
                    player.player_id
                ))
            })
        })
        .collect::<Result<_, _>>()?;

    let events = load_events(conn, race_id).await?;
    // Raw standings: official (non-ghost) participants with the engine rank T1 stored.
    let ranked: Vec<(i64, i64)> = sqlx::query_as(
        r#"SELECT "userId", "initialRank" FROM "RaceParticipant"
           WHERE "raceId" = ? AND "cloneIndex" IS NULL AND "initialRank" IS NOT NULL
           ORDER BY "initialRank", "id""#,
    )
    .bind(race_id)
    .fetch_all(&mut *conn)
    .await?;
    let config_name = |user_id: i64| {
        let id = user_id.to_string();
        config
            .players
            .iter()
            .find(|player| player.player_id.as_str() == id)
    };
    let standings: Vec<RawStanding<'_>> = ranked
        .iter()
        .filter_map(|(user_id, rank)| {
            let player = config_name(*user_id).filter(|player| !player.is_ghost)?;
            Some(RawStanding {
                rank: *rank,
                user_id: *user_id,
                name: player.name.as_str(),
            })
        })
        .collect();
    if standings.is_empty() {
        return Err(T2Error::Data("no standings stored by T1".into()));
    }
    // `result.durationMs = Math.max(...standings.map(finishTimeMs))`.
    let mut duration_ms = f64::NEG_INFINITY;
    for standing in &standings {
        let id = standing.user_id.to_string();
        let finish = events
            .iter()
            .find(|event| {
                event.row.kind == "DUCK_FINISHED"
                    && event.row.source_player_id.as_deref() == Some(id.as_str())
            })
            .and_then(|event| event.finish_time_ms)
            .ok_or_else(|| T2Error::Data(format!("no DUCK_FINISHED for {id}")))?;
        duration_ms = race_core::math::js_max(duration_ms, finish);
    }

    let meta_players: Vec<MetaPlayer<'_>> = players
        .iter()
        .map(|(player, name)| MetaPlayer {
            season_player_id: player.id,
            user_id: player.user_id,
            name: name.as_str(),
            scars: player.scars,
            shields: player.shields,
            is_king: player.is_king,
            king_streak: player.king_streak,
        })
        .collect();
    let meta_events: Vec<MetaEvent<'_>> = events
        .iter()
        .map(|event| MetaEvent {
            kind: event.row.kind.as_str(),
            tick: event.row.tick,
            timestamp_within_race_ms: event.row.timestamp_within_race_ms,
            source_player_id: event.row.source_player_id.as_deref(),
            finish_time_ms: event.finish_time_ms,
            pickup_id: event.pickup_id.as_deref(),
        })
        .collect();
    let input = ResolutionInput {
        race_id,
        is_test: race.is_test,
        season_id: week.season_id,
        week_id: week.id,
        week_number: week.week_number,
        chaos_type: &week.chaos_type,
        chaos_target_user_id: week.chaos_target_user_id,
        chaos_target_user_id2: week.chaos_target_user_id2,
        chaos_payload: week.chaos_payload.as_deref(),
        predictions: &predictions,
        season_players: &meta_players,
        shield_choice_player_ids: &shield_choice_player_ids,
        configured_user_ids: &configured_user_ids,
        standings: &standings,
        events: &meta_events,
        duration_ms,
        tick_rate: f64::from(config.tick_rate),
    };
    let plan = plan_resolution(&input)?;
    apply_plan(conn, race_id, race.is_test, &config, &week, &plan).await?;
    Ok(T2Outcome::Resolved {
        final_verdict: plan.final_verdict,
        is_test: race.is_test,
    })
}

async fn load_week(
    conn: &mut SqliteConnection,
    race_id: i64,
    is_test: bool,
    week_hint: Option<i64>,
) -> Result<SeasonWeekRow, T2Error> {
    let by_id = |id: i64| {
        sqlx::query_as::<_, SeasonWeekRow>(AssertSqlSafe(format!(
            r#"SELECT {WEEK_COLUMNS} FROM "SeasonWeek" WHERE "SeasonWeek"."id" = ?"#
        )))
        .bind(id)
    };
    if !is_test {
        let week: Option<SeasonWeekRow> = sqlx::query_as(AssertSqlSafe(format!(
            r#"SELECT {WEEK_COLUMNS} FROM "SeasonWeek" WHERE "SeasonWeek"."raceId" = ?"#
        )))
        .bind(race_id)
        .fetch_optional(&mut *conn)
        .await?;
        return match week {
            Some(week) if week.status == "racing" => Ok(week),
            _ => Err(T2Error::Data(
                "Season 3 official race không còn hợp lệ".into(),
            )),
        };
    }
    if let Some(id) = week_hint
        && let Some(week) = by_id(id).fetch_optional(&mut *conn).await?
    {
        return Ok(week);
    }
    // After a restart a test race has no stored week link: test races only run during the
    // current week's prep, so take the newest week of the active season.
    sqlx::query_as::<_, SeasonWeekRow>(AssertSqlSafe(format!(
        r#"SELECT {WEEK_COLUMNS} FROM "SeasonWeek"
           JOIN "Season" ON "Season"."id" = "SeasonWeek"."seasonId"
           WHERE "Season"."status" = 'active'
           ORDER BY "SeasonWeek"."weekNumber" DESC LIMIT 1"#
    )))
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| T2Error::Data("test race has no week to resolve against".into()))
}

/// The season's players in the include order (`seasonId IN (?)`, no `ORDER BY`) with names.
async fn load_players(
    conn: &mut SqliteConnection,
    season_id: i64,
) -> Result<Vec<(SeasonPlayerRow, String)>, T2Error> {
    let players: Vec<SeasonPlayerRow> = sqlx::query_as(AssertSqlSafe(format!(
        r#"SELECT {SEASON_PLAYER_COLUMNS} FROM "SeasonPlayer" WHERE "SeasonPlayer"."seasonId" IN (?) LIMIT ? OFFSET ?"#
    )))
    .bind(season_id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(&mut *conn)
    .await?;
    let mut out = Vec::with_capacity(players.len());
    for player in players {
        let name: String = sqlx::query_scalar(r#"SELECT "name" FROM "User" WHERE "id" = ?"#)
            .bind(player.user_id)
            .fetch_optional(&mut *conn)
            .await?
            .ok_or_else(|| T2Error::Data(format!("season player {} has no user", player.id)))?;
        out.push((player, name));
    }
    Ok(out)
}

async fn load_events(
    conn: &mut SqliteConnection,
    race_id: i64,
) -> Result<Vec<LoadedEvent>, T2Error> {
    let rows: Vec<EventRow> = sqlx::query_as(
        r#"SELECT "type", "tick", "timestampWithinRaceMs", "sourcePlayerId", "metadataJson"
           FROM "RaceEngineEvent" WHERE "raceId" = ? ORDER BY "id""#,
    )
    .bind(race_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let wanted = matches!(row.kind.as_str(), "DUCK_FINISHED" | "GOLDEN_BOX_COLLECTED");
            let metadata: Option<Value> = wanted
                .then(|| serde_json::from_str(&row.metadata_json).ok())
                .flatten();
            let field = |key: &str| metadata.as_ref().and_then(|value| value.get(key));
            LoadedEvent {
                finish_time_ms: field("finishTimeMs").and_then(Value::as_f64),
                pickup_id: field("pickupId").and_then(Value::as_str).map(str::to_owned),
                row,
            }
        })
        .collect())
}

/// A meta event row T2 writes.
struct MetaRow<'a> {
    race_id: i64,
    kind: &'a str,
    tick: i64,
    timestamp_within_race_ms: f64,
    source_player_id: Option<&'a str>,
    metadata_json: &'a str,
    now: DbTime,
}

/// Inserts one `RaceEngineEvent` row.
async fn insert_event(conn: &mut SqliteConnection, row: MetaRow<'_>) -> Result<(), sqlx::Error> {
    let MetaRow {
        race_id,
        kind,
        tick,
        timestamp_within_race_ms,
        source_player_id,
        metadata_json,
        now,
    } = row;
    sqlx::query(
        r#"INSERT INTO "RaceEngineEvent" ("raceId", "type", "tick", "timestampWithinRaceMs",
             "sourcePlayerId", "targetPlayerId", "metadataJson", "createdAt")
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)"#,
    )
    .bind(race_id)
    .bind(kind)
    .bind(tick)
    .bind(timestamp_within_race_ms)
    .bind(source_player_id)
    .bind(metadata_json)
    .bind(now)
    .execute(conn)
    .await?;
    Ok(())
}

async fn apply_plan(
    conn: &mut SqliteConnection,
    race_id: i64,
    is_test: bool,
    config: &ResolvedRaceConfig,
    week: &SeasonWeekRow,
    plan: &ResolutionPlan,
) -> Result<(), T2Error> {
    let now = DbTime::now();
    let chaos = &plan.chaos_resolved;
    // D7/phase-3 note: the event's tick is the integer tick (`Math.ceil` of the duration).
    let chaos_tick = js_int(chaos.tick);
    insert_event(
        conn,
        MetaRow {
            race_id,
            kind: "CHAOS_RESOLVED",
            tick: chaos_tick,
            timestamp_within_race_ms: chaos.timestamp_within_race_ms,
            source_player_id: None,
            metadata_json: &chaos.metadata_json(),
            now,
        },
    )
    .await?;

    for update in &plan.participant_updates {
        sqlx::query(
            r#"UPDATE "RaceParticipant" SET "initialRank" = ?, "gotScar" = ?, "usedShield" = ?
               WHERE "raceId" = ? AND "userId" = ? AND "cloneIndex" IS NULL"#,
        )
        .bind(update.initial_rank)
        .bind(update.got_scar)
        .bind(update.used_shield)
        .bind(race_id)
        .bind(update.user_id)
        .execute(&mut *conn)
        .await?;
    }

    if let Some(season) = &plan.season {
        sqlx::query(
            r#"UPDATE "SeasonPlayer" SET "isKing" = 0, "kingStreak" = 0, "updatedAt" = ?
               WHERE "seasonId" = ? AND "isKing" = 1"#,
        )
        .bind(now)
        .bind(season.clear_kings_season_id)
        .execute(&mut *conn)
        .await?;
        for update in &season.player_updates {
            sqlx::query(
                r#"UPDATE "SeasonPlayer" SET "scars" = ?, "shields" = ?,
                     "shieldsUsed" = "shieldsUsed" + ?, "predictionPoints" = "predictionPoints" + ?,
                     "raceCount" = "raceCount" + ?, "raceWins" = "raceWins" + ?,
                     "championshipPoints" = "championshipPoints" + ?, "isKing" = ?,
                     "kingStreak" = ?, "updatedAt" = ?
                   WHERE "id" = ?"#,
            )
            .bind(update.scars)
            .bind(update.shields)
            .bind(update.shields_used_increment)
            .bind(update.prediction_points_increment)
            .bind(update.race_count_increment)
            .bind(update.race_wins_increment)
            .bind(update.championship_points_increment)
            .bind(update.is_king)
            .bind(update.king_streak)
            .bind(now)
            .bind(update.season_player_id)
            .execute(&mut *conn)
            .await?;
        }
        for update in &season.prediction_updates {
            sqlx::query(r#"UPDATE "SeasonPrediction" SET "pointsAwarded" = ? WHERE "id" = ?"#)
                .bind(update.points_awarded)
                .bind(update.prediction_id)
                .execute(&mut *conn)
                .await?;
        }
        for grant in &season.quack_grants {
            apply_quack_transaction(conn, &grant.as_input())
                .await
                .map_err(|error| T2Error::Data(format!("QP grant: {error}")))?;
        }
        if let Some(golden) = &season.golden {
            apply_quack_transaction(conn, &golden.grant.as_input())
                .await
                .map_err(|error| T2Error::Data(format!("Golden Box QP: {error}")))?;
            insert_event(
                conn,
                MetaRow {
                    race_id,
                    kind: "QP_TRACK_REWARD_GRANTED",
                    tick: golden.tick,
                    timestamp_within_race_ms: golden.timestamp_within_race_ms,
                    source_player_id: Some(&golden.source_player_id),
                    metadata_json: &golden.event_metadata_json(),
                    now,
                },
            )
            .await?;
        }
    }

    let final_state = if is_test { "ARCHIVED" } else { "RESOLVED" };
    let moved = sqlx::query(
        r#"UPDATE "Race" SET "status" = 'finished', "engineState" = ?, "videoUrl" = NULL,
             "liveSnapshotJson" = NULL, "finalVerdict" = ?, "finishedAt" = ?,
             "engineVersion" = ?, "balanceVersion" = ?, "trackVersion" = ?
           WHERE "id" = ? AND "engineState" = 'FINISHED'"#,
    )
    .bind(final_state)
    .bind(&plan.final_verdict)
    .bind(now)
    .bind(&config.engine_version)
    .bind(&config.balance_version)
    .bind(&config.track_version)
    .bind(race_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if moved != 1 {
        return Err(T2Error::Data(format!(
            "Race {race_id} is no longer in FINISHED"
        )));
    }
    if !is_test {
        sqlx::query(
            r#"UPDATE "SeasonWeek" SET "status" = 'resolved', "recap" = ?, "resolvedAt" = ?,
                 "updatedAt" = ?
               WHERE "id" = ?"#,
        )
        .bind(&plan.recap)
        .bind(now)
        .bind(now)
        .bind(week.id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// The integer tick of a JS number (`Math.ceil` already made it whole).
fn js_int(value: f64) -> i64 {
    crate::cosmetics::js::prisma_int(value).unwrap_or(0)
}
