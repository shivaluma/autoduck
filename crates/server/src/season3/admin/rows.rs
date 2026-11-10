//! Season 3 tables as the admin route reads them, decoded and serialised like the Prisma client
//! returns them (every scalar field in schema order, `DateTime` as `toISOString()`).
//!
//! The queries copy the SQL Prisma 7 issues for `app/api/admin/season3/route.ts` (captured with
//! the query log): the same `WHERE … IN (…)` shape, `LIMIT ? OFFSET ?` and no `ORDER BY` where
//! Prisma has none. SQLite then picks the same plan, so rows without an explicit order (relation
//! includes, `findMany` without `orderBy`) come back in the same order as on the TS server. That
//! order is observable: `season.players` (no `orderBy` in the POST include) is the lobby order
//! the Chaos shuffles and the auto-loadout upserts see, and the balance telemetry groups appear
//! in first-seen row order.

use serde::Serialize;
use sqlx::{AssertSqlSafe, FromRow, SqliteConnection};

use crate::cosmetics::rows::{
    SEASON_COLUMNS, SEASON_PLAYER_COLUMNS, SeasonPlayerRow, SeasonRow, USER_COLUMNS, UserRow,
    placeholders,
};
use crate::db::DbTime;

pub const WEEK_COLUMNS: &str = r#""SeasonWeek"."id", "SeasonWeek"."seasonId", "SeasonWeek"."weekNumber", "SeasonWeek"."status", "SeasonWeek"."chaosType", "SeasonWeek"."chaosTargetUserId", "SeasonWeek"."chaosTargetUserId2", "SeasonWeek"."chaosPayload", "SeasonWeek"."chaosRevealedAt", "SeasonWeek"."predictionsLockedAt", "SeasonWeek"."raceId", "SeasonWeek"."recap", "SeasonWeek"."resolvedAt", "SeasonWeek"."raceSeed", "SeasonWeek"."chaosSeed", "SeasonWeek"."skippedPlayerIdsJson", "SeasonWeek"."previousRaceSeeds", "SeasonWeek"."createdAt", "SeasonWeek"."updatedAt""#;

/// A `SeasonWeek` row (every scalar field in schema order, `previousRaceSeeds` included since
/// schema 0.8).
#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SeasonWeekRow {
    pub id: i64,
    pub season_id: i64,
    pub week_number: i64,
    pub status: String,
    pub chaos_type: String,
    pub chaos_target_user_id: Option<i64>,
    pub chaos_target_user_id2: Option<i64>,
    pub chaos_payload: Option<String>,
    pub chaos_revealed_at: DbTime,
    pub predictions_locked_at: Option<DbTime>,
    pub race_id: Option<i64>,
    pub recap: Option<String>,
    pub resolved_at: Option<DbTime>,
    pub race_seed: Option<String>,
    pub chaos_seed: Option<String>,
    pub skipped_player_ids_json: Option<String>,
    pub previous_race_seeds: Option<String>,
    pub created_at: DbTime,
    pub updated_at: DbTime,
}

pub const REWARD_COLUMNS: &str = r#""SeasonReward"."id", "SeasonReward"."seasonId", "SeasonReward"."key", "SeasonReward"."name", "SeasonReward"."cost", "SeasonReward"."stock", "SeasonReward"."active", "SeasonReward"."createdAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SeasonRewardRow {
    pub id: i64,
    pub season_id: i64,
    pub key: String,
    pub name: String,
    pub cost: i64,
    pub stock: Option<i64>,
    pub active: bool,
    pub created_at: DbTime,
}

pub const LOADOUT_COLUMNS: &str = r#""SeasonLoadout"."id", "SeasonLoadout"."weekId", "SeasonLoadout"."seasonPlayerId", "SeasonLoadout"."userId", "SeasonLoadout"."itemIdsJson", "SeasonLoadout"."status", "SeasonLoadout"."lockedAt", "SeasonLoadout"."createdAt", "SeasonLoadout"."updatedAt""#;

#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct SeasonLoadoutRow {
    pub id: i64,
    pub week_id: i64,
    pub season_player_id: i64,
    pub user_id: i64,
    pub item_ids_json: String,
    pub status: String,
    pub locked_at: Option<DbTime>,
    pub created_at: DbTime,
    pub updated_at: DbTime,
}

pub const PREDICTION_COLUMNS: &str = r#""SeasonPrediction"."id", "SeasonPrediction"."weekId", "SeasonPrediction"."predictorPlayerId", "SeasonPrediction"."predictorUserId", "SeasonPrediction"."targetUserId", "SeasonPrediction"."pointsAwarded", "SeasonPrediction"."createdAt""#;

#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct SeasonPredictionRow {
    pub id: i64,
    pub week_id: i64,
    pub predictor_player_id: i64,
    pub predictor_user_id: i64,
    pub target_user_id: i64,
    pub points_awarded: i64,
    pub created_at: DbTime,
}

pub const SHIELD_CHOICE_COLUMNS: &str = r#""SeasonShieldChoice"."id", "SeasonShieldChoice"."weekId", "SeasonShieldChoice"."seasonPlayerId", "SeasonShieldChoice"."userId", "SeasonShieldChoice"."confirmedAt""#;

#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct SeasonShieldChoiceRow {
    pub id: i64,
    pub week_id: i64,
    pub season_player_id: i64,
    pub user_id: i64,
    pub confirmed_at: DbTime,
}

/// `race: { select: { id: true, status: true } }`.
#[derive(Debug, Clone, FromRow)]
pub struct RaceStatusRow {
    pub id: i64,
    pub status: String,
}

/// `user: { select: { id, name, avatarUrl } }` (admin GET players).
#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct UserSummaryRow {
    pub id: i64,
    pub name: String,
    pub avatar_url: Option<String>,
}

pub const ITEM_TELEMETRY_COLUMNS: &str = r#""RaceItemTelemetry"."id", "RaceItemTelemetry"."raceId", "RaceItemTelemetry"."playerId", "RaceItemTelemetry"."itemId", "RaceItemTelemetry"."loadoutKey", "RaceItemTelemetry"."finalRank", "RaceItemTelemetry"."baselineRank", "RaceItemTelemetry"."rankDelta", "RaceItemTelemetry"."won", "RaceItemTelemetry"."topThree", "RaceItemTelemetry"."bottomTwo", "RaceItemTelemetry"."activated", "RaceItemTelemetry"."succeeded", "RaceItemTelemetry"."createdAt""#;

#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct ItemTelemetryDbRow {
    pub id: i64,
    pub race_id: i64,
    pub player_id: String,
    pub item_id: String,
    pub loadout_key: String,
    pub final_rank: i64,
    pub baseline_rank: i64,
    pub rank_delta: i64,
    pub won: bool,
    pub top_three: bool,
    pub bottom_two: bool,
    pub activated: bool,
    pub succeeded: bool,
    pub created_at: DbTime,
}

pub const PICKUP_TELEMETRY_COLUMNS: &str = r#""RacePickupTelemetry"."id", "RacePickupTelemetry"."raceId", "RacePickupTelemetry"."playerId", "RacePickupTelemetry"."instanceId", "RacePickupTelemetry"."itemId", "RacePickupTelemetry"."collectionRank", "RacePickupTelemetry"."finalRank", "RacePickupTelemetry"."baselineRank", "RacePickupTelemetry"."rankDelta", "RacePickupTelemetry"."activated", "RacePickupTelemetry"."succeeded", "RacePickupTelemetry"."manualUsed", "RacePickupTelemetry"."autoUsed", "RacePickupTelemetry"."hitCount""#;

#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct PickupTelemetryDbRow {
    pub id: String,
    pub race_id: i64,
    pub player_id: String,
    pub instance_id: String,
    pub item_id: String,
    pub collection_rank: i64,
    pub final_rank: i64,
    pub baseline_rank: i64,
    pub rank_delta: i64,
    pub activated: bool,
    pub succeeded: bool,
    pub manual_used: bool,
    pub auto_used: bool,
    pub hit_count: i64,
}

/// `SELECT <columns> FROM "<table>" WHERE "<table>"."<column>" IN (…) [ORDER BY …] LIMIT ? OFFSET ?`,
/// Prisma's relation-include query. Prisma skips the query for an empty id list.
pub async fn fetch_in<T>(
    conn: &mut SqliteConnection,
    columns: &str,
    table: &str,
    column: &str,
    ids: &[i64],
    order_by: &str,
) -> Result<Vec<T>, sqlx::Error>
where
    T: for<'r> FromRow<'r, sqlx::sqlite::SqliteRow> + Send + Unpin,
{
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        r#"SELECT {columns} FROM "{table}" WHERE "{table}"."{column}" IN ({}){order_by} LIMIT ? OFFSET ?"#,
        placeholders(ids.len())
    );
    let mut query = sqlx::query_as::<_, T>(AssertSqlSafe(sql));
    for id in ids {
        query = query.bind(*id);
    }
    query.bind(-1_i64).bind(0_i64).fetch_all(conn).await
}

/// Ids in first-seen order without duplicates (Prisma's relation-key list).
pub fn unique_ids(ids: impl IntoIterator<Item = i64>) -> Vec<i64> {
    let mut out: Vec<i64> = Vec::new();
    for id in ids {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

/// `season.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } })` (GET).
pub async fn active_season_latest(
    conn: &mut SqliteConnection,
) -> Result<Option<SeasonRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_COLUMNS} FROM "Season" WHERE "Season"."status" = ? ORDER BY "Season"."createdAt" DESC LIMIT ? OFFSET ?"#
    )))
    .bind("active")
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `season.findFirst({ where: { status: 'active' } })` (POST: no `orderBy`).
pub async fn active_season(conn: &mut SqliteConnection) -> Result<Option<SeasonRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_COLUMNS} FROM "Season" WHERE "Season"."status" = ? LIMIT ? OFFSET ?"#
    )))
    .bind("active")
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `seasonWeek.findUnique({ where: { id } })`.
pub async fn week_by_id(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Option<SeasonWeekRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonWeekRow>(AssertSqlSafe(format!(
        r#"SELECT {WEEK_COLUMNS} FROM "SeasonWeek" WHERE ("SeasonWeek"."id" = ? AND 1=1) LIMIT ? OFFSET ?"#
    )))
    .bind(id)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// A season player with its `user` (POST include: `players: { include: { user: true } }`).
#[derive(Debug, Clone)]
pub struct PlayerWithUser {
    pub player: SeasonPlayerRow,
    pub user: UserRow,
}

/// The POST `season` include: players in SQLite's order for `seasonId IN (?)` (no `orderBy`),
/// each with its user; weeks newest first.
#[derive(Debug, Clone)]
pub struct ActiveSeason {
    pub season: SeasonRow,
    pub players: Vec<PlayerWithUser>,
    /// `weeksPlan: { orderBy: { weekNumber: 'desc' } }`.
    pub weeks: Vec<SeasonWeekRow>,
}

/// Loads the POST `findFirst({ where: { status: 'active' }, include: { players: { include:
/// { user: true } }, weeksPlan: { orderBy: { weekNumber: 'desc' } } } })`. The `predictions`
/// include is not loaded: no admin action reads it.
///
/// # Errors
/// A DB error, or a season player whose user row is missing (Prisma fails on the required
/// relation).
pub async fn load_active_season(
    conn: &mut SqliteConnection,
) -> Result<Option<ActiveSeason>, anyhow::Error> {
    let Some(season) = active_season(conn).await? else {
        return Ok(None);
    };
    let players: Vec<SeasonPlayerRow> = fetch_in(
        conn,
        SEASON_PLAYER_COLUMNS,
        "SeasonPlayer",
        "seasonId",
        &[season.id],
        "",
    )
    .await?;
    let weeks: Vec<SeasonWeekRow> = fetch_in(
        conn,
        WEEK_COLUMNS,
        "SeasonWeek",
        "seasonId",
        &[season.id],
        r#" ORDER BY "SeasonWeek"."weekNumber" DESC"#,
    )
    .await?;
    let user_ids = unique_ids(players.iter().map(|player| player.user_id));
    let users: Vec<UserRow> = fetch_in(conn, USER_COLUMNS, "User", "id", &user_ids, "").await?;
    let players = players
        .into_iter()
        .map(|player| {
            let user = users
                .iter()
                .find(|user| user.id == player.user_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("season player {} has no user", player.id))?;
            Ok(PlayerWithUser { player, user })
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(Some(ActiveSeason {
        season,
        players,
        weeks,
    }))
}

/// `seasonLoadout.findMany({ where: { weekId } })`.
pub async fn loadouts_for_week(
    conn: &mut SqliteConnection,
    week_id: i64,
) -> Result<Vec<SeasonLoadoutRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonLoadoutRow>(AssertSqlSafe(format!(
        r#"SELECT {LOADOUT_COLUMNS} FROM "SeasonLoadout" WHERE "SeasonLoadout"."weekId" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(week_id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(conn)
    .await
}

/// `seasonWeek.update(...)` with `RETURNING`, re-read after the write in the same transaction.
pub async fn reload_week(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<SeasonWeekRow, anyhow::Error> {
    week_by_id(conn, id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("SeasonWeek {id} vanished inside the transaction"))
}

/// `season.update(...)` result, re-read in the same transaction.
pub async fn reload_season(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<SeasonRow, anyhow::Error> {
    sqlx::query_as::<_, SeasonRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_COLUMNS} FROM "Season" WHERE "Season"."id" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(id)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await?
    .ok_or_else(|| anyhow::anyhow!("Season {id} vanished inside the transaction"))
}
