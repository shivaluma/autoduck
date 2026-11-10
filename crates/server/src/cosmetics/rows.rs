//! Rows of the economy tables, decoded and serialised exactly like the Prisma client returns them
//! (every scalar field in schema order, `Boolean` as `true/false`, `DateTime` as `toISOString()`).
//!
//! Queries mirror the SQL Prisma 7 issues for the TS routes (captured with the query log): the
//! same `WHERE` shape, `LIMIT ? OFFSET ?` and no `ORDER BY` where Prisma has none. SQLite then
//! picks the same plan, so rows without an explicit order (relation includes, `findMany()`) come
//! back in the same order as on the TS server. Relation includes are separate `IN (…)` queries
//! joined in memory, as Prisma does.

use serde::Serialize;
use sqlx::AssertSqlSafe;
use sqlx::{FromRow, SqliteConnection};

use crate::db::DbTime;

pub const SEASON_PLAYER_COLUMNS: &str = r#""SeasonPlayer"."id", "SeasonPlayer"."seasonId", "SeasonPlayer"."userId", "SeasonPlayer"."accessToken", "SeasonPlayer"."scars", "SeasonPlayer"."shields", "SeasonPlayer"."shieldsUsed", "SeasonPlayer"."predictionPoints", "SeasonPlayer"."kingStreak", "SeasonPlayer"."isKing", "SeasonPlayer"."raceWins", "SeasonPlayer"."raceCount", "SeasonPlayer"."championshipPoints", "SeasonPlayer"."quackPoints", "SeasonPlayer"."rarePity", "SeasonPlayer"."epicPity", "SeasonPlayer"."legendaryPity", "SeasonPlayer"."cosmeticsOnboarded", "SeasonPlayer"."createdAt", "SeasonPlayer"."updatedAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SeasonPlayerRow {
    pub id: i64,
    pub season_id: i64,
    pub user_id: i64,
    pub access_token: String,
    pub scars: i64,
    pub shields: i64,
    pub shields_used: i64,
    pub prediction_points: i64,
    pub king_streak: i64,
    pub is_king: bool,
    pub race_wins: i64,
    pub race_count: i64,
    pub championship_points: i64,
    pub quack_points: i64,
    pub rare_pity: i64,
    pub epic_pity: i64,
    pub legendary_pity: i64,
    pub cosmetics_onboarded: bool,
    pub created_at: DbTime,
    pub updated_at: DbTime,
}

pub const SEASON_COLUMNS: &str =
    r#""id", "key", "name", "year", "weeks", "status", "championUserId", "createdAt", "endedAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct SeasonRow {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub year: i64,
    pub weeks: i64,
    pub status: String,
    pub champion_user_id: Option<i64>,
    pub created_at: DbTime,
    pub ended_at: Option<DbTime>,
}

pub const USER_COLUMNS: &str = r#""id", "name", "email", "googleId", "avatarUrl", "scars", "shields", "shieldsUsed", "totalKhaos", "cleanStreak", "isBoss", "bossSince", "createdAt", "updatedAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct UserRow {
    pub id: i64,
    pub name: String,
    pub email: Option<String>,
    pub google_id: Option<String>,
    pub avatar_url: Option<String>,
    pub scars: i64,
    pub shields: i64,
    pub shields_used: i64,
    pub total_khaos: i64,
    pub clean_streak: i64,
    pub is_boss: bool,
    pub boss_since: Option<DbTime>,
    pub created_at: DbTime,
    pub updated_at: DbTime,
}

pub const APPEARANCE_COLUMNS: &str = r#""id", "seasonPlayerId", "bodyColorId", "bodySkinId", "faceId", "headId", "neckId", "outfitId", "backId", "petId", "auraId", "trailId", "finishId", "nameplateId", "favoriteId", "updatedAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct PlayerAppearanceRow {
    pub id: String,
    pub season_player_id: i64,
    pub body_color_id: String,
    pub body_skin_id: Option<String>,
    pub face_id: Option<String>,
    pub head_id: Option<String>,
    pub neck_id: Option<String>,
    pub outfit_id: Option<String>,
    pub back_id: Option<String>,
    pub pet_id: Option<String>,
    pub aura_id: Option<String>,
    pub trail_id: Option<String>,
    pub finish_id: Option<String>,
    pub nameplate_id: Option<String>,
    pub favorite_id: Option<String>,
    pub updated_at: DbTime,
}

impl PlayerAppearanceRow {
    /// `appearance[`${slot}Id`]` for the slots the admin dashboard counts.
    pub fn slot(&self, key: &str) -> Option<&str> {
        match key {
            "headId" => self.head_id.as_deref(),
            "petId" => self.pet_id.as_deref(),
            "auraId" => self.aura_id.as_deref(),
            _ => None,
        }
    }
}

pub const COSMETIC_COLUMNS: &str =
    r#""id", "seasonPlayerId", "cosmeticId", "source", "sourceReferenceId", "isNew", "obtainedAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct PlayerCosmeticRow {
    pub id: String,
    pub season_player_id: i64,
    pub cosmetic_id: String,
    pub source: String,
    pub source_reference_id: Option<String>,
    pub is_new: bool,
    pub obtained_at: DbTime,
}

pub const CURRENCY_COLUMNS: &str = r#""id", "seasonPlayerId", "amount", "reason", "raceId", "cosmeticId", "gachaPullId", "idempotencyKey", "balanceAfter", "metadataJson", "createdAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct CurrencyTransactionRow {
    pub id: String,
    pub season_player_id: i64,
    pub amount: i64,
    pub reason: String,
    pub race_id: Option<i64>,
    pub cosmetic_id: Option<String>,
    pub gacha_pull_id: Option<String>,
    pub idempotency_key: String,
    pub balance_after: i64,
    pub metadata_json: Option<String>,
    pub created_at: DbTime,
}

pub const GACHA_COLUMNS: &str = r#""id", "seasonPlayerId", "cost", "rolledRarity", "finalCosmeticId", "wasDuplicate", "wasRerolled", "refundAmount", "rarePityBefore", "rarePityAfter", "epicPityBefore", "epicPityAfter", "legendaryPityBefore", "legendaryPityAfter", "createdAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct GachaPullRow {
    pub id: String,
    pub season_player_id: i64,
    pub cost: i64,
    pub rolled_rarity: String,
    pub final_cosmetic_id: Option<String>,
    pub was_duplicate: bool,
    pub was_rerolled: bool,
    pub refund_amount: i64,
    pub rare_pity_before: i64,
    pub rare_pity_after: i64,
    pub epic_pity_before: i64,
    pub epic_pity_after: i64,
    pub legendary_pity_before: i64,
    pub legendary_pity_after: i64,
    pub created_at: DbTime,
}

pub const ROTATION_COLUMNS: &str =
    r#""id", "seasonId", "weekKey", "startsAt", "endsAt", "itemsJson", "createdAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct ShopRotationRow {
    pub id: String,
    pub season_id: i64,
    pub week_key: String,
    pub starts_at: DbTime,
    pub ends_at: DbTime,
    pub items_json: String,
    pub created_at: DbTime,
}

pub const CONFIG_COLUMNS: &str = r#""cosmeticId", "enabled", "shopEligible", "gachaEligible", "priceOverride", "limitedLabel", "updatedAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct CosmeticConfigRow {
    pub cosmetic_id: String,
    pub enabled: bool,
    pub shop_eligible: Option<bool>,
    pub gacha_eligible: Option<bool>,
    pub price_override: Option<i64>,
    pub limited_label: Option<String>,
    pub updated_at: DbTime,
}

pub const ADMIN_EVENT_COLUMNS: &str =
    r#""id", "action", "actor", "playerId", "cosmeticId", "metadataJson", "createdAt""#;

#[derive(Debug, Clone, FromRow, Serialize)]
#[sqlx(rename_all = "camelCase")]
#[serde(rename_all = "camelCase")]
pub struct CosmeticAdminEventRow {
    pub id: String,
    pub action: String,
    pub actor: String,
    pub player_id: Option<i64>,
    pub cosmetic_id: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: DbTime,
}

/// `?, ?, …` for an `IN (…)` list (callers never pass an empty list).
pub fn placeholders(count: usize) -> String {
    vec!["?"; count].join(",")
}

/// `seasonPlayer.findUnique({ where: { accessToken } })`.
pub async fn player_by_token(
    conn: &mut SqliteConnection,
    token: &str,
) -> Result<Option<SeasonPlayerRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonPlayerRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_PLAYER_COLUMNS} FROM "SeasonPlayer" WHERE "SeasonPlayer"."accessToken" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(token)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `seasonPlayer.findUnique({ where: { id } })`.
pub async fn player_by_id(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Option<SeasonPlayerRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonPlayerRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_PLAYER_COLUMNS} FROM "SeasonPlayer" WHERE "SeasonPlayer"."id" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(id)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `include: { cosmetics: true }` for one player (no `ORDER BY`, as Prisma).
pub async fn player_cosmetics(
    conn: &mut SqliteConnection,
    season_player_id: i64,
) -> Result<Vec<PlayerCosmeticRow>, sqlx::Error> {
    sqlx::query_as::<_, PlayerCosmeticRow>(AssertSqlSafe(format!(
        r#"SELECT {COSMETIC_COLUMNS} FROM "PlayerCosmetic" WHERE "PlayerCosmetic"."seasonPlayerId" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(season_player_id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(conn)
    .await
}

/// `include: { season: true }` for one player.
pub async fn season_by_id(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Option<SeasonRow>, sqlx::Error> {
    sqlx::query_as::<_, SeasonRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_COLUMNS} FROM "Season" WHERE "Season"."id" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `currencyTransaction.findUnique({ where: { idempotencyKey } })`.
pub async fn transaction_by_key(
    conn: &mut SqliteConnection,
    key: &str,
) -> Result<Option<CurrencyTransactionRow>, sqlx::Error> {
    sqlx::query_as::<_, CurrencyTransactionRow>(AssertSqlSafe(format!(
        r#"SELECT {CURRENCY_COLUMNS} FROM "CurrencyTransaction" WHERE "CurrencyTransaction"."idempotencyKey" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(key)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `gachaPull.findUnique({ where: { id } })`.
pub async fn gacha_pull_by_id(
    conn: &mut SqliteConnection,
    id: &str,
) -> Result<Option<GachaPullRow>, sqlx::Error> {
    sqlx::query_as::<_, GachaPullRow>(AssertSqlSafe(format!(
        r#"SELECT {GACHA_COLUMNS} FROM "GachaPull" WHERE "GachaPull"."id" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(id)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `cosmeticConfig.findMany()`.
pub async fn all_configs(
    conn: &mut SqliteConnection,
) -> Result<Vec<CosmeticConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, CosmeticConfigRow>(AssertSqlSafe(format!(
        r#"SELECT {CONFIG_COLUMNS} FROM "CosmeticConfig" WHERE 1=1 LIMIT ? OFFSET ?"#
    )))
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(conn)
    .await
}

/// `cosmeticConfig.findUnique({ where: { cosmeticId } })`.
pub async fn config_by_id(
    conn: &mut SqliteConnection,
    cosmetic_id: &str,
) -> Result<Option<CosmeticConfigRow>, sqlx::Error> {
    sqlx::query_as::<_, CosmeticConfigRow>(AssertSqlSafe(format!(
        r#"SELECT {CONFIG_COLUMNS} FROM "CosmeticConfig" WHERE "CosmeticConfig"."cosmeticId" = ? LIMIT ? OFFSET ?"#
    )))
    .bind(cosmetic_id)
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}
