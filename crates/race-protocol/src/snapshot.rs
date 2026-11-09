//! Live snapshot types for the opt-in `snapshot` SSE frame (D16), the
//! spectator HUD and the DTRK/1 decoder.
//!
//! TS sources: `duckSnapshotSchema` and `stateSnapshotMessageSchema`
//! (`packages/race-protocol/src/index.ts:140-190`), produced by
//! `snapshotRaceWorld` (`packages/race-core/src/simulation.ts:637-654`,
//! `pickups/engine.ts:532-537`, `items/engine.ts:780-797`) and consumed by
//! `applyWorld` (`components/racing/phaser-race-canvas.tsx:806`).
//!
//! Defaults match Zod's `.default(...)`: a missing `wildItem` is `null`, a
//! missing `regularPickupCount` is 0, and missing world arrays are empty
//! (plan section 4.2, "Old snapshot shapes").

use alloc::string::String;
use alloc::vec::Vec;

use serde::{Deserialize, Serialize};

use crate::ids::{HazardType, PickupSpawnType, PlayerId, RaceId, WildItemId};

crate::wire_enum! {
    /// Race lifecycle (`raceLifecycleStateSchema`, `index.ts:126-136`).
    pub enum RaceLifecycleState {
        Created => "CREATED",
        ChaosRevealed => "CHAOS_REVEALED",
        Preparing => "PREPARING",
        Locked => "LOCKED",
        Countdown => "COUNTDOWN",
        Racing => "RACING",
        Finished => "FINISHED",
        Resolved => "RESOLVED",
        Archived => "ARCHIVED",
    }
}

crate::wire_enum! {
    /// Duck status effects in `activeEffects`, in the order
    /// `itemActiveEffects` can push them (`items/engine.ts:889-904`). The TS
    /// schema types this as `string[]`; the set is closed.
    pub enum ActiveEffect {
        BubbleShield => "BUBBLE_SHIELD",
        Feather => "FEATHER",
        ShockAbsorber => "SHOCK_ABSORBER",
        Silenced => "SILENCED",
        Nitro => "NITRO",
        DraftFin => "DRAFT_FIN",
        PaddleBurst => "PADDLE_BURST",
        PredatorRush => "PREDATOR_RUSH",
        Slowed => "SLOWED",
        MiniBubble => "MINI_BUBBLE",
        WildFeather => "WILD_FEATHER",
        Tailwind => "TAILWIND",
        SlipstreamMagnet => "SLIPSTREAM_MAGNET",
    }
}

crate::wire_enum! {
    /// Pickup box state (`index.ts:167`).
    pub enum PickupState {
        Active => "ACTIVE",
        Collected => "COLLECTED",
        Expired => "EXPIRED",
    }
}

crate::wire_enum! {
    /// Whether a projectile came from a loadout (`PREP`) or a box (`WILD`).
    pub enum ProjectileKind {
        Prep => "PREP",
        Wild => "WILD",
    }
}

/// The wild item a duck holds (`index.ts:147-151`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct HeldWildItem {
    pub instance_id: String,
    pub item_id: WildItemId,
    pub acquired_at_tick: u32,
}

/// One duck in a snapshot (`duckSnapshotSchema`, `index.ts:140-153`).
/// Ducks are ordered by current rank.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct DuckSnapshot {
    pub player_id: PlayerId,
    pub progress: f64,
    pub lateral_offset: f64,
    pub speed: f64,
    pub rank: u32,
    pub active_effects: Vec<ActiveEffect>,
    #[serde(default)]
    pub wild_item: Option<HeldWildItem>,
    #[serde(default)]
    pub regular_pickup_count: u32,
}

/// A pickup box (`index.ts:162-168`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct PickupSnapshot {
    pub id: String,
    #[serde(rename = "type")]
    pub pickup_type: PickupSpawnType,
    pub progress: f64,
    pub lateral_offset: f64,
    pub state: PickupState,
}

/// A hazard (`index.ts:169-175`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct HazardSnapshot {
    pub id: String,
    #[serde(rename = "type")]
    pub hazard_type: HazardType,
    pub progress: f64,
    pub lateral_offset: f64,
    pub radius: f64,
}

/// A homing rocket in flight (`index.ts:176-182`). `progress` may exceed 1
/// (schema max 2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RocketSnapshot {
    pub id: u32,
    pub source_player_id: PlayerId,
    pub target_player_id: PlayerId,
    pub progress: f64,
    pub kind: ProjectileKind,
}

/// A banana peel on the water (`index.ts:183-189`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct BananaSnapshot {
    pub id: u32,
    pub source_player_id: PlayerId,
    pub progress: f64,
    pub lateral_offset: f64,
    pub kind: ProjectileKind,
}

/// What `applyWorld` takes: `Pick<StateSnapshotMessage, 'ducks' | 'pickups' |
/// 'hazards' | 'rockets' | 'bananas'>` (`phaser-race-canvas.tsx:806`). Also
/// what the DTRK/1 decoder yields per tick.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceWorld {
    pub ducks: Vec<DuckSnapshot>,
    #[serde(default)]
    pub pickups: Vec<PickupSnapshot>,
    #[serde(default)]
    pub hazards: Vec<HazardSnapshot>,
    #[serde(default)]
    pub rockets: Vec<RocketSnapshot>,
    #[serde(default)]
    pub bananas: Vec<BananaSnapshot>,
}

crate::wire_enum! {
    /// The `type` literal of a [`StateSnapshotMessage`].
    pub enum StateSnapshotType {
        StateSnapshot => "STATE_SNAPSHOT",
    }
}

/// A full world snapshot message (`stateSnapshotMessageSchema`,
/// `index.ts:156-190`; built in `lib/racing/runtime.ts:65`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct StateSnapshotMessage {
    #[serde(rename = "type")]
    pub message_type: StateSnapshotType,
    pub protocol_version: String,
    pub race_id: RaceId,
    pub tick: u32,
    #[serde(flatten)]
    pub world: RaceWorld,
}
