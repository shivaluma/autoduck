//! `GET /api/health` (port of `app/api/health/route.ts`): liveness plus a trivial DB round trip.
//! No auth, always 200, never throws: `{"ok":true,"db":<bool>}` with `Cache-Control: no-store`.

use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::header;
use axum::response::IntoResponse;

use super::AppState;

#[derive(serde::Serialize)]
struct Health {
    ok: bool,
    db: bool,
}

pub async fn get(State(state): State<AppState>) -> impl IntoResponse {
    let query = sqlx::query_scalar::<_, i64>("SELECT 1").fetch_one(&state.db().reader);
    let db = match tokio::time::timeout(Duration::from_secs(2), query).await {
        Ok(Ok(1)) => true,
        Ok(Ok(other)) => {
            tracing::error!(other, "health check: unexpected result");
            false
        }
        Ok(Err(error)) => {
            tracing::error!(%error, "health check: database query failed");
            false
        }
        Err(_) => {
            tracing::error!("health check: database query timed out");
            false
        }
    };
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(Health { ok: true, db }),
    )
}
