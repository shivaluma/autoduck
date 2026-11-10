//! `GET|POST /api/admin/cosmetics`: cosmetic admin dashboard and actions.
//!
//! Port of `app/api/admin/cosmetics/route.ts`. Auth is the `x-race-secret` header only
//! ([`RequireAdminHeader`], checked before the body is read, as in TS).
//!
//! Request bodies follow TS/Prisma semantics: a truthy non-number `playerId`, or a `configure`
//! field of the wrong type, fails Prisma validation in TS and answers 500 here too; numbers given
//! to `Int` arguments are truncated like Prisma does ([`js::prisma_int`]).

use std::collections::HashMap;

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde::Serialize;
use serde_json::value::RawValue;
use serde_json::{Map, Value, json};
use sqlx::{AssertSqlSafe, SqliteConnection};

use crate::auth::admin::RequireAdminHeader;
use crate::cosmetics::economy::{QuackInput, apply_quack_transaction};
use crate::cosmetics::ids::{cuid, uuid_v4};
use crate::cosmetics::js;
use crate::cosmetics::rows::{
    ADMIN_EVENT_COLUMNS, APPEARANCE_COLUMNS, COSMETIC_COLUMNS, CURRENCY_COLUMNS,
    CosmeticAdminEventRow, CosmeticConfigRow, CurrencyTransactionRow, GACHA_COLUMNS, GachaPullRow,
    PlayerAppearanceRow, PlayerCosmeticRow, SEASON_COLUMNS, SEASON_PLAYER_COLUMNS, SeasonPlayerRow,
    SeasonRow, USER_COLUMNS, UserRow, all_configs, placeholders, player_by_id,
};
use crate::cosmetics::{CosmeticItem, Rarity, catalog};
use crate::db::DbTime;
use crate::error::{ApiError, ApiResult};
use crate::http::AppState;

/// `Number.MAX_SAFE_INTEGER`. better-sqlite3 binds a larger JS number as REAL, and Prisma then
/// fails to read the `Int` column back, so TS rejects such amounts inside the transaction.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

pub fn router() -> Router<AppState> {
    Router::new().route("/admin/cosmetics", get(get_dashboard).post(post_action))
}

// ---------------------------------------------------------------------------------------------
// GET

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Dashboard<'a> {
    catalog: Vec<&'a RawValue>,
    players: Vec<PlayerSummary<'a>>,
    transactions: Vec<CurrencyTransactionRow>,
    pulls: Vec<GachaPullRow>,
    events: Vec<CosmeticAdminEventRow>,
    configs: Vec<CosmeticConfigRow>,
    analytics: Analytics<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerSummary<'a> {
    id: i64,
    name: &'a str,
    quack_points: i64,
    collection_count: usize,
    owned_cosmetic_ids: Vec<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Analytics<'a> {
    qp_earned: i64,
    qp_spent: i64,
    shop_purchases: i64,
    gacha_pulls: i64,
    /// A JS number (`k / n`), printed with `Number#toString`.
    duplicate_refund_rate: Box<RawValue>,
    rarity_distribution: Map<String, Value>,
    most_equipped: MostEquipped,
    collection_distribution: Vec<CollectionCount<'a>>,
}

#[derive(Serialize)]
struct MostEquipped {
    heads: Vec<EquipCount>,
    pets: Vec<EquipCount>,
    auras: Vec<EquipCount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EquipCount {
    cosmetic_id: String,
    count: i64,
}

#[derive(Serialize)]
struct CollectionCount<'a> {
    name: &'a str,
    count: usize,
}

/// One season player with the relations `include: { user, cosmetics, appearance }` loads.
struct LoadedPlayer {
    player: SeasonPlayerRow,
    user: Option<UserRow>,
    cosmetics: Vec<PlayerCosmeticRow>,
    appearance: Option<PlayerAppearanceRow>,
}

fn name(entry: &LoadedPlayer) -> &str {
    entry.user.as_ref().map_or("", |user| user.name.as_str())
}

/// `SELECT … WHERE "<column>" IN (…)` with Prisma's `LIMIT -1 OFFSET 0`.
async fn fetch_in<T>(
    conn: &mut SqliteConnection,
    columns: &str,
    table: &str,
    column: &str,
    ids: &[i64],
) -> Result<Vec<T>, sqlx::Error>
where
    T: for<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> + Send + Unpin,
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

/// `findMany({ orderBy: { createdAt: 'desc' }, take: 100 })`.
async fn latest<T>(
    conn: &mut SqliteConnection,
    columns: &str,
    table: &str,
) -> Result<Vec<T>, sqlx::Error>
where
    T: for<'r> sqlx::FromRow<'r, sqlx::sqlite::SqliteRow> + Send + Unpin,
{
    sqlx::query_as::<_, T>(AssertSqlSafe(format!(
        r#"SELECT {columns} FROM "{table}" WHERE 1=1 ORDER BY "{table}"."createdAt" DESC LIMIT ? OFFSET ?"#
    )))
    .bind(100_i64)
    .bind(0_i64)
    .fetch_all(conn)
    .await
}

async fn sum_amount(conn: &mut SqliteConnection, op: &str) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(AssertSqlSafe(format!(
        r#"SELECT SUM("amount") FROM (SELECT "CurrencyTransaction"."amount" FROM "CurrencyTransaction"
           WHERE "CurrencyTransaction"."amount" {op} ? LIMIT ? OFFSET ?) AS "sub""#
    )))
    .bind(0_i64)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_one(conn)
    .await
}

async fn count(conn: &mut SqliteConnection, table: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar(AssertSqlSafe(format!(
        r#"SELECT COUNT(*) FROM (SELECT "{table}"."id" FROM "{table}" WHERE 1=1 LIMIT ? OFFSET ?) AS "sub""#
    )))
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_one(conn)
    .await
}

/// Top 10 equipped ids for one slot: counts in first-seen order, then a stable sort by count.
fn most_equipped(players: &[LoadedPlayer], slot: &str) -> Vec<EquipCount> {
    let mut order: Vec<String> = Vec::new();
    let mut counts: HashMap<String, i64> = HashMap::new();
    for loaded in players {
        let Some(id) = loaded
            .appearance
            .as_ref()
            .and_then(|appearance| appearance.slot(slot))
        else {
            continue;
        };
        if id.is_empty() {
            continue;
        }
        let entry = counts.entry(id.to_owned()).or_insert_with(|| {
            order.push(id.to_owned());
            0
        });
        *entry += 1;
    }
    let mut ranked: Vec<EquipCount> = order
        .into_iter()
        .map(|cosmetic_id| {
            let count = counts.get(&cosmetic_id).copied().unwrap_or(0);
            EquipCount { cosmetic_id, count }
        })
        .collect();
    ranked.sort_by_key(|entry| std::cmp::Reverse(entry.count));
    ranked.truncate(10);
    ranked
}

async fn get_dashboard(
    _admin: RequireAdminHeader,
    State(state): State<AppState>,
) -> ApiResult<Response> {
    let mut conn = state.db().reader.acquire().await?;
    let Some(season) = sqlx::query_as::<_, SeasonRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_COLUMNS} FROM "Season" WHERE "Season"."status" = ? LIMIT ? OFFSET ?"#
    )))
    .bind("active")
    .bind(1_i64)
    .bind(0_i64)
    .fetch_optional(&mut *conn)
    .await?
    else {
        return Err(ApiError::not_found("Chưa có Season active"));
    };

    let players: Vec<SeasonPlayerRow> = fetch_in(
        &mut conn,
        SEASON_PLAYER_COLUMNS,
        "SeasonPlayer",
        "seasonId",
        &[season.id],
    )
    .await?;
    let player_ids: Vec<i64> = players.iter().map(|player| player.id).collect();
    let mut user_ids: Vec<i64> = players.iter().map(|player| player.user_id).collect();
    user_ids.sort();
    user_ids.dedup();
    let users: Vec<UserRow> = fetch_in(&mut conn, USER_COLUMNS, "User", "id", &user_ids).await?;
    let cosmetics: Vec<PlayerCosmeticRow> = fetch_in(
        &mut conn,
        COSMETIC_COLUMNS,
        "PlayerCosmetic",
        "seasonPlayerId",
        &player_ids,
    )
    .await?;
    let appearances: Vec<PlayerAppearanceRow> = fetch_in(
        &mut conn,
        APPEARANCE_COLUMNS,
        "PlayerAppearance",
        "seasonPlayerId",
        &player_ids,
    )
    .await?;

    let transactions: Vec<CurrencyTransactionRow> =
        latest(&mut conn, CURRENCY_COLUMNS, "CurrencyTransaction").await?;
    let pulls: Vec<GachaPullRow> = latest(&mut conn, GACHA_COLUMNS, "GachaPull").await?;
    let events: Vec<CosmeticAdminEventRow> =
        latest(&mut conn, ADMIN_EVENT_COLUMNS, "CosmeticAdminEvent").await?;
    let configs = all_configs(&mut conn).await?;
    let earned = sum_amount(&mut conn, ">").await?;
    let spent = sum_amount(&mut conn, "<").await?;
    let shop_purchases = count(&mut conn, "ShopPurchase").await?;
    let gacha_pulls = count(&mut conn, "GachaPull").await?;
    drop(conn);

    // Join the includes in memory, keeping each child query's row order (as Prisma does).
    let users_by_id: HashMap<i64, UserRow> =
        users.into_iter().map(|user| (user.id, user)).collect();
    let mut cosmetics_by_player: HashMap<i64, Vec<PlayerCosmeticRow>> = HashMap::new();
    for cosmetic in cosmetics {
        cosmetics_by_player
            .entry(cosmetic.season_player_id)
            .or_default()
            .push(cosmetic);
    }
    let mut appearance_by_player: HashMap<i64, PlayerAppearanceRow> = appearances
        .into_iter()
        .map(|appearance| (appearance.season_player_id, appearance))
        .collect();
    let loaded: Vec<LoadedPlayer> = players
        .into_iter()
        .map(|player| LoadedPlayer {
            user: users_by_id.get(&player.user_id).cloned(),
            cosmetics: cosmetics_by_player.remove(&player.id).unwrap_or_default(),
            appearance: appearance_by_player.remove(&player.id),
            player,
        })
        .collect();
    if loaded.iter().any(|entry| entry.user.is_none()) {
        return Err(ApiError::internal("season player without a user"));
    }

    let rarity_distribution: Map<String, Value> = Rarity::ALL
        .into_iter()
        .map(|rarity| {
            let total = loaded
                .iter()
                .flat_map(|entry| &entry.cosmetics)
                .filter(|entry| {
                    catalog()
                        .get(&entry.cosmetic_id)
                        .is_some_and(|item| item.rarity == rarity)
                })
                .count();
            (rarity.as_str().to_owned(), json!(total))
        })
        .collect();
    let refunded = pulls.iter().filter(|pull| pull.refund_amount > 0).count();
    let rate = if pulls.is_empty() {
        0.0
    } else {
        refunded as f64 / pulls.len() as f64
    };
    let duplicate_refund_rate =
        RawValue::from_string(js::number_to_string(rate)).map_err(ApiError::internal)?;

    let dashboard = Dashboard {
        catalog: catalog()
            .items
            .iter()
            .map(|item: &CosmeticItem| item.raw.as_ref())
            .collect(),
        players: loaded
            .iter()
            .map(|entry| PlayerSummary {
                id: entry.player.id,
                name: name(entry),
                quack_points: entry.player.quack_points,
                collection_count: entry.cosmetics.len(),
                owned_cosmetic_ids: entry
                    .cosmetics
                    .iter()
                    .map(|cosmetic| cosmetic.cosmetic_id.as_str())
                    .collect(),
            })
            .collect(),
        analytics: Analytics {
            qp_earned: earned.unwrap_or(0),
            qp_spent: -spent.unwrap_or(0),
            shop_purchases,
            gacha_pulls,
            duplicate_refund_rate,
            rarity_distribution,
            most_equipped: MostEquipped {
                heads: most_equipped(&loaded, "headId"),
                pets: most_equipped(&loaded, "petId"),
                auras: most_equipped(&loaded, "auraId"),
            },
            collection_distribution: loaded
                .iter()
                .map(|entry| CollectionCount {
                    name: name(entry),
                    count: entry.cosmetics.len(),
                })
                .collect(),
        },
        transactions,
        pulls,
        events,
        configs,
    };
    Ok(Json(dashboard).into_response())
}

// ---------------------------------------------------------------------------------------------
// POST

fn ok(extra: Option<(&str, Value)>) -> Response {
    let mut body = Map::new();
    body.insert("ok".to_owned(), Value::Bool(true));
    if let Some((key, value)) = extra {
        body.insert(key.to_owned(), value);
    }
    Json(Value::Object(body)).into_response()
}

async fn insert_event(
    conn: &mut SqliteConnection,
    action: &str,
    player_id: Option<i64>,
    cosmetic_id: Option<&str>,
    metadata_json: Option<String>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO "CosmeticAdminEvent" ("id", "action", "actor", "playerId", "cosmeticId", "metadataJson", "createdAt")
           VALUES (?, ?, 'host', ?, ?, ?, ?)"#,
    )
    .bind(cuid())
    .bind(action)
    .bind(player_id)
    .bind(cosmetic_id)
    .bind(metadata_json)
    .bind(DbTime::now())
    .execute(conn)
    .await?;
    Ok(())
}

/// `body.slot && body.slot !== 'all'` → the catalog items in that slot (none when `slot` is a
/// truthy non-string); otherwise `None` (every item).
fn slot_filter(slot: Option<&Value>) -> Option<Vec<&'static CosmeticItem>> {
    if !js::truthy(slot) || slot == Some(&Value::String("all".to_owned())) {
        return None;
    }
    let slot = slot.and_then(Value::as_str);
    Some(
        catalog()
            .items
            .iter()
            .filter(|item| Some(item.slot.as_str()) == slot)
            .collect(),
    )
}

/// `JSON.stringify(body.slot ?? 'all')`.
fn slot_json(slot: Option<&Value>) -> String {
    match slot {
        None | Some(Value::Null) => "\"all\"".to_owned(),
        Some(value) => js::stringify(value),
    }
}

/// A `configure` field: absent → not set; otherwise it must have the Prisma type (or be `null`
/// where the column is nullable), else Prisma validation fails (500).
enum Field<T> {
    Absent,
    Set(Option<T>),
}

fn bool_field(body: &Value, key: &str, nullable: bool) -> ApiResult<Field<bool>> {
    match js::property(body, key) {
        None => Ok(Field::Absent),
        Some(Value::Null) if nullable => Ok(Field::Set(None)),
        Some(Value::Bool(flag)) => Ok(Field::Set(Some(*flag))),
        Some(_) => Err(ApiError::internal(format!("configure: invalid {key}"))),
    }
}

fn int_field(body: &Value, key: &str) -> ApiResult<Field<i64>> {
    match js::property(body, key) {
        None => Ok(Field::Absent),
        Some(Value::Null) => Ok(Field::Set(None)),
        Some(Value::Number(number)) => number
            .as_f64()
            .filter(|value| value.abs() <= MAX_SAFE_INTEGER)
            .and_then(js::prisma_int)
            .map(|value| Field::Set(Some(value)))
            .ok_or_else(|| ApiError::internal(format!("configure: invalid {key}"))),
        Some(_) => Err(ApiError::internal(format!("configure: invalid {key}"))),
    }
}

fn string_field(body: &Value, key: &str) -> ApiResult<Field<String>> {
    match js::property(body, key) {
        None => Ok(Field::Absent),
        Some(Value::Null) => Ok(Field::Set(None)),
        Some(Value::String(text)) => Ok(Field::Set(Some(text.clone()))),
        Some(_) => Err(ApiError::internal(format!("configure: invalid {key}"))),
    }
}

async fn post_action(
    _admin: RequireAdminHeader,
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> ApiResult<Response> {
    let body = body?;
    let body = js::parse_body(&body)
        .ok_or_else(|| ApiError::internal("admin/cosmetics: body is not JSON"))?;
    if body.is_null() {
        return Err(ApiError::internal("admin/cosmetics: body is null"));
    }
    let action = js::property(&body, "action").and_then(Value::as_str);
    let cosmetic_value = js::property(&body, "cosmeticId");
    let cosmetic_id = cosmetic_value
        .and_then(Value::as_str)
        .filter(|id| catalog().contains(id));
    let slot = js::property(&body, "slot");

    // `body.playerId ? findUnique({ where: { id: body.playerId } }) : null`.
    let player_value = js::property(&body, "playerId");
    let player = if js::truthy(player_value) {
        let id = js::as_number(player_value)
            .and_then(js::prisma_int)
            .ok_or_else(|| ApiError::internal("admin/cosmetics: invalid playerId"))?;
        let mut conn = state.db().reader.acquire().await?;
        player_by_id(&mut conn, id).await?
    } else {
        None
    };

    match action {
        Some("adjust-qp") => {
            let amount_value = js::property(&body, "amount");
            let Some(player) = player.filter(|_| js::is_integer(amount_value)) else {
                return Err(ApiError::bad_request("Player/amount không hợp lệ"));
            };
            let amount = js::as_number(amount_value).unwrap_or(0.0);
            if amount == 0.0 {
                return Err(ApiError::bad_request("Player/amount không hợp lệ"));
            }
            let result: anyhow::Result<()> = async {
                if amount.abs() > MAX_SAFE_INTEGER {
                    anyhow::bail!("amount {amount} is not a safe integer");
                }
                let amount_int =
                    js::prisma_int(amount).ok_or_else(|| anyhow::anyhow!("amount out of range"))?;
                let mut tx = state.db().begin_write().await?;
                let key = format!("admin:{}", uuid_v4());
                apply_quack_transaction(
                    &mut tx,
                    &QuackInput {
                        season_player_id: player.id,
                        amount: amount_int,
                        reason: "ADMIN_ADJUSTMENT",
                        idempotency_key: &key,
                        metadata_json: Some(r#"{"actor":"host"}"#.to_owned()),
                        ..QuackInput::default()
                    },
                )
                .await?;
                insert_event(
                    &mut tx,
                    "ADJUST_QP",
                    Some(player.id),
                    None,
                    Some(format!(r#"{{"amount":{}}}"#, js::number_to_string(amount))),
                )
                .await?;
                tx.commit().await?;
                Ok(())
            }
            .await;
            match result {
                Ok(()) => Ok(ok(None)),
                Err(error) => {
                    tracing::warn!(%error, "admin adjust-qp failed");
                    Err(ApiError::conflict("Không thể điều chỉnh QP"))
                }
            }
        }
        Some(action @ ("grant" | "revoke")) => {
            let (Some(player), Some(cosmetic_id)) = (player, cosmetic_id) else {
                return Err(ApiError::bad_request("Player/cosmetic không hợp lệ"));
            };
            let mut tx = state.db().begin_write().await?;
            if action == "grant" {
                sqlx::query(
                    r#"INSERT INTO "PlayerCosmetic" ("id", "seasonPlayerId", "cosmeticId", "source", "isNew", "obtainedAt")
                       VALUES (?, ?, ?, 'ADMIN', 1, ?) ON CONFLICT ("seasonPlayerId", "cosmeticId") DO NOTHING"#,
                )
                .bind(cuid())
                .bind(player.id)
                .bind(cosmetic_id)
                .bind(DbTime::now())
                .execute(&mut *tx)
                .await?;
            } else {
                sqlx::query(
                    r#"DELETE FROM "PlayerCosmetic" WHERE "seasonPlayerId" = ? AND "cosmeticId" = ?"#,
                )
                .bind(player.id)
                .bind(cosmetic_id)
                .execute(&mut *tx)
                .await?;
            }
            let event = if action == "grant" {
                "GRANT_COSMETIC"
            } else {
                "REVOKE_COSMETIC"
            };
            insert_event(&mut tx, event, Some(player.id), Some(cosmetic_id), None).await?;
            tx.commit().await?;
            Ok(ok(None))
        }
        Some("grant-all") => {
            let Some(player) = player else {
                return Err(ApiError::bad_request("Player không hợp lệ"));
            };
            // `grantMissingCosmetics` (main, `lib/cosmetics/admin-grant.ts`): every target the
            // player doesn't own yet is inserted with source `ADMIN_GRANT_ALL`; owned rows are left
            // alone. The answer and the event count every target, owned or not.
            let targets: Vec<&CosmeticItem> =
                slot_filter(slot).unwrap_or_else(|| catalog().items.iter().collect());
            let mut tx = state.db().begin_write().await?;
            let now = DbTime::now();
            for item in &targets {
                sqlx::query(
                    r#"INSERT INTO "PlayerCosmetic" ("id", "seasonPlayerId", "cosmeticId", "source", "isNew", "obtainedAt")
                       VALUES (?, ?, ?, 'ADMIN_GRANT_ALL', 1, ?) ON CONFLICT ("seasonPlayerId", "cosmeticId") DO NOTHING"#,
                )
                .bind(cuid())
                .bind(player.id)
                .bind(&item.id)
                .bind(now)
                .execute(&mut *tx)
                .await?;
            }
            insert_event(
                &mut tx,
                "GRANT_ALL_COSMETICS",
                Some(player.id),
                None,
                Some(format!(
                    r#"{{"count":{},"slot":{}}}"#,
                    targets.len(),
                    slot_json(slot)
                )),
            )
            .await?;
            tx.commit().await?;
            Ok(ok(Some(("count", json!(targets.len())))))
        }
        Some("revoke-all") => {
            let Some(player) = player else {
                return Err(ApiError::bad_request("Player không hợp lệ"));
            };
            let mut tx = state.db().begin_write().await?;
            match slot_filter(slot) {
                Some(items) => {
                    for item in items {
                        sqlx::query(
                            r#"DELETE FROM "PlayerCosmetic" WHERE "seasonPlayerId" = ? AND "cosmeticId" = ?"#,
                        )
                        .bind(player.id)
                        .bind(&item.id)
                        .execute(&mut *tx)
                        .await?;
                    }
                }
                None => {
                    sqlx::query(r#"DELETE FROM "PlayerCosmetic" WHERE "seasonPlayerId" = ?"#)
                        .bind(player.id)
                        .execute(&mut *tx)
                        .await?;
                }
            }
            insert_event(
                &mut tx,
                "REVOKE_ALL_COSMETICS",
                Some(player.id),
                None,
                Some(format!(r#"{{"slot":{}}}"#, slot_json(slot))),
            )
            .await?;
            tx.commit().await?;
            Ok(ok(None))
        }
        Some("configure") => {
            let Some(cosmetic_id) = cosmetic_id.filter(|_| js::truthy(cosmetic_value)) else {
                return Err(ApiError::bad_request("Cosmetic không hợp lệ"));
            };
            let enabled = bool_field(&body, "enabled", false)?;
            let shop_eligible = bool_field(&body, "shopEligible", true)?;
            let gacha_eligible = bool_field(&body, "gachaEligible", true)?;
            let price_override = int_field(&body, "priceOverride")?;
            let limited_label = string_field(&body, "limitedLabel")?;
            let metadata = js::stringify(&body);

            let mut tx = state.db().begin_write().await?;
            let now = DbTime::now();
            let exists: Option<String> = sqlx::query_scalar(
                r#"SELECT "cosmeticId" FROM "CosmeticConfig" WHERE "cosmeticId" = ?"#,
            )
            .bind(cosmetic_id)
            .fetch_optional(&mut *tx)
            .await?;
            if exists.is_none() {
                let value = |field: &Field<bool>| match field {
                    Field::Absent => None,
                    Field::Set(value) => *value,
                };
                sqlx::query(
                    r#"INSERT INTO "CosmeticConfig" ("cosmeticId", "enabled", "shopEligible", "gachaEligible",
                           "priceOverride", "limitedLabel", "updatedAt")
                       VALUES (?, ?, ?, ?, ?, ?, ?)"#,
                )
                .bind(cosmetic_id)
                .bind(value(&enabled).unwrap_or(true))
                .bind(value(&shop_eligible))
                .bind(value(&gacha_eligible))
                .bind(match &price_override {
                    Field::Absent => None,
                    Field::Set(value) => *value,
                })
                .bind(match &limited_label {
                    Field::Absent => None,
                    Field::Set(value) => value.clone(),
                })
                .bind(now)
                .execute(&mut *tx)
                .await?;
            } else {
                // Only the fields the body sets; Prisma skips the UPDATE (and `updatedAt`)
                // when none is set (verified against the TS app).
                let mut sets: Vec<&str> = Vec::new();
                let mut bools: Vec<Option<bool>> = Vec::new();
                for (column, field) in [
                    (r#""enabled" = ?"#, &enabled),
                    (r#""shopEligible" = ?"#, &shop_eligible),
                    (r#""gachaEligible" = ?"#, &gacha_eligible),
                ] {
                    if let Field::Set(value) = field {
                        sets.push(column);
                        bools.push(*value);
                    }
                }
                let price = match &price_override {
                    Field::Set(value) => {
                        sets.push(r#""priceOverride" = ?"#);
                        Some(*value)
                    }
                    Field::Absent => None,
                };
                let label = match &limited_label {
                    Field::Set(value) => {
                        sets.push(r#""limitedLabel" = ?"#);
                        Some(value.clone())
                    }
                    Field::Absent => None,
                };
                if !sets.is_empty() {
                    sets.push(r#""updatedAt" = ?"#);
                    let sql = format!(
                        r#"UPDATE "CosmeticConfig" SET {} WHERE "cosmeticId" = ?"#,
                        sets.join(", ")
                    );
                    let mut query = sqlx::query(AssertSqlSafe(sql));
                    for value in bools {
                        query = query.bind(value);
                    }
                    if let Some(price) = price {
                        query = query.bind(price);
                    }
                    if let Some(label) = label {
                        query = query.bind(label);
                    }
                    query.bind(now).bind(cosmetic_id).execute(&mut *tx).await?;
                }
            }
            insert_event(
                &mut tx,
                "CONFIGURE_COSMETIC",
                None,
                Some(cosmetic_id),
                Some(metadata),
            )
            .await?;
            tx.commit().await?;
            Ok(ok(None))
        }
        _ => Err(ApiError::bad_request("Action không hợp lệ")),
    }
}
