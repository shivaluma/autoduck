//! JSON API errors. Every TS route answers errors as `{ "error": "<message>" }` with a status
//! code, so that is the only error body the API produces.

use std::borrow::Cow;
use std::fmt::Display;

use axum::Json;
use axum::extract::rejection::BytesRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: Cow<'static, str>,
}

impl ApiError {
    pub fn new(status: StatusCode, message: impl Into<Cow<'static, str>>) -> Self {
        ApiError {
            status,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<Cow<'static, str>>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    /// `{ "error": "Unauthorized" }`, 401: the admin routes' rejection.
    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "Unauthorized")
    }

    pub fn forbidden(message: impl Into<Cow<'static, str>>) -> Self {
        Self::new(StatusCode::FORBIDDEN, message)
    }

    pub fn not_found(message: impl Into<Cow<'static, str>>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    pub fn conflict(message: impl Into<Cow<'static, str>>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }

    /// Logs `error` and answers 500 without leaking its text.
    pub fn internal(error: impl Display) -> Self {
        tracing::error!(%error, "internal error");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        #[derive(serde::Serialize)]
        struct Body<'a> {
            error: &'a str,
        }
        (
            self.status,
            Json(Body {
                error: &self.message,
            }),
        )
            .into_response()
    }
}

/// A body the server refused to buffer: over [`crate::http::BODY_LIMIT`] (413) or a client
/// error mid-upload (400). axum's own rejection is `text/plain` and names framework internals
/// (review 2/3: keep the `{ "error": … }` contract).
impl From<BytesRejection> for ApiError {
    fn from(rejection: BytesRejection) -> Self {
        let status = rejection.status();
        tracing::debug!(%status, reason = %rejection.body_text(), "request body refused");
        if status == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::new(status, "Payload Too Large")
        } else {
            ApiError::new(status, "Invalid request body")
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        ApiError::internal(error)
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
