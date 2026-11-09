//! Prep items (loadouts): `packages/race-core/src/items/*` (S3.15).
//!
//! # Hooks the core step calls (M1 contract)
//!
//! | Rust | TS | Status |
//! |---|---|---|
//! | [`create_item_race_state`] | `createItemRaceState` (`items/engine.ts:120`) | ported (brains: `auto_use::create_duck_brains`) |
//! | [`tick_item_system`] | `tickItemSystem` (`items/engine.ts:799`) | ported; calls the M2 hooks below |
//! | [`projectiles::update_rockets`] | `updateRockets` (`items/engine.ts:563`) | ported (M2) |
//! | [`projectiles::update_bananas`] | `updateBananas` (`items/engine.ts:682`) | ported (M2) |
//! | [`apply_item_boost`] | `applyItemBoost` (`items/engine.ts:212`) | ported (boost gates use it) |
//! | [`item_speed_multiplier`] | `itemSpeedMultiplier` (`items/engine.ts:851`) | ported |
//! | [`item_active_effects`] | `itemActiveEffects` (`items/engine.ts:889`) | ported |
//! | [`snapshot_item_world`] | `snapshotItemWorld` (`items/engine.ts:780`) | ported |
//!
//! Also ported because the per-tick maintenance needs them:
//! `applyStagedSlow`, `applyItemSlow`, `grantGuardSurge`, `finishSpeedBoost`,
//! `updateSlipstreamTracking`, `loadoutComboLabel/Badge` and `ITEM_BALANCE`.
//!
//! # M2 (for the auto-use executor and the box items)
//!
//! | Rust | TS |
//! |---|---|
//! | [`break_active_speed_boost`] | `breakActiveSpeedBoost` (`items/engine.ts:236`) |
//! | [`grant_momentum_steal`] | `grantMomentumSteal` (`:303`); TS defaults are [`MOMENTUM_STEAL_DEFAULTS`] |
//! | [`try_activate_bubble_shield`] | `tryActivateBubbleShield` (`:344`) |
//! | [`arm_bubble_reflex`] | `armBubbleReflex` (`:365`) |
//! | [`trigger_menace_predator_rush`] | `triggerMenacePredatorRush` (`:371`) |
//! | [`try_apply_prep_speed_boost`] | `tryApplyPrepSpeedBoost` (`:390`); `metadata` is [`SpeedStartExtras`] |
//! | [`slipstream_ready`] | `slipstreamReady` (`:509`) |
//! | [`projectiles::banana_touches`] | `bananaTouches` (`:520`) |
//! | [`fire_prep_rocket`] | `firePrepRocket` (`:528`); `{autoReason, ...metadata}` is one `RocketFiredMeta` |
//! | [`next_object_id`] | `itemState.nextObjectId++` |
//! | [`interactions::resolve_incoming_race_effect`] | `resolveIncomingRaceEffect` (`items/interactions.ts`) |
//! | [`aim`] | `items/aim.ts` (returns duck **indices**) |
//! | [`telemetry`] | `items/telemetry.ts` |
//! | [`catalog`], [`loadout`] | re-exports of `crate::catalog` / `crate::loadout` |
//!
//! `autoReason` injection: `executeWildAction` wraps `emit` so every event a
//! box item emits gets `autoReason` appended (`auto-use/execute.ts:256`).
//! The functions here always emit `auto_reason: None` in the metadata types
//! that carry the key; the wrapping belongs to the emitter (M3 / pickups).
//!
//! Conventions: the current tick is `u32`, runtime ticks are `i64`
//! ([`engine::seconds_to_ticks`], [`engine::tick_u32`] for event fields);
//! ducks are `&mut [DuckPhysicsState]` in `state.ducks` order; JS `sort`s go
//! through `js_sort::v8_sort_by` and ids compare with `sim::id_cmp`; events
//! go out through `sim::Emitter::emit(kind, source, target)`.

pub mod aim;
pub mod catalog;
pub mod classes;
pub mod config;
pub mod engine;
pub mod interactions;
pub mod loadout;
pub mod projectiles;
pub mod state;
pub mod telemetry;

pub use aim::{AimDuck, aimed_banana_lateral, default_horn_side, horn_side_targets};
pub use classes::{LoadoutCombo, loadout_combo_badge, loadout_combo_label};
pub use engine::{
    MOMENTUM_STEAL_DEFAULTS, PrepSpeedOutcome, SpeedStartExtras, apply_item_boost, apply_item_slow,
    apply_staged_slow, arm_bubble_reflex, break_active_speed_boost, create_item_race_state,
    finish_speed_boost, fire_prep_rocket, grant_guard_surge, grant_momentum_steal,
    item_active_effects, item_speed_multiplier, next_object_id, slipstream_ready,
    snapshot_item_world, speed_boost_priority, tick_item_system, trigger_menace_predator_rush,
    try_activate_bubble_shield, try_apply_prep_speed_boost,
};
pub use interactions::{DefenseOutcome, IncomingRaceEffect, resolve_incoming_race_effect};
pub use state::{
    BananaRuntime, DuckItemRuntime, HeldWildItem, ItemRaceState, ProjectileSource,
    QueuedSpeedBoost, RocketRuntime,
};
pub use telemetry::{ItemEventCredit, item_activation_for_event, item_success_for_event};
