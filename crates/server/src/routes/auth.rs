//! `GET|POST /api/auth/google`: Google sign-in, bind and unbind (D24, as shipped on main).
//!
//! Ported from `app/api/auth/google/route.ts` and `lib/auth/google.ts` (commit `d8c69d1`):
//! - the credential is a verified Google ID token ([`crate::auth::google`]); unreachable Google
//!   keys answer 503, a token that doesn't verify 401;
//! - login matches by verified Google id (`sub`) only, never by email;
//! - bind refuses a `sub` linked to another user with a generic 409, and stores the email only
//!   when Google verified it and no other user has it;
//! - players are joined by `userId`.
//!
//! Request and response JSON are identical to the TS route. Bind's reads and its update run in
//! one `BEGIN IMMEDIATE` transaction (TS ran them as separate statements).

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use serde_json::{Value, json};

use crate::auth::google::{
    GoogleProfile, KeySource, RemoteJwks, google_client_id, has_google_link, verify_google_id_token,
};
use crate::auth::js_trim;
use crate::auth::player::{QueryToken, body_token, find_player_by_token};
use crate::db::DbTime;
use crate::error::ApiError;
use crate::http::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/auth/google", get(get_config).post(post))
}

const ALREADY_LINKED: &str = "Tài khoản Google này đã được liên kết với một chú Dzịt khác.";
const INVALID_REQUEST: &str = "Yêu cầu không hợp lệ";

fn error(status: StatusCode, message: &'static str) -> Response {
    ApiError::new(status, message).into_response()
}

/// `GET /api/auth/google?token=`: the button's client id and, for a valid token, who it is.
async fn get_config(State(state): State<AppState>, QueryToken(token): QueryToken) -> Response {
    let client_id = google_client_id(&state.config().google_audiences);
    let bound = match token {
        None => Ok(Value::Null),
        Some(token) => sqlx::query!(
            r#"SELECT u."id" AS "id!: i64", u."name" AS "name!: String", u."email", u."googleId" AS "google_id"
               FROM "SeasonPlayer" p JOIN "User" u ON u."id" = p."userId"
               WHERE p."accessToken" = ?"#,
            token
        )
        .fetch_optional(&state.db().reader)
        .await
        .map(|row| match row {
            None => Value::Null,
            Some(user) => json!({
                "userId": user.id,
                "name": user.name,
                "email": user.email,
                "hasGoogle": has_google_link(user.google_id.as_deref()),
            }),
        }),
    };
    match bound {
        Ok(bound) => Json(json!({
            "clientId": client_id,
            "isConfigured": !client_id.is_empty(),
            "bound": bound,
        }))
        .into_response(),
        Err(err) => {
            tracing::error!(error = %err, "Google Auth GET error");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Không lấy được cấu hình Google Auth",
            )
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Login,
    Bind,
    Unbind,
}

/// `await request.json()`: UTF-8 decode (BOM stripped, invalid bytes replaced), then JSON.parse.
fn parse_json_body(body: &[u8]) -> Option<Value> {
    let text = String::from_utf8_lossy(body);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    serde_json::from_str(text).ok()
}

async fn post(State(state): State<AppState>, body: Result<Bytes, BytesRejection>) -> Response {
    let body = match body {
        Ok(body) => body,
        Err(rejection) => return ApiError::from(rejection).into_response(),
    };
    match handle_post(&state, &body).await {
        Ok(response) => response,
        Err(err) => {
            tracing::error!(error = %err, "Google Auth POST error");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Đã xảy ra lỗi khi xử lý đăng nhập Google.",
            )
        }
    }
}

async fn handle_post(state: &AppState, body: &[u8]) -> Result<Response, sqlx::Error> {
    let Some(body @ Value::Object(_)) = parse_json_body(body) else {
        return Ok(error(StatusCode::BAD_REQUEST, INVALID_REQUEST));
    };
    let action = match body.get("action") {
        None => Action::Login,
        Some(Value::String(action)) if action == "login" => Action::Login,
        Some(Value::String(action)) if action == "bind" => Action::Bind,
        Some(Value::String(action)) if action == "unbind" => Action::Unbind,
        Some(_) => {
            return Ok(error(StatusCode::BAD_REQUEST, "Hành động không hợp lệ"));
        }
    };
    let player_token = body_token(&body);

    if action == Action::Unbind {
        return unbind(state, player_token).await;
    }

    // Verify the Google ID token.
    let audience = &state.config().google_audiences;
    if audience.is_empty() {
        tracing::error!("Google sign-in is not configured: set GOOGLE_CLIENT_ID.");
        return Ok(error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Đăng nhập Google chưa được cấu hình.",
        ));
    }
    let Some(credential) = body
        .get("credential")
        .and_then(Value::as_str)
        .filter(|credential| !js_trim(credential).is_empty())
    else {
        return Ok(error(
            StatusCode::BAD_REQUEST,
            "Thiếu thông tin xác thực Google",
        ));
    };
    let remote = RemoteJwks::shared(&state.config().google_jwks_url);
    let verdict = verify_google_id_token(credential, audience, KeySource::Remote(&remote)).await;
    let profile = match verdict {
        Ok(Some(profile)) => profile,
        Ok(None) => {
            return Ok(error(
                StatusCode::UNAUTHORIZED,
                "Không thể xác thực thông tin tài khoản Google",
            ));
        }
        Err(unavailable) => {
            tracing::error!(error = %unavailable, "Could not fetch Google signing keys");
            return Ok(error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Không kết nối được Google. Vui lòng thử lại sau.",
            ));
        }
    };

    match action {
        Action::Bind => bind(state, player_token, &profile).await,
        _ => login(state, &profile).await,
    }
}

async fn unbind(state: &AppState, token: Option<&str>) -> Result<Response, sqlx::Error> {
    let Some(token) = token else {
        return Ok(error(StatusCode::BAD_REQUEST, "Token là bắt buộc"));
    };
    let Some(player) = find_player_by_token(&state.db().reader, token).await? else {
        return Ok(error(StatusCode::UNAUTHORIZED, "Token không hợp lệ"));
    };
    let now = DbTime::now();
    let mut tx = state.db().begin_write().await?;
    let updated = sqlx::query!(
        r#"UPDATE "User" SET "googleId" = NULL, "email" = NULL, "updatedAt" = ? WHERE "id" = ?"#,
        now,
        player.user_id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated != 1 {
        // `prisma.user.update` on a missing row throws (P2025) → 500.
        return Err(sqlx::Error::RowNotFound);
    }
    tx.commit().await?;
    Ok(Json(json!({
        "ok": true,
        "message": "Đã hủy liên kết tài khoản Google thành công.",
    }))
    .into_response())
}

async fn bind(
    state: &AppState,
    token: Option<&str>,
    profile: &GoogleProfile,
) -> Result<Response, sqlx::Error> {
    let Some(token) = token else {
        return Ok(error(
            StatusCode::BAD_REQUEST,
            "Token là bắt buộc để liên kết",
        ));
    };
    let Some(player) = find_player_by_token(&state.db().reader, token).await? else {
        return Ok(error(StatusCode::UNAUTHORIZED, "Token không hợp lệ"));
    };
    let user_id = player.user_id;

    let mut tx = state.db().begin_write().await?;
    let user = sqlx::query!(
        r#"SELECT "email", "avatarUrl" AS "avatar_url" FROM "User" WHERE "id" = ?"#,
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(sqlx::Error::RowNotFound)?;

    // One Google account per duck.
    let linked_elsewhere = sqlx::query_scalar!(
        r#"SELECT "id" AS "id!: i64" FROM "User" WHERE "googleId" = ? AND "id" <> ? LIMIT 1"#,
        profile.google_id,
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(other) = linked_elsewhere {
        tracing::warn!(
            "Google bind refused: sub already linked to user {other}, requested by user {user_id}"
        );
        return Ok(error(StatusCode::CONFLICT, ALREADY_LINKED));
    }

    // Store the verified email only when Google verified it and no other duck already uses it.
    let mut email = user.email;
    if let Some(google_email) = profile.email.as_deref().filter(|_| profile.email_verified) {
        let owner = sqlx::query_scalar!(
            r#"SELECT "id" AS "id!: i64" FROM "User" WHERE "email" = ? AND "id" <> ? LIMIT 1"#,
            google_email,
            user_id
        )
        .fetch_optional(&mut *tx)
        .await?;
        if owner.is_none() {
            email = Some(google_email.to_owned());
        }
    }
    // `player.user.avatarUrl || googleProfile.picture || null`
    let avatar_url = user
        .avatar_url
        .filter(|url| !url.is_empty())
        .or_else(|| profile.picture.clone().filter(|url| !url.is_empty()));

    let now = DbTime::now();
    let updated = sqlx::query!(
        r#"UPDATE "User" SET "googleId" = ?, "email" = ?, "avatarUrl" = ?, "updatedAt" = ?
           WHERE "id" = ?
           RETURNING "id" AS "id!: i64", "name" AS "name!: String", "email""#,
        profile.google_id,
        email,
        avatar_url,
        now,
        user_id
    )
    .fetch_optional(&mut *tx)
    .await;
    let updated = match updated {
        Ok(Some(updated)) => updated,
        Ok(None) => return Err(sqlx::Error::RowNotFound),
        Err(err)
            if err
                .as_database_error()
                .is_some_and(|db| db.is_unique_violation()) =>
        {
            return Ok(error(StatusCode::CONFLICT, ALREADY_LINKED));
        }
        Err(err) => return Err(err),
    };
    tx.commit().await?;

    let shown = profile
        .email
        .as_deref()
        .or(profile.name.as_deref())
        .unwrap_or("thành công");
    Ok(Json(json!({
        "ok": true,
        "message": format!("Đã liên kết tài khoản Google ({shown}) với Dzịt {}!", updated.name),
        "user": {
            "id": updated.id,
            "name": updated.name,
            "email": updated.email,
        },
    }))
    .into_response())
}

async fn login(state: &AppState, profile: &GoogleProfile) -> Result<Response, sqlx::Error> {
    let reader = &state.db().reader;
    // findUserByGoogle: by verified Google id only, never by email.
    let Some(user) = sqlx::query!(
        r#"SELECT "id" AS "id!: i64", "name" AS "name!: String", "email" FROM "User"
           WHERE "googleId" = ? ORDER BY "id" LIMIT 1"#,
        profile.google_id
    )
    .fetch_optional(reader)
    .await?
    else {
        return Ok(error(
            StatusCode::NOT_FOUND,
            "Tài khoản Google này chưa được liên kết với chú Dzịt nào. Hãy đăng nhập bằng Secret Link một lần rồi bấm \"Liên kết Google\" để kích hoạt nhé!",
        ));
    };

    // getActiveSeasonPlayerToken: the first active season (Prisma findFirst, rowid order).
    let access_token = sqlx::query_scalar!(
        r#"SELECT p."accessToken" AS "access_token!: String" FROM "SeasonPlayer" p
           WHERE p."seasonId" = (SELECT s."id" FROM "Season" s WHERE s."status" = 'active' ORDER BY s."id" LIMIT 1)
             AND p."userId" = ?
           ORDER BY p."id" LIMIT 1"#,
        user.id
    )
    .fetch_optional(reader)
    .await?;
    let Some(access_token) = access_token else {
        return Ok(ApiError::new(
            StatusCode::FORBIDDEN,
            format!(
                "Chú Dzịt \"{}\" chưa tham gia Season 3 đang mở. Vui lòng liên hệ Admin.",
                user.name
            ),
        )
        .into_response());
    };

    Ok(Json(json!({
        "ok": true,
        "message": format!("Đăng nhập thành công! Chào mừng Dzịt {}! 🦆", user.name),
        "token": access_token,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
        },
    }))
    .into_response())
}
