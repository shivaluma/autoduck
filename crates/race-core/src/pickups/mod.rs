//! Track pickups, box (wild) items and hazards:
//! `packages/race-core/src/pickups/*` (S3.15).
//!
//! # Hooks the core step calls (M1 contract)
//!
//! | Rust | TS | Status |
//! |---|---|---|
//! | [`create_pickup_race_state`] | `createPickupRaceState` (`pickups/engine.ts:195`) | ported; spawns via [`spawn`] (**M2**) |
//! | [`announce_pickup_world`] | `announcePickupWorld` (`:209`) | ported |
//! | [`apply_recorded_wild_inputs`] | `applyRecordedWildInputs` (`:511`) | ported; [`wild::activate_wild_item`] handlers are **M2** |
//! | [`tick_pickup_system`] | `tickPickupSystem` (`:524`) | ported (`expireWildEffects`, `activateZones`); [`collect`] is **M2** |
//! | [`snapshot_pickup_world`] | `snapshotPickupWorld` (`:532`) | ported |
//!
//! Every M2 stub is exact for an absent `pickupConfig` (pickups, golden box
//! and hazards off) and panics with `todo!("M2: ...")` the first time it would
//! have to do real work, so an unported path can never diverge silently.

pub mod collect;
pub mod config;
pub mod engine;
pub mod spawn;
pub mod state;
pub mod wild;

pub use engine::{
    announce_pickup_world, apply_recorded_wild_inputs, create_pickup_race_state,
    snapshot_pickup_world, tick_pickup_system,
};
pub use state::{HazardSpawn, PickupRaceState, PickupSpawn};
pub use wild::{WildUseInput, WildUseMode, WildUseResult, activate_wild_item};
