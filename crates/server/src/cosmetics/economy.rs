//! Quack Points: a port of `lib/cosmetics/economy.ts`.
//!
//! [`apply_quack_transaction`] runs inside the caller's write transaction (`BEGIN IMMEDIATE` on
//! the writer, D15) and is idempotent by `idempotencyKey`, exactly like the TS helper:
//! an existing ledger row is returned untouched; otherwise the balance moves (never below zero
//! for a spend) and one ledger row is written with the new balance.

use sqlx::AssertSqlSafe;
use sqlx::SqliteConnection;

use super::ids::cuid;
use super::rows::{CURRENCY_COLUMNS, CurrencyTransactionRow, transaction_by_key};
use crate::db::DbTime;

/// `QUACK_ECONOMY`.
pub const RACE_WIN: i64 = 5;
pub const PREDICTION_TWO_LOSERS: i64 = 2;
pub const PREDICTION_MANY_LOSERS: i64 = 1;
pub const PERFECT_WEEK: i64 = 1;
pub const PERFECT_WEEK_ENABLED: bool = true;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QuackReason {
    RaceWin,
    PredictionWin,
    PerfectWeek,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuackReward {
    pub player_id: i64,
    pub amount: i64,
    pub reason: QuackReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Prediction {
    pub predictor_user_id: i64,
    pub target_user_id: i64,
}

/// `calculateOfficialRaceQuackRewards(input)`.
pub fn official_race_quack_rewards(
    winner_user_id: i64,
    final_loser_user_ids: &[i64],
    predictions: &[Prediction],
    perfect_week_enabled: Option<bool>,
) -> Vec<QuackReward> {
    let mut losers: Vec<i64> = final_loser_user_ids.to_vec();
    losers.sort();
    losers.dedup();
    let prediction_amount = if losers.len() == 2 {
        PREDICTION_TWO_LOSERS
    } else {
        PREDICTION_MANY_LOSERS
    };
    let mut rewards = vec![QuackReward {
        player_id: winner_user_id,
        amount: RACE_WIN,
        reason: QuackReason::RaceWin,
    }];
    for prediction in predictions {
        if losers.binary_search(&prediction.target_user_id).is_err() {
            continue;
        }
        rewards.push(QuackReward {
            player_id: prediction.predictor_user_id,
            amount: prediction_amount,
            reason: QuackReason::PredictionWin,
        });
        if prediction.predictor_user_id == winner_user_id
            && perfect_week_enabled.unwrap_or(PERFECT_WEEK_ENABLED)
        {
            rewards.push(QuackReward {
                player_id: prediction.predictor_user_id,
                amount: PERFECT_WEEK,
                reason: QuackReason::PerfectWeek,
            });
        }
    }
    rewards
}

/// The `applyQuackTransaction` input. `metadata_json` is `JSON.stringify(metadata)` already.
#[derive(Clone, Debug, Default)]
pub struct QuackInput<'a> {
    pub season_player_id: i64,
    pub amount: i64,
    pub reason: &'a str,
    pub idempotency_key: &'a str,
    pub race_id: Option<i64>,
    pub cosmetic_id: Option<&'a str>,
    pub gacha_pull_id: Option<&'a str>,
    pub metadata_json: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum QuackError {
    #[error("QP amount must be a non-zero integer")]
    InvalidAmount,
    /// Prisma's P2025 for the guarded update: the player is missing or (for a spend) the
    /// balance is below the amount. The ledger is untouched.
    #[error("No record was found for an update.")]
    NotFound,
    /// The amount or the resulting balance is outside JS's safe-integer range. Prisma throws
    /// when it reads such a value back (`Integer value … is too large to represent as a
    /// JavaScript number`), so TS rolls the transaction back; writing it here would make the
    /// row unreadable by the rollback image (review 1, finding 1).
    #[error("QP value {0} is outside the JS safe-integer range")]
    UnsafeInteger(i64),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// `Number.MAX_SAFE_INTEGER`.
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

fn ensure_safe(value: i64) -> Result<i64, QuackError> {
    if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value) {
        Ok(value)
    } else {
        Err(QuackError::UnsafeInteger(value))
    }
}

/// `applyQuackTransaction(tx, input)` on the caller's transaction connection.
pub async fn apply_quack_transaction(
    conn: &mut SqliteConnection,
    input: &QuackInput<'_>,
) -> Result<CurrencyTransactionRow, QuackError> {
    if input.amount == 0 {
        return Err(QuackError::InvalidAmount);
    }
    if let Some(existing) = transaction_by_key(conn, input.idempotency_key).await? {
        return Ok(existing);
    }
    // Checked before the UPDATE so `quackPoints + amount` can never leave i64 (SQLite would
    // silently turn it into a REAL). Same outcome as TS: the caller's transaction rolls back.
    ensure_safe(input.amount)?;
    let now = DbTime::now();
    let balance: Option<i64> = if input.amount > 0 {
        sqlx::query_scalar(
            r#"UPDATE "SeasonPlayer" SET "quackPoints" = "quackPoints" + ?, "updatedAt" = ?
               WHERE "id" = ? RETURNING "quackPoints""#,
        )
        .bind(input.amount)
        .bind(now)
        .bind(input.season_player_id)
        .fetch_optional(&mut *conn)
        .await?
    } else {
        sqlx::query_scalar(
            r#"UPDATE "SeasonPlayer" SET "quackPoints" = "quackPoints" + ?, "updatedAt" = ?
               WHERE "id" = ? AND "quackPoints" >= ? RETURNING "quackPoints""#,
        )
        .bind(input.amount)
        .bind(now)
        .bind(input.season_player_id)
        .bind(-input.amount)
        .fetch_optional(&mut *conn)
        .await?
    };
    let balance = ensure_safe(balance.ok_or(QuackError::NotFound)?)?;
    let row = sqlx::query_as::<_, CurrencyTransactionRow>(AssertSqlSafe(format!(
        r#"INSERT INTO "CurrencyTransaction" ("id", "seasonPlayerId", "amount", "reason", "raceId",
               "cosmeticId", "gachaPullId", "idempotencyKey", "balanceAfter", "metadataJson", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING {CURRENCY_COLUMNS}"#
    )))
    .bind(cuid())
    .bind(input.season_player_id)
    .bind(input.amount)
    .bind(input.reason)
    .bind(input.race_id)
    .bind(input.cosmetic_id)
    .bind(input.gacha_pull_id)
    .bind(input.idempotency_key)
    .bind(balance)
    .bind(input.metadata_json.as_deref())
    .bind(now)
    .fetch_one(&mut *conn)
    .await?;
    Ok(row)
}
