//! Box collection and hazard contact: `collectPickups`, `resolveHazards`
//! and their helpers (`pickups/engine.ts:222-372`). **M2 hook (not ported
//! yet).**
//!
//! `tick_pickup_system` only reaches these when pickups are enabled or a box
//! or hazard exists (`pickups/engine.ts:526`), so they never run for an
//! absent `pickupConfig`.
//!
//! TS sources to port here (M2): `rankBucket` (`:222`), `weightedCategory`
//! (`:229`, `Object.entries` order of `POSITION_CATEGORY_WEIGHTS`),
//! `nearestAhead` (`:241`), `rollWildItem` (`:250`), `grantOrTriggerItem`
//! (`:264`, instance id `wild:<raceId>:<pickupId>:<playerId>`),
//! `crossingFraction` (`:290`), `touches` (`:297`), `collectPickups` (`:303`,
//! `Math.hypot` sort key: use `EngineMath::hypot2`), `resolveHazards` (`:351`).

use race_protocol::config::ResolvedRaceConfig;

use super::state::PickupRaceState;
use crate::items::ItemRaceState;
use crate::sim::{DuckPhysicsState, Emitter};

/// `collectPickups(config, pickupState, itemState, ducks, tick, tickRate, emit)`
/// (`pickups/engine.ts:303-340`).
///
/// # Panics
/// Until M2 lands, when an active box exists.
#[allow(clippy::too_many_arguments)]
pub fn collect_pickups(
    config: &ResolvedRaceConfig,
    pickup_state: &mut PickupRaceState,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let _ = (config, item_state, ducks, tick, tick_rate, emit);
    if pickup_state.pickups.is_empty() {
        return;
    }
    todo!("M2: port collectPickups (pickups/engine.ts:303-340)")
}

/// `resolveHazards(pickupState, itemState, ducks, tick, tickRate, emit)`
/// (`pickups/engine.ts:351-372`).
///
/// # Panics
/// Until M2 lands, when a hazard exists.
pub fn resolve_hazards(
    pickup_state: &mut PickupRaceState,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let _ = (item_state, ducks, tick, tick_rate, emit);
    if pickup_state.hazards.is_empty() {
        return;
    }
    todo!("M2: port resolveHazards (pickups/engine.ts:351-372)")
}
