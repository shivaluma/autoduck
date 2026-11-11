//! `POST /api/admin/season3 {action: "start-race", weekId, test?, allowOffSchedule?}`: port of
//! `startSeason3Race` (`lib/season3-race.ts`) on the Rust engine.
//!
//! In one `BEGIN IMMEDIATE` transaction: the checks (active season, `weekId`, the Monday ICT gate
//! unless `test`/`allowOffSchedule`, week status, 2–16 active ducks), the Chaos-card preflight
//! (`preflight_card`, review M1: a card that cannot resolve is refused with 409 before the race
//! runs), then the writes: auto loadouts (official only), the `Race` row (`pending`/`LOCKED`,
//! versions 2.0.0/S3.16, the race seed), its participants, the week claim (official only:
//! `locked` → `racing`), and `COUNTDOWN` with `engineConfigJson = JCS(resolved config)` and
//! `seedCommit = sha256(engineConfigJson)` (D9). After the commit the race is handed to the
//! [`LiveHub`]; the answer is `{ok: true, raceId, status: "pending"}` as in TS.
//!
//! Differences from TS (deliberate):
//! - TS's thrown errors (`Season không active`, the status and lobby-size checks) answer 500
//!   `Season 3 action failed`; here they answer 409 with the message, so the admin sees why.
//! - A slot is reserved first: shutting down, `MAX_LIVE_RACES` reached or starts blocked → 503.
//! - The preflight 409 (TS ran such races live and failed them at T2).

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use race_core::digest::create_race_commit;
use race_core::replay::engine_config_json;
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::versions;
use serde_json::{Value, json};
use sqlx::AssertSqlSafe;

use super::{LaunchSpec, LiveHub};
use crate::cosmetics::js::{prisma_int, property, stringify, truthy};
use crate::cosmetics::rows::{APPEARANCE_COLUMNS, PlayerAppearanceRow};
use crate::db::{Db, DbTime};
use crate::error::ApiError;
use crate::season3::admin::rows::{
    PlayerWithUser, load_active_season, loadouts_for_week, week_by_id,
};
use crate::season3::admin::seed::create_race_seed;
use crate::season3::is_ghost_duck;
use crate::season3::loadout::{parse_item_ids, select_auto_loadout, serialize_item_ids};
use crate::season3::payload::{
    chaos_groups_for_resolution, parse_skipped_player_ids, skipped_contains,
};
use crate::season3::resolution::{MetaPlayer, ResolutionInput, preflight_card};
use crate::season3::schedule::{assert_season3_race_day, now_ms};
use crate::season3::test_mode::{can_start_test_race, race_mode};

fn internal(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(error = %error, "Season 3 admin action failed");
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Season 3 action failed")
}

impl From<sqlx::Error> for StartError {
    fn from(error: sqlx::Error) -> Self {
        Self(internal(error))
    }
}

/// An [`ApiError`] that `?` can build from DB errors.
pub struct StartError(pub ApiError);

impl From<ApiError> for StartError {
    fn from(error: ApiError) -> Self {
        Self(error)
    }
}

fn conflict(message: impl Into<String>) -> StartError {
    StartError(ApiError::conflict(message.into()))
}

/// One immutable loadout.
struct Loadout<'a> {
    player: &'a PlayerWithUser,
    item_ids: Vec<race_protocol::ids::RaceItemId>,
    auto: bool,
}

/// Runs the action (auth already checked).
///
/// # Errors
/// The API error to answer.
pub async fn start_race(hub: &LiveHub, db: &Db, body: &Value) -> Result<Response, ApiError> {
    run(hub, db, body).await.map_err(|error| error.0)
}

#[allow(clippy::too_many_lines)]
async fn run(hub: &LiveHub, db: &Db, body: &Value) -> Result<Response, StartError> {
    let mut tx = db.begin_write().await?;
    let Some(season) = load_active_season(&mut tx).await.map_err(internal)? else {
        return Err(ApiError::not_found("Chưa có Season active").into());
    };
    let week_value = property(body, "weekId");
    if !truthy(week_value) {
        return Err(ApiError::bad_request("weekId là bắt buộc").into());
    }
    let week_id = week_value
        .and_then(Value::as_f64)
        .and_then(prisma_int)
        .ok_or_else(|| internal("Argument `id`: Invalid value provided. Expected Int"))?;
    let test_mode = property(body, "test") == Some(&Value::Bool(true));
    let allow_off_schedule =
        test_mode || property(body, "allowOffSchedule") == Some(&Value::Bool(true));
    if !allow_off_schedule && let Err(error) = assert_season3_race_day(now_ms()) {
        return Err(ApiError::forbidden(error.to_string()).into());
    }

    let week = week_by_id(&mut tx, week_id)
        .await?
        .filter(|week| week.season_id == season.season.id)
        .ok_or_else(|| conflict("Season không active"))?;
    if test_mode {
        if !can_start_test_race(&week.status) {
            return Err(conflict("Test Race chỉ chạy khi prep đang mở hoặc đã lock"));
        }
    } else if week.status != "locked" {
        return Err(conflict("Phải lock prep trước khi đua"));
    }
    let mode = race_mode(test_mode);
    let mut claimed_race_id: Option<i64> = None;
    if !test_mode && let Some(race_id) = week.race_id {
        let status: Option<String> =
            sqlx::query_scalar(r#"SELECT "status" FROM "Race" WHERE "id" = ?"#)
                .bind(race_id)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some(status) = status {
            if status != "failed" {
                return Ok(ok_response(race_id, &status));
            }
            claimed_race_id = Some(race_id);
        }
    }

    let race_seed = if test_mode {
        create_race_seed()
    } else {
        week.race_seed.clone().unwrap_or_else(create_race_seed)
    };
    let skipped = parse_skipped_player_ids(week.skipped_player_ids_json.as_deref());
    let active: Vec<&PlayerWithUser> = season
        .players
        .iter()
        .filter(|entry| !skipped_contains(&skipped, entry.player.user_id))
        .collect();
    if !(2..=16).contains(&active.len()) {
        return Err(conflict("Race cần 2–16 dzịt active"));
    }

    let stored_loadouts = loadouts_for_week(&mut tx, week.id).await?;
    let mut loadouts: Vec<Loadout<'_>> = Vec::with_capacity(active.len());
    for entry in &active {
        let ready = stored_loadouts
            .iter()
            .find(|loadout| loadout.season_player_id == entry.player.id)
            .filter(|loadout| loadout.status == "ready");
        let (item_ids, auto) = match ready {
            Some(loadout) => (
                parse_item_ids(&loadout.item_ids_json).map_err(internal)?,
                false,
            ),
            None => (
                select_auto_loadout(&race_seed, &entry.player.user_id.to_string()).to_vec(),
                true,
            ),
        };
        loadouts.push(Loadout {
            player: entry,
            item_ids,
            auto,
        });
    }

    // Review M1: a Chaos card that cannot resolve for any finish order is refused now.
    let meta_players: Vec<MetaPlayer<'_>> = season
        .players
        .iter()
        .map(|entry| MetaPlayer {
            season_player_id: entry.player.id,
            user_id: entry.player.user_id,
            name: &entry.user.name,
            scars: entry.player.scars,
            shields: entry.player.shields,
            is_king: entry.player.is_king,
            king_streak: entry.player.king_streak,
        })
        .collect();
    let configured: Vec<i64> = active.iter().map(|entry| entry.player.user_id).collect();
    preflight_card(&ResolutionInput {
        race_id: 0,
        is_test: test_mode,
        season_id: season.season.id,
        week_id: week.id,
        week_number: week.week_number,
        chaos_type: &week.chaos_type,
        chaos_target_user_id: week.chaos_target_user_id,
        chaos_target_user_id2: week.chaos_target_user_id2,
        chaos_payload: week.chaos_payload.as_deref(),
        predictions: &[],
        season_players: &meta_players,
        shield_choice_player_ids: &[],
        configured_user_ids: &configured,
        standings: &[],
        events: &[],
        duration_ms: 0.0,
        tick_rate: f64::from(versions::RACE_TICK_RATE),
    })
    .map_err(|error| conflict(format!("Chaos card không thể resolve: {error}")))?;
    let groups = chaos_groups_for_resolution(week.chaos_payload.as_deref())
        .map_err(|error| conflict(format!("Chaos card không thể resolve: {error}")))?;

    let slot = hub.reserve().map_err(|refusal| {
        StartError(ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            refusal.to_string(),
        ))
    })?;

    let now = DbTime::now();
    if mode.mutates_season {
        for loadout in loadouts.iter().filter(|loadout| loadout.auto) {
            let items = serialize_item_ids(&loadout.item_ids).map_err(internal)?;
            sqlx::query(
                r#"INSERT INTO "SeasonLoadout" ("weekId", "seasonPlayerId", "userId", "itemIdsJson", "status",
                       "lockedAt", "createdAt", "updatedAt")
                   VALUES (?, ?, ?, ?, 'auto', ?, ?, ?)
                   ON CONFLICT ("weekId", "seasonPlayerId") DO UPDATE SET "itemIdsJson" = excluded."itemIdsJson",
                       "status" = 'auto', "lockedAt" = excluded."lockedAt", "updatedAt" = excluded."updatedAt""#,
            )
            .bind(week.id)
            .bind(loadout.player.player.id)
            .bind(loadout.player.player.user_id)
            .bind(items)
            .bind(now)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
    }
    let race_id: i64 = sqlx::query_scalar(
        r#"INSERT INTO "Race" ("status", "isTest", "engineState", "protocolVersion", "engineVersion",
             "balanceVersion", "trackVersion", "raceSeed", "createdAt")
           VALUES ('pending', ?, 'LOCKED', ?, ?, ?, ?, ?, ?) RETURNING "id""#,
    )
    .bind(test_mode)
    .bind(versions::RACE_PROTOCOL_VERSION)
    .bind(versions::RACE_ENGINE_VERSION)
    .bind(versions::RACE_BALANCE_VERSION)
    .bind(versions::TRACK_VERSION)
    .bind(&race_seed)
    .bind(now)
    .fetch_one(&mut *tx)
    .await?;
    for entry in &active {
        sqlx::query(
            r#"INSERT INTO "RaceParticipant" ("raceId", "userId", "usedShield", "shieldBackfired",
                 "initialRank", "gotScar", "isClone", "displayName", "dragonEligible")
               VALUES (?, ?, 0, 0, NULL, 0, 0, ?, 1)"#,
        )
        .bind(race_id)
        .bind(entry.player.user_id)
        .bind(&entry.user.name)
        .execute(&mut *tx)
        .await?;
    }
    if mode.claims_official_week {
        let claimed = sqlx::query(
            r#"UPDATE "SeasonWeek" SET "status" = 'racing', "raceId" = ?, "updatedAt" = ?
               WHERE "id" = ? AND "status" = 'locked' AND "raceId" IS ?"#,
        )
        .bind(race_id)
        .bind(now)
        .bind(week.id)
        .bind(claimed_race_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if claimed != 1 {
            return Err(conflict("Không thể claim Season 3 week để start race"));
        }
    }

    let mut players = Vec::with_capacity(active.len());
    for entry in &active {
        let appearance: Option<PlayerAppearanceRow> = sqlx::query_as(AssertSqlSafe(format!(
            r#"SELECT {APPEARANCE_COLUMNS} FROM "PlayerAppearance" WHERE "seasonPlayerId" = ?"#
        )))
        .bind(entry.player.id)
        .fetch_optional(&mut *tx)
        .await?;
        let mut player = json!({
            "playerId": entry.player.user_id.to_string(),
            "name": entry.user.name,
            "isGhost": is_ghost_duck(&entry.user.name),
        });
        if let Some(appearance) = appearance {
            let value = serde_json::to_value(&appearance).map_err(internal)?;
            player["cosmeticKey"] = json!(stringify(&value));
        }
        players.push(player);
    }
    let mut chaos = json!({
        "type": week.chaos_type,
        "targetPlayerId": week.chaos_target_user_id.map(|id| id.to_string()),
    });
    if let Some(groups) = groups {
        chaos["groups"] = json!(groups);
    }
    let input = json!({
        "raceId": race_id.to_string(),
        "seed": race_seed,
        "protocolVersion": versions::RACE_PROTOCOL_VERSION,
        "engineVersion": versions::RACE_ENGINE_VERSION,
        "balanceVersion": versions::RACE_BALANCE_VERSION,
        "trackVersion": versions::TRACK_VERSION,
        "pickupSpawnVersion": versions::PICKUP_SPAWN_VERSION,
        "hazardBalanceVersion": versions::HAZARD_BALANCE_VERSION,
        "tickRate": versions::RACE_TICK_RATE,
        "players": players,
        "loadouts": loadouts.iter().map(|loadout| json!({
            "playerId": loadout.player.player.user_id.to_string(),
            "itemIds": loadout.item_ids.iter().map(|item| item.as_str()).collect::<Vec<_>>(),
            "source": if loadout.auto { "AUTO" } else { "PLAYER" },
        })).collect::<Vec<_>>(),
        "chaosConfig": chaos,
        "pickupConfig": {
            "enabled": true,
            "goldenBoxEnabled": true,
            "goldenBoxProbability": 0.15,
            "hazardsEnabled": true,
            "positionAwareLoot": true,
            "spawnMultiplier": 1.25,
            "regularPickupCap": 3,
            "manualItemsEnabled": true,
            "autoItemsEnabled": true,
            "chaosBoxEnabled": false,
            "forceGoldenBox": false,
            "disabledItems": [],
            "idealManualPlayerIds": [],
        },
    });
    let config: ResolvedRaceConfig = serde_json::from_value::<RaceConfigInput>(input)
        .map_err(internal)?
        .resolve()
        .map_err(|error| internal(format!("race config: {error:?}")))?;
    let engine_config = engine_config_json(&config).map_err(internal)?;
    let seed_commit = create_race_commit(engine_config.as_bytes());
    sqlx::query(
        r#"UPDATE "Race" SET "engineState" = 'COUNTDOWN', "engineConfigJson" = ?, "seedCommit" = ?
           WHERE "id" = ?"#,
    )
    .bind(&engine_config)
    .bind(&seed_commit)
    .bind(race_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    tracing::info!(
        target: "audit",
        race = race_id,
        week = week.id,
        test = test_mode,
        seed_commit = %seed_commit,
        "race started"
    );
    hub.launch(
        slot,
        LaunchSpec {
            race_id,
            week_id: week.id,
            is_test: test_mode,
            config,
            engine_config_json: engine_config,
        },
    );
    Ok(ok_response(race_id, "pending"))
}

fn ok_response(race_id: i64, status: &str) -> Response {
    Json(json!({ "ok": true, "raceId": race_id, "status": status })).into_response()
}
