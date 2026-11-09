//! Item runtime state: `DuckItemRuntime`, `RocketRuntime`, `BananaRuntime`
//! and `ItemRaceState` (`items/engine.ts:21-116`, `items/interactions.ts:21-32`).
//!
//! Tick-valued fields are `i64`: TS stores them as numbers that are always
//! integers (`tick + Math.round(seconds * tickRate)`), and `i64` keeps
//! differences like `tick - boostStartedAtTick` from underflowing. Optional TS
//! fields (`recoverySlowUntilTick?`, ...) are `Option`; remember that TS tests
//! like `if (runtime.recoverySlowUntilTick && ...)` treat `0` as false.

use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::config::RaceItemTuning;
use race_protocol::events::IncomingAttack;
use race_protocol::ids::{PlayerId, RaceItemId, WildItemId};

use super::classes::LoadoutCombo;
use crate::auto_use::AutoUseCandidate;
use crate::sim::IdMap;

/// A held box item (`DuckItemRuntime.wildItem`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeldWildItem {
    pub instance_id: String,
    pub item_id: WildItemId,
    pub acquired_at_tick: u32,
}

/// `DuckItemRuntime.queuedSpeedBoost`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct QueuedSpeedBoost {
    pub multiplier: f64,
    pub duration_seconds: f64,
    pub item_id: RaceItemId,
}

/// `DuckItemRuntime` (`items/engine.ts:21-66`) including `ItemDefenseState`
/// (`items/interactions.ts:21-32`). Field order follows the TS literal in
/// `createItemRaceState` (`items/engine.ts:134-171`).
#[derive(Clone, Debug, PartialEq)]
pub struct DuckItemRuntime {
    pub item_ids: Vec<RaceItemId>,
    pub loadout_combo: Option<LoadoutCombo>,
    /// A JS `Set<RaceItemId>`.
    pub used_items: Vec<RaceItemId>,
    pub bubble_available: bool,
    pub bubble_until_tick: i64,
    pub silenced_until_tick: i64,
    pub silence_immune_until_tick: i64,
    pub feather_available: bool,
    pub shock_absorber_available: bool,
    pub item_immunity_until_tick: i64,
    pub rocket_protection_until_tick: i64,
    pub slow_multiplier: f64,
    pub slow_until_tick: i64,
    pub recovery_slow_multiplier: Option<f64>,
    pub recovery_slow_until_tick: Option<i64>,
    pub boost_multiplier: f64,
    pub boost_until_tick: i64,
    pub wild_item: Option<HeldWildItem>,
    pub regular_pickup_count: u32,
    pub wild_bubble_available: bool,
    pub wild_bubble_until_tick: i64,
    pub wild_feather_available: bool,
    pub wild_feather_until_tick: i64,
    pub tailwind_until_tick: i64,
    pub magnet_until_tick: i64,
    pub last_item_use_tick: i64,
    pub next_auto_decision_tick: i64,
    pub next_auto_action_tick: i64,
    pub pending_auto_action: Option<AutoUseCandidate>,
    pub pending_auto_action_execute_tick: i64,
    pub last_offensive_use_tick: i64,
    pub draft_slipstream_ticks: i64,
    pub draft_target_player_id: Option<PlayerId>,
    pub active_speed_item_id: Option<RaceItemId>,
    pub queued_speed_boost: Option<QueuedSpeedBoost>,
    pub boost_started_at_tick: i64,
    pub continuous_boost_started_at_tick: Option<i64>,
    pub nitro_ignition_ticks: Option<i64>,
    pub nitro_overdrive_ticks: Option<i64>,
    pub nitro_decay_ticks: Option<i64>,
    pub nitro_start_progress: Option<f64>,
    pub nitro_start_rank: Option<u32>,
    pub reactive_rocket_visible_since_tick: Option<i64>,
    pub reactive_banana_visible_since_tick: Option<i64>,
    pub queued_guard_surge_tick: Option<i64>,
    pub queued_guard_surge_source: Option<PlayerId>,
    /// `'ROCKET' | 'BANANA'`.
    pub queued_guard_surge_blocked: Option<IncomingAttack>,
    pub speed_drained: bool,
}

impl DuckItemRuntime {
    /// `runtime.itemIds.includes(item) && !runtime.usedItems.has(item)`.
    #[must_use]
    pub fn has_unused(&self, item: RaceItemId) -> bool {
        self.item_ids.contains(&item) && !self.used_items.contains(&item)
    }

    /// `runtime.usedItems.has(item)`.
    #[must_use]
    pub fn used(&self, item: RaceItemId) -> bool {
        self.used_items.contains(&item)
    }

    /// `runtime.usedItems.add(item)`.
    pub fn mark_used(&mut self, item: RaceItemId) {
        if !self.used_items.contains(&item) {
            self.used_items.push(item);
        }
    }
}

/// `'PREP' | 'WILD'`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectileSource {
    Prep,
    Wild,
}

/// `RocketRuntime` (`items/engine.ts:76-90`).
#[derive(Clone, Debug, PartialEq)]
pub struct RocketRuntime {
    pub id: u32,
    pub source_player_id: PlayerId,
    pub target_player_id: PlayerId,
    pub progress: f64,
    pub spawned_at_tick: i64,
    pub expires_at_tick: i64,
    pub kind: ProjectileSource,
    pub speed_per_second: f64,
    pub hit_radius: f64,
    pub slow_multiplier: f64,
    pub slow_duration_seconds: f64,
    pub retargeted: bool,
    pub launch_at_tick: i64,
}

/// `BananaRuntime` (`items/engine.ts:92-104`).
#[derive(Clone, Debug, PartialEq)]
pub struct BananaRuntime {
    pub id: u32,
    pub source_player_id: PlayerId,
    pub progress: f64,
    pub lateral_offset: f64,
    pub armed_at_tick: i64,
    pub expires_at_tick: i64,
    pub kind: ProjectileSource,
    pub hit_progress_radius: f64,
    pub hit_lateral_radius: f64,
    pub progress_knockback: Option<f64>,
    pub lateral_slip: f64,
}

/// `ItemRaceState` (`items/engine.ts:106-116`). `brains` lives on
/// `Simulation::brains` (see `sim::state`).
#[derive(Clone, Debug, PartialEq)]
pub struct ItemRaceState {
    /// `new Map(config.players.map(...))`: `config.players` order.
    pub by_player: IdMap<DuckItemRuntime>,
    pub rockets: Vec<RocketRuntime>,
    pub bananas: Vec<BananaRuntime>,
    pub next_object_id: u32,
    /// `Required<RaceItemTuning>`: the resolved config already holds the
    /// `itemTuning ?? ITEM_BALANCE` fallbacks (`items/engine.ts:176-181`).
    pub tuning: RaceItemTuning,
    /// A JS `Set`, `config.players` order.
    pub ghost_player_ids: Vec<PlayerId>,
    /// `teammatesByPlayer`: each grouped player to its other group members
    /// (a later group overwrites an earlier one, as `Map.set` does).
    pub teammates_by_player: IdMap<Vec<PlayerId>>,
}

impl ItemRaceState {
    /// `itemState.byPlayer.get(playerId)!`.
    ///
    /// # Panics
    /// If `player_id` is not in the race (the TS `!` would throw later).
    #[must_use]
    pub fn runtime(&self, player_id: &str) -> &DuckItemRuntime {
        self.by_player
            .get(player_id)
            .expect("every duck has an item runtime")
    }

    /// `itemState.byPlayer.get(playerId)!` for mutation.
    ///
    /// # Panics
    /// If `player_id` is not in the race.
    pub fn runtime_mut(&mut self, player_id: &str) -> &mut DuckItemRuntime {
        self.by_player
            .get_mut(player_id)
            .expect("every duck has an item runtime")
    }

    /// `itemState.teammatesByPlayer?.get(a)?.has(b)`.
    #[must_use]
    pub fn are_teammates(&self, player_id: &str, other: &str) -> bool {
        self.teammates_by_player
            .get(player_id)
            .is_some_and(|mates| mates.iter().any(|mate| mate.as_str() == other))
    }
}
