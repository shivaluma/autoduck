//! `createSimulation` and its helpers (`simulation.ts:111-227`).

use alloc::collections::BTreeMap;
use alloc::format;
use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{
    DuckTemperamentMeta, EventKind, RaceStartedMeta, RecordedWildItemInput, WildItemUseCommand,
};

use super::events::{Emitter, EventLog, EventSink, reborrow_sink};
use super::id_cmp;
use super::options::SimOptions;
use super::state::{DuckPhysicsState, Simulation};
use crate::auto_use::{DirectorCache, create_duck_brains};
use crate::config::{base_speed, core_balance};
use crate::items::create_item_race_state;
use crate::js_sort::v8_sort_by;
use crate::math::{floor, js_clamp, js_min, js_round};
use crate::pickups::{announce_pickup_world, create_pickup_race_state};
use crate::rng::{DeterministicRng, create_race_rng};
use crate::track::create_river_track;

/// `scheduleImpulse(rng, currentTick, tickRate)` (`simulation.ts:111-113`).
pub(crate) fn schedule_impulse(
    rng: &mut DeterministicRng,
    current_tick: u32,
    tick_rate: u32,
) -> u32 {
    let delay = js_round(
        rng.range(
            core_balance::IMPULSE_MIN_SECONDS,
            core_balance::IMPULSE_MAX_SECONDS,
        ) * f64::from(tick_rate),
    );
    assert!(
        (0.0..=f64::from(u32::MAX)).contains(&delay),
        "impulse delay out of range"
    );
    // Integral and in range (checked above).
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let delay = delay as u32;
    current_tick
        .checked_add(delay)
        .expect("impulse tick fits in u32")
}

/// `generateDuckPacingSegments(rng, segmentCount, variation)`
/// (`simulation.ts:115-130`).
#[must_use]
pub fn generate_duck_pacing_segments(
    rng: &mut DeterministicRng,
    segment_count: u32,
    variation: f64,
) -> Vec<f64> {
    if segment_count <= 1 || variation <= 0.0 {
        return Vec::from([1.0]);
    }
    let mut deltas: Vec<f64> = Vec::new();
    let mut sum = 0.0;
    for _ in 0..segment_count {
        let delta = rng.range(-variation, variation);
        deltas.push(delta);
        sum += delta;
    }
    let mean = sum / f64::from(segment_count);
    deltas
        .into_iter()
        .map(|delta| 1.0 + (delta - mean))
        .collect()
}

/// `evaluatePacingMultiplier(segments, progress)` (`simulation.ts:132-153`).
#[must_use]
pub fn evaluate_pacing_multiplier(segments: &[f64], progress: f64) -> f64 {
    let count = segments.len();
    if count == 0 {
        return 1.0;
    }
    if count == 1 {
        return segments[0];
    }
    let count_f = f64::from(u32::try_from(count).expect("segment count fits in u32"));

    let clamped_progress = js_clamp(progress, 0.0, 1.0);
    let segment_width = 1.0 / count_f;
    let first_center = segment_width * 0.5;
    let last_center = 1.0 - segment_width * 0.5;

    if clamped_progress <= first_center {
        return segments[0];
    }
    if clamped_progress >= last_center {
        return segments[count - 1];
    }

    let normalized_progress = (clamped_progress - first_center) / segment_width;
    let segment_index = js_min(count_f - 2.0, floor(normalized_progress));
    let local_t = normalized_progress - segment_index;

    let smooth_t = local_t * local_t * (3.0 - 2.0 * local_t);
    // `segment_index` is an integer in [0, count - 2] here.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let index = segment_index as usize;
    let from = segments[index];
    let to = segments[index + 1];
    from + (to - from) * smooth_t
}

/// `createSimulation(config, options)` (`simulation.ts:155-221`).
///
/// `sink` is `options.onEvent`; it sees the creation events (`RACE_STARTED`,
/// `DUCK_TEMPERAMENT`, spawns).
#[must_use]
pub fn create_simulation(
    config: ResolvedRaceConfig,
    options: SimOptions,
    mut sink: Option<&mut dyn EventSink>,
) -> Simulation {
    let mut sorted_players: Vec<usize> = (0..config.players.len()).collect();
    v8_sort_by(&mut sorted_players, |&left, &right| {
        id_cmp(
            config.players[left].player_id.as_str(),
            config.players[right].player_id.as_str(),
        )
    });
    let mut start_rng = create_race_rng(config.seed.as_str(), "track:start");
    let mut lateral_slots: Vec<usize> = (0..sorted_players.len()).collect();
    for index in (1..lateral_slots.len()).rev() {
        let swap = start_rng.index(index + 1);
        lateral_slots.swap(index, swap);
    }

    let base_speed = base_speed();
    let player_count = sorted_players.len();
    let mut ducks: Vec<DuckPhysicsState> = Vec::with_capacity(player_count);
    let mut rngs: Vec<DeterministicRng> = Vec::with_capacity(player_count);
    for (index, &player_index) in sorted_players.iter().enumerate() {
        let player = &config.players[player_index];
        let mut rng = create_race_rng(config.seed.as_str(), &format!("duck:{}", player.player_id));
        let pacing_segments = generate_duck_pacing_segments(
            &mut rng,
            core_balance::PACING_SEGMENT_COUNT,
            core_balance::PACING_VARIATION,
        );
        let slot = lateral_slots[index];
        let lateral_offset = if player_count == 1 {
            0.0
        } else {
            let slot = f64::from(u32::try_from(slot).expect("slot fits in u32"));
            let span = f64::from(u32::try_from(player_count - 1).expect("lobby fits in u32"));
            -0.75 + (slot / span) * 1.5
        };
        let speed = base_speed * pacing_segments[0];
        let desired_speed = base_speed
            * rng.range(
                1.0 - core_balance::SPEED_VARIATION,
                1.0 + core_balance::SPEED_VARIATION,
            );
        let next_impulse_tick = schedule_impulse(&mut rng, 0, config.tick_rate);
        ducks.push(DuckPhysicsState {
            player_id: player.player_id.clone(),
            name: player.name.clone(),
            progress: 0.0,
            previous_progress: 0.0,
            lateral_offset,
            speed,
            acceleration: 0.0,
            lateral_velocity: 0.0,
            desired_speed,
            desired_lateral_offset: lateral_offset,
            current_rank: u32::try_from(index + 1).expect("rank fits in u32"),
            active_effects: Vec::new(),
            next_impulse_tick,
            finished: false,
            finish_time_ms: None,
            pacing_segments,
        });
        rngs.push(rng);
    }

    let track = create_river_track(&config.track_version);
    let item_state = create_item_race_state(&config);
    let mut brains = create_duck_brains(&config);
    let pickup_state = create_pickup_race_state(&config, &track, options.loot_override.clone());
    for player_id in &options.ai_ablation {
        if let Some(brain) = brains.get_mut(player_id.as_str()) {
            brain.ablated = true;
        }
    }

    let mut log = EventLog::new(options.record_events);
    {
        let mut emit = Emitter {
            log: &mut log,
            sink: reborrow_sink(&mut sink),
            brains: &mut brains,
            race_id: &config.race_id,
            tick: 0,
            tick_rate: config.tick_rate,
            math: options.math,
        };
        emit.emit(
            EventKind::RaceStarted(RaceStartedMeta {
                player_count: u32::try_from(ducks.len()).expect("lobby fits in u32"),
            }),
            None,
            None,
        );
        let mut temperaments: Vec<_> = emit
            .brains
            .iter()
            .map(|(player_id, brain)| (player_id.clone(), brain.temperament))
            .collect();
        v8_sort_by(&mut temperaments, |left, right| {
            id_cmp(left.0.as_str(), right.0.as_str())
        });
        for (player_id, temperament) in &temperaments {
            emit.emit(
                EventKind::DuckTemperament(DuckTemperamentMeta {
                    temperament: *temperament,
                }),
                Some(player_id),
                None,
            );
        }
        announce_pickup_world(&pickup_state, &mut emit);
    }

    Simulation {
        config,
        auto_objective: None,
        track,
        tick: 0,
        ducks,
        log,
        finished: false,
        rngs,
        item_state,
        brains,
        pickup_state,
        manual_inputs: options.manual_inputs,
        last_collision_event_tick: BTreeMap::new(),
        director: DirectorCache::default(),
        math: options.math,
    }
}

/// `queueWildItemInput(state, input, authoritativeTick = state.tick + 1)`
/// (`simulation.ts:223-227`): the input applies no earlier than the next
/// tick.
pub fn queue_wild_item_input(
    sim: &mut Simulation,
    input: WildItemUseCommand,
    authoritative_tick: Option<u32>,
) -> RecordedWildItemInput {
    let next = sim.tick.checked_add(1).expect("tick fits in u32");
    let recorded = RecordedWildItemInput {
        race_id: input.race_id,
        player_id: input.player_id,
        wild_item_instance_id: input.wild_item_instance_id,
        action: input.action,
        client_action_id: input.client_action_id,
        authoritative_tick: authoritative_tick.unwrap_or(next).max(next),
    };
    sim.manual_inputs.push(recorded.clone());
    recorded
}
