//! The Season 3 admin route (`/api/admin/season3`, plan Phase 3 stage B) over the meta layer:
//!
//! - [`rows`]: the Season 3 tables as Prisma returns them, and the query shapes Prisma issues;
//! - [`dashboard`]: the GET dashboard (players, weeks with readiness, rewards, balance);
//! - [`ops`]: `GET ?report=ops`, including the replay-track gate (plan step 0.4, §4.5);
//! - [`actions`]: the POST actions (`create-season`, `open-week`, `set-chaos`, `toggle-skip`,
//!   `lock`, `unlock`, `extend-season`, `end-season`, the new `reseed-week`; `start-race` is
//!   Phase 5 and answers 501);
//! - [`seed`]: `createRaceSeed()` and the `set-chaos` clock, deterministic under `test-rng`;
//! - [`js`]: JS number printing and Prisma `Int` coercion for request bodies.
//!
//! The HTTP layer (auth, body parsing) is `routes/admin_season3.rs`.

pub mod actions;
pub mod dashboard;
pub mod js;
pub mod ops;
pub mod rows;
pub mod seed;
