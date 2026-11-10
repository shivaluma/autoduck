//! API routes. Each module ports one TS route group; [`router`] merges them under `/api`.
//!
//! Not ported yet (engine-dependent, Phase 5): wild-item, live SSE and the admin `start-race`
//! action (`/api/admin/season3` answers it 501 `not in stage B`).

pub mod admin_cosmetics;
pub mod admin_season3;
pub mod auth;
pub mod avatars;
pub mod cosmetics;
pub mod gacha;
pub mod races;
pub mod season3;
pub mod shop;

use axum::Router;

use crate::http::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(cosmetics::router())
        .merge(shop::router())
        .merge(gacha::router())
        .merge(admin_cosmetics::router())
        .merge(admin_season3::router())
        .merge(auth::router())
        .merge(avatars::router())
        .merge(races::router())
        .merge(season3::router())
}
