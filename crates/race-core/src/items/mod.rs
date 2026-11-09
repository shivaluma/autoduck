//! Prep items (loadouts): `packages/race-core/src/items/*` (S3.15).
//!
//! # Hooks the core step calls (M1 contract)
//!
//! | Rust | TS | Status |
//! |---|---|---|
//! | [`create_item_race_state`] | `createItemRaceState` (`items/engine.ts:120`) | ported (brains: `auto_use::create_duck_brains`) |
//! | [`tick_item_system`] | `tickItemSystem` (`items/engine.ts:799`) | ported; calls the M2 hooks below |
//! | [`projectiles::update_rockets`] | `updateRockets` (`items/engine.ts:563`) | **M2** (no-op while no rocket exists) |
//! | [`projectiles::update_bananas`] | `updateBananas` (`items/engine.ts:682`) | **M2** (no-op while no banana exists) |
//! | [`apply_item_boost`] | `applyItemBoost` (`items/engine.ts:212`) | ported (boost gates use it) |
//! | [`item_speed_multiplier`] | `itemSpeedMultiplier` (`items/engine.ts:851`) | ported |
//! | [`item_active_effects`] | `itemActiveEffects` (`items/engine.ts:889`) | ported |
//! | [`snapshot_item_world`] | `snapshotItemWorld` (`items/engine.ts:780`) | ported |
//!
//! Also ported because the per-tick maintenance needs them:
//! `applyStagedSlow`, `applyItemSlow`, `grantGuardSurge`, `finishSpeedBoost`,
//! `updateSlipstreamTracking`, `loadoutComboLabel/Badge` and `ITEM_BALANCE`.
//!
//! **Left for M2** (each in its own file under `items/`): `breakActiveSpeedBoost`
//! (`:236`), `grantMomentumSteal` (`:303`), `tryActivateBubbleShield` (`:344`),
//! `armBubbleReflex` (`:365`), `triggerMenacePredatorRush` (`:371`),
//! `tryApplyPrepSpeedBoost` (`:390`), `slipstreamReady` (`:509`),
//! `bananaTouches` (`:520`), `firePrepRocket` (`:528`), the two projectile
//! updates, `items/interactions.ts` (`resolveIncomingRaceEffect`),
//! `items/aim.ts` and `items/telemetry.ts`.
//!
//! Conventions: the current tick is `u32`, runtime ticks are `i64`
//! ([`engine::seconds_to_ticks`], [`engine::tick_u32`] for event fields);
//! ducks are `&mut [DuckPhysicsState]` in `state.ducks` order; JS `sort`s go
//! through `js_sort::v8_sort_by` and ids compare with `sim::id_cmp`; events
//! go out through `sim::Emitter::emit(kind, source, target)`.

pub mod classes;
pub mod config;
pub mod engine;
pub mod projectiles;
pub mod state;

pub use classes::{LoadoutCombo, loadout_combo_badge, loadout_combo_label};
pub use engine::{
    apply_item_boost, apply_item_slow, apply_staged_slow, create_item_race_state,
    finish_speed_boost, grant_guard_surge, item_active_effects, item_speed_multiplier,
    snapshot_item_world, tick_item_system,
};
pub use state::{
    BananaRuntime, DuckItemRuntime, HeldWildItem, ItemRaceState, ProjectileSource,
    QueuedSpeedBoost, RocketRuntime,
};
