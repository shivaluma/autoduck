//! `PickupSpawn`, `HazardSpawn` and `PickupRaceState`
//! (`pickups/engine.ts:29-60`).

use alloc::collections::BTreeSet;
use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::config::PickupConfig;
use race_protocol::ids::{HazardType, PickupSpawnType, PlayerId};
use race_protocol::snapshot::PickupState;

use crate::sim::WildLootOverride;

/// `PickupSpawn` (`pickups/engine.ts:29-39`).
#[derive(Clone, Debug, PartialEq)]
pub struct PickupSpawn {
    pub id: String,
    pub zone_id: String,
    pub anchor_id: String,
    pub spawn_type: PickupSpawnType,
    pub progress: f64,
    pub lateral_offset: f64,
    pub state: PickupState,
    pub collected_by_player_id: Option<PlayerId>,
    pub collected_at_tick: Option<u32>,
}

/// `HazardSpawn` (`pickups/engine.ts:41-50`).
#[derive(Clone, Debug, PartialEq)]
pub struct HazardSpawn {
    pub id: String,
    pub zone_id: String,
    pub anchor_id: String,
    pub hazard_type: HazardType,
    pub progress: f64,
    pub lateral_offset: f64,
    pub radius: f64,
    /// A JS `Set<string>`.
    pub hit_player_ids: Vec<PlayerId>,
}

/// `PickupRaceState` (`pickups/engine.ts:52-60`).
///
/// `config` is the engine's `ResolvedPickupConfig` (`pickupConfig(config)`,
/// `pickups/engine.ts:86-121`). `race_protocol` already resolves it the same
/// way (an absent block is [`PickupConfig::disabled`]), so it is copied.
#[derive(Clone, Debug)]
pub struct PickupRaceState {
    pub config: PickupConfig,
    pub pickups: Vec<PickupSpawn>,
    pub hazards: Vec<HazardSpawn>,
    /// Membership-only JS `Set`s.
    pub activated_zone_ids: BTreeSet<String>,
    pub slot_full_feedback: BTreeSet<String>,
    pub golden_collector_player_id: Option<PlayerId>,
    pub loot_override: Option<WildLootOverride>,
}
