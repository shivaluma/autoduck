//! `GET|POST /api/cosmetics/shop`: weekly shop rotation and purchases.
//!
//! Port of `app/api/cosmetics/shop/route.ts` over [`crate::cosmetics::shop`] (rotation,
//! bit-exact) and [`crate::cosmetics::economy`] (the QP ledger).
//!
//! Differences from TS that are not observable on the wire:
//! - the rotation "upsert" reads on the reader pool first and only takes the writer when the
//!   week's row is missing (TS always ran a transaction);
//! - the purchase transaction is `BEGIN IMMEDIATE` on the single writer (D15).
//!
//! A failed purchase transaction answers `409 {"error":"Không mua được món này"}`. TS meant to
//! answer "Không đủ QP" when the guarded balance update failed, but it tested the Prisma error
//! text for `quackPoints`, which the production error format never contains (verified against
//! the TS app with `NODE_ENV=production`), so production answers this message in every case.

use std::collections::{HashMap, HashSet};

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::{Value, json};
use sqlx::{AssertSqlSafe, SqliteConnection};

use crate::auth::player::QueryToken;
use crate::cosmetics::economy::{QuackInput, apply_quack_transaction};
use crate::cosmetics::ids::cuid;
use crate::cosmetics::js;
use crate::cosmetics::rows::{
    CosmeticConfigRow, PlayerCosmeticRow, ROTATION_COLUMNS, SeasonPlayerRow, SeasonRow,
    ShopRotationRow, all_configs, config_by_id, player_by_token, player_cosmetics, season_by_id,
    transaction_by_key,
};
use crate::cosmetics::shop::{
    generate_rotation_pool, personalize_rotation, shop_price, shop_prices_json, shop_week,
};
use crate::cosmetics::{CosmeticItem, catalog};
use crate::db::DbTime;
use crate::error::{ApiError, ApiResult};
use crate::http::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/cosmetics/shop", get(get_shop).post(post_shop))
}

/// `prisma.seasonPlayer.findUnique({ where: { accessToken }, include: { season, cosmetics } })`.
struct Context {
    player: SeasonPlayerRow,
    season: SeasonRow,
    cosmetics: Vec<PlayerCosmeticRow>,
}

impl Context {
    /// `new Set(player.cosmetics.map((item) => item.cosmeticId))`, plus the ids in first-seen
    /// order (`[...owned]`).
    fn owned(&self) -> (HashSet<String>, Vec<String>) {
        let mut set = HashSet::new();
        let mut ordered = Vec::new();
        for cosmetic in &self.cosmetics {
            if set.insert(cosmetic.cosmetic_id.clone()) {
                ordered.push(cosmetic.cosmetic_id.clone());
            }
        }
        (set, ordered)
    }
}

async fn context(conn: &mut SqliteConnection, token: &str) -> ApiResult<Option<Context>> {
    let Some(player) = player_by_token(conn, token).await? else {
        return Ok(None);
    };
    let season = season_by_id(conn, player.season_id)
        .await?
        .ok_or_else(|| ApiError::internal("season player without a season"))?;
    let cosmetics = player_cosmetics(conn, player.id).await?;
    Ok(Some(Context {
        player,
        season,
        cosmetics,
    }))
}

async fn find_rotation(
    conn: &mut SqliteConnection,
    season_id: i64,
    week_key: &str,
) -> Result<Option<ShopRotationRow>, sqlx::Error> {
    sqlx::query_as::<_, ShopRotationRow>(AssertSqlSafe(format!(
        r#"SELECT {ROTATION_COLUMNS} FROM "ShopRotation"
           WHERE (("ShopRotation"."seasonId" = ? AND "ShopRotation"."weekKey" = ?) AND 1=1) LIMIT ? OFFSET ?"#
    )))
    .bind(season_id)
    .bind(week_key)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_optional(conn)
    .await
}

/// `rotationFor(player)`: the season's row for the current Vietnam week, created on first use
/// with `generateRotationPool`.
async fn rotation_for(state: &AppState, season: &SeasonRow) -> ApiResult<ShopRotationRow> {
    let week = shop_week(DbTime::now());
    {
        let mut conn = state.db().reader.acquire().await?;
        if let Some(rotation) = find_rotation(&mut conn, season.id, &week.week_key).await? {
            return Ok(rotation);
        }
    }
    let mut tx = state.db().begin_write().await?;
    if let Some(rotation) = find_rotation(&mut tx, season.id, &week.week_key).await? {
        tx.commit().await?;
        return Ok(rotation);
    }
    let items_json = serde_json::to_string(&generate_rotation_pool(&season.key, &week.week_key))
        .map_err(ApiError::internal)?;
    let rotation = sqlx::query_as::<_, ShopRotationRow>(AssertSqlSafe(format!(
        r#"INSERT INTO "ShopRotation" ("id", "seasonId", "weekKey", "startsAt", "endsAt", "itemsJson", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING {ROTATION_COLUMNS}"#
    )))
    .bind(cuid())
    .bind(season.id)
    .bind(&week.week_key)
    .bind(week.starts_at)
    .bind(week.ends_at)
    .bind(items_json)
    .bind(DbTime::now())
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rotation)
}

/// `JSON.parse(rotation.itemsJson)` as pool ids. Non-string entries can never match a catalog
/// id (`COSMETIC_BY_ID.get(5)` is `undefined`), so they are dropped; anything but an array makes
/// TS throw (`poolIds.flatMap` is not a function) → 500.
fn pool_ids(rotation: &ShopRotationRow) -> ApiResult<Vec<String>> {
    match serde_json::from_str::<Value>(&rotation.items_json) {
        Ok(Value::Array(items)) => Ok(items
            .into_iter()
            .filter_map(|item| match item {
                Value::String(id) => Some(id),
                _ => None,
            })
            .collect()),
        _ => Err(ApiError::internal(format!(
            "ShopRotation {} has a non-array itemsJson",
            rotation.id
        ))),
    }
}

fn offered(context: &Context, rotation: &ShopRotationRow) -> ApiResult<Vec<&'static CosmeticItem>> {
    let (owned, _) = context.owned();
    Ok(personalize_rotation(
        &pool_ids(rotation)?,
        &owned,
        &context.season.key,
        &rotation.week_key,
    ))
}

async fn get_shop(
    State(state): State<AppState>,
    QueryToken(token): QueryToken,
) -> ApiResult<Response> {
    let context = match token.as_deref() {
        Some(token) => {
            let mut conn = state.db().reader.acquire().await?;
            context(&mut conn, token).await?
        }
        None => None,
    };
    let Some(context) = context else {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Personal link không hợp lệ",
        ));
    };
    let rotation = rotation_for(&state, &context.season).await?;
    let (_, owned_ids) = context.owned();
    let configs = {
        let mut conn = state.db().reader.acquire().await?;
        all_configs(&mut conn).await?
    };
    // `new Map(configs.map(...))`: a later row with the same id wins (ids are unique anyway).
    let config_by_id: HashMap<&str, &CosmeticConfigRow> = configs
        .iter()
        .map(|config| (config.cosmetic_id.as_str(), config))
        .collect();
    let items: Vec<Value> = offered(&context, &rotation)?
        .into_iter()
        .filter(|item| {
            let config = config_by_id.get(item.id.as_str());
            config.is_none_or(|config| config.enabled)
                && config
                    .and_then(|config| config.shop_eligible)
                    .unwrap_or(item.shop_eligible)
        })
        .map(|item| {
            let config = config_by_id.get(item.id.as_str());
            let mut object = item.to_object();
            let price = config
                .and_then(|config| config.price_override)
                .unwrap_or_else(|| shop_price(item.rarity));
            object.insert("price".to_owned(), price.into());
            // `limitedLabel: config?.limitedLabel`: undefined (key dropped) without a config row.
            if let Some(config) = config {
                object.insert("limitedLabel".to_owned(), json!(config.limited_label));
            }
            Value::Object(object)
        })
        .collect();
    Ok(Json(json!({
        "balance": context.player.quack_points,
        "endsAt": rotation.ends_at,
        "prices": shop_prices_json(),
        "items": items,
        "ownedIds": owned_ids,
    }))
    .into_response())
}

async fn post_shop(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Response> {
    let body = body?;
    let body = js::parse_body(&body).ok_or_else(|| ApiError::internal("shop: body is not JSON"))?;
    if body.is_null() {
        return Err(ApiError::internal("shop: body is null"));
    }
    let token = js::property(&body, "token");
    let cosmetic_id = js::property(&body, "cosmeticId");
    let idempotency_key = js::property(&body, "idempotencyKey");

    // `context(body.token ?? null)`: a falsy token is no player; a truthy non-string fails
    // Prisma validation (500).
    let context = if js::truthy(token) {
        let Some(Value::String(token)) = token else {
            return Err(ApiError::internal("shop: token is not a string"));
        };
        let mut conn = state.db().reader.acquire().await?;
        context(&mut conn, token).await?
    } else {
        None
    };
    let Some(context) = context else {
        return Err(ApiError::bad_request("Request không hợp lệ"));
    };
    if !js::truthy(cosmetic_id) || !js::truthy(idempotency_key) {
        return Err(ApiError::bad_request("Request không hợp lệ"));
    }
    let item = match cosmetic_id {
        Some(Value::String(id)) => catalog().get(id),
        _ => None,
    };
    let Some(item) = item else {
        return Err(ApiError::not_found("Cosmetic không tồn tại"));
    };
    let Some(Value::String(idempotency_key)) = idempotency_key else {
        return Err(ApiError::internal("shop: idempotencyKey is not a string"));
    };

    let previous = {
        let mut conn = state.db().reader.acquire().await?;
        transaction_by_key(&mut conn, idempotency_key).await?
    };
    if let Some(previous) = previous
        && previous.season_player_id == context.player.id
        && previous.reason == "SHOP_PURCHASE"
    {
        return Ok(Json(json!({
            "ok": true,
            "balance": previous.balance_after,
            "cosmeticId": item.id,
            "item": item.to_value(),
        }))
        .into_response());
    }
    let rotation = rotation_for(&state, &context.season).await?;
    let config = {
        let mut conn = state.db().reader.acquire().await?;
        config_by_id(&mut conn, &item.id).await?
    };
    if !offered(&context, &rotation)?
        .iter()
        .any(|entry| entry.id == item.id)
    {
        return Err(ApiError::conflict("Món này không có trong shop của bạn"));
    }
    if config
        .as_ref()
        .is_some_and(|config| !config.enabled || config.shop_eligible == Some(false))
    {
        return Err(ApiError::conflict("Món này đang tắt"));
    }
    let price = config
        .as_ref()
        .and_then(|config| config.price_override)
        .unwrap_or_else(|| shop_price(item.rarity));
    if context.player.quack_points < price {
        return Err(ApiError::conflict("Không đủ QP"));
    }

    match purchase(&state, &context, item, &rotation, price, idempotency_key).await {
        Ok((balance, cosmetic_id)) => Ok(Json(json!({
            "ok": true,
            "balance": balance,
            "cosmeticId": cosmetic_id,
            "item": item.to_value(),
        }))
        .into_response()),
        Err(error) => {
            tracing::warn!(%error, "shop purchase failed");
            Err(ApiError::conflict("Không mua được món này"))
        }
    }
}

/// The purchase transaction. Any error rolls everything back.
async fn purchase(
    state: &AppState,
    context: &Context,
    item: &CosmeticItem,
    rotation: &ShopRotationRow,
    price: i64,
    idempotency_key: &str,
) -> anyhow::Result<(i64, String)> {
    let mut tx = state.db().begin_write().await?;
    if let Some(existing) = transaction_by_key(&mut tx, idempotency_key).await? {
        tx.commit().await?;
        return Ok((existing.balance_after, item.id.clone()));
    }
    apply_quack_transaction(
        &mut tx,
        &QuackInput {
            season_player_id: context.player.id,
            amount: -price,
            reason: "SHOP_PURCHASE",
            cosmetic_id: Some(&item.id),
            idempotency_key,
            ..QuackInput::default()
        },
    )
    .await?;
    let now = DbTime::now();
    sqlx::query(
        r#"INSERT INTO "PlayerCosmetic" ("id", "seasonPlayerId", "cosmeticId", "source", "sourceReferenceId", "isNew", "obtainedAt")
           VALUES (?, ?, ?, 'SHOP', ?, 1, ?)"#,
    )
    .bind(cuid())
    .bind(context.player.id)
    .bind(&item.id)
    .bind(&rotation.id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO "ShopPurchase" ("id", "seasonPlayerId", "rotationId", "cosmeticId", "price", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(cuid())
    .bind(context.player.id)
    .bind(&rotation.id)
    .bind(&item.id)
    .bind(price)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let balance: i64 =
        sqlx::query_scalar(r#"SELECT "quackPoints" FROM "SeasonPlayer" WHERE "id" = ?"#)
            .bind(context.player.id)
            .fetch_one(&mut *tx)
            .await?;
    tx.commit().await?;
    Ok((balance, item.id.clone()))
}
