//! `GET /api/cosmetics/profile/{userId}`: public duck profile (owner sees the personal link).
//!
//! Port of `app/api/cosmetics/profile/[userId]/route.ts`. The player is looked up by `userId`
//! in the active season; the viewer (`?token=`) is the owner when its `userId` matches.

use axum::Json;
use axum::Router;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::json;
use sqlx::AssertSqlSafe;

use crate::auth::google::has_google_link;
use crate::auth::player::QueryToken;
use crate::cosmetics::js;
use crate::cosmetics::rows::{
    APPEARANCE_COLUMNS, COSMETIC_COLUMNS, PlayerAppearanceRow, PlayerCosmeticRow, SEASON_COLUMNS,
    SEASON_PLAYER_COLUMNS, SeasonPlayerRow, SeasonRow, USER_COLUMNS, UserRow,
};
use crate::error::{ApiError, ApiResult};
use crate::http::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/cosmetics/profile/{user_id}", get(get_profile))
}

/// `findFirst({ where: { <column>: ?, season: { status: 'active' } } })`, as Prisma writes it.
fn active_player_sql(column: &str) -> String {
    format!(
        r#"SELECT {SEASON_PLAYER_COLUMNS} FROM "SeasonPlayer" LEFT JOIN "Season" AS "j0" ON ("j0"."id") = ("SeasonPlayer"."seasonId")
           WHERE ("SeasonPlayer"."{column}" = ? AND ("j0"."status" = ? AND ("j0"."id" IS NOT NULL))) LIMIT ? OFFSET ?"#
    )
}

async fn get_profile(
    State(state): State<AppState>,
    path: Result<Path<String>, PathRejection>,
    QueryToken(token): QueryToken,
) -> ApiResult<Response> {
    // A segment axum can't decode (invalid UTF-8) can't be a number either. TS answers 500
    // text/plain there (Next can't decode it); we keep the JSON contract (accept-list
    // `path-invalid-utf8`).
    let Ok(Path(raw_user_id)) = path else {
        return Err(ApiError::bad_request("Dzịt không hợp lệ"));
    };
    // `Number(rawUserId)` + `Number.isInteger`; Prisma rejects an Int outside i64 (→ 500).
    let number = js::number_from_string(&raw_user_id);
    if !(number.is_finite() && js::trunc(number) == number) {
        return Err(ApiError::bad_request("Dzịt không hợp lệ"));
    }
    let user_id = js::prisma_int(number)
        .ok_or_else(|| ApiError::internal(format!("userId {number} is outside Prisma's Int")))?;

    let mut conn = state.db().reader.acquire().await?;
    let Some(player) =
        sqlx::query_as::<_, SeasonPlayerRow>(AssertSqlSafe(active_player_sql("userId")))
            .bind(user_id)
            .bind("active")
            .bind(1_i64)
            .bind(0_i64)
            .fetch_optional(&mut *conn)
            .await?
    else {
        return Err(ApiError::not_found("Không tìm thấy dzịt"));
    };

    let user = sqlx::query_as::<_, UserRow>(AssertSqlSafe(format!(
        r#"SELECT {USER_COLUMNS} FROM "User" WHERE "User"."id" IN (?) LIMIT ? OFFSET ?"#
    )))
    .bind(player.user_id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| ApiError::internal("season player without a user"))?;
    let appearance = sqlx::query_as::<_, PlayerAppearanceRow>(AssertSqlSafe(format!(
        r#"SELECT {APPEARANCE_COLUMNS} FROM "PlayerAppearance" WHERE "PlayerAppearance"."seasonPlayerId" IN (?) LIMIT ? OFFSET ?"#
    )))
    .bind(player.id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_optional(&mut *conn)
    .await?;
    let cosmetics = sqlx::query_as::<_, PlayerCosmeticRow>(AssertSqlSafe(format!(
        r#"SELECT {COSMETIC_COLUMNS} FROM "PlayerCosmetic" WHERE "PlayerCosmetic"."seasonPlayerId" IN (?)
           ORDER BY "PlayerCosmetic"."obtainedAt" DESC LIMIT ? OFFSET ?"#
    )))
    .bind(player.id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_all(&mut *conn)
    .await?;
    let season = sqlx::query_as::<_, SeasonRow>(AssertSqlSafe(format!(
        r#"SELECT {SEASON_COLUMNS} FROM "Season" WHERE "Season"."id" IN (?) LIMIT ? OFFSET ?"#
    )))
    .bind(player.season_id)
    .bind(-1_i64)
    .bind(0_i64)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| ApiError::internal("season player without a season"))?;

    let viewer = match token.as_deref() {
        Some(token) => {
            sqlx::query_as::<_, SeasonPlayerRow>(AssertSqlSafe(active_player_sql("accessToken")))
                .bind(token)
                .bind("active")
                .bind(1_i64)
                .bind(0_i64)
                .fetch_optional(&mut *conn)
                .await?
        }
        None => None,
    };
    drop(conn);

    let is_owner = viewer.is_some_and(|viewer| viewer.user_id == user_id);
    for cosmetic in &cosmetics {
        if !crate::cosmetics::catalog().contains(&cosmetic.cosmetic_id) {
            crate::cosmetics::note_unknown(&cosmetic.cosmetic_id, "profile");
        }
    }
    let favorite_id = appearance
        .as_ref()
        .and_then(|appearance| appearance.favorite_id.clone());
    let recent: Vec<&PlayerCosmeticRow> = cosmetics.iter().take(24).collect();
    let personal_link = is_owner.then(|| {
        format!(
            "/season-3?token={}",
            js::encode_uri_component(&player.access_token)
        )
    });
    Ok(Json(json!({
        "userId": player.user_id,
        "name": user.name,
        "avatarUrl": user.avatar_url,
        "season": season.name,
        "appearance": appearance,
        "favoriteId": favorite_id,
        "collectionCount": cosmetics.len(),
        "recentCosmetics": recent,
        "stats": {
            "raceWins": player.race_wins,
            "raceCount": player.race_count,
            "kingStreak": player.king_streak,
            "scars": player.scars,
            "shields": player.shields,
            "championshipPoints": player.championship_points,
            "predictionPoints": player.prediction_points,
            "quackPoints": player.quack_points,
            "isKing": player.is_king,
        },
        "isOwner": is_owner,
        "isGoogleLinked": has_google_link(user.google_id.as_deref()),
        "googleEmail": if is_owner { user.email.clone() } else { None },
        "personalLink": personal_link,
    }))
    .into_response())
}
