//! `GET|POST /api/season3` (the player page) and `POST /api/season3/redeem`.
//!
//! Port of `app/api/season3/route.ts` and `app/api/season3/redeem/route.ts` on `main`. Data
//! access lives in [`crate::season3::player`]; the payload parsers, loadout helpers and catalogs
//! come from the meta layer and race-core.
//!
//! Wire behaviour follows TS exactly:
//! - Responses are `JSON.stringify` output ([`js_json::stringify`]): `chaosGroups` and
//!   `skippedPlayerIds` re-serialise parsed JSON as V8 would, and `chaosGroups` is omitted (not
//!   `null`) when the payload isn't an array of arrays.
//! - Every error TS throws inside its `try` answers 500 with the route's own message
//!   (`Failed to fetch Season 3`, `Failed to save prediction`, `Redeem failed`): invalid JSON, a
//!   `null` body, Prisma validation failures (a truthy non-string `cosmeticId`, a non-string
//!   `presetName`), `saveAppearance` errors, Zod/`validateLoadout` errors, a non-array `itemIds`.
//! - `save-preset` writes the appearance before the preset, outside a transaction, so a
//!   non-string `presetName` (500) still leaves the appearance saved, as in TS.
//! - `GET` grants the starter cosmetics to a viewer without an appearance or inventory, then
//!   answers from a fresh read (TS re-enters `GET`).
//!
//! Deliberate difference (not observable sequentially): `redeem` re-checks the points and the
//! stock inside its `BEGIN IMMEDIATE` transaction, so two concurrent redeems cannot overspend.
//! TS checks before its transaction.

use std::fmt::Display;
use std::sync::OnceLock;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use race_core::catalog::RACE_ITEM_CATALOG;
use race_core::loadout::LoadoutError;
use serde_json::{Map, Value, json};

use crate::auth::google::has_google_link;
use crate::auth::js_trim;
use crate::auth::player::QueryToken;
use crate::cosmetics::catalog;
use crate::cosmetics::inventory::{SaveAppearanceError, grant_starter_cosmetics, save_appearance};
use crate::cosmetics::js;
use crate::db::DbTime;
use crate::error::ApiError;
use crate::http::AppState;
use crate::routes::races::js_json;
use crate::season3::loadout::{
    ParseItemIdsError, parse_item_id, parse_item_ids, serialize_item_ids, validate_loadout,
};
use crate::season3::payload::{
    parse_chaos_groups_strict, parse_skipped_player_ids, skipped_contains,
};
use crate::season3::player::{
    self, ActiveSeason, LoadError, PlayerEntry, RedeemSeason, SeasonRewardRow, WeekEntry,
    js_slice_utf16,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/season3", get(get_season3).post(post_season3))
        .route("/season3/redeem", post(post_redeem))
}

// ---------------------------------------------------------------------------------------------
// Errors and responses

/// Why a handler stopped: a deliberate `{ error }` reply, or something TS would have thrown
/// (answered with the route's 500 message).
#[derive(Debug)]
enum Failure {
    Reply(ApiError),
    Internal(String),
}

fn internal(error: impl Display) -> Failure {
    Failure::Internal(error.to_string())
}

impl From<ApiError> for Failure {
    fn from(error: ApiError) -> Self {
        Failure::Reply(error)
    }
}

macro_rules! internal_from {
    ($($ty:ty),*) => {$(
        impl From<$ty> for Failure {
            fn from(error: $ty) -> Self {
                internal(error)
            }
        }
    )*};
}
internal_from!(
    sqlx::Error,
    LoadError,
    SaveAppearanceError,
    ParseItemIdsError,
    LoadoutError,
    serde_json::Error
);

/// The route's `catch` block: `{ error: message }`, 500.
fn finish(result: Result<Response, Failure>, message: &'static str) -> Response {
    match result {
        Ok(response) => response,
        Err(Failure::Reply(error)) => error.into_response(),
        Err(Failure::Internal(error)) => {
            tracing::error!(%error, "{message}");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, message).into_response()
        }
    }
}

/// `NextResponse.json(value)`: `JSON.stringify` bytes.
fn json_ok(value: &Value) -> Response {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "application/json")],
        js_json::stringify(value),
    )
        .into_response()
}

fn to_value(value: &impl serde::Serialize) -> Result<Value, Failure> {
    serde_json::to_value(value).map_err(internal)
}

/// `await request.json()` followed by property access: invalid JSON and `null` throw (500).
fn parse_request(bytes: &[u8]) -> Result<Value, Failure> {
    match js::parse_body(bytes) {
        None => Err(internal("request body is not JSON")),
        Some(Value::Null) => Err(internal("request body is null")),
        Some(body) => Ok(body),
    }
}

// ---------------------------------------------------------------------------------------------
// Catalogs

/// `RACE_ITEM_CATALOG` as the TS objects (`id, name, icon, cost, category, itemClass,
/// description`).
fn race_items() -> &'static Value {
    static ITEMS: OnceLock<Value> = OnceLock::new();
    ITEMS.get_or_init(|| {
        Value::Array(
            RACE_ITEM_CATALOG
                .iter()
                .map(|item| {
                    json!({
                        "id": item.id.as_str(),
                        "name": item.name,
                        "icon": item.icon,
                        "cost": item.cost,
                        "category": item.category.as_str(),
                        "itemClass": item.item_class.as_str(),
                        "description": item.description,
                    })
                })
                .collect(),
        )
    })
}

/// `COSMETIC_CATALOG`, every definition verbatim.
fn cosmetic_catalog() -> &'static Value {
    static ITEMS: OnceLock<Value> = OnceLock::new();
    ITEMS.get_or_init(|| Value::Array(catalog().items.iter().map(|item| item.to_value()).collect()))
}

// ---------------------------------------------------------------------------------------------
// GET

async fn get_season3(State(state): State<AppState>, QueryToken(token): QueryToken) -> Response {
    finish(
        get_inner(&state, token.as_deref()).await,
        "Failed to fetch Season 3",
    )
}

async fn get_inner(state: &AppState, token: Option<&str>) -> Result<Response, Failure> {
    // TS re-enters GET after granting; the grant is idempotent, so one retry settles it. The
    // bound only guards against a row deleted concurrently in between.
    let mut granted = 0;
    loop {
        let mut conn = state.db().reader.acquire().await?;
        let Some(season) = player::load_active_season(&mut conn).await? else {
            return Ok(json_ok(&json!({ "season": null })));
        };
        let viewer = token.and_then(|token| {
            season
                .players
                .iter()
                .find(|player| player.row.access_token == token)
        });
        if let Some(viewer) = viewer
            && (viewer.appearance.is_none() || viewer.cosmetics.is_empty())
            && granted < 3
        {
            let viewer_id = viewer.row.id;
            drop(conn);
            let mut tx = state.db().begin_write().await?;
            grant_starter_cosmetics(&mut tx, viewer_id).await?;
            tx.commit().await?;
            granted += 1;
            continue;
        }
        let live_race = match viewer {
            Some(viewer) => player::live_race(&mut conn, viewer.row.user_id).await?,
            None => None,
        };
        drop(conn);
        let body = render(&season, viewer, live_race.as_ref())?;
        return Ok(json_ok(&body));
    }
}

fn render(
    season: &ActiveSeason,
    viewer: Option<&PlayerEntry>,
    live_race: Option<&player::LiveRace>,
) -> Result<Value, Failure> {
    let current_week = season
        .weeks
        .iter()
        .find(|week| week.row.status != "resolved");
    let skipped = parse_skipped_player_ids(
        current_week.and_then(|week| week.row.skipped_player_ids_json.as_deref()),
    );
    let latest_resolved = season
        .weeks
        .iter()
        .rev()
        .find(|week| week.row.status == "resolved");

    let viewer_json = match viewer {
        Some(viewer) => json!({
            "userId": viewer.row.user_id,
            "name": viewer.user.name,
            "avatarUrl": viewer.user.avatar_url,
            "email": viewer.user.email,
            "isGoogleLinked": has_google_link(viewer.user.google_id.as_deref()),
            "predictionPoints": viewer.row.prediction_points,
            "quackPoints": viewer.row.quack_points,
            "scars": viewer.row.scars,
            "shields": viewer.row.shields,
            "isKing": viewer.row.is_king,
            "kingStreak": viewer.row.king_streak,
            "cosmeticsOnboarded": viewer.row.cosmetics_onboarded,
            "appearance": to_value(&viewer.appearance)?,
            "inventory": to_value(&viewer.cosmetics)?,
            "cosmeticPresets": to_value(&viewer.presets)?,
        }),
        None => Value::Null,
    };
    let personal_link = viewer.map(|viewer| {
        format!(
            "/season-3?token={}",
            js::encode_uri_component(&viewer.row.access_token)
        )
    });
    let players: Vec<Value> = season
        .players
        .iter()
        .map(|player| {
            json!({
                "id": player.user.id,
                "name": player.user.name,
                "avatarUrl": player.user.avatar_url,
                "appearance": player.appearance.as_ref().map(|appearance| json!({
                    "bodyColorId": appearance.body_color_id,
                    "bodySkinId": appearance.body_skin_id,
                    "faceId": appearance.face_id,
                    "headId": appearance.head_id,
                    "outfitId": appearance.outfit_id,
                })),
                "predictionPoints": player.row.prediction_points,
                "scars": player.row.scars,
                "shields": player.row.shields,
                "isKing": player.row.is_king,
                "kingStreak": player.row.king_streak,
            })
        })
        .collect();
    let current_week_json = match current_week {
        Some(week) => render_current_week(season, week, viewer, &skipped)?,
        None => Value::Null,
    };
    let latest_reveal = latest_resolved.map(|week| {
        let predictions: Vec<Value> = week
            .predictions
            .iter()
            .map(|prediction| {
                json!({
                    "predictorName": prediction.predictor.name,
                    "targetName": prediction.target.name,
                    "pointsAwarded": prediction.row.points_awarded,
                })
            })
            .collect();
        json!({
            "weekNumber": week.row.week_number,
            "recap": week.row.recap,
            "predictions": predictions,
        })
    });
    let history: Vec<Value> = season
        .weeks
        .iter()
        .filter(|week| week.row.status == "resolved")
        .map(|week| {
            json!({
                "id": week.row.id,
                "weekNumber": week.row.week_number,
                "chaosType": week.row.chaos_type,
                "recap": week.row.recap,
                "resolvedAt": week.row.resolved_at,
            })
        })
        .collect();

    Ok(json!({
        "season": {
            "key": season.season.key,
            "name": season.season.name,
            "year": season.season.year,
            "weeks": season.season.weeks,
            "status": season.season.status,
        },
        "viewer": viewer_json,
        "personalLink": personal_link,
        "liveRace": to_value(&live_race)?,
        "raceItems": race_items().clone(),
        "cosmeticCatalog": cosmetic_catalog().clone(),
        "players": players,
        "currentWeek": current_week_json,
        "latestReveal": latest_reveal,
        "history": history,
        "rewards": to_value(&season.rewards)?,
    }))
}

fn render_current_week(
    season: &ActiveSeason,
    week: &WeekEntry,
    viewer: Option<&PlayerEntry>,
    skipped: &[f64],
) -> Result<Value, Failure> {
    let row = &week.row;
    let viewer_loadout = viewer.and_then(|viewer| {
        week.loadouts
            .iter()
            .find(|l| l.season_player_id == viewer.row.id)
    });
    let viewer_prediction = viewer.and_then(|viewer| {
        week.predictions
            .iter()
            .find(|p| p.row.predictor_player_id == viewer.row.id)
    });
    let name_of = |user_id: Option<i64>| -> Value {
        user_id
            .and_then(|id| season.players.iter().find(|p| p.row.user_id == id))
            .map_or(Value::Null, |player| {
                Value::String(player.user.name.clone())
            })
    };
    let loadout = match viewer_loadout {
        Some(loadout) => {
            let ids: Vec<&str> = parse_item_ids(&loadout.item_ids_json)?
                .iter()
                .map(|id| id.as_str())
                .collect();
            json!({ "itemIds": ids, "status": loadout.status })
        }
        None => json!({ "itemIds": [], "status": "draft" }),
    };
    let skipped_json: Vec<Value> = skipped
        .iter()
        .map(|&id| serde_json::Number::from_f64(id).map_or(Value::Null, Value::Number))
        .collect();

    let mut out = Map::new();
    out.insert("id".into(), row.id.into());
    out.insert("weekNumber".into(), row.week_number.into());
    out.insert("status".into(), row.status.clone().into());
    out.insert("chaosType".into(), row.chaos_type.clone().into());
    out.insert("chaosTargetUserId".into(), json!(row.chaos_target_user_id));
    out.insert(
        "chaosTargetUserId2".into(),
        json!(row.chaos_target_user_id2),
    );
    // `chaosGroups: undefined` drops the key.
    if let Some(groups) = parse_chaos_groups_strict(row.chaos_payload.as_deref()) {
        out.insert("chaosGroups".into(), groups);
    }
    out.insert("skippedPlayerIds".into(), Value::Array(skipped_json));
    out.insert(
        "viewerSkipped".into(),
        viewer
            .is_some_and(|viewer| skipped_contains(skipped, viewer.row.user_id))
            .into(),
    );
    out.insert("chaosTargetName".into(), name_of(row.chaos_target_user_id));
    out.insert(
        "chaosTargetName2".into(),
        name_of(row.chaos_target_user_id2),
    );
    out.insert(
        "predictionsLockedAt".into(),
        to_value(&row.predictions_locked_at)?,
    );
    out.insert("predictionCount".into(), week.predictions.len().into());
    out.insert(
        "predictionSubmitted".into(),
        viewer_prediction.is_some().into(),
    );
    out.insert(
        "predictionTargetUserId".into(),
        json!(viewer_prediction.map(|p| p.row.target_user_id)),
    );
    out.insert(
        "predictionTargetName".into(),
        json!(viewer_prediction.map(|p| p.target.name.clone())),
    );
    out.insert(
        "predictionTargetAvatarUrl".into(),
        json!(viewer_prediction.and_then(|p| p.target.avatar_url.clone())),
    );
    out.insert(
        "shieldConfirmed".into(),
        viewer
            .is_some_and(|viewer| {
                week.shield_choices
                    .iter()
                    .any(|choice| choice.season_player_id == viewer.row.id)
            })
            .into(),
    );
    out.insert(
        "loadoutReadyCount".into(),
        week.loadouts
            .iter()
            .filter(|l| l.status == "ready" || l.status == "auto")
            .count()
            .into(),
    );
    out.insert("loadout".into(), loadout);
    out.insert(
        "raceId".into(),
        json!(week.race.as_ref().map(|race| race.id)),
    );
    out.insert(
        "raceStatus".into(),
        json!(week.race.as_ref().map(|race| race.status.clone())),
    );
    out.insert("predictions".into(), json!([]));
    Ok(Value::Object(out))
}

// ---------------------------------------------------------------------------------------------
// POST /api/season3

async fn post_season3(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(rejection) => return ApiError::from(rejection).into_response(),
    };
    finish(post_inner(&state, &body).await, "Failed to save prediction")
}

async fn post_inner(state: &AppState, bytes: &[u8]) -> Result<Response, Failure> {
    let body = parse_request(bytes)?;
    let token = js::property(&body, "token");
    if !js::truthy(token) {
        return Err(ApiError::bad_request("Token là bắt buộc").into());
    }
    let season = {
        let mut conn = state.db().reader.acquire().await?;
        player::load_active_season_core(&mut conn).await?
    };
    let Some(season) = season else {
        return Err(ApiError::not_found("Chưa có Season 3 active").into());
    };
    // `candidate.accessToken === body.token`: only a string can match.
    let player = match token {
        Some(Value::String(token)) => season.players.iter().find(|p| p.access_token == *token),
        _ => None,
    };
    let Some(player) = player else {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "Personal link không hợp lệ").into());
    };
    let action = js::property(&body, "action").and_then(Value::as_str);

    match action {
        Some("appearance") => return appearance_action(state, &body, player.id).await,
        Some("favorite") => return favorite_action(state, &body, player.id).await,
        Some("save-preset") => return save_preset_action(state, &body, player.id).await,
        Some("load-preset") => return load_preset_action(state, &body, player.id).await,
        Some("seen-cosmetics") => {
            let mut tx = state.db().begin_write().await?;
            player::mark_cosmetics_seen(&mut tx, player.id).await?;
            tx.commit().await?;
            return Ok(json_ok(&json!({ "ok": true })));
        }
        _ => {}
    }

    let Some(week) = season.weeks.iter().find(|week| week.status == "open") else {
        return Err(ApiError::conflict("Tuần đã đóng hoặc đã resolve").into());
    };
    let skipped = parse_skipped_player_ids(week.skipped_player_ids_json.as_deref());
    if skipped_contains(&skipped, player.user_id) {
        return Err(ApiError::conflict("Host đã cho bạn nghỉ race tuần này").into());
    }

    if action == Some("shield") {
        if player.shields < 1 {
            return Err(ApiError::bad_request("Bạn không có Shield để xác nhận").into());
        }
        let mut tx = state.db().begin_write().await?;
        recheck_open_week(&mut tx, week.id, player.user_id).await?;
        if js::property(&body, "useShield") == Some(&Value::Bool(false)) {
            player::delete_shield_choice(&mut tx, week.id, player.id).await?;
            tx.commit().await?;
            return Ok(json_ok(&json!({
                "ok": true,
                "shieldConfirmed": false,
                "message": "Đã bỏ xác nhận dùng Shield.",
            })));
        }
        player::upsert_shield_choice(&mut tx, week.id, player.id, player.user_id).await?;
        tx.commit().await?;
        return Ok(json_ok(&json!({
            "ok": true,
            "shieldConfirmed": true,
            "message": "Đã xác nhận dùng Shield tuần này.",
        })));
    }

    if action == Some("loadout") {
        // `(body.itemIds ?? []).map((item) => raceItemIdSchema.parse(item))`.
        let item_ids = match js::property(&body, "itemIds") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(items)) => items
                .iter()
                .map(parse_item_id)
                .collect::<Result<Vec<_>, _>>()?,
            Some(_) => return Err(internal("body.itemIds.map is not a function")),
        };
        let validation = validate_loadout(&item_ids)?;
        let ready = js::truthy(js::property(&body, "ready"));
        if ready && !validation.ready {
            return Err(ApiError::bad_request(
                "Loadout cần dùng đủ 3 Prep Credits với 1 Major + 1 Minor",
            )
            .into());
        }
        let status = if ready { "ready" } else { "draft" };
        let item_ids_json = serialize_item_ids(&item_ids)?;
        let mut tx = state.db().begin_write().await?;
        recheck_open_week(&mut tx, week.id, player.user_id).await?;
        player::upsert_loadout(
            &mut tx,
            week.id,
            player,
            &item_ids_json,
            status,
            ready.then(DbTime::now),
        )
        .await?;
        tx.commit().await?;
        return Ok(json_ok(&json!({
            "ok": true,
            "status": status,
            "message": if ready { "Loadout đã khóa." } else { "Đã lưu loadout." },
        })));
    }

    let Some(target) = js::as_number(js::property(&body, "targetUserId")) else {
        return Err(ApiError::bad_request("targetUserId là bắt buộc").into());
    };
    // User ids are database integers, exact as doubles.
    #[allow(clippy::cast_precision_loss)]
    let as_number = |id: i64| id as f64;
    if as_number(player.user_id) == target {
        return Err(ApiError::bad_request("Không được pick bản thân").into());
    }
    let Some(target_player) = season
        .players
        .iter()
        .find(|candidate| as_number(candidate.user_id) == target)
    else {
        return Err(ApiError::bad_request("Target không đua tuần này").into());
    };
    if skipped.contains(&target) {
        return Err(ApiError::bad_request("Target không đua tuần này").into());
    }
    let mut tx = state.db().begin_write().await?;
    if skipped_contains(
        &recheck_open_week(&mut tx, week.id, player.user_id).await?,
        target_player.user_id,
    ) {
        return Err(ApiError::bad_request("Target không đua tuần này").into());
    }
    player::upsert_prediction(&mut tx, week.id, player, target_player.user_id).await?;
    tx.commit().await?;
    Ok(json_ok(&json!({
        "ok": true,
        "message": "Prediction đã khóa cho tuần này.",
    })))
}

/// The pre-checks above, repeated inside the write transaction (a deliberate difference from TS,
/// which only checks before writing): the week must still be `open` and the player not skipped.
/// The single writer serialises this with admin `lock`/`toggle-skip`, so no shield choice,
/// loadout or prediction lands on a locked week or for a skipped player. Answers the same 409s
/// as the pre-check; returns the current skip list.
async fn recheck_open_week(
    conn: &mut sqlx::SqliteConnection,
    week_id: i64,
    user_id: i64,
) -> Result<Vec<f64>, Failure> {
    let Some(skipped_json) = player::open_week_skip_list(conn, week_id).await? else {
        return Err(ApiError::conflict("Tuần đã đóng hoặc đã resolve").into());
    };
    let skipped = parse_skipped_player_ids(skipped_json.as_deref());
    if skipped_contains(&skipped, user_id) {
        return Err(ApiError::conflict("Host đã cho bạn nghỉ race tuần này").into());
    }
    Ok(skipped)
}

/// The keys `normalizeAppearance` can read from `value`: an object's own entries; any other
/// value has none (`input[key]` is `undefined`), so it fails with "Duck cần một Body Color".
fn appearance_input(value: Option<&Value>) -> Map<String, Value> {
    value
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

async fn appearance_action(
    state: &AppState,
    body: &Value,
    player_id: i64,
) -> Result<Response, Failure> {
    let appearance = js::property(body, "appearance");
    if !js::truthy(appearance) {
        return Err(ApiError::bad_request("Thiếu appearance").into());
    }
    let raw = appearance_input(appearance);
    let mut tx = state.db().begin_write().await?;
    grant_starter_cosmetics(&mut tx, player_id).await?;
    let saved = save_appearance(&mut tx, player_id, &raw).await?;
    player::mark_onboarded(&mut tx, player_id).await?;
    tx.commit().await?;
    Ok(json_ok(
        &json!({ "ok": true, "appearance": to_value(&saved)? }),
    ))
}

async fn favorite_action(
    state: &AppState,
    body: &Value,
    player_id: i64,
) -> Result<Response, Failure> {
    let cosmetic_id = js::property(body, "cosmeticId");
    if js::truthy(cosmetic_id) {
        // A truthy non-string fails Prisma validation.
        let Some(Value::String(id)) = cosmetic_id else {
            return Err(internal("cosmeticId is not a string"));
        };
        let owned = {
            let mut conn = state.db().reader.acquire().await?;
            player::owns_cosmetic(&mut conn, player_id, id).await?
        };
        if !owned {
            return Err(ApiError::conflict("Bạn chưa sở hữu cosmetic này").into());
        }
    }
    // `favoriteId: body.cosmeticId ?? null`: `""` is stored as is; `0`/`false` fail validation.
    let favorite = match cosmetic_id {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) => Some(id.as_str()),
        Some(_) => return Err(internal("favoriteId is not a string")),
    };
    let mut tx = state.db().begin_write().await?;
    let Some(appearance) = player::set_favorite(&mut tx, player_id, favorite).await? else {
        return Err(internal("PlayerAppearance not found (P2025)"));
    };
    tx.commit().await?;
    Ok(json_ok(
        &json!({ "ok": true, "appearance": to_value(&appearance)? }),
    ))
}

async fn save_preset_action(
    state: &AppState,
    body: &Value,
    player_id: i64,
) -> Result<Response, Failure> {
    let index = js::property(body, "presetIndex");
    let appearance = js::property(body, "appearance");
    let slot = js::as_number(index).filter(|_| js::is_integer(index));
    let Some(slot) = slot.filter(|slot| (1.0..=3.0).contains(slot)) else {
        return Err(ApiError::bad_request("Preset không hợp lệ").into());
    };
    if !js::truthy(appearance) {
        return Err(ApiError::bad_request("Preset không hợp lệ").into());
    }
    let raw = appearance_input(appearance);
    // `saveAppearance(prisma, …)`: its own writes, committed before the preset.
    let validated = {
        let mut tx = state.db().begin_write().await?;
        let row = save_appearance(&mut tx, player_id, &raw).await?;
        tx.commit().await?;
        row
    };
    // `body.presetName?.trim().slice(0, 30) || `Preset ${body.presetIndex}``.
    let name = match js::property(body, "presetName") {
        None | Some(Value::Null) => None,
        Some(Value::String(name)) => Some(js_slice_utf16(js_trim(name), 30)),
        Some(_) => return Err(internal("body.presetName.trim is not a function")),
    };
    let name = name
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("Preset {}", js::number_to_string(slot)));
    let appearance_json = js_json::stringify(&to_value(&validated)?);
    #[allow(clippy::cast_possible_truncation)]
    let slot = slot as i64;
    let mut tx = state.db().begin_write().await?;
    let preset = player::upsert_preset(&mut tx, player_id, slot, &name, &appearance_json).await?;
    tx.commit().await?;
    Ok(json_ok(
        &json!({ "ok": true, "preset": to_value(&preset)? }),
    ))
}

async fn load_preset_action(
    state: &AppState,
    body: &Value,
    player_id: i64,
) -> Result<Response, Failure> {
    let index = js::property(body, "presetIndex");
    if !js::is_integer(index) {
        return Err(ApiError::bad_request("Preset không hợp lệ").into());
    }
    let slot = js::as_number(index)
        .and_then(js::prisma_int)
        .ok_or_else(|| internal("presetIndex is outside Prisma's Int"))?;
    let preset = {
        let mut conn = state.db().reader.acquire().await?;
        player::find_preset(&mut conn, player_id, slot).await?
    };
    let Some(preset) = preset else {
        return Err(ApiError::not_found("Preset chưa được lưu").into());
    };
    // `JSON.parse(preset.appearanceJson)`: `null` throws on property access; other non-objects
    // have no slot keys.
    let raw = match serde_json::from_str::<Value>(&preset.appearance_json)? {
        Value::Null => return Err(internal("stored preset appearance is null")),
        other => appearance_input(Some(&other)),
    };
    let mut tx = state.db().begin_write().await?;
    let appearance = save_appearance(&mut tx, player_id, &raw).await?;
    tx.commit().await?;
    Ok(json_ok(
        &json!({ "ok": true, "appearance": to_value(&appearance)? }),
    ))
}

// ---------------------------------------------------------------------------------------------
// POST /api/season3/redeem

async fn post_redeem(
    State(state): State<AppState>,
    body: Result<Bytes, BytesRejection>,
) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(rejection) => return ApiError::from(rejection).into_response(),
    };
    finish(redeem_inner(&state, &body).await, "Redeem failed")
}

/// The checks before the redeem transaction, in TS order.
fn redeem_target<'a>(
    season: &'a RedeemSeason,
    token: &Value,
    reward_key: &Value,
) -> Result<
    (
        &'a crate::cosmetics::rows::SeasonPlayerRow,
        &'a SeasonRewardRow,
    ),
    ApiError,
> {
    let player = match token {
        Value::String(token) => season.players.iter().find(|p| p.access_token == *token),
        _ => None,
    };
    let reward = match reward_key {
        Value::String(key) => season
            .rewards
            .iter()
            .find(|reward| reward.key == *key && reward.active),
        _ => None,
    };
    let Some(player) = player else {
        return Err(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Personal link không hợp lệ",
        ));
    };
    let Some(reward) = reward else {
        return Err(ApiError::not_found("Reward không tồn tại hoặc đã tắt"));
    };
    if player.prediction_points < reward.cost {
        return Err(ApiError::conflict(format!("Cần {} 🔮", reward.cost)));
    }
    if reward.stock.is_some_and(|stock| stock <= 0) {
        return Err(ApiError::conflict("Reward đã hết stock"));
    }
    Ok((player, reward))
}

async fn redeem_inner(state: &AppState, bytes: &[u8]) -> Result<Response, Failure> {
    let body = parse_request(bytes)?;
    let token = js::property(&body, "token");
    let reward_key = js::property(&body, "rewardKey");
    let (Some(token), Some(reward_key)) = (token, reward_key) else {
        return Err(ApiError::bad_request("Token và rewardKey là bắt buộc").into());
    };
    if !js::truthy(Some(token)) || !js::truthy(Some(reward_key)) {
        return Err(ApiError::bad_request("Token và rewardKey là bắt buộc").into());
    }
    let season = {
        let mut conn = state.db().reader.acquire().await?;
        player::load_redeem_season(&mut conn).await?
    };
    let Some(season) = season else {
        return Err(ApiError::not_found("Chưa có Season 3").into());
    };
    redeem_target(&season, token, reward_key)?;

    let mut tx = state.db().begin_write().await?;
    let Some(fresh) = player::load_redeem_season(&mut tx).await? else {
        return Err(ApiError::not_found("Chưa có Season 3").into());
    };
    let (player, reward) = redeem_target(&fresh, token, reward_key)?;
    let redemption = player::redeem(&mut tx, fresh.season.id, player.id, reward).await?;
    tx.commit().await?;
    Ok(json_ok(&json!({
        "ok": true,
        "redemption": to_value(&redemption)?,
        "reward": reward.name,
    })))
}
