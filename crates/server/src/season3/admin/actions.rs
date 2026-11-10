//! `POST /api/admin/season3` actions (port of the POST handler of
//! `app/api/admin/season3/route.ts`), except `start-race`, which needs the engine (Phase 5) and
//! answers `501 {"error":"not in stage B"}` here.
//!
//! Every action runs in one `BEGIN IMMEDIATE` transaction on the single writer (D15): the reads
//! the TS handler makes before its writes happen inside the same transaction, so no other
//! request can slip in between (TS reads outside its transactions). For serial requests this is
//! not observable.
//!
//! Errors follow the TS handler: explicit failures answer `{ "error": … }` with their status;
//! anything thrown inside its try/catch (a Prisma validation error, a constraint violation, a
//! `TypeError`) answers `500 {"error":"Season 3 action failed"}` ([`ActionError::Internal`]).
//!
//! JS/Prisma coercions on the request body:
//! - truthiness checks (`!body.weekId`) use JS truthiness;
//! - a value given to a Prisma `Int` argument must be a JS number and is truncated
//!   ([`super::js::int_arg`]); anything else is a validation error (500);
//! - `=== userId` comparisons are numeric equality on doubles;
//! - `Math.max(1, body.weeks ?? 12)` uses `ToNumber`.
//!
//! `reseed-week` is new (plan Phase 3, risk R24): allowed only when the week is `locked` with no
//! race attached, and the latest official race run with its current seed `failed`. It draws a
//! new race seed, appends the old one to `SeasonWeek.previousRaceSeeds` (JSON array), re-rolls
//! the auto loadouts from the new seed (as `lock` does) and logs an audit line with seed
//! commitments (never the seeds). The column is schema 0.8 (`ea1dc1e` on main), which the
//! verifier requires, so it always exists here.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use race_core::rng::create_race_rng;
use serde::Serialize;
use serde_json::Value;
use sqlx::{AssertSqlSafe, SqliteConnection};

use super::js::{JsNum, equals_id, int_arg, int_from_number, max_one, number, to_number};
use super::rows::{
    ActiveSeason, PlayerWithUser, SeasonLoadoutRow, SeasonWeekRow, load_active_season,
    loadouts_for_week, reload_season, reload_week, week_by_id,
};
use super::seed::{chaos_clock_ms, create_race_seed, seed_commit};
use crate::cosmetics::ids::uuid_v4;
use crate::cosmetics::inventory::grant_starter_cosmetics;
use crate::cosmetics::js::{self, prisma_int, property, truthy};
use crate::cosmetics::rows::{
    SEASON_PLAYER_COLUMNS, SeasonPlayerRow, SeasonRow, USER_COLUMNS, UserRow, placeholders,
};
use crate::db::{Db, DbTime};
use crate::error::ApiError;
use crate::season3::cards::{
    ChaosType, Season3Player, parse_chaos_type, prepare_chaos_card, select_chaos_card,
    toggle_skip_chaos_card,
};
use crate::season3::loadout::auto_loadout_json;
use crate::season3::payload::{
    chaos_payload, chaos_payload_value, parse_skipped_player_ids, skipped_contains,
    skipped_ids_json,
};
use crate::season3::resolve::{ChampionCandidate, select_champion};
use crate::season3::{DEFAULT_SEASON_NAME, DEFAULT_SEASON3_REWARDS, SEASON3_KEY};

/// Why an action did not succeed.
#[derive(Debug)]
pub enum ActionError {
    /// `return fail(message, status)`.
    Fail(ApiError),
    /// Thrown inside the handler's try/catch: `500 {"error":"Season 3 action failed"}`.
    Internal(anyhow::Error),
}

impl From<sqlx::Error> for ActionError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(error.into())
    }
}

impl From<anyhow::Error> for ActionError {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }
}

impl ActionError {
    /// The HTTP answer, logging internal errors as TS does (`console.error`).
    #[must_use]
    pub fn into_api_error(self) -> ApiError {
        match self {
            Self::Fail(error) => error,
            Self::Internal(error) => {
                tracing::error!(error = %format!("{error:#}"), "Season 3 admin action failed");
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Season 3 action failed")
            }
        }
    }
}

type ActionResult = Result<Response, ActionError>;

fn fail(status: StatusCode, message: impl Into<std::borrow::Cow<'static, str>>) -> ActionError {
    ActionError::Fail(ApiError::new(status, message))
}

fn bad_request(message: impl Into<std::borrow::Cow<'static, str>>) -> ActionError {
    fail(StatusCode::BAD_REQUEST, message)
}

fn internal(message: impl std::fmt::Display) -> ActionError {
    ActionError::Internal(anyhow::anyhow!("{message}"))
}

fn ok_json(body: &impl Serialize) -> Response {
    Json(body).into_response()
}

#[derive(Serialize)]
struct WeekBody {
    ok: bool,
    week: SeasonWeekRow,
}

fn week_response(week: SeasonWeekRow) -> Response {
    ok_json(&WeekBody { ok: true, week })
}

/// The `{ userId, name }` lobby the Chaos draws see, in `season.players` order.
fn card_players<'a>(players: &[&'a PlayerWithUser]) -> Vec<Season3Player<'a>> {
    players
        .iter()
        .map(|entry| Season3Player {
            user_id: entry.player.user_id,
            name: &entry.user.name,
        })
        .collect()
}

/// A Prisma `Int` lookup argument (`findUnique({ where: { id: body.weekId } })`): a JS number,
/// truncated; anything else (or a number outside i64) is a validation error.
fn lookup_id(value: Option<&Value>) -> Result<i64, ActionError> {
    number(value)
        .and_then(prisma_int)
        .ok_or_else(|| internal("Argument `id`: Invalid value provided. Expected Int"))
}

/// `body.weekId ? findUnique(body.weekId) : fallback`.
async fn week_or(
    conn: &mut SqliteConnection,
    body: &Value,
    fallback: impl FnOnce() -> Option<SeasonWeekRow>,
) -> Result<Option<SeasonWeekRow>, ActionError> {
    let value = property(body, "weekId");
    if truthy(value) {
        Ok(week_by_id(conn, lookup_id(value)?).await?)
    } else {
        Ok(fallback())
    }
}

/// `chaosRng.next()` as the `random` callback.
fn rng_fn(rng: &mut race_core::rng::DeterministicRng) -> impl FnMut() -> f64 + '_ {
    || rng.next_f64()
}

/// Runs one admin action. `body` is the parsed request body (authorisation already checked).
///
/// # Errors
/// See [`ActionError`].
pub async fn run(db: &Db, body: &Value) -> ActionResult {
    // `body.action` on a `null` body throws a TypeError inside the try block.
    if body.is_null() {
        return Err(internal(
            "Cannot read properties of null (reading 'action')",
        ));
    }
    let action = property(body, "action").and_then(Value::as_str);
    let mut tx = db.begin_write().await?;
    if action == Some("create-season") {
        let response = create_season(&mut tx, body).await?;
        tx.commit().await?;
        return Ok(response);
    }
    let Some(season) = load_active_season(&mut tx).await? else {
        return Err(fail(StatusCode::NOT_FOUND, "Chưa có Season active"));
    };
    let response = match action {
        Some("start-race") => {
            if !truthy(property(body, "weekId")) {
                return Err(bad_request("weekId là bắt buộc"));
            }
            // Needs the engine: Phase 5 (plan Phase 3 stage B leaves it out).
            return Err(fail(StatusCode::NOT_IMPLEMENTED, "not in stage B"));
        }
        Some("open-week") => open_week(&mut tx, body, &season).await?,
        Some("extend-season") => extend_season(&mut tx, body, &season).await?,
        Some("set-chaos") => set_chaos(&mut tx, body, &season).await?,
        Some("toggle-skip") => toggle_skip(&mut tx, body, &season).await?,
        Some("lock") => lock(&mut tx, body, &season).await?,
        Some("unlock") => unlock(&mut tx, body, &season).await?,
        Some("end-season") => end_season(&mut tx, body, &season).await?,
        Some("reseed-week") => reseed_week(&mut tx, body, &season).await?,
        _ => return Err(bad_request("Unknown Season 3 admin action")),
    };
    tx.commit().await?;
    Ok(response)
}

// ---------------------------------------------------------------------------------------------
// create-season

/// `body.userIds?.length ? { id: { in: body.userIds } } : all`.
fn user_id_filter(value: Option<&Value>) -> Result<Option<Vec<i64>>, ActionError> {
    let invalid = || internal("Argument `in`: Invalid value provided. Expected Int list");
    match value {
        Some(Value::Array(items)) if !items.is_empty() => items
            .iter()
            .map(|item| number(Some(item)).and_then(prisma_int).ok_or_else(invalid))
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(Value::String(text)) if !text.is_empty() => Err(invalid()),
        Some(Value::Object(map)) if truthy(map.get("length")) => Err(invalid()),
        _ => Ok(None),
    }
}

/// `body.<key> ?? fallback` for a Prisma `String` argument.
fn string_arg(body: &Value, key: &str, fallback: &str) -> Result<String, ActionError> {
    match property(body, key) {
        None | Some(Value::Null) => Ok(fallback.to_owned()),
        Some(Value::String(text)) => Ok(text.clone()),
        Some(_) => Err(internal(format!(
            "Argument `{key}`: Invalid value provided. Expected String"
        ))),
    }
}

/// `new Date().getFullYear()`. The production container runs in UTC (no `TZ`), so this is the
/// UTC year.
fn current_year() -> i64 {
    DbTime::now().to_iso_string()[..4].parse().unwrap_or(1970)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedSeason {
    ok: bool,
    season_id: i64,
    week_id: Option<i64>,
    players: Vec<CreatedPlayer>,
}

#[derive(Serialize)]
struct CreatedPlayer {
    name: String,
    token: String,
}

async fn create_season(conn: &mut SqliteConnection, body: &Value) -> ActionResult {
    if super::rows::active_season(conn).await?.is_some() {
        return Err(fail(StatusCode::CONFLICT, "Đã có Season active"));
    }
    let users: Vec<UserRow> = match user_id_filter(property(body, "userIds"))? {
        Some(ids) => {
            let sql = format!(
                r#"SELECT {USER_COLUMNS} FROM "User" WHERE "User"."id" IN ({}) ORDER BY "User"."name" ASC LIMIT ? OFFSET ?"#,
                placeholders(ids.len())
            );
            let mut query = sqlx::query_as::<_, UserRow>(AssertSqlSafe(sql));
            for id in &ids {
                query = query.bind(*id);
            }
            query.bind(-1_i64).bind(0_i64).fetch_all(&mut *conn).await?
        }
        None => {
            sqlx::query_as::<_, UserRow>(AssertSqlSafe(format!(
                r#"SELECT {USER_COLUMNS} FROM "User" WHERE 1=1 ORDER BY "User"."name" ASC LIMIT ? OFFSET ?"#
            )))
            .bind(-1_i64)
            .bind(0_i64)
            .fetch_all(&mut *conn)
            .await?
        }
    };
    if users.len() < 2 {
        return Err(bad_request("Season cần ít nhất 2 players"));
    }
    let chaos_seed = create_race_seed();
    let mut chaos_rng = create_race_rng(&chaos_seed, "chaos:week:1");
    let lobby: Vec<Season3Player<'_>> = users
        .iter()
        .map(|user| Season3Player {
            user_id: user.id,
            name: &user.name,
        })
        .collect();
    let chaos = select_chaos_card(&lobby, &mut rng_fn(&mut chaos_rng)).map_err(internal)?;

    let key = string_arg(body, "key", SEASON3_KEY)?;
    let name = string_arg(body, "name", DEFAULT_SEASON_NAME)?;
    let year = match property(body, "year") {
        None | Some(Value::Null) => current_year(),
        value => int_arg(value).ok_or_else(|| internal("Argument `year`: Expected Int"))?,
    };
    let weeks = match property(body, "weeks") {
        None | Some(Value::Null) => 12,
        Some(value) => int_from_number(max_one(to_number(value)))
            .ok_or_else(|| internal("Argument `weeks`: Expected Int"))?,
    };

    let now = DbTime::now();
    let season_id: i64 = sqlx::query_scalar(
        r#"INSERT INTO "Season" ("key", "name", "year", "weeks", "status", "createdAt")
           VALUES (?, ?, ?, ?, 'active', ?) RETURNING "id""#,
    )
    .bind(&key)
    .bind(&name)
    .bind(year)
    .bind(weeks)
    .bind(now)
    .fetch_one(&mut *conn)
    .await?;
    for user in &users {
        sqlx::query(
            r#"INSERT INTO "SeasonPlayer" ("seasonId", "userId", "accessToken", "scars", "shields",
                   "shieldsUsed", "predictionPoints", "kingStreak", "isKing", "raceWins", "raceCount",
                   "championshipPoints", "quackPoints", "rarePity", "epicPity", "legendaryPity",
                   "cosmeticsOnboarded", "createdAt", "updatedAt")
               VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, ?)"#,
        )
        .bind(season_id)
        .bind(user.id)
        .bind(uuid_v4())
        .bind(now)
        .bind(now)
        .execute(&mut *conn)
        .await?;
    }
    for reward in &DEFAULT_SEASON3_REWARDS {
        sqlx::query(
            r#"INSERT INTO "SeasonReward" ("seasonId", "key", "name", "cost", "stock", "active", "createdAt")
               VALUES (?, ?, ?, ?, ?, 1, ?)"#,
        )
        .bind(season_id)
        .bind(reward.key)
        .bind(reward.name)
        .bind(reward.cost)
        .bind(reward.stock)
        .bind(now)
        .execute(&mut *conn)
        .await?;
    }
    let week_id: i64 = sqlx::query_scalar(
        r#"INSERT INTO "SeasonWeek" ("seasonId", "weekNumber", "status", "chaosType", "chaosTargetUserId",
               "chaosTargetUserId2", "chaosPayload", "chaosRevealedAt", "chaosSeed", "createdAt", "updatedAt")
           VALUES (?, 1, 'open', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING "id""#,
    )
    .bind(season_id)
    .bind(chaos.chaos_type.as_str())
    .bind(chaos.target_user_id)
    .bind(chaos.target_user_id2)
    .bind(chaos_payload(chaos.groups.as_deref()))
    .bind(now)
    .bind(&chaos_seed)
    .bind(now)
    .bind(now)
    .fetch_one(&mut *conn)
    .await?;

    // `include: { players: { include: { user: true } } }` reads the players back in SQLite's
    // order for `seasonId = ?`; starter cosmetics and the response follow it.
    let created: Vec<SeasonPlayerRow> = sqlx::query_as(AssertSqlSafe(format!(
        r#"SELECT {SEASON_PLAYER_COLUMNS} FROM "SeasonPlayer" WHERE "SeasonPlayer"."seasonId" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(season_id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(&mut *conn)
    .await?;
    for player in &created {
        grant_starter_cosmetics(conn, player.id).await?;
    }
    let players = created
        .into_iter()
        .map(|player| {
            let name = users
                .iter()
                .find(|user| user.id == player.user_id)
                .map(|user| user.name.clone())
                .ok_or_else(|| internal("created player without a user"))?;
            Ok(CreatedPlayer {
                name,
                token: player.access_token,
            })
        })
        .collect::<Result<Vec<_>, ActionError>>()?;

    let body = CreatedSeason {
        ok: true,
        season_id,
        week_id: Some(week_id),
        players,
    };
    Ok((StatusCode::CREATED, Json(body)).into_response())
}

// ---------------------------------------------------------------------------------------------
// open-week, set-chaos

/// The Chaos card an action stores: type, Wanted target and the `chaosPayload` text.
struct StoredCard {
    chaos_type: ChaosType,
    target_user_id: Option<i64>,
    payload: Option<String>,
}

/// `body.groups` when it is a non-empty array (`Array.isArray(body.groups) && body.groups.length > 0`).
fn manual_groups(body: &Value) -> Option<&Value> {
    property(body, "groups")
        .filter(|groups| groups.as_array().is_some_and(|items| !items.is_empty()))
}

/// `typeof body.targetUserId === 'number' && body.targetUserId > 0`.
fn manual_target(body: &Value) -> Option<&Value> {
    property(body, "targetUserId").filter(|value| number(Some(value)).is_some_and(|n| n > 0.0))
}

async fn open_week(
    conn: &mut SqliteConnection,
    body: &Value,
    season: &ActiveSeason,
) -> ActionResult {
    let latest = season.weeks.first();
    if latest.is_some_and(|week| week.status != "resolved") {
        return Err(fail(StatusCode::CONFLICT, "Tuần hiện tại chưa resolve"));
    }
    let next_week_number = latest.map_or(0, |week| week.week_number) + 1;
    if next_week_number > season.season.weeks {
        return Err(bad_request("Season đã đủ số tuần"));
    }
    let everyone: Vec<&PlayerWithUser> = season.players.iter().collect();
    let lobby = card_players(&everyone);
    let chaos_seed = create_race_seed();
    let mut chaos_rng = create_race_rng(&chaos_seed, &format!("chaos:week:{next_week_number}"));

    // `body.chaosType && body.chaosType !== 'RANDOM' && CHAOS_CARDS.includes(body.chaosType)`.
    let requested = property(body, "chaosType")
        .and_then(Value::as_str)
        .and_then(parse_chaos_type);
    let card = match requested {
        Some(ChaosType::BountyHunt) if manual_target(body).is_some() => {
            let target = manual_target(body);
            let Some(player) = everyone
                .iter()
                .find(|entry| equals_id(target, entry.player.user_id))
            else {
                return Err(bad_request(
                    "Mục tiêu Truy nã phải là một tuyển thủ trong Season",
                ));
            };
            StoredCard {
                chaos_type: ChaosType::BountyHunt,
                target_user_id: Some(player.player.user_id),
                payload: None,
            }
        }
        Some(chaos_type @ (ChaosType::Duo | ChaosType::Constructors))
            if manual_groups(body).is_some() =>
        {
            StoredCard {
                chaos_type,
                target_user_id: None,
                payload: chaos_payload_value(manual_groups(body)),
            }
        }
        Some(chaos_type) => {
            let prepared = prepare_chaos_card(chaos_type, &lobby, &mut rng_fn(&mut chaos_rng))
                .map_err(internal)?;
            StoredCard {
                chaos_type,
                target_user_id: prepared.target_user_id,
                payload: chaos_payload(prepared.groups.as_deref()),
            }
        }
        None => {
            let chaos = select_chaos_card(&lobby, &mut rng_fn(&mut chaos_rng)).map_err(internal)?;
            StoredCard {
                chaos_type: chaos.chaos_type,
                target_user_id: chaos.target_user_id,
                payload: chaos_payload(chaos.groups.as_deref()),
            }
        }
    };

    let now = DbTime::now();
    let week_id: i64 = sqlx::query_scalar(
        r#"INSERT INTO "SeasonWeek" ("seasonId", "weekNumber", "status", "chaosType", "chaosTargetUserId",
               "chaosTargetUserId2", "chaosPayload", "chaosRevealedAt", "chaosSeed", "createdAt", "updatedAt")
           VALUES (?, ?, 'open', ?, ?, NULL, ?, ?, ?, ?, ?) RETURNING "id""#,
    )
    .bind(season.season.id)
    .bind(next_week_number)
    .bind(card.chaos_type.as_str())
    .bind(card.target_user_id)
    .bind(card.payload)
    .bind(now)
    .bind(&chaos_seed)
    .bind(now)
    .bind(now)
    .fetch_one(&mut *conn)
    .await?;
    Ok(week_response(reload_week(conn, week_id).await?))
}

/// `skipped` → the players who race this week, in `season.players` order.
fn active_players<'a>(season: &'a ActiveSeason, skipped: &[f64]) -> Vec<&'a PlayerWithUser> {
    season
        .players
        .iter()
        .filter(|entry| !skipped_contains(skipped, entry.player.user_id))
        .collect()
}

fn check_lobby_size(active: &[&PlayerWithUser]) -> Result<(), ActionError> {
    if active.len() < 2 || active.len() > 16 {
        return Err(bad_request("Race cần 2–16 dzịt active"));
    }
    Ok(())
}

async fn set_chaos(
    conn: &mut SqliteConnection,
    body: &Value,
    season: &ActiveSeason,
) -> ActionResult {
    let week_value = property(body, "weekId");
    if !truthy(week_value) {
        return Err(bad_request("weekId là bắt buộc"));
    }
    let Some(week) = week_by_id(conn, lookup_id(week_value)?).await? else {
        return Err(fail(StatusCode::NOT_FOUND, "Tuần không tồn tại"));
    };
    if week.status != "open" && week.status != "locked" {
        return Err(fail(
            StatusCode::CONFLICT,
            "Chỉ có thể đổi lá bài Chaos khi tuần chưa bắt đầu đua",
        ));
    }
    let skipped = parse_skipped_player_ids(week.skipped_player_ids_json.as_deref());
    let active = active_players(season, &skipped);
    check_lobby_size(&active)?;
    let lobby = card_players(&active);

    let chaos_seed = create_race_seed();
    let mut rng = create_race_rng(
        &chaos_seed,
        &format!("chaos:manual:{}:{}", week.week_number, chaos_clock_ms()),
    );

    let requested = property(body, "chaosType");
    let card = if !truthy(requested) || requested.and_then(Value::as_str) == Some("RANDOM") {
        let rolled = select_chaos_card(&lobby, &mut rng_fn(&mut rng)).map_err(internal)?;
        StoredCard {
            chaos_type: rolled.chaos_type,
            target_user_id: rolled.target_user_id,
            payload: chaos_payload(rolled.groups.as_deref()),
        }
    } else {
        let Some(chaos_type) = requested.and_then(Value::as_str).and_then(parse_chaos_type) else {
            return Err(bad_request("Lá bài Chaos không hợp lệ"));
        };
        let mut card = StoredCard {
            chaos_type,
            target_user_id: None,
            payload: None,
        };
        match chaos_type {
            ChaosType::BountyHunt => {
                if let Some(target) = manual_target(body) {
                    let Some(player) = active
                        .iter()
                        .find(|entry| equals_id(Some(target), entry.player.user_id))
                    else {
                        return Err(bad_request(
                            "Mục tiêu Truy nã phải là một tuyển thủ đang tham gia tuần này",
                        ));
                    };
                    card.target_user_id = Some(player.player.user_id);
                } else {
                    card.target_user_id =
                        prepare_chaos_card(ChaosType::BountyHunt, &lobby, &mut rng_fn(&mut rng))
                            .map_err(internal)?
                            .target_user_id;
                }
            }
            ChaosType::Duo | ChaosType::Constructors => {
                if let Some(groups) = manual_groups(body) {
                    card.payload = chaos_payload_value(Some(groups));
                } else {
                    let prepared = prepare_chaos_card(chaos_type, &lobby, &mut rng_fn(&mut rng))
                        .map_err(internal)?;
                    card.payload = chaos_payload(prepared.groups.as_deref());
                }
            }
            _ => {}
        }
        card
    };

    let now = DbTime::now();
    sqlx::query(
        r#"UPDATE "SeasonWeek" SET "chaosType" = ?, "chaosTargetUserId" = ?, "chaosTargetUserId2" = NULL,
               "chaosPayload" = ?, "chaosSeed" = ?, "chaosRevealedAt" = ?, "updatedAt" = ? WHERE "id" = ?"#,
    )
    .bind(card.chaos_type.as_str())
    .bind(card.target_user_id)
    .bind(card.payload)
    .bind(&chaos_seed)
    .bind(now)
    .bind(now)
    .bind(week.id)
    .execute(&mut *conn)
    .await?;
    Ok(week_response(reload_week(conn, week.id).await?))
}

// ---------------------------------------------------------------------------------------------
// extend-season, end-season

#[derive(Serialize)]
struct SeasonBody {
    ok: bool,
    season: SeasonRow,
}

async fn extend_season(
    conn: &mut SqliteConnection,
    body: &Value,
    season: &ActiveSeason,
) -> ActionResult {
    let played_weeks = season.weeks.first().map_or(0, |week| week.week_number);
    let current = season.season.weeks;
    // `body.weeks ?? season.weeks + 1`, then `Number.isInteger(requested)`.
    #[allow(clippy::cast_precision_loss)]
    let requested = match property(body, "weeks") {
        None | Some(Value::Null) => Some((current + 1) as f64),
        value => number(value),
    };
    let Some(requested) = requested.filter(|n| n.is_finite() && js::trunc(*n) == *n) else {
        return Err(bad_request("Số tuần không hợp lệ (1–52)"));
    };
    if !(1.0..=52.0).contains(&requested) {
        return Err(bad_request("Số tuần không hợp lệ (1–52)"));
    }
    #[allow(clippy::cast_precision_loss)]
    if requested <= current as f64 {
        return Err(bad_request(format!(
            "Season đang có {current} tuần — số tuần mới phải lớn hơn"
        )));
    }
    #[allow(clippy::cast_precision_loss)]
    if requested < played_weeks as f64 {
        return Err(bad_request(format!(
            "Đã đua {played_weeks} tuần, không thể giảm xuống {}",
            js::number_to_string(requested)
        )));
    }
    // An integer in 1..=52.
    #[allow(clippy::cast_possible_truncation)]
    let weeks = requested as i64;
    sqlx::query(r#"UPDATE "Season" SET "weeks" = ? WHERE "id" = ?"#)
        .bind(weeks)
        .bind(season.season.id)
        .execute(&mut *conn)
        .await?;
    Ok(ok_json(&SeasonBody {
        ok: true,
        season: reload_season(conn, season.season.id).await?,
    }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EndedSeason {
    ok: bool,
    /// `body.championUserId` as given (a JS number) or the selected champion.
    champion_user_id: Option<JsNum>,
    season: SeasonRow,
}

async fn end_season(
    conn: &mut SqliteConnection,
    body: &Value,
    season: &ActiveSeason,
) -> ActionResult {
    let (champion, echo) = match property(body, "championUserId") {
        None | Some(Value::Null) => {
            let candidates: Vec<ChampionCandidate> = season
                .players
                .iter()
                .map(|entry| ChampionCandidate {
                    user_id: entry.player.user_id,
                    championship_points: entry.player.championship_points,
                    race_wins: entry.player.race_wins,
                })
                .collect();
            let champion = select_champion(&candidates);
            #[allow(clippy::cast_precision_loss)]
            (champion, champion.map(|id| JsNum(id as f64)))
        }
        value => {
            let raw =
                number(value).ok_or_else(|| internal("Argument `championUserId`: Expected Int"))?;
            let id = int_from_number(raw)
                .ok_or_else(|| internal("Argument `championUserId`: Expected Int"))?;
            (Some(id), Some(JsNum(raw)))
        }
    };
    sqlx::query(
        r#"UPDATE "Season" SET "status" = 'completed', "championUserId" = ?, "endedAt" = ? WHERE "id" = ?"#,
    )
    .bind(champion)
    .bind(DbTime::now())
    .bind(season.season.id)
    .execute(&mut *conn)
    .await?;
    Ok(ok_json(&EndedSeason {
        ok: true,
        champion_user_id: echo,
        season: reload_season(conn, season.season.id).await?,
    }))
}

// ---------------------------------------------------------------------------------------------
// toggle-skip

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToggledSkip {
    ok: bool,
    skipped_player_ids: Vec<JsNum>,
    chaos: ToggledChaos,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToggledChaos {
    #[serde(rename = "type")]
    chaos_type: &'static str,
    target_user_id: Option<i64>,
    target_user_id2: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    groups: Option<Vec<Vec<i64>>>,
}

/// `[...ids]` as Prisma `Int` filter values.
fn int_list(ids: &[f64]) -> Result<Vec<i64>, ActionError> {
    ids.iter()
        .map(|&id| int_from_number(id).ok_or_else(|| internal("Argument `in`: Expected Int")))
        .collect()
}

/// `DELETE … WHERE "weekId" = ? AND <column> IN (…)`; Prisma turns `in: []` into a false
/// condition, so an empty list deletes nothing.
async fn delete_for_users(
    conn: &mut SqliteConnection,
    table: &str,
    week_id: i64,
    columns: &[&str],
    ids: &[i64],
) -> Result<(), sqlx::Error> {
    if ids.is_empty() {
        return Ok(());
    }
    let list = placeholders(ids.len());
    let condition = columns
        .iter()
        .map(|column| format!(r#""{column}" IN ({list})"#))
        .collect::<Vec<_>>()
        .join(" OR ");
    let sql = format!(r#"DELETE FROM "{table}" WHERE "weekId" = ? AND ({condition})"#);
    let mut query = sqlx::query(AssertSqlSafe(sql)).bind(week_id);
    for _ in columns {
        for id in ids {
            query = query.bind(*id);
        }
    }
    query.execute(conn).await?;
    Ok(())
}

async fn toggle_skip(
    conn: &mut SqliteConnection,
    body: &Value,
    season: &ActiveSeason,
) -> ActionResult {
    let week_value = property(body, "weekId");
    let user_value = property(body, "userId");
    if !truthy(week_value) || !truthy(user_value) {
        return Err(bad_request("weekId và userId là bắt buộc"));
    }
    let week = week_by_id(conn, lookup_id(week_value)?).await?;
    let Some(week) = week.filter(|week| week.status == "open") else {
        return Err(fail(
            StatusCode::CONFLICT,
            "Chỉ đổi roster khi prep đang mở",
        ));
    };
    let Some(member) = season
        .players
        .iter()
        .find(|entry| equals_id(user_value, entry.player.user_id))
    else {
        return Err(bad_request("Dzịt không thuộc Season"));
    };
    #[allow(clippy::cast_precision_loss)]
    let user_id = member.player.user_id as f64;

    // `new Set(parseSkippedPlayerIds(...))`: first occurrences, SameValueZero.
    let mut skipped: Vec<f64> = Vec::new();
    for id in parse_skipped_player_ids(week.skipped_player_ids_json.as_deref()) {
        if !skipped.contains(&id) {
            skipped.push(id);
        }
    }
    if let Some(index) = skipped.iter().position(|&id| id == user_id) {
        skipped.remove(index);
    } else {
        skipped.push(user_id);
    }
    let active = active_players(season, &skipped);
    check_lobby_size(&active)?;

    let chaos_seed = week.chaos_seed.clone().unwrap_or_else(create_race_seed);
    let chaos_type = parse_chaos_type(&week.chaos_type)
        .ok_or_else(|| internal(format!("Unknown chaos rule {}", week.chaos_type)))?;
    let week_number = u32::try_from(week.week_number)
        .map_err(|_| internal(format!("week number {} out of range", week.week_number)))?;
    let chaos =
        toggle_skip_chaos_card(&chaos_seed, week_number, chaos_type, &card_players(&active))
            .map_err(internal)?;

    let mut sorted = skipped.clone();
    sorted.sort_by(|left, right| race_core::math::cmp_f64_js(*left, *right));
    let ids = int_list(&skipped)?;
    sqlx::query(
        r#"UPDATE "SeasonWeek" SET "skippedPlayerIdsJson" = ?, "chaosSeed" = ?, "chaosTargetUserId" = ?,
               "chaosTargetUserId2" = ?, "chaosPayload" = ?, "updatedAt" = ? WHERE "id" = ?"#,
    )
    .bind(skipped_ids_json(&sorted))
    .bind(&chaos_seed)
    .bind(chaos.target_user_id)
    .bind(chaos.target_user_id2)
    .bind(chaos_payload(chaos.groups.as_deref()))
    .bind(DbTime::now())
    .bind(week.id)
    .execute(&mut *conn)
    .await?;
    delete_for_users(
        conn,
        "SeasonPrediction",
        week.id,
        &["predictorUserId", "targetUserId"],
        &ids,
    )
    .await?;
    delete_for_users(conn, "SeasonLoadout", week.id, &["userId"], &ids).await?;
    delete_for_users(conn, "SeasonShieldChoice", week.id, &["userId"], &ids).await?;

    Ok(ok_json(&ToggledSkip {
        ok: true,
        skipped_player_ids: skipped.iter().map(|&id| JsNum(id)).collect(),
        chaos: ToggledChaos {
            chaos_type: chaos.chaos_type.as_str(),
            target_user_id: chaos.target_user_id,
            target_user_id2: chaos.target_user_id2,
            groups: chaos.groups,
        },
    }))
}

// ---------------------------------------------------------------------------------------------
// lock, unlock, reseed-week

/// The `lock` loop: every active player without a `ready` loadout gets the auto loadout of
/// `seed` (`selectAutoLoadout(seed, String(userId))`), upserted as `auto` with `lockedAt` now.
async fn write_auto_loadouts(
    conn: &mut SqliteConnection,
    week_id: i64,
    active: &[&PlayerWithUser],
    existing: &[SeasonLoadoutRow],
    seed: &str,
) -> Result<(), sqlx::Error> {
    for entry in active {
        // `new Map(existing.map(l => [l.seasonPlayerId, l]))`: the last row per player wins.
        let current = existing
            .iter()
            .rev()
            .find(|loadout| loadout.season_player_id == entry.player.id);
        if current.is_some_and(|loadout| loadout.status == "ready") {
            continue;
        }
        let items = auto_loadout_json(seed, entry.player.user_id);
        let now = DbTime::now();
        sqlx::query(
            r#"INSERT INTO "SeasonLoadout" ("weekId", "seasonPlayerId", "userId", "itemIdsJson", "status",
                   "lockedAt", "createdAt", "updatedAt")
               VALUES (?, ?, ?, ?, 'auto', ?, ?, ?)
               ON CONFLICT ("weekId", "seasonPlayerId") DO UPDATE SET "itemIdsJson" = excluded."itemIdsJson",
                   "status" = 'auto', "lockedAt" = excluded."lockedAt", "updatedAt" = excluded."updatedAt""#,
        )
        .bind(week_id)
        .bind(entry.player.id)
        .bind(entry.player.user_id)
        .bind(items)
        .bind(now)
        .bind(now)
        .bind(now)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

async fn lock(conn: &mut SqliteConnection, body: &Value, season: &ActiveSeason) -> ActionResult {
    let week = week_or(conn, body, || {
        season
            .weeks
            .iter()
            .find(|week| week.status == "open")
            .cloned()
    })
    .await?;
    let Some(week) = week.filter(|week| week.status == "open") else {
        return Err(fail(StatusCode::CONFLICT, "Tuần không ở trạng thái open"));
    };
    let seed = week.race_seed.clone().unwrap_or_else(create_race_seed);
    let skipped = parse_skipped_player_ids(week.skipped_player_ids_json.as_deref());
    let active = active_players(season, &skipped);
    let existing = loadouts_for_week(conn, week.id).await?;
    write_auto_loadouts(conn, week.id, &active, &existing, &seed).await?;
    let now = DbTime::now();
    sqlx::query(
        r#"UPDATE "SeasonWeek" SET "status" = 'locked', "predictionsLockedAt" = ?, "raceSeed" = ?, "updatedAt" = ?
           WHERE "id" = ?"#,
    )
    .bind(now)
    .bind(&seed)
    .bind(now)
    .bind(week.id)
    .execute(&mut *conn)
    .await?;
    Ok(week_response(reload_week(conn, week.id).await?))
}

async fn unlock(conn: &mut SqliteConnection, body: &Value, season: &ActiveSeason) -> ActionResult {
    let week = week_or(conn, body, || {
        season
            .weeks
            .iter()
            .find(|week| week.status == "locked")
            .cloned()
    })
    .await?;
    let Some(week) = week.filter(|week| week.status == "locked" && week.race_id.is_none()) else {
        return Err(fail(
            StatusCode::CONFLICT,
            "Chỉ có thể mở lại trước khi race bắt đầu",
        ));
    };
    sqlx::query(
        r#"UPDATE "SeasonWeek" SET "status" = 'open', "predictionsLockedAt" = NULL, "updatedAt" = ? WHERE "id" = ?"#,
    )
    .bind(DbTime::now())
    .bind(week.id)
    .execute(&mut *conn)
    .await?;
    Ok(week_response(reload_week(conn, week.id).await?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reseeded {
    ok: bool,
    week: SeasonWeekRow,
    failed_race_id: i64,
    previous_race_seed_count: usize,
}

const RESEED_REFUSED: &str =
    "Chỉ re-seed được khi tuần đang locked và race gần nhất của seed hiện tại đã failed";

async fn reseed_week(
    conn: &mut SqliteConnection,
    body: &Value,
    season: &ActiveSeason,
) -> ActionResult {
    let week_value = property(body, "weekId");
    if !truthy(week_value) {
        return Err(bad_request("weekId là bắt buộc"));
    }
    let Some(week) = week_by_id(conn, lookup_id(week_value)?).await? else {
        return Err(fail(StatusCode::NOT_FOUND, "Tuần không tồn tại"));
    };
    if week.season_id != season.season.id {
        return Err(fail(StatusCode::CONFLICT, "Tuần không thuộc Season active"));
    }
    // A failed official race returns its week to `locked` with `raceId` NULL
    // (`executeSeason3Race`'s catch, and D22 recovery); the race keeps the seed it ran with.
    let (Some(old_seed), "locked", None) =
        (week.race_seed.clone(), week.status.as_str(), week.race_id)
    else {
        return Err(fail(StatusCode::CONFLICT, RESEED_REFUSED));
    };
    let last: Option<(i64, String)> = sqlx::query_as(
        r#"SELECT "id", "status" FROM "Race" WHERE "raceSeed" = ? AND "isTest" = 0 ORDER BY "id" DESC LIMIT 1"#,
    )
    .bind(&old_seed)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((failed_race_id, _)) = last.filter(|(_, status)| status == "failed") else {
        return Err(fail(StatusCode::CONFLICT, RESEED_REFUSED));
    };

    let mut previous: Vec<String> = match week.previous_race_seeds.as_deref() {
        None | Some("") => Vec::new(),
        Some(text) => serde_json::from_str(text).map_err(|error| {
            internal(format!(
                "SeasonWeek.previousRaceSeeds is not a JSON string array: {error}"
            ))
        })?,
    };
    previous.push(old_seed.clone());
    let new_seed = create_race_seed();

    let skipped = parse_skipped_player_ids(week.skipped_player_ids_json.as_deref());
    let active = active_players(season, &skipped);
    let existing = loadouts_for_week(conn, week.id).await?;
    write_auto_loadouts(conn, week.id, &active, &existing, &new_seed).await?;
    sqlx::query(
        r#"UPDATE "SeasonWeek" SET "raceSeed" = ?, "previousRaceSeeds" = ?, "updatedAt" = ? WHERE "id" = ?"#,
    )
    .bind(&new_seed)
    .bind(serde_json::to_string(&previous).map_err(internal)?)
    .bind(DbTime::now())
    .bind(week.id)
    .execute(&mut *conn)
    .await?;
    tracing::warn!(
        target: "audit",
        action = "reseed-week",
        week_id = week.id,
        week_number = week.week_number,
        failed_race_id,
        old_seed_commit = %seed_commit(&old_seed),
        new_seed_commit = %seed_commit(&new_seed),
        previous_seeds = previous.len(),
        "Season 3 week re-seeded after a failed race"
    );
    Ok(ok_json(&Reseeded {
        ok: true,
        week: reload_week(conn, week.id).await?,
        failed_race_id,
        previous_race_seed_count: previous.len(),
    }))
}
