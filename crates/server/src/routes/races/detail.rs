//! `GET /api/races/{id}`: port of `app/api/races/[id]/route.ts` on `main`.
//!
//! The body is byte-identical to what `NextResponse.json` sends: same keys in the same order,
//! the stored JSON columns re-serialised like `JSON.stringify(JSON.parse(text))`
//! ([`super::js_json`]), dates as `Date#toISOString()`, and rows in the order Prisma's queries
//! return them. Each query below has the table, `WHERE` and `ORDER BY` of the one Prisma 7 runs
//! for the route's `findUnique`/`include`, and selects a column outside every index just as
//! Prisma's `SELECT <all columns>` does, so SQLite picks the same plan and ties come back in the
//! same order. Related users are joined by id (`userId`, `predictorUserId`,
//! `targetUserId`), never by name.
//!
//! - `engine.replay` (plan §4.6, `replayInfo` on `main`): `mode: "track"` with the track and
//!   geometry URLs only for a `finished` race whose `RaceReplayTrack` has a `byteSha256` and is
//!   not `UNAVAILABLE`; `verify` is always `"none"`. `engine.postRaceStats` is the stored
//!   `statsJson` of a finished race (`parseJsonOr(…, null)`).
//! - Events come in emission order (`ORDER BY id`): meta events (`CHAOS_RESOLVED`,
//!   `QP_TRACK_REWARD_GRANTED`) last.
//! - Stored JSON is read like `parseJsonOr`: an empty or unparsable `engineConfigJson` is `null`,
//!   an empty or unparsable `metadataJson` is `{}`.
//! - `engine.seed`/`engine.config` follow `publicRaceEngineVisibility` (`lib/racing/public-engine.ts`):
//!   revealed only while the race is `pending`, `running` or `finished`; `engine.players` always
//!   comes from the stored config.
//! - `engine.liveTick`/`engine.liveManualInputs`: this server has no in-memory live race session
//!   yet (stage A), so they are what TS returns when `getLiveRaceSession` finds none: `null`/`[]`.
//! - The legacy v2 keys (`consumedChests`, `awardedChests`, `dragonAward`, `dragonScaleEvents`)
//!   are constants, as on `main`.
//! - Errors: a non-canonical id → 400 `Invalid race ID`; no row, or an id above 2^31 − 1 → 404
//!   `Race not found`; anything that throws in TS (a DB error) → 500 `Failed to fetch race`.

use std::collections::BTreeMap;

use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use sqlx::SqliteConnection;

use super::{RaceIdParam, js_json, parse_race_id};
use crate::auth::player::QueryToken;
use crate::db::DbTime;
use crate::error::ApiError;
use crate::http::AppState;

pub async fn get(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
    QueryToken(token): QueryToken,
) -> Response {
    // A segment axum can't decode (invalid UTF-8 after percent-decoding) can't be a number.
    let segment = match path {
        Ok(Path(segment)) => segment,
        Err(_) => return invalid_id(),
    };
    let race_id = match parse_race_id(&segment) {
        RaceIdParam::Invalid => return invalid_id(),
        RaceIdParam::NotFound => return ApiError::not_found("Race not found").into_response(),
        RaceIdParam::Id(id) => id,
    };
    match load(&state, race_id, token.as_deref()).await {
        Ok(Some(body)) => json_response(StatusCode::OK, body),
        Ok(None) => ApiError::not_found("Race not found").into_response(),
        Err(error) => failed(&error),
    }
}

fn invalid_id() -> Response {
    ApiError::bad_request("Invalid race ID").into_response()
}

/// TS `catch`: logs and answers `{ error: 'Failed to fetch race' }`, 500.
fn failed(error: &dyn std::fmt::Display) -> Response {
    tracing::error!(%error, "failed to fetch race");
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Failed to fetch race").into_response()
}

fn json_response(status: StatusCode, body: String) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

#[derive(Debug, thiserror::Error)]
enum LoadError {
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error("cannot parse {what}: {source}")]
    Json {
        what: &'static str,
        source: serde_json::Error,
    },
    #[error("{0} references missing user {1}")]
    MissingUser(&'static str, i64),
}

struct RaceRow {
    id: i64,
    status: String,
    video_url: Option<String>,
    final_verdict: Option<String>,
    created_at: DbTime,
    finished_at: Option<DbTime>,
    engine_state: String,
    protocol_version: Option<String>,
    engine_version: Option<String>,
    balance_version: Option<String>,
    track_version: Option<String>,
    seed_commit: Option<String>,
    race_seed: Option<String>,
    engine_config_json: Option<String>,
    result_digest: Option<String>,
}

struct ParticipantRow {
    user_id: i64,
    used_shield: bool,
    shield_id: Option<i64>,
    shield_charges_at_start: Option<i64>,
    shield_backfired: bool,
    initial_rank: Option<i64>,
    got_scar: bool,
    is_clone: bool,
    clone_of_user_id: Option<i64>,
    clone_index: Option<i64>,
    display_name: Option<String>,
    chest_effect: Option<String>,
    chest_target_user_id: Option<i64>,
    dragon_eligible: bool,
}

struct EventRow {
    event_type: String,
    tick: i64,
    timestamp_within_race_ms: f64,
    source_player_id: Option<String>,
    target_player_id: Option<String>,
    metadata_json: String,
}

struct ReplayTrackRow {
    fidelity: String,
    engine_version: String,
    balance_version: String,
    track_geometry: Option<String>,
    byte_sha256: Option<String>,
    stats_json: Option<String>,
}

struct PredictionRow {
    predictor_player_id: i64,
    predictor_user_id: i64,
    target_user_id: i64,
    points_awarded: i64,
}

#[derive(Clone)]
struct UserRow {
    name: String,
    avatar_url: Option<String>,
    shields: i64,
}

/// The JSON body, or `None` when the race doesn't exist.
async fn load(
    state: &AppState,
    race_id: i64,
    token: Option<&str>,
) -> Result<Option<String>, LoadError> {
    // One read transaction: a consistent snapshot, and no network wait inside it.
    let mut tx = state.db().reader.begin().await?;
    let conn: &mut SqliteConnection = &mut tx;

    let viewer = match token {
        Some(token) => viewer_by_token(conn, token).await?,
        None => None,
    };

    let Some(race) = sqlx::query_as!(
        RaceRow,
        r#"SELECT "id" AS "id!: i64", "status" AS "status!", "videoUrl" AS "video_url?",
                  "finalVerdict" AS "final_verdict?", "createdAt" AS "created_at!: DbTime",
                  "finishedAt" AS "finished_at?: DbTime", "engineState" AS "engine_state!",
                  "protocolVersion" AS "protocol_version?", "engineVersion" AS "engine_version?",
                  "balanceVersion" AS "balance_version?", "trackVersion" AS "track_version?",
                  "seedCommit" AS "seed_commit?", "raceSeed" AS "race_seed?",
                  "engineConfigJson" AS "engine_config_json?", "resultDigest" AS "result_digest?"
           FROM "Race" WHERE "id" = ? LIMIT 1"#,
        race_id
    )
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };

    let participants = sqlx::query_as!(
        ParticipantRow,
        r#"SELECT "userId" AS "user_id!: i64", "usedShield" AS "used_shield!: bool",
                  "shieldId" AS "shield_id?: i64",
                  "shieldChargesAtStart" AS "shield_charges_at_start?: i64",
                  "shieldBackfired" AS "shield_backfired!: bool",
                  "initialRank" AS "initial_rank?: i64", "gotScar" AS "got_scar!: bool",
                  "isClone" AS "is_clone!: bool", "cloneOfUserId" AS "clone_of_user_id?: i64",
                  "cloneIndex" AS "clone_index?: i64", "displayName" AS "display_name?",
                  "chestEffect" AS "chest_effect?",
                  "chestTargetUserId" AS "chest_target_user_id?: i64",
                  "dragonEligible" AS "dragon_eligible!: bool"
           FROM "RaceParticipant" WHERE "raceId" = ? ORDER BY "initialRank" ASC"#,
        race_id
    )
    .fetch_all(&mut *conn)
    .await?;

    let commentaries = sqlx::query!(
        r#"SELECT "timestamp" AS "timestamp!: i64", "content" AS "content!"
           FROM "CommentaryLog" WHERE "raceId" = ? ORDER BY "timestamp" ASC"#,
        race_id
    )
    .fetch_all(&mut *conn)
    .await?;

    let events = sqlx::query_as!(
        EventRow,
        r#"SELECT "type" AS "event_type!", "tick" AS "tick!: i64",
                  "timestampWithinRaceMs" AS "timestamp_within_race_ms!: f64",
                  "sourcePlayerId" AS "source_player_id?", "targetPlayerId" AS "target_player_id?",
                  "metadataJson" AS "metadata_json!"
           FROM "RaceEngineEvent" WHERE "raceId" = ? ORDER BY "id" ASC"#,
        race_id
    )
    .fetch_all(&mut *conn)
    .await?;

    let replay_track = sqlx::query_as!(
        ReplayTrackRow,
        r#"SELECT "fidelity" AS "fidelity!", "engineVersion" AS "engine_version!",
                  "balanceVersion" AS "balance_version!", "trackGeometry" AS "track_geometry?",
                  "byteSha256" AS "byte_sha256?", "statsJson" AS "stats_json?"
           FROM "RaceReplayTrack" WHERE "raceId" = ? LIMIT 1"#,
        race_id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let week_id = sqlx::query_scalar!(
        r#"SELECT "id" AS "id!: i64" FROM "SeasonWeek" WHERE "raceId" = ? LIMIT 1"#,
        race_id
    )
    .fetch_optional(&mut *conn)
    .await?;

    let predictions = match week_id {
        // Prisma loads a relation with `IN (…)` and no ORDER BY; keep that shape so SQLite
        // returns the predictions in the same order.
        Some(week_id) => {
            sqlx::query_as!(
                PredictionRow,
                r#"SELECT "predictorPlayerId" AS "predictor_player_id!: i64",
                          "predictorUserId" AS "predictor_user_id!: i64",
                          "targetUserId" AS "target_user_id!: i64",
                          "pointsAwarded" AS "points_awarded!: i64"
                   FROM "SeasonPrediction" WHERE "weekId" IN (?)"#,
                week_id
            )
            .fetch_all(&mut *conn)
            .await?
        }
        None => Vec::new(),
    };

    let user_ids: Vec<i64> = participants
        .iter()
        .map(|p| p.user_id)
        .chain(
            predictions
                .iter()
                .flat_map(|p| [p.predictor_user_id, p.target_user_id]),
        )
        .collect();
    let users = users_by_id(conn, &user_ids).await?;
    tx.commit().await?;

    let user = |what: &'static str, id: i64| {
        users
            .get(&id)
            .cloned()
            .ok_or(LoadError::MissingUser(what, id))
    };

    // `parseJsonOr(race.engineConfigJson, null)`: never Zod-parsed, so configs of other engine
    // versions are served as stored.
    let engine_config = parse_json_or(race.engine_config_json.as_deref(), Value::Null);

    let engine = match race.engine_version.as_deref() {
        Some(version) if !version.is_empty() => {
            let reveal = matches!(race.status.as_str(), "pending" | "running" | "finished");
            let mut event_values = Vec::with_capacity(events.len());
            for event in &events {
                let metadata = parse_json_or(Some(&event.metadata_json), json!({}));
                event_values.push(json!({
                    "raceId": race.id.to_string(),
                    "type": event.event_type,
                    "tick": event.tick,
                    "timestampWithinRaceMs": event.timestamp_within_race_ms,
                    "sourcePlayerId": event.source_player_id,
                    "targetPlayerId": event.target_player_id,
                    "metadata": metadata,
                }));
            }
            json!({
                "state": race.engine_state,
                "protocolVersion": race.protocol_version,
                "engineVersion": race.engine_version,
                "balanceVersion": race.balance_version,
                "trackVersion": race.track_version,
                "seedCommit": race.seed_commit,
                "seed": if reveal { json!(race.race_seed) } else { Value::Null },
                "config": if reveal { engine_config.clone() } else { Value::Null },
                "players": config_field(&engine_config, "players").unwrap_or_else(|| json!([])),
                "chaosConfig": config_field(&engine_config, "chaosConfig").unwrap_or(Value::Null),
                "loadouts": config_field(&engine_config, "loadouts").unwrap_or_else(|| json!([])),
                // No live session in this server yet: `liveTick` is null and
                // `liveManualInputs` empty, as TS returns when no session exists.
                "liveTick": Value::Null,
                "liveManualInputs": [],
                "resultDigest": race.result_digest,
                "replay": replay_info(race.id, &race.status, replay_track.as_ref()),
                "postRaceStats": if race.status == "finished" {
                    parse_json_or(
                        replay_track.as_ref().and_then(|t| t.stats_json.as_deref()),
                        Value::Null,
                    )
                } else {
                    Value::Null
                },
                "events": event_values,
            })
        }
        _ => Value::Null,
    };

    let mut participant_values = Vec::with_capacity(participants.len());
    for p in &participants {
        let u = user("RaceParticipant.userId", p.user_id)?;
        let is_thomas = u.name == "Thomas";
        participant_values.push(json!({
            "userId": p.user_id,
            "name": u.name,
            "displayName": p.display_name,
            "avatarUrl": u.avatar_url,
            "usedShield": p.used_shield,
            "shieldId": p.shield_id,
            "shieldChargesAtStart": p.shield_charges_at_start,
            "shieldBackfired": p.shield_backfired,
            "initialRank": p.initial_rank,
            "gotScar": p.got_scar,
            // lib/immortal-duck.ts and lib/ghost-duck.ts
            "isImmortal": is_thomas || u.shields >= 9999,
            "isGhost": is_thomas,
            "isClone": p.is_clone,
            "cloneOfUserId": p.clone_of_user_id,
            "cloneIndex": p.clone_index,
            "chestEffect": p.chest_effect,
            "chestTargetUserId": p.chest_target_user_id,
            "dragonEligible": p.dragon_eligible,
        }));
    }

    let commentary_values: Vec<Value> = commentaries
        .iter()
        .map(|c| json!({ "timestamp": c.timestamp, "content": c.content }))
        .collect();

    let season_prediction = match (&viewer, week_id) {
        (Some(viewer), Some(_)) => {
            match predictions
                .iter()
                .find(|p| p.predictor_player_id == viewer.player_id)
            {
                Some(p) => {
                    let target = user("SeasonPrediction.targetUserId", p.target_user_id)?;
                    json!({
                        "predictorName": viewer.name,
                        "targetUserId": p.target_user_id,
                        "targetName": target.name,
                        "targetAvatarUrl": target.avatar_url,
                        "pointsAwarded": p.points_awarded,
                    })
                }
                None => Value::Null,
            }
        }
        _ => Value::Null,
    };

    let mut season_predictions = Vec::new();
    if race.status == "finished" && week_id.is_some() {
        for p in &predictions {
            let predictor = user("SeasonPrediction.predictorUserId", p.predictor_user_id)?;
            let target = user("SeasonPrediction.targetUserId", p.target_user_id)?;
            season_predictions.push(json!({
                "predictorName": predictor.name,
                "targetUserId": p.target_user_id,
                "targetName": target.name,
                "targetAvatarUrl": target.avatar_url,
                "pointsAwarded": p.points_awarded,
            }));
        }
    } else {
        // Prisma still loads every prediction's users; a dangling one throws there too.
        for p in &predictions {
            user("SeasonPrediction.predictorUserId", p.predictor_user_id)?;
            user("SeasonPrediction.targetUserId", p.target_user_id)?;
        }
    }

    let body = json!({
        "id": race.id,
        "status": race.status,
        "videoUrl": race.video_url,
        "finalVerdict": race.final_verdict,
        "createdAt": race.created_at.to_iso_string(),
        "finishedAt": race.finished_at.map(DbTime::to_iso_string),
        "engine": engine,
        // Legacy v2 keys (chests, dragon) were removed; kept as constants so older clients
        // don't break.
        "consumedChests": [],
        "awardedChests": [],
        "dragonAward": Value::Null,
        "dragonScaleEvents": [],
        "participants": participant_values,
        "commentaries": commentary_values,
        "seasonPrediction": season_prediction,
        "seasonPredictions": season_predictions,
    });
    Ok(Some(js_json::stringify(&body)))
}

/// `parseJsonOr(value, fallback)` (`app/api/races/[id]/route.ts`): the fallback for `null`, `""`
/// or text `JSON.parse` rejects.
///
/// `serde_json` also rejects two inputs `JSON.parse` accepts (a number outside f64, e.g. `1e400`,
/// and a lone surrogate escape); they read as the fallback here. No writer stores either.
fn parse_json_or(value: Option<&str>, fallback: Value) -> Value {
    match value {
        Some(text) if !text.is_empty() => js_json::parse(text).unwrap_or(fallback),
        _ => fallback,
    }
}

/// `replayInfo(raceId, status, track)` (`app/api/races/[id]/route.ts`, plan §4.6).
fn replay_info(race_id: i64, status: &str, track: Option<&ReplayTrackRow>) -> Value {
    let playable = track
        .filter(|t| status == "finished" && t.byte_sha256.is_some() && t.fidelity != "UNAVAILABLE");
    let sha = playable.and_then(|t| t.byte_sha256.as_deref());
    json!({
        "mode": if playable.is_some() { "track" } else { "none" },
        "fidelity": track.map(|t| t.fidelity.as_str()),
        "trackUrl": sha.map(|sha| format!("/api/races/{race_id}/track?h={sha}")),
        "geometryUrl": playable.and_then(|t| track_geometry_url(t.track_geometry.as_deref())),
        "engineVersion": track.map(|t| t.engine_version.as_str()),
        "balanceVersion": track.map(|t| t.balance_version.as_str()),
        "byteSha256": sha,
        "verify": "none",
    })
}

/// `trackGeometryUrl` (`src/race/polyline-track.ts`): `/race-tracks/<id>.json` when the id
/// matches `/^[A-Za-z0-9._-]+@[0-9a-f]{8}$/`, else `None`.
pub fn track_geometry_url(track_geometry: Option<&str>) -> Option<String> {
    let id = track_geometry?;
    let (name, sha8) = id.rsplit_once('@')?;
    let name_ok = !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    let sha_ok = sha8.len() == 8 && sha8.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    (name_ok && sha_ok).then(|| format!("/race-tracks/{id}.json"))
}

/// `config?.<key> ?? <default>`: `None` when the config isn't an object, lacks the key, or holds
/// `null` there.
fn config_field(config: &Value, key: &str) -> Option<Value> {
    config
        .as_object()?
        .get(key)
        .filter(|v| !v.is_null())
        .cloned()
}

struct Viewer {
    player_id: i64,
    name: String,
}

/// `prisma.seasonPlayer.findUnique({ where: { accessToken: token }, include: { user: true } })`.
async fn viewer_by_token(
    conn: &mut SqliteConnection,
    token: &str,
) -> Result<Option<Viewer>, LoadError> {
    let Some(player) = crate::auth::player::find_player_by_token(&mut *conn, token).await? else {
        return Ok(None);
    };
    let users = users_by_id(conn, &[player.user_id]).await?;
    let user = users.get(&player.user_id).ok_or(LoadError::MissingUser(
        "SeasonPlayer.userId",
        player.user_id,
    ))?;
    Ok(Some(Viewer {
        player_id: player.id,
        name: user.name.clone(),
    }))
}

async fn users_by_id(
    conn: &mut SqliteConnection,
    ids: &[i64],
) -> Result<BTreeMap<i64, UserRow>, LoadError> {
    let mut users = BTreeMap::new();
    if ids.is_empty() {
        return Ok(users);
    }
    let mut unique = ids.to_vec();
    unique.sort();
    unique.dedup();
    let ids_json = serde_json::to_string(&unique).map_err(|source| LoadError::Json {
        what: "user ids",
        source,
    })?;
    let rows = sqlx::query!(
        r#"SELECT "id" AS "id!: i64", "name" AS "name!", "avatarUrl" AS "avatar_url?",
                  "shields" AS "shields!: i64"
           FROM "User" WHERE "id" IN (SELECT "value" FROM json_each(?))"#,
        ids_json
    )
    .fetch_all(&mut *conn)
    .await?;
    for row in rows {
        users.insert(
            row.id,
            UserRow {
                name: row.name,
                avatar_url: row.avatar_url,
                shields: row.shields,
            },
        );
    }
    Ok(users)
}
