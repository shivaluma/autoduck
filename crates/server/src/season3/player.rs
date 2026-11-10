//! Data access for the player-facing Season 3 routes (`/api/season3`, `/api/season3/redeem`).
//!
//! The reads mirror the SQL Prisma 7 issues for `getActiveSeason()` in
//! `app/api/season3/route.ts` and for the redeem lookup (captured with the query log): the same
//! `WHERE … IN (…)` shape and no `ORDER BY` where Prisma has none, so SQLite picks the same plan
//! and relation rows (inventory, presets, predictions) come back in the same order. Relation
//! includes are separate `IN (…)` queries grouped per parent in memory, as Prisma does.
//!
//! The upserts are Prisma's native `INSERT … ON CONFLICT DO UPDATE` (Prisma 7 uses them for
//! these `upsert` calls), with the same columns, so autoincrement ids advance identically.

use serde::Serialize;
use sqlx::{AssertSqlSafe, FromRow, SqliteConnection};

use crate::cosmetics::ids::cuid;
use crate::cosmetics::rows::{
    APPEARANCE_COLUMNS, COSMETIC_COLUMNS, PlayerAppearanceRow, PlayerCosmeticRow, SEASON_COLUMNS,
    SEASON_PLAYER_COLUMNS, SeasonPlayerRow, SeasonRow, placeholders,
};
use crate::db::DbTime;

pub const WEEK_COLUMNS: &str = r#""id", "seasonId", "weekNumber", "status", "chaosType", "chaosTargetUserId", "chaosTargetUserId2", "chaosPayload", "chaosRevealedAt", "predictionsLockedAt", "raceId", "recap", "resolvedAt", "raceSeed", "chaosSeed", "skippedPlayerIdsJson", "previousRaceSeeds", "createdAt", "updatedAt""#;

/// A `SeasonWeek` row (every scalar field, schema order).
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

pub const REWARD_COLUMNS: &str =
    r#""id", "seasonId", "key", "name", "cost", "stock", "active", "createdAt""#;

/// A `SeasonReward` row, serialised as Prisma returns it.
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

pub const PRESET_COLUMNS: &str =
    r#""id", "seasonPlayerId", "slotIndex", "name", "appearanceJson", "createdAt", "updatedAt""#;

/// A `CosmeticPreset` row.
#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct CosmeticPresetRow {
    pub id: String,
    pub season_player_id: i64,
    pub slot_index: i64,
    pub name: String,
    pub appearance_json: String,
    pub created_at: DbTime,
    pub updated_at: DbTime,
}

pub const PREDICTION_COLUMNS: &str = r#""id", "weekId", "predictorPlayerId", "predictorUserId", "targetUserId", "pointsAwarded", "createdAt""#;

/// A `SeasonPrediction` row.
#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SeasonPredictionRow {
    pub id: i64,
    pub week_id: i64,
    pub predictor_player_id: i64,
    pub predictor_user_id: i64,
    pub target_user_id: i64,
    pub points_awarded: i64,
    pub created_at: DbTime,
}

pub const SHIELD_CHOICE_COLUMNS: &str =
    r#""id", "weekId", "seasonPlayerId", "userId", "confirmedAt""#;

/// A `SeasonShieldChoice` row.
#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SeasonShieldChoiceRow {
    pub id: i64,
    pub week_id: i64,
    pub season_player_id: i64,
    pub user_id: i64,
    pub confirmed_at: DbTime,
}

pub const LOADOUT_COLUMNS: &str = r#""id", "weekId", "seasonPlayerId", "userId", "itemIdsJson", "status", "lockedAt", "createdAt", "updatedAt""#;

/// A `SeasonLoadout` row.
#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
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

pub const REDEMPTION_COLUMNS: &str =
    r#""id", "seasonId", "seasonPlayerId", "rewardId", "pointsSpent", "status", "createdAt""#;

/// A `SeasonRedemption` row.
#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SeasonRedemptionRow {
    pub id: i64,
    pub season_id: i64,
    pub season_player_id: i64,
    pub reward_id: i64,
    pub points_spent: i64,
    pub status: String,
    pub created_at: DbTime,
}

/// `user: { select: { id, name, avatarUrl, email, googleId } }`.
#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct PlayerUser {
    pub id: i64,
    pub name: String,
    pub avatar_url: Option<String>,
    pub email: Option<String>,
    pub google_id: Option<String>,
}

/// The fields of an included `User` (`predictor`/`target`) the routes read.
#[derive(Debug, Clone, FromRow)]
#[sqlx(rename_all = "camelCase")]
pub struct UserName {
    pub id: i64,
    pub name: String,
    pub avatar_url: Option<String>,
}

/// `race: { select: { id: true, status: true } }`.
#[derive(Debug, Clone, FromRow)]
pub struct RaceBrief {
    pub id: i64,
    pub status: String,
}

/// The `liveRace` lookup: `select: { id, status, isTest }`.
#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct LiveRace {
    pub id: i64,
    pub status: String,
    pub is_test: bool,
}

/// One entry of `season.players` with its includes.
#[derive(Debug, Clone)]
pub struct PlayerEntry {
    pub row: SeasonPlayerRow,
    pub user: PlayerUser,
    pub cosmetics: Vec<PlayerCosmeticRow>,
    pub appearance: Option<PlayerAppearanceRow>,
    pub presets: Vec<CosmeticPresetRow>,
}

/// One prediction with `predictor` and `target` included.
#[derive(Debug, Clone)]
pub struct PredictionEntry {
    pub row: SeasonPredictionRow,
    pub predictor: UserName,
    pub target: UserName,
}

/// One entry of `season.weeksPlan` with its includes.
#[derive(Debug, Clone)]
pub struct WeekEntry {
    pub row: SeasonWeekRow,
    pub predictions: Vec<PredictionEntry>,
    pub shield_choices: Vec<SeasonShieldChoiceRow>,
    pub loadouts: Vec<SeasonLoadoutRow>,
    pub race: Option<RaceBrief>,
}

/// `getActiveSeason()` with every include.
#[derive(Debug, Clone)]
pub struct ActiveSeason {
    pub season: SeasonRow,
    pub players: Vec<PlayerEntry>,
    pub weeks: Vec<WeekEntry>,
    pub rewards: Vec<SeasonRewardRow>,
}

/// The parts of `getActiveSeason()` the POST handler reads: the players (no includes) and the
/// weeks (no includes).
#[derive(Debug, Clone)]
pub struct ActiveSeasonCore {
    pub season: SeasonRow,
    pub players: Vec<SeasonPlayerRow>,
    pub weeks: Vec<SeasonWeekRow>,
}

/// Something Prisma would refuse to return (a required relation with no row): TS throws.
#[derive(Debug, thiserror::Error)]
pub enum LoadError {
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error("inconsistent query result: {0}")]
    Inconsistent(String),
}

/// `season.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } })`.
async fn active_season_row(conn: &mut SqliteConnection) -> Result<Option<SeasonRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_COLUMNS} FROM "Season" WHERE "Season"."status" = ? ORDER BY "Season"."createdAt" DESC LIMIT ? OFFSET ?"#
    )))
    .bind("active")
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `players: { orderBy: { user: { name: 'asc' } } }`.
async fn season_players_by_name(
    conn: &mut SqliteConnection,
    season_id: i64,
) -> Result<Vec<SeasonPlayerRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonPlayerRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_PLAYER_COLUMNS} FROM "SeasonPlayer" LEFT JOIN "User" AS "orderby_1" ON ("orderby_1"."id") = ("SeasonPlayer"."userId")
           WHERE "SeasonPlayer"."seasonId" IN (?) ORDER BY "orderby_1"."name" ASC LIMIT ? OFFSET ?"#
    )))
    .bind(season_id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(conn)
    .await
}

/// `weeksPlan: { orderBy: { weekNumber: 'asc' } }`.
async fn season_weeks(
    conn: &mut SqliteConnection,
    season_id: i64,
) -> Result<Vec<SeasonWeekRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonWeekRow>(AssertSqlSafe(format!(
        r#"SELECT {WEEK_COLUMNS} FROM "SeasonWeek" WHERE "SeasonWeek"."seasonId" IN (?) ORDER BY "SeasonWeek"."weekNumber" ASC LIMIT ? OFFSET ?"#
    )))
    .bind(season_id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(conn)
    .await
}

/// `SELECT <columns> FROM "<table>" WHERE "<table>"."<column>" IN (…) LIMIT -1 OFFSET 0`: a
/// relation include without `orderBy`. An empty id list returns nothing without a query.
async fn rows_in<T>(
    conn: &mut SqliteConnection,
    columns: &str,
    table: &str,
    column: &str,
    ids: &[i64],
) -> Result<Vec<T>, sqlx::Error>
where
    T: for<'r> FromRow<'r, sqlx::sqlite::SqliteRow> + Send + Unpin,
{
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        r#"SELECT {columns} FROM "{table}" WHERE "{table}"."{column}" IN ({}) LIMIT ? OFFSET ?"#,
        placeholders(ids.len())
    );
    let mut query = sqlx::query_as::<_, T>(AssertSqlSafe(sql));
    for id in ids {
        query = query.bind(*id);
    }
    query.bind(-1_i64).bind(0_i64).fetch_all(conn).await
}

/// The rows whose key is `key`, in query order (Prisma's per-parent grouping).
fn group<T: Clone>(rows: &[T], key: i64, of: impl Fn(&T) -> i64) -> Vec<T> {
    rows.iter().filter(|row| of(row) == key).cloned().collect()
}

/// `getActiveSeason()` for the POST handler (players and weeks, no includes).
pub async fn load_active_season_core(
    conn: &mut SqliteConnection,
) -> Result<Option<ActiveSeasonCore>, sqlx::Error> {
    let Some(season) = active_season_row(conn).await? else {
        return Ok(None);
    };
    let players = season_players_by_name(conn, season.id).await?;
    let weeks = season_weeks(conn, season.id).await?;
    Ok(Some(ActiveSeasonCore {
        season,
        players,
        weeks,
    }))
}

/// `getActiveSeason()` with every include, for the GET handler.
pub async fn load_active_season(
    conn: &mut SqliteConnection,
) -> Result<Option<ActiveSeason>, LoadError> {
    let Some(season) = active_season_row(conn).await? else {
        return Ok(None);
    };
    let player_rows = season_players_by_name(conn, season.id).await?;
    let week_rows = season_weeks(conn, season.id).await?;
    let rewards = sqlx::query_as::<_, SeasonRewardRow>(AssertSqlSafe(format!(
        r#"SELECT {REWARD_COLUMNS} FROM "SeasonReward" WHERE ("SeasonReward"."active" = ? AND "SeasonReward"."seasonId" IN (?))
           ORDER BY "SeasonReward"."cost" ASC LIMIT ? OFFSET ?"#
    )))
    .bind(true)
    .bind(season.id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(&mut *conn)
    .await?;

    let player_ids: Vec<i64> = player_rows.iter().map(|player| player.id).collect();
    let user_ids: Vec<i64> = player_rows.iter().map(|player| player.user_id).collect();
    let users: Vec<PlayerUser> = rows_in(
        conn,
        r#""id", "name", "avatarUrl", "email", "googleId""#,
        "User",
        "id",
        &user_ids,
    )
    .await?;
    let cosmetics: Vec<PlayerCosmeticRow> = rows_in(
        conn,
        COSMETIC_COLUMNS,
        "PlayerCosmetic",
        "seasonPlayerId",
        &player_ids,
    )
    .await?;
    let appearances: Vec<PlayerAppearanceRow> = rows_in(
        conn,
        APPEARANCE_COLUMNS,
        "PlayerAppearance",
        "seasonPlayerId",
        &player_ids,
    )
    .await?;
    let presets: Vec<CosmeticPresetRow> = rows_in(
        conn,
        PRESET_COLUMNS,
        "CosmeticPreset",
        "seasonPlayerId",
        &player_ids,
    )
    .await?;

    let mut players = Vec::with_capacity(player_rows.len());
    for row in player_rows {
        let user = users
            .iter()
            .find(|user| user.id == row.user_id)
            .cloned()
            .ok_or_else(|| {
                LoadError::Inconsistent(format!("SeasonPlayer {} has no user", row.id))
            })?;
        players.push(PlayerEntry {
            cosmetics: group(&cosmetics, row.id, |c| c.season_player_id),
            appearance: appearances
                .iter()
                .find(|appearance| appearance.season_player_id == row.id)
                .cloned(),
            presets: group(&presets, row.id, |p| p.season_player_id),
            user,
            row,
        });
    }

    let week_ids: Vec<i64> = week_rows.iter().map(|week| week.id).collect();
    let predictions: Vec<SeasonPredictionRow> = rows_in(
        conn,
        PREDICTION_COLUMNS,
        "SeasonPrediction",
        "weekId",
        &week_ids,
    )
    .await?;
    let shield_choices: Vec<SeasonShieldChoiceRow> = rows_in(
        conn,
        SHIELD_CHOICE_COLUMNS,
        "SeasonShieldChoice",
        "weekId",
        &week_ids,
    )
    .await?;
    let loadouts: Vec<SeasonLoadoutRow> =
        rows_in(conn, LOADOUT_COLUMNS, "SeasonLoadout", "weekId", &week_ids).await?;
    let race_ids: Vec<i64> = week_rows.iter().filter_map(|week| week.race_id).collect();
    let races: Vec<RaceBrief> = rows_in(conn, r#""id", "status""#, "Race", "id", &race_ids).await?;
    let predictor_ids: Vec<i64> = predictions.iter().map(|p| p.predictor_user_id).collect();
    let target_ids: Vec<i64> = predictions.iter().map(|p| p.target_user_id).collect();
    let name_columns = r#""id", "name", "avatarUrl""#;
    let predictors: Vec<UserName> =
        rows_in(conn, name_columns, "User", "id", &predictor_ids).await?;
    let targets: Vec<UserName> = rows_in(conn, name_columns, "User", "id", &target_ids).await?;

    let find_user = |users: &[UserName], id: i64, prediction: i64| {
        users
            .iter()
            .find(|user| user.id == id)
            .cloned()
            .ok_or_else(|| {
                LoadError::Inconsistent(format!("SeasonPrediction {prediction} has no user {id}"))
            })
    };
    let mut weeks = Vec::with_capacity(week_rows.len());
    for row in week_rows {
        let mut week_predictions = Vec::new();
        for prediction in predictions.iter().filter(|p| p.week_id == row.id) {
            week_predictions.push(PredictionEntry {
                predictor: find_user(&predictors, prediction.predictor_user_id, prediction.id)?,
                target: find_user(&targets, prediction.target_user_id, prediction.id)?,
                row: prediction.clone(),
            });
        }
        weeks.push(WeekEntry {
            predictions: week_predictions,
            shield_choices: group(&shield_choices, row.id, |c| c.week_id),
            loadouts: group(&loadouts, row.id, |l| l.week_id),
            race: row
                .race_id
                .and_then(|id| races.iter().find(|race| race.id == id).cloned()),
            row,
        });
    }
    Ok(Some(ActiveSeason {
        season,
        players,
        weeks,
        rewards,
    }))
}

/// `race.findFirst({ where: { status: { in: ['pending', 'running'] }, engineVersion: { not: null },
/// participants: { some: { userId } } }, orderBy: { createdAt: 'desc' } })`.
pub async fn live_race(
    conn: &mut SqliteConnection,
    user_id: i64,
) -> Result<Option<LiveRace>, sqlx::Error> {
    sqlx::query_as::<_, LiveRace>(
        r#"SELECT "Race"."id", "Race"."status", "Race"."isTest" FROM "Race"
           WHERE ("Race"."status" IN (?,?) AND "Race"."engineVersion" IS NOT NULL
             AND EXISTS(SELECT "t0"."raceId" FROM "RaceParticipant" AS "t0"
                        WHERE ("t0"."userId" = ? AND ("Race"."id") = ("t0"."raceId") AND "t0"."raceId" IS NOT NULL)))
           ORDER BY "Race"."createdAt" DESC LIMIT ? OFFSET ?"#,
    )
    .bind("pending")
    .bind("running")
    .bind(user_id)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `playerCosmetic.findUnique({ where: { seasonPlayerId_cosmeticId } })` is not null.
pub async fn owns_cosmetic(
    conn: &mut SqliteConnection,
    season_player_id: i64,
    cosmetic_id: &str,
) -> Result<bool, sqlx::Error> {
    let found: Option<String> = sqlx::query_scalar(
        r#"SELECT "PlayerCosmetic"."id" FROM "PlayerCosmetic"
           WHERE (("PlayerCosmetic"."seasonPlayerId" = ? AND "PlayerCosmetic"."cosmeticId" = ?) AND 1=1) LIMIT ? OFFSET ?"#,
    )
    .bind(season_player_id)
    .bind(cosmetic_id)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await?;
    Ok(found.is_some())
}

/// `playerAppearance.update({ where: { seasonPlayerId }, data: { favoriteId } })`. `None` when
/// the player has no appearance row (Prisma throws P2025).
pub async fn set_favorite(
    conn: &mut SqliteConnection,
    season_player_id: i64,
    favorite_id: Option<&str>,
) -> Result<Option<PlayerAppearanceRow>, sqlx::Error> {
    sqlx::query_as::<_, PlayerAppearanceRow>(AssertSqlSafe(format!(
        r#"UPDATE "PlayerAppearance" SET "favoriteId" = ?, "updatedAt" = ?
           WHERE ("PlayerAppearance"."seasonPlayerId" = ? AND 1=1) RETURNING {APPEARANCE_COLUMNS}"#
    )))
    .bind(favorite_id)
    .bind(DbTime::now())
    .bind(season_player_id)
    .fetch_optional(conn)
    .await
}

/// `cosmeticPreset.findUnique({ where: { seasonPlayerId_slotIndex } })`.
pub async fn find_preset(
    conn: &mut SqliteConnection,
    season_player_id: i64,
    slot_index: i64,
) -> Result<Option<CosmeticPresetRow>, sqlx::Error> {
    sqlx::query_as::<_, CosmeticPresetRow>(AssertSqlSafe(format!(
        r#"SELECT {PRESET_COLUMNS} FROM "CosmeticPreset"
           WHERE (("CosmeticPreset"."seasonPlayerId" = ? AND "CosmeticPreset"."slotIndex" = ?) AND 1=1) LIMIT ? OFFSET ?"#
    )))
    .bind(season_player_id)
    .bind(slot_index)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `cosmeticPreset.upsert` keyed by `(seasonPlayerId, slotIndex)`.
pub async fn upsert_preset(
    conn: &mut SqliteConnection,
    season_player_id: i64,
    slot_index: i64,
    name: &str,
    appearance_json: &str,
) -> Result<CosmeticPresetRow, sqlx::Error> {
    let now = DbTime::now();
    sqlx::query_as::<_, CosmeticPresetRow>(AssertSqlSafe(format!(
        r#"INSERT INTO "CosmeticPreset" ("id", "seasonPlayerId", "slotIndex", "name", "appearanceJson", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("seasonPlayerId", "slotIndex") DO UPDATE SET "name" = ?, "appearanceJson" = ?, "updatedAt" = ?
           WHERE (("CosmeticPreset"."seasonPlayerId" = ? AND "CosmeticPreset"."slotIndex" = ?) AND 1=1)
           RETURNING {PRESET_COLUMNS}"#
    )))
    .bind(cuid())
    .bind(season_player_id)
    .bind(slot_index)
    .bind(name)
    .bind(appearance_json)
    .bind(now)
    .bind(now)
    .bind(name)
    .bind(appearance_json)
    .bind(now)
    .bind(season_player_id)
    .bind(slot_index)
    .fetch_one(conn)
    .await
}

/// `playerCosmetic.updateMany({ where: { seasonPlayerId, isNew: true }, data: { isNew: false } })`.
pub async fn mark_cosmetics_seen(
    conn: &mut SqliteConnection,
    season_player_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"UPDATE "PlayerCosmetic" SET "isNew" = ? WHERE ("PlayerCosmetic"."seasonPlayerId" = ? AND "PlayerCosmetic"."isNew" = ?)"#,
    )
    .bind(false)
    .bind(season_player_id)
    .bind(true)
    .execute(conn)
    .await?;
    Ok(())
}

/// `seasonPlayer.update({ data: { cosmeticsOnboarded: true } })`.
pub async fn mark_onboarded(
    conn: &mut SqliteConnection,
    season_player_id: i64,
) -> Result<(), sqlx::Error> {
    let result = sqlx::query(
        r#"UPDATE "SeasonPlayer" SET "cosmeticsOnboarded" = ?, "updatedAt" = ? WHERE ("SeasonPlayer"."id" = ? AND 1=1)"#,
    )
    .bind(true)
    .bind(DbTime::now())
    .bind(season_player_id)
    .execute(conn)
    .await?;
    if result.rows_affected() == 0 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

/// Re-reads the week inside the write transaction (not in TS): `Some(skippedPlayerIdsJson)` when
/// it is still `open`, `None` once an admin locked, resolved or removed it. The route's pre-check
/// reads on the reader pool before `BEGIN IMMEDIATE`, so a concurrent `lock` or `toggle-skip`
/// could otherwise commit in between and a player write land on a locked week, or bring back a
/// skipped player's rows.
pub async fn open_week_skip_list(
    conn: &mut SqliteConnection,
    week_id: i64,
) -> Result<Option<Option<String>>, sqlx::Error> {
    let row: Option<(String, Option<String>)> = sqlx::query_as(
        r#"SELECT "status", "skippedPlayerIdsJson" FROM "SeasonWeek" WHERE "id" = ?"#,
    )
    .bind(week_id)
    .fetch_optional(conn)
    .await?;
    Ok(row.and_then(|(status, skipped)| (status == "open").then_some(skipped)))
}

/// `seasonShieldChoice.deleteMany({ where: { weekId, seasonPlayerId } })`.
pub async fn delete_shield_choice(
    conn: &mut SqliteConnection,
    week_id: i64,
    season_player_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"DELETE FROM "SeasonShieldChoice" WHERE ("SeasonShieldChoice"."weekId" = ? AND "SeasonShieldChoice"."seasonPlayerId" = ?)"#,
    )
    .bind(week_id)
    .bind(season_player_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// `seasonShieldChoice.upsert({ create: { weekId, seasonPlayerId, userId }, update: { confirmedAt: new Date() } })`.
pub async fn upsert_shield_choice(
    conn: &mut SqliteConnection,
    week_id: i64,
    season_player_id: i64,
    user_id: i64,
) -> Result<(), sqlx::Error> {
    let now = DbTime::now();
    sqlx::query(
        r#"INSERT INTO "SeasonShieldChoice" ("weekId", "seasonPlayerId", "userId", "confirmedAt") VALUES (?, ?, ?, ?)
           ON CONFLICT ("weekId", "seasonPlayerId") DO UPDATE SET "confirmedAt" = ?
           WHERE (("SeasonShieldChoice"."weekId" = ? AND "SeasonShieldChoice"."seasonPlayerId" = ?) AND 1=1)"#,
    )
    .bind(week_id)
    .bind(season_player_id)
    .bind(user_id)
    .bind(now)
    .bind(now)
    .bind(week_id)
    .bind(season_player_id)
    .execute(conn)
    .await?;
    Ok(())
}

/// `seasonLoadout.upsert` keyed by `(weekId, seasonPlayerId)`.
pub async fn upsert_loadout(
    conn: &mut SqliteConnection,
    week_id: i64,
    player: &SeasonPlayerRow,
    item_ids_json: &str,
    status: &str,
    locked_at: Option<DbTime>,
) -> Result<(), sqlx::Error> {
    let now = DbTime::now();
    sqlx::query(
        r#"INSERT INTO "SeasonLoadout" ("weekId", "seasonPlayerId", "userId", "itemIdsJson", "status", "lockedAt", "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT ("weekId", "seasonPlayerId") DO UPDATE SET "itemIdsJson" = ?, "status" = ?, "lockedAt" = ?, "updatedAt" = ?
           WHERE (("SeasonLoadout"."weekId" = ? AND "SeasonLoadout"."seasonPlayerId" = ?) AND 1=1)"#,
    )
    .bind(week_id)
    .bind(player.id)
    .bind(player.user_id)
    .bind(item_ids_json)
    .bind(status)
    .bind(locked_at)
    .bind(now)
    .bind(now)
    .bind(item_ids_json)
    .bind(status)
    .bind(locked_at)
    .bind(now)
    .bind(week_id)
    .bind(player.id)
    .execute(conn)
    .await?;
    Ok(())
}

/// `seasonPrediction.upsert` keyed by `(weekId, predictorPlayerId)`; the update resets
/// `pointsAwarded` to 0.
pub async fn upsert_prediction(
    conn: &mut SqliteConnection,
    week_id: i64,
    player: &SeasonPlayerRow,
    target_user_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "SeasonPrediction" ("weekId", "predictorPlayerId", "predictorUserId", "targetUserId", "pointsAwarded", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT ("weekId", "predictorPlayerId") DO UPDATE SET "targetUserId" = ?, "pointsAwarded" = ?
           WHERE (("SeasonPrediction"."weekId" = ? AND "SeasonPrediction"."predictorPlayerId" = ?) AND 1=1)"#,
    )
    .bind(week_id)
    .bind(player.id)
    .bind(player.user_id)
    .bind(target_user_id)
    .bind(0_i64)
    .bind(DbTime::now())
    .bind(target_user_id)
    .bind(0_i64)
    .bind(week_id)
    .bind(player.id)
    .execute(conn)
    .await?;
    Ok(())
}

/// The redeem route's `season.findFirst({ where: { status: { in: ['active', 'completed'] } },
/// orderBy: { createdAt: 'desc' }, include: { players: true, rewards: true } })`.
pub struct RedeemSeason {
    pub season: SeasonRow,
    pub players: Vec<SeasonPlayerRow>,
    pub rewards: Vec<SeasonRewardRow>,
}

pub async fn load_redeem_season(
    conn: &mut SqliteConnection,
) -> Result<Option<RedeemSeason>, sqlx::Error> {
    let Some(season) = sqlx::query_as::<_, SeasonRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_COLUMNS} FROM "Season" WHERE "Season"."status" IN (?,?) ORDER BY "Season"."createdAt" DESC LIMIT ? OFFSET ?"#
    )))
    .bind("active")
    .bind("completed")
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Ok(None);
    };
    let players: Vec<SeasonPlayerRow> = rows_in(
        conn,
        SEASON_PLAYER_COLUMNS,
        "SeasonPlayer",
        "seasonId",
        &[season.id],
    )
    .await?;
    let rewards: Vec<SeasonRewardRow> = rows_in(
        conn,
        REWARD_COLUMNS,
        "SeasonReward",
        "seasonId",
        &[season.id],
    )
    .await?;
    Ok(Some(RedeemSeason {
        season,
        players,
        rewards,
    }))
}

/// The redeem transaction body: decrement the points, decrement a finite stock, record the
/// redemption. Runs on the caller's write transaction.
pub async fn redeem(
    conn: &mut SqliteConnection,
    season_id: i64,
    player_id: i64,
    reward: &SeasonRewardRow,
) -> Result<SeasonRedemptionRow, sqlx::Error> {
    let now = DbTime::now();
    let updated = sqlx::query(
        r#"UPDATE "SeasonPlayer" SET "predictionPoints" = ("SeasonPlayer"."predictionPoints" - ?), "updatedAt" = ?
           WHERE ("SeasonPlayer"."id" = ? AND 1=1)"#,
    )
    .bind(reward.cost)
    .bind(now)
    .bind(player_id)
    .execute(&mut *conn)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(sqlx::Error::RowNotFound);
    }
    if reward.stock.is_some() {
        let updated = sqlx::query(
            r#"UPDATE "SeasonReward" SET "stock" = ("SeasonReward"."stock" - ?) WHERE ("SeasonReward"."id" = ? AND 1=1)"#,
        )
        .bind(1_i64)
        .bind(reward.id)
        .execute(&mut *conn)
        .await?;
        if updated.rows_affected() == 0 {
            return Err(sqlx::Error::RowNotFound);
        }
    }
    sqlx::query_as::<_, SeasonRedemptionRow>(AssertSqlSafe(format!(
        r#"INSERT INTO "SeasonRedemption" ("seasonId", "seasonPlayerId", "rewardId", "pointsSpent", "status", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?) RETURNING {REDEMPTION_COLUMNS}"#
    )))
    .bind(season_id)
    .bind(player_id)
    .bind(reward.id)
    .bind(reward.cost)
    .bind("requested")
    .bind(now)
    .fetch_one(conn)
    .await
}

/// `text.slice(0, max)` in UTF-16 code units, as stored by better-sqlite3: a surrogate pair cut
/// in half leaves a lone high surrogate, which the UTF-8 conversion writes as U+FFFD
/// (verified against the TS app).
#[must_use]
pub fn js_slice_utf16(text: &str, max: usize) -> String {
    let mut out = String::new();
    let mut units = 0;
    for ch in text.chars() {
        let width = ch.len_utf16();
        if units + width > max {
            if units < max {
                out.push('\u{FFFD}');
            }
            break;
        }
        out.push(ch);
        units += width;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slice_counts_utf16_units() {
        assert_eq!(js_slice_utf16("abc", 30), "abc");
        assert_eq!(js_slice_utf16("abcdef", 3), "abc");
        assert_eq!(js_slice_utf16("ĐUA DZỊT", 4), "ĐUA ");
        let name = format!("{}😀xyz", "a".repeat(29));
        assert_eq!(
            js_slice_utf16(&name, 30),
            format!("{}\u{FFFD}", "a".repeat(29))
        );
        let name = format!("{}😀xyz", "a".repeat(28));
        assert_eq!(js_slice_utf16(&name, 30), format!("{}😀", "a".repeat(28)));
        assert_eq!(js_slice_utf16("", 30), "");
    }
}
