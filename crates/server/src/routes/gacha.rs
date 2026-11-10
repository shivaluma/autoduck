//! `POST /api/gacha/pull`: Mystery Egg pull with pity and `idempotencyKey`.
//!
//! Port of `app/api/gacha/pull/route.ts` over [`crate::cosmetics::gacha`] (selection and pity,
//! bit-exact for the same rolls) and [`crate::cosmetics::economy`]. Rolls are
//! `randomInt(1_000_000) / 1_000_000` ([`crate::cosmetics::ids::random_unit`]).
//!
//! The whole pull is one `BEGIN IMMEDIATE` transaction on the writer (D15). As in TS, any error
//! inside it answers 409: "Không đủ QP" when the fresh balance is short, otherwise
//! "Mystery Egg chưa mở được".

use std::collections::{HashMap, HashSet};

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use serde::Serialize;
use serde_json::Value;
use sqlx::AssertSqlSafe;

use crate::cosmetics::economy::{QuackInput, apply_quack_transaction};
use crate::cosmetics::gacha::{self, CONFIG_JSON, Pity, select_gacha_result};
use crate::cosmetics::ids::{cuid, random_unit, uuid_v4};
use crate::cosmetics::js;
use crate::cosmetics::rows::{
    CosmeticConfigRow, GACHA_COLUMNS, GachaPullRow, all_configs, gacha_pull_by_id, player_by_id,
    player_by_token, player_cosmetics, transaction_by_key,
};
use crate::cosmetics::{CosmeticItem, catalog};
use crate::db::DbTime;
use crate::error::{ApiError, ApiResult};
use crate::http::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/gacha/pull", post(pull))
}

/// `{ ok: true, pull, balance, config: GACHA_CONFIG }`.
#[derive(Serialize)]
struct Reveal<'a> {
    ok: bool,
    pull: &'a GachaPullRow,
    balance: i64,
    config: Value,
}

fn reveal(pull: &GachaPullRow, balance: i64) -> Response {
    // CONFIG_JSON is a checked constant (unit test in cosmetics::gacha).
    let config = serde_json::from_str(CONFIG_JSON).unwrap_or(Value::Null);
    axum::Json(Reveal {
        ok: true,
        pull,
        balance,
        config,
    })
    .into_response()
}

#[derive(Debug, thiserror::Error)]
enum PullError {
    #[error("INSUFFICIENT_QP")]
    InsufficientQp,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl From<sqlx::Error> for PullError {
    fn from(error: sqlx::Error) -> Self {
        PullError::Other(error.into())
    }
}

async fn pull(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Response> {
    let body = body?;
    let body =
        js::parse_body(&body).ok_or_else(|| ApiError::internal("gacha: body is not JSON"))?;
    if body.is_null() {
        return Err(ApiError::internal("gacha: body is null"));
    }
    let token = js::property(&body, "token");
    let idempotency_key = js::property(&body, "idempotencyKey");
    if !js::truthy(token) || !js::truthy(idempotency_key) {
        return Err(ApiError::bad_request("Request không hợp lệ"));
    }
    // Truthy non-strings fail Prisma validation in TS (500).
    let Some(Value::String(token)) = token else {
        return Err(ApiError::internal("gacha: token is not a string"));
    };

    let mut conn = state.db().reader.acquire().await?;
    let Some(player) = player_by_token(&mut conn, token).await? else {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Personal link không hợp lệ",
        ));
    };
    let Some(Value::String(idempotency_key)) = idempotency_key else {
        return Err(ApiError::internal("gacha: idempotencyKey is not a string"));
    };
    if let Some(previous) = transaction_by_key(&mut conn, idempotency_key).await?
        && previous.season_player_id == player.id
        && let Some(pull_id) = previous.gacha_pull_id.as_deref()
        && let Some(pull) = gacha_pull_by_id(&mut conn, pull_id).await?
    {
        return Ok(reveal(&pull, previous.balance_after + pull.refund_amount));
    }
    drop(conn);
    if player.quack_points < gacha::COST {
        return Err(ApiError::conflict("Cần 3 QP để mở Mystery Egg"));
    }

    match pull_transaction(&state, player.id, idempotency_key).await {
        Ok((pull, balance)) => Ok(reveal(&pull, balance)),
        Err(PullError::InsufficientQp) => Err(ApiError::conflict("Không đủ QP")),
        Err(PullError::Other(error)) => {
            tracing::warn!(error = %error, "gacha pull failed");
            Err(ApiError::conflict("Mystery Egg chưa mở được"))
        }
    }
}

/// `COSMETIC_CATALOG.filter(enabled && (override.gachaEligible ?? item.gachaEligible))`.
fn gacha_catalog(configs: &[CosmeticConfigRow]) -> Vec<&'static CosmeticItem> {
    let by_id: HashMap<&str, &CosmeticConfigRow> = configs
        .iter()
        .map(|config| (config.cosmetic_id.as_str(), config))
        .collect();
    catalog()
        .items
        .iter()
        .filter(|item| {
            let config = by_id.get(item.id.as_str());
            config.is_none_or(|config| config.enabled)
                && config
                    .and_then(|config| config.gacha_eligible)
                    .unwrap_or(item.gacha_eligible)
        })
        .collect()
}

async fn pull_transaction(
    state: &AppState,
    player_id: i64,
    idempotency_key: &str,
) -> Result<(GachaPullRow, i64), PullError> {
    let mut tx = state.db().begin_write().await?;
    if let Some(previous) = transaction_by_key(&mut tx, idempotency_key).await?
        && let Some(pull_id) = previous.gacha_pull_id.as_deref()
        && let Some(pull) = gacha_pull_by_id(&mut tx, pull_id).await?
    {
        tx.commit().await?;
        let balance = previous.balance_after + pull.refund_amount;
        return Ok((pull, balance));
    }

    let fresh = player_by_id(&mut tx, player_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("player {player_id} disappeared"))?;
    let owned: HashSet<String> = player_cosmetics(&mut tx, fresh.id)
        .await?
        .into_iter()
        .map(|cosmetic| cosmetic.cosmetic_id)
        .collect();
    if fresh.quack_points < gacha::COST {
        return Err(PullError::InsufficientQp);
    }
    let configs = all_configs(&mut tx).await?;
    let pity = Pity {
        rare_pity: fresh.rare_pity,
        epic_pity: fresh.epic_pity,
        legendary_pity: fresh.legendary_pity,
    };
    let result = select_gacha_result(&owned, pity, &gacha_catalog(&configs), &mut random_unit)
        .map_err(anyhow::Error::from)?;
    let pull_id = uuid_v4();
    apply_quack_transaction(
        &mut tx,
        &QuackInput {
            season_player_id: fresh.id,
            amount: -gacha::COST,
            reason: "GACHA_PULL",
            cosmetic_id: Some(&result.final_item.id),
            gacha_pull_id: Some(&pull_id),
            idempotency_key,
            ..QuackInput::default()
        },
    )
    .await
    .map_err(anyhow::Error::from)?;
    let now = DbTime::now();
    if result.refund_amount > 0 {
        let refund_key = format!("{idempotency_key}:refund");
        apply_quack_transaction(
            &mut tx,
            &QuackInput {
                season_player_id: fresh.id,
                amount: result.refund_amount,
                reason: "DUPLICATE_REFUND",
                cosmetic_id: Some(&result.final_item.id),
                gacha_pull_id: Some(&pull_id),
                idempotency_key: &refund_key,
                ..QuackInput::default()
            },
        )
        .await
        .map_err(anyhow::Error::from)?;
    } else {
        sqlx::query(
            r#"INSERT INTO "PlayerCosmetic" ("id", "seasonPlayerId", "cosmeticId", "source", "sourceReferenceId", "isNew", "obtainedAt")
               VALUES (?, ?, ?, 'GACHA', ?, 1, ?)"#,
        )
        .bind(cuid())
        .bind(fresh.id)
        .bind(&result.final_item.id)
        .bind(&pull_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }
    let pull = sqlx::query_as::<_, GachaPullRow>(AssertSqlSafe(format!(
        r#"INSERT INTO "GachaPull" ("id", "seasonPlayerId", "cost", "rolledRarity", "finalCosmeticId",
               "wasDuplicate", "wasRerolled", "refundAmount", "rarePityBefore", "rarePityAfter",
               "epicPityBefore", "epicPityAfter", "legendaryPityBefore", "legendaryPityAfter", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING {GACHA_COLUMNS}"#
    )))
    .bind(&pull_id)
    .bind(fresh.id)
    .bind(gacha::COST)
    .bind(result.rolled_rarity.as_str())
    .bind(&result.final_item.id)
    .bind(result.was_duplicate)
    .bind(result.was_rerolled)
    .bind(result.refund_amount)
    .bind(fresh.rare_pity)
    .bind(result.pity_after.rare_pity)
    .bind(fresh.epic_pity)
    .bind(result.pity_after.epic_pity)
    .bind(fresh.legendary_pity)
    .bind(result.pity_after.legendary_pity)
    .bind(now)
    .fetch_one(&mut *tx)
    .await?;
    let balance: i64 = sqlx::query_scalar(
        r#"UPDATE "SeasonPlayer" SET "rarePity" = ?, "epicPity" = ?, "legendaryPity" = ?, "updatedAt" = ?
           WHERE "id" = ? RETURNING "quackPoints""#,
    )
    .bind(result.pity_after.rare_pity)
    .bind(result.pity_after.epic_pity)
    .bind(result.pity_after.legendary_pity)
    .bind(now)
    .bind(fresh.id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((pull, balance))
}
