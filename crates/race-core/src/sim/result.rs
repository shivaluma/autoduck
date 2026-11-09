//! Results and snapshots: `resultFromSimulation`, `simulateRace`,
//! `snapshotSimulation`, `snapshotRaceWorld` (`simulation.ts:637-685`).

use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::result::{RaceFinishEntry, RaceResult};
use race_protocol::snapshot::{DuckSnapshot, HeldWildItem, RaceWorld};

use super::create::create_simulation;
use super::events::{EventSink, reborrow_sink};
use super::id_cmp;
use super::options::{SimError, SimOptions};
use super::state::Simulation;
use super::step::step_simulation;
use crate::config::maximum_ticks;
use crate::ghost::is_ghost_player_id;
use crate::items::snapshot_item_world;
use crate::js_sort::v8_sort_by;
use crate::math::{cmp_f64_js, js_max_of};
use crate::pickups::snapshot_pickup_world;

/// What `simulate_race` returns: the TS `RaceResult`.
pub type SimResult = RaceResult;

/// `resultFromSimulation(state)` (`simulation.ts:656-677`): raw standings of
/// the non-ghost ducks by finish time (ties by `localeCompare`), and the
/// recorded events.
///
/// # Errors
/// [`SimError::NotFinished`] before every duck has finished.
pub fn result_from_simulation(sim: &Simulation) -> Result<RaceResult, SimError> {
    if !sim.finished {
        return Err(SimError::NotFinished);
    }
    let mut official: Vec<&super::state::DuckPhysicsState> = sim
        .ducks
        .iter()
        .filter(|duck| !is_ghost_player_id(&sim.config, duck.player_id.as_str()))
        .collect();
    let finish = |duck: &super::state::DuckPhysicsState| {
        duck.finish_time_ms
            .expect("a finished race has a finish time for every duck")
    };
    v8_sort_by(&mut official, |left, right| {
        cmp_f64_js(finish(left), finish(right))
            .then_with(|| id_cmp(left.player_id.as_str(), right.player_id.as_str()))
    });
    let standings: Vec<RaceFinishEntry> = official
        .iter()
        .enumerate()
        .map(|(index, duck)| RaceFinishEntry {
            player_id: duck.player_id.clone(),
            name: duck.name.clone(),
            rank: u32::try_from(index + 1).expect("rank fits in u32"),
            finish_time_ms: finish(duck),
        })
        .collect();
    let times: Vec<f64> = standings.iter().map(|entry| entry.finish_time_ms).collect();
    Ok(RaceResult {
        race_id: sim.config.race_id.clone(),
        engine_version: sim.config.engine_version.clone(),
        balance_version: sim.config.balance_version.clone(),
        track_version: sim.config.track_version.clone(),
        tick_rate: sim.config.tick_rate,
        // `Math.max(...[])` is `-Infinity` when every duck is a ghost.
        duration_ms: js_max_of(&times),
        standings,
        events: sim.log.events.clone(),
    })
}

/// `simulateRace(config, options)` (`simulation.ts:679-685`).
///
/// # Errors
/// [`SimError::DidNotFinish`] when the race is still running after
/// `options.max_ticks` (default `maximumDurationSeconds * tickRate`).
pub fn simulate_race(
    config: ResolvedRaceConfig,
    options: SimOptions,
    mut sink: Option<&mut dyn EventSink>,
) -> Result<SimResult, SimError> {
    let max_ticks = options
        .max_ticks
        .unwrap_or_else(|| maximum_ticks(config.tick_rate));
    let mut sim = create_simulation(config, options, reborrow_sink(&mut sink));
    while !sim.finished && sim.tick < max_ticks {
        step_simulation(&mut sim, reborrow_sink(&mut sink));
    }
    if !sim.finished {
        return Err(SimError::DidNotFinish { max_ticks });
    }
    result_from_simulation(&sim)
}

/// `snapshotSimulation(state)` (`simulation.ts:637-650`): ducks by rank.
#[must_use]
pub fn snapshot_simulation(sim: &Simulation) -> Vec<DuckSnapshot> {
    let mut ordered: Vec<&super::state::DuckPhysicsState> = sim.ducks.iter().collect();
    v8_sort_by(&mut ordered, |left, right| {
        left.current_rank.cmp(&right.current_rank)
    });
    ordered
        .into_iter()
        .map(|duck| {
            let runtime = sim.item_state.runtime(duck.player_id.as_str());
            DuckSnapshot {
                player_id: duck.player_id.clone(),
                progress: duck.progress,
                lateral_offset: duck.lateral_offset,
                speed: duck.speed,
                rank: duck.current_rank,
                active_effects: duck.active_effects.clone(),
                wild_item: runtime.wild_item.as_ref().map(|wild| HeldWildItem {
                    instance_id: wild.instance_id.clone(),
                    item_id: wild.item_id,
                    acquired_at_tick: wild.acquired_at_tick,
                }),
                regular_pickup_count: runtime.regular_pickup_count,
            }
        })
        .collect()
}

/// `snapshotRaceWorld(state)` (`simulation.ts:652-654`).
#[must_use]
pub fn snapshot_world(sim: &Simulation) -> RaceWorld {
    let (pickups, hazards) = snapshot_pickup_world(&sim.pickup_state);
    let (rockets, bananas) = snapshot_item_world(&sim.item_state);
    RaceWorld {
        ducks: snapshot_simulation(sim),
        pickups,
        hazards,
        rockets,
        bananas,
    }
}
