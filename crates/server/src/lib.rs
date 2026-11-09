//! AutoDuck server (rewrite plan Phase 3): one axum binary over the Prisma-compatible SQLite DB.
//!
//! Module map:
//! - [`config`]: environment configuration (`DATABASE_URL`, `AUTODUCK_*`, `PORT`, secrets).
//! - [`cli`]: the `autoduck` subcommands.
//! - [`db`]: `DATABASE_URL` parsing, [`db::DbTime`] (D13), the writer/reader pools (D15),
//!   the schema verifier (D14) and the required TS migration ids.
//! - [`boot`]: the boot guards in plan order (lock, DB guards, backup, integrity, schema,
//!   migrations, crash recovery).
//! - [`http`]: router, static `dist/` serving with SPA fallback, security headers, request
//!   logging, `/api/health`.
//! - [`auth`]: admin-secret and player-token extraction shared by routes.
//! - [`cosmetics`]: the embedded cosmetic catalog exported from TS (D19).
//! - [`routes`]: API route modules (stage A: stubs naming the TS source to port).
//! - [`error`]: the JSON API error type.

// The workspace clippy.toml bans HashMap/HashSet and serde_json::Value for the engine (D4(b)).
// Server code isn't part of the deterministic engine, so the type bans don't apply here; the
// float-method bans (D4(f): the server crate bans std transcendental methods) stay enforced.
#![allow(clippy::disallowed_types)]

pub mod auth;
pub mod boot;
pub mod cli;
pub mod config;
pub mod cosmetics;
pub mod db;
pub mod error;
pub mod http;
pub mod routes;
pub mod seed;
pub mod telemetry;

pub use config::Config;
pub use error::ApiError;
pub use http::AppState;
