//! API routes. Each module ports one TS route group; [`router`] merges them under `/api`.
//!
//! Live races (Phase 5): [`races_live`] (SSE, wild-item 410, desync) and the admin `start-race`
//! action ([`crate::live::start`], dispatched from [`admin_season3`]).

pub mod admin_cosmetics;
pub mod admin_season3;
pub mod auth;
pub mod avatars;
pub mod cosmetics;
pub mod gacha;
pub mod races;
pub mod races_live;
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
        .merge(races_live::router())
        .merge(season3::router())
}
