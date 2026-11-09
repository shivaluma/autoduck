//! `DuckPhysicsState` and `RaceSimulationState` (`simulation.ts:34-69`).

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::RecordedWildItemInput;
use race_protocol::ids::PlayerId;
use race_protocol::snapshot::ActiveEffect;

use super::events::EventLog;
use super::options::EngineMath;
use crate::auto_use::{Brains, DirectorCache, RaceObjectiveContext};
use crate::items::ItemRaceState;
use crate::pickups::PickupRaceState;
use crate::rng::DeterministicRng;
use crate::track::RaceTrack;

/// `DuckPhysicsState` (`simulation.ts:34-51`). It is also the TS
/// `ItemDuckState` the item, pickup and auto-use systems read and mutate.
#[derive(Clone, Debug, PartialEq)]
pub struct DuckPhysicsState {
    pub player_id: PlayerId,
    pub name: String,
    pub progress: f64,
    pub previous_progress: f64,
    pub lateral_offset: f64,
    pub speed: f64,
    pub acceleration: f64,
    pub lateral_velocity: f64,
    pub desired_speed: f64,
    pub desired_lateral_offset: f64,
    /// 1-based; always an integer in TS.
    pub current_rank: u32,
    /// `itemActiveEffects(runtime, tick)`, refreshed each movement step.
    pub active_effects: Vec<ActiveEffect>,
    /// Always a non-negative integer in TS (`tick + Math.round(...)`).
    pub next_impulse_tick: u32,
    pub finished: bool,
    pub finish_time_ms: Option<f64>,
    pub pacing_segments: Vec<f64>,
}

/// `RaceSimulationState` (`simulation.ts:53-69`).
///
/// Differences from the TS object, all representation-only:
/// - `rngByPlayer` is [`Self::rngs`], parallel to [`Self::ducks`] (duck order
///   never changes after creation, and the map was keyed by those ducks).
/// - `itemState.brains` is [`Self::brains`], a sibling of `item_state`, so an
///   [`super::Emitter`] can borrow it (TS `emitEvent` feeds every event to
///   `noteBrainEvent`) while a system holds `&mut ItemRaceState`.
/// - `events` / `recordEvents` live in [`Self::log`]; `onEvent` is passed per
///   call as an [`super::EventSink`].
/// - The `director.readRace` memo (a module `WeakMap` keyed by the `ducks`
///   array, so per simulation) is the plain field [`Self::director`].
#[derive(Clone, Debug)]
pub struct Simulation {
    pub config: ResolvedRaceConfig,
    /// `autoObjective`, built lazily on the first step (`simulation.ts:537`).
    pub auto_objective: Option<RaceObjectiveContext>,
    pub track: RaceTrack,
    /// 0 before the first step.
    pub tick: u32,
    pub ducks: Vec<DuckPhysicsState>,
    pub log: EventLog,
    pub finished: bool,
    /// `rngByPlayer`, indexed like `ducks`.
    pub rngs: Vec<DeterministicRng>,
    pub item_state: ItemRaceState,
    pub brains: Brains,
    pub pickup_state: PickupRaceState,
    pub manual_inputs: Vec<RecordedWildItemInput>,
    /// `lastCollisionEventTick`, keyed by `` `${left}:${right}` `` exactly as
    /// TS builds it (two different pairs can share a key; that quirk is kept).
    pub last_collision_event_tick: BTreeMap<String, u32>,
    /// `readRace` memo (`auto-use/director.ts:25`).
    pub director: DirectorCache,
    pub math: EngineMath,
}

impl Simulation {
    /// Index of `player_id` in [`Self::ducks`].
    #[must_use]
    pub fn duck_index(&self, player_id: &str) -> Option<usize> {
        self.ducks
            .iter()
            .position(|duck| duck.player_id.as_str() == player_id)
    }

    /// `state.events` (empty when events are not recorded).
    #[must_use]
    pub fn events(&self) -> &[race_protocol::events::RaceEvent] {
        &self.log.events
    }

    /// The xorshift state of each duck's RNG (`sh1` `rngState`).
    #[must_use]
    pub fn rng_state(&self, duck_index: usize) -> u32 {
        self.rngs[duck_index].state()
    }
}
