//! The personal magic-link token (`/season-3?token=…`, `SeasonPlayer.accessToken`).
//!
//! Tokens are opaque: never validated for shape, never logged. TS treats an empty token as
//! absent everywhere (`if (!token)`), so [`QueryToken`] and [`body_token`] do the same. Routes
//! differ in how they look the player up (active season only, with relations, …), so this module
//! only provides the common lookup by token; routes add their own filters.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use sqlx::SqliteExecutor;

use super::query_param;

/// `?token=` (first value), `None` when missing or empty.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryToken(pub Option<String>);

impl<S: Send + Sync> FromRequestParts<S> for QueryToken {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        Ok(QueryToken(
            query_param(parts.uri.query(), "token").filter(|token| !token.is_empty()),
        ))
    }
}

/// `body.token` when it is a non-empty string.
pub fn body_token(body: &serde_json::Value) -> Option<&str> {
    body.get("token")
        .and_then(serde_json::Value::as_str)
        .filter(|token| !token.is_empty())
}

/// The `SeasonPlayer` identity behind a token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenPlayer {
    pub id: i64,
    pub season_id: i64,
    pub user_id: i64,
}

/// `prisma.seasonPlayer.findUnique({ where: { accessToken } })` (any season).
pub async fn find_player_by_token<'e>(
    executor: impl SqliteExecutor<'e>,
    token: &str,
) -> Result<Option<TokenPlayer>, sqlx::Error> {
    let row = sqlx::query!(
        r#"SELECT "id" AS "id!: i64", "seasonId" AS "season_id!: i64", "userId" AS "user_id!: i64"
           FROM "SeasonPlayer" WHERE "accessToken" = ?"#,
        token
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.map(|row| TokenPlayer {
        id: row.id,
        season_id: row.season_id,
        user_id: row.user_id,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;

    async fn extract(uri: &str) -> QueryToken {
        let (mut parts, ()) = Request::builder().uri(uri).body(()).unwrap().into_parts();
        QueryToken::from_request_parts(&mut parts, &())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn query_token() {
        assert_eq!(
            extract("/x?token=abc").await,
            QueryToken(Some("abc".into()))
        );
        assert_eq!(extract("/x?token=").await, QueryToken(None));
        assert_eq!(extract("/x").await, QueryToken(None));
        assert_eq!(
            extract("/x?a=1&token=a%20b&token=z").await,
            QueryToken(Some("a b".into()))
        );
    }

    #[test]
    fn body_token_is_a_non_empty_string() {
        assert_eq!(body_token(&serde_json::json!({"token": "t"})), Some("t"));
        assert_eq!(body_token(&serde_json::json!({"token": ""})), None);
        assert_eq!(body_token(&serde_json::json!({"token": 5})), None);
        assert_eq!(body_token(&serde_json::json!({})), None);
    }
}
