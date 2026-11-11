//! Track pickups, box (wild) items and hazards:
//! `packages/race-core/src/pickups/*` (S3.15).
//!
//! | Rust | TS |
//! |---|---|
//! | [`config`] | `pickups/config.ts` (`PICKUP_BALANCE`, `POSITION_CATEGORY_WEIGHTS`) |
//! | [`catalog`] | `pickups/catalog.ts` (`WILD_ITEM_CATALOG`, `getWildItem`) |
//! | [`state`] | `PickupSpawn`, `HazardSpawn`, `PickupRaceState` (`pickups/engine.ts:29-60`) |
//! | [`spawn`] | `shuffled`, `boxCount`, `createRegularBoxes`, `createGoldenBox`, `createHazards` (`:77-193`) |
//! | [`engine`] | `createPickupRaceState` (`:195`), `announcePickupWorld` (`:209`), `expireWildEffects` (`:495`), `applyRecordedWildInputs` (`:511`), `tickPickupSystem` (`:524`), `snapshotPickupWorld` (`:532`), `activateZones` (`:342`) |
//! | [`collect`] | `rankBucket`, `weightedCategory`, `nearestAhead`, `rollWildItem`, `grantOrTriggerItem`, `crossingFraction`, `touches`, `collectPickups`, `resolveHazards` (`:222-372`) |
//! | [`wild`] | `createWildRocket`, `createWildBanana`, `wildHornReach`, `HELD_HANDLERS`, `activateWildItem` (`:374-493`); the `autoReason` emit wrapper of `auto-use/execute.ts:256` |
//!
//! The engine's `pickupConfig(config)` (`:86-121`) is not ported: the
//! resolved config already holds it (`race_protocol::config`). F3: the
//! resolver's 0.15 is the single `goldenBoxProbability` default; the TS
//! engine's 0.18 fallback was never reachable and `resolve_ts_compat` keeps
//! Zod's 0.12 for the oracle.

pub mod catalog;
pub mod collect;
pub mod config;
pub mod engine;
pub mod spawn;
pub mod state;
pub mod wild;

pub use catalog::{
    WILD_ITEM_CATALOG, WildItemBehavior, WildItemCategory, WildItemDefinition, get_wild_item,
};
pub use collect::{AheadFilter, RankBucket, nearest_ahead, rank_bucket, roll_wild_item};
pub use engine::{
    announce_pickup_world, apply_recorded_wild_inputs, create_pickup_race_state,
    snapshot_pickup_world, tick_pickup_system,
};
pub use state::{HazardSpawn, PickupRaceState, PickupSpawn};
pub use wild::{
    HornReach, WildUseInput, WildUseMode, WildUseResult, activate_wild_item, set_auto_reason,
    wild_horn_reach, with_auto_reason,
};
