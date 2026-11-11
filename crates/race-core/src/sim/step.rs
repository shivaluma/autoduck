//! `stepSimulation(state)` (`simulation.ts:505-635`).

use alloc::vec::Vec;

use race_protocol::events::{BoostGatePassedMeta, DuckFinishedMeta, EmptyMeta, EventKind};

use super::collisions::resolve_collisions;
use super::create::evaluate_pacing_multiplier;
use super::events::{Emitter, EventSink, reborrow_sink};
use super::id_cmp;
use super::lane_ai::{LaneContext, update_intent};
use super::ranks::update_ranks;
use super::river::{emit_river_transition, river_speed_multiplier, tick_river};
use super::state::Simulation;
use crate::auto_use::{
    AutoUseTickInput, build_race_objective_context, tick_auto_use_decide, tick_auto_use_execute,
};
use crate::config::core_balance;
use crate::items::{
    apply_item_boost, item_active_effects, item_speed_multiplier, tick_item_system,
};
use crate::js_sort::v8_sort_by;
use crate::math::{cmp_f64_js, js_clamp, js_max};
use crate::pickups::config::pickup_balance;
use crate::pickups::{apply_recorded_wild_inputs, tick_pickup_system};
use crate::track::current_at;

/// `stepSimulation(state)`: one fixed tick. No-op once the race has
/// finished. `sink` is `onEvent`.
///
/// Order (as TS): manual wild inputs, auto-use execute, item system,
/// movement (intent, current, pacing, magnet/tailwind steering, item speed,
/// boost gates, finish line), pickups, auto-use decide, collisions, ranks,
/// finish check.
#[allow(clippy::too_many_lines)]
pub fn step_simulation(sim: &mut Simulation, mut sink: Option<&mut dyn EventSink>) {
    if sim.finished {
        return;
    }
    sim.tick = sim.tick.checked_add(1).expect("tick fits in u32");
    let Simulation {
        config,
        auto_objective,
        track,
        tick,
        ducks,
        log,
        finished,
        rngs,
        item_state,
        brains,
        pickup_state,
        manual_inputs,
        last_collision_event_tick,
        director,
        math,
        river,
    } = sim;
    let tick = *tick;
    let tick_rate = config.tick_rate;
    let delta_seconds = 1.0 / f64::from(tick_rate);
    let tick_start_ms = f64::from(tick - 1) * (1000.0 / f64::from(tick_rate));
    let tick_i = i64::from(tick);

    let mut emit = Emitter {
        log,
        sink: reborrow_sink(&mut sink),
        brains,
        race_id: &config.race_id,
        tick,
        tick_rate,
        math: *math,
    };

    apply_recorded_wild_inputs(item_state, ducks, manual_inputs, tick, tick_rate, &mut emit);

    let wild_auto_use_enabled =
        pickup_state.config.enabled && pickup_state.config.auto_items_enabled;
    let objective = auto_objective.get_or_insert_with(|| build_race_objective_context(config));
    tick_auto_use_execute(
        &mut AutoUseTickInput {
            config,
            track,
            item_state,
            pickup_state,
            ducks,
            tick,
            tick_rate,
            prep_auto_use_enabled: true,
            wild_auto_use_enabled,
            director,
            emit: &mut emit,
        },
        objective,
    );

    tick_item_system(item_state, ducks, tick, tick_rate, &mut emit);

    for transition in tick_river(river, ducks, tick, tick_rate) {
        emit_river_transition(river, ducks, &transition, tick_rate, &mut emit);
    }

    for index in 0..ducks.len() {
        if ducks[index].finished {
            continue;
        }
        ducks[index].previous_progress = ducks[index].progress;
        let update = update_intent(
            &LaneContext {
                config,
                track,
                ducks,
                item_state,
                brains: emit.brains,
                pickup_state,
                tick,
            },
            index,
            &mut rngs[index],
        );
        if let Some(update) = update {
            update.apply(&mut ducks[index]);
        }

        let (current_multiplier, current_lateral_force) =
            match current_at(track, ducks[index].progress) {
                Some(zone) => (zone.speed_multiplier, zone.lateral_force),
                None => (1.0, 0.0),
            };
        let player_id = ducks[index].player_id.clone();
        let runtime = item_state.runtime(player_id.as_str());
        let magnet_active = tick_i < runtime.magnet_until_tick;
        let tailwind_active = tick_i < runtime.tailwind_until_tick;

        // Magnet: steer onto the nearest duck ahead within reach.
        let magnet_target = if magnet_active {
            let me = &ducks[index];
            let mut targets: Vec<usize> = (0..ducks.len())
                .filter(|&other| {
                    let candidate = &ducks[other];
                    !candidate.finished
                        && candidate.progress > me.progress
                        && candidate.progress - me.progress
                            <= pickup_balance::magnet::MAXIMUM_TARGET_DISTANCE
                })
                .collect();
            v8_sort_by(&mut targets, |&left, &right| {
                cmp_f64_js(ducks[left].progress, ducks[right].progress).then_with(|| {
                    id_cmp(
                        ducks[left].player_id.as_str(),
                        ducks[right].player_id.as_str(),
                    )
                })
            });
            targets.first().map(|&target| ducks[target].lateral_offset)
        } else {
            None
        };

        let active_effects = item_active_effects(runtime, tick);
        let duck = &mut ducks[index];
        duck.active_effects = active_effects;
        let pacing_multiplier = evaluate_pacing_multiplier(&duck.pacing_segments, duck.progress);
        let target_speed = duck.desired_speed * pacing_multiplier + duck.acceleration;
        duck.speed += (target_speed - duck.speed) * core_balance::SPEED_RESPONSE * delta_seconds;
        if let Some(lateral) = magnet_target {
            duck.desired_lateral_offset = lateral;
        }
        let stability = if tailwind_active {
            pickup_balance::tailwind::LATERAL_STABILITY
        } else {
            1.0
        };
        let desired_lateral_velocity = ((duck.desired_lateral_offset - duck.lateral_offset)
            * core_balance::LATERAL_RESPONSE
            + current_lateral_force)
            * stability;
        duck.lateral_velocity +=
            (desired_lateral_velocity - duck.lateral_velocity) * 2.8 * delta_seconds;
        duck.lateral_velocity = js_clamp(
            duck.lateral_velocity,
            -core_balance::MAXIMUM_LATERAL_VELOCITY,
            core_balance::MAXIMUM_LATERAL_VELOCITY,
        );
        duck.lateral_offset = js_clamp(
            duck.lateral_offset + duck.lateral_velocity * delta_seconds,
            -0.95,
            0.95,
        );
        duck.progress += js_max(
            0.0,
            duck.speed
                * current_multiplier
                * item_speed_multiplier(runtime, tick)
                * river_speed_multiplier(river, duck, index)
                * delta_seconds,
        );

        for gate in &track.boost_gates {
            if duck.previous_progress < gate.progress && duck.progress >= gate.progress {
                let lane = gate.lane_at(duck.lateral_offset);
                apply_item_boost(
                    item_state.runtime_mut(player_id.as_str()),
                    lane.speed_multiplier,
                    lane.duration_seconds,
                    tick,
                    tick_rate,
                );
                emit.emit(
                    EventKind::BoostGatePassed(BoostGatePassedMeta {
                        gate_id: gate.id.clone(),
                        lane_id: lane.id.clone(),
                        tier: lane.tier,
                        multiplier: lane.speed_multiplier,
                        duration_seconds: lane.duration_seconds,
                        color_hex: lane.color_hex,
                        color_name: lane.color_name.into(),
                        label: lane.label.into(),
                    }),
                    Some(&player_id),
                    None,
                );
            }
        }

        if duck.progress >= 1.0 {
            let travelled = duck.progress - duck.previous_progress;
            let fraction = if travelled > 0.0 {
                js_clamp((1.0 - duck.previous_progress) / travelled, 0.0, 1.0)
            } else {
                1.0
            };
            duck.finished = true;
            duck.progress = 1.0;
            let finish_time_ms = tick_start_ms + fraction * (1000.0 / f64::from(tick_rate));
            duck.finish_time_ms = Some(finish_time_ms);
            emit.emit(
                EventKind::DuckFinished(DuckFinishedMeta { finish_time_ms }),
                Some(&player_id),
                None,
            );
        }
    }

    tick_pickup_system(
        config,
        track,
        pickup_state,
        item_state,
        ducks,
        tick,
        tick_rate,
        &mut emit,
    );

    tick_auto_use_decide(
        &mut AutoUseTickInput {
            config,
            track,
            item_state,
            pickup_state,
            ducks,
            tick,
            tick_rate,
            prep_auto_use_enabled: true,
            wild_auto_use_enabled,
            director,
            emit: &mut emit,
        },
        objective,
    );

    resolve_collisions(
        ducks,
        item_state,
        last_collision_event_tick,
        tick,
        tick_rate,
        &mut emit,
    );

    update_ranks(ducks);

    *finished = ducks.iter().all(|duck| duck.finished);
    if *finished {
        emit.emit(EventKind::RaceFinished(EmptyMeta {}), None, None);
    }
}
