//! Rockets and bananas in flight: `updateRockets` / `updateBananas`
//! (`items/engine.ts:563-778`). **M2 hook (not ported yet).**
//!
//! Both are called from `tick_item_system` every tick. They are exact no-ops
//! while `rockets`/`bananas` are empty, which holds whenever nothing can fire
//! a projectile: no loadouts (no `HOMING_ROCKET`/`BANANA`), pickups off (no
//! `MINI_ROCKET`/wild `BANANA`) and therefore no auto-use. A non-empty list
//! means M2/M3 code created a projectile, so the port must exist by then.
//!
//! TS sources to port here (M2): `updateRockets` (`:563-680`, wild-rocket
//! retargeting, arming, `armBubbleReflex`, `resolveIncomingRaceEffect`,
//! shock absorber, staged slows, momentum steal, predator rush),
//! `updateBananas` (`:682-778`), `bananaTouches` (`:520-526`),
//! `firePrepRocket` (`:528-561`), and from `items/interactions.ts`
//! `resolveIncomingRaceEffect`. Both loops first sort the list by `id`
//! (in place, as TS `Array.prototype.sort` does) and iterate ducks in
//! `state.ducks` order except where TS sorts by `localeCompare`.

use crate::items::ItemRaceState;
use crate::sim::{DuckPhysicsState, Emitter};

/// `updateRockets(itemState, ducks, tick, tickRate, emit)` (`items/engine.ts:563`).
///
/// # Panics
/// Until M2 lands, if a rocket is in flight.
pub fn update_rockets(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let _ = (ducks, tick, tick_rate, emit);
    if item_state.rockets.is_empty() {
        // `itemState.rockets = keep` with nothing kept: still empty.
        return;
    }
    todo!("M2: port updateRockets (items/engine.ts:563-680)")
}

/// `updateBananas(itemState, ducks, tick, tickRate, emit)` (`items/engine.ts:682`).
///
/// # Panics
/// Until M2 lands, if a banana is on the track.
pub fn update_bananas(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let _ = (ducks, tick, tick_rate, emit);
    if item_state.bananas.is_empty() {
        return;
    }
    todo!("M2: port updateBananas (items/engine.ts:682-778)")
}
