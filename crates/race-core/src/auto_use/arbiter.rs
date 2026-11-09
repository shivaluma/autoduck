//! The auto-use arbiter: `tickAutoUseExecute` / `tickAutoUseDecide`
//! (`packages/race-core/src/auto-use/arbiter.ts`). **M3 hook (not ported
//! yet).**
//!
//! # What the stubs do now
//!
//! Both are called every tick, and `prepAutoUseEnabled` is always `true`, so
//! the TS decide pass runs `processDuckDecide` for every duck on its decision
//! tick even without items: `noteNeighbours` updates `neighbourSamples` and
//! `rivalId`, `decideOffensiveAutoItemAction` finds no candidate, and
//! `nextAutoDecisionTick` advances by 15. None of that reaches the state hash,
//! the events or any other system while no duck holds a prep or box item and
//! no projectile exists (the only readers are the evaluation itself and
//! `AI_INTENT 'HOLDING'`, which needs `heldItemId`). In that regime the stubs
//! return without touching anything; once any duck has an item or a
//! projectile is in flight they `todo!("M3: ...")` instead of diverging
//! silently.
//!
//! # Porting notes for M3
//!
//! RNG streams carry the race id (Phase A): `auto-use-delay:<raceId>:<playerId>:<tick>`
//! and `auto-use-cooldown:<raceId>:<playerId>:<tick>`. Ducks are visited in
//! `localeCompare` order (`sortedDucks`). `readRace` is
//! [`super::director::read_race`] with `Simulation::director` as its memo.
//! Every event emitted while an auto-used wild item activates gets
//! `autoReason` appended (`auto-use/execute.ts:256`).

use race_protocol::config::ResolvedRaceConfig;

use super::director::DirectorCache;
use super::objective::RaceObjectiveContext;
use crate::items::ItemRaceState;
use crate::pickups::PickupRaceState;
use crate::sim::{DuckPhysicsState, Emitter};
use crate::track::RaceTrack;

/// `AutoUseTickInput` (`arbiter.ts:61-73`). `emitItem` and `emitPickup` are
/// the same `emitEvent` wrapper in TS, so one [`Emitter`] serves both; the
/// duck brains are `emit.brains`.
pub struct AutoUseTickInput<'a, 'e> {
    pub config: &'a ResolvedRaceConfig,
    pub track: &'a RaceTrack,
    pub item_state: &'a mut ItemRaceState,
    pub pickup_state: &'a mut PickupRaceState,
    pub ducks: &'a mut [DuckPhysicsState],
    pub tick: u32,
    pub tick_rate: u32,
    /// Always `true` in the engine (`simulation.ts:528`).
    pub prep_auto_use_enabled: bool,
    /// `pickupConfig.enabled && pickupConfig.autoItemsEnabled`.
    pub wild_auto_use_enabled: bool,
    /// The `readRace` memo for `state.ducks`.
    pub director: &'a mut DirectorCache,
    pub emit: &'a mut Emitter<'e>,
}

/// `true` when the auto-use AI could act or observe an item this tick (see
/// the module docs).
fn items_in_play(input: &AutoUseTickInput<'_, '_>) -> bool {
    !input.item_state.rockets.is_empty()
        || !input.item_state.bananas.is_empty()
        || input
            .item_state
            .by_player
            .iter()
            .any(|(_, runtime)| !runtime.item_ids.is_empty() || runtime.wild_item.is_some())
}

/// `tickAutoUseExecute(input, objective)` (`arbiter.ts:271-276`).
///
/// # Panics
/// Until M3 lands, when an item is in play.
pub fn tick_auto_use_execute(
    input: &mut AutoUseTickInput<'_, '_>,
    objective: &mut RaceObjectiveContext,
) {
    let _ = objective;
    if !items_in_play(input) {
        return;
    }
    todo!("M3: port tickAutoUseExecute (auto-use/arbiter.ts:271-276)")
}

/// `tickAutoUseDecide(input, objective)` (`arbiter.ts:278-284`).
///
/// # Panics
/// Until M3 lands, when an item is in play.
pub fn tick_auto_use_decide(
    input: &mut AutoUseTickInput<'_, '_>,
    objective: &mut RaceObjectiveContext,
) {
    let _ = objective;
    if !items_in_play(input) {
        return;
    }
    todo!("M3: port tickAutoUseDecide (auto-use/arbiter.ts:278-284)")
}
