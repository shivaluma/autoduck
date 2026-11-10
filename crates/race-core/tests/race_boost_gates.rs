//! White-box port of `tests/race-boost-gates.test.ts` (Phase 2).
//!
//! Same test names in snake_case and the same assertions. Configs carry the
//! TS S3.15 version constants, as the TS test passes them explicitly.
//!
//! Needs `ts-compat` (`resolve_ts_compat`, ICU id collation, V8 maths).

#![cfg(feature = "ts-compat")]
#![allow(clippy::float_cmp)]

use race_core::rng::create_race_rng;
use race_core::sim::lane_ai::{LaneContext, evaluate_smart_desired_lateral_offset};
use race_core::sim::{SimOptions, Simulation, create_simulation, simulate_race};
use race_core::track::create_river_track;
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::{BoostLaneTier, EventKind};
use race_protocol::versions::RACE_TICK_RATE;
use race_protocol::versions::ts_compat::{
    RACE_BALANCE_VERSION, RACE_ENGINE_VERSION, RACE_PROTOCOL_VERSION, TRACK_VERSION,
};

/// `config(seed, playerCount)`.
fn config(seed: &str, player_count: u32) -> ResolvedRaceConfig {
    let players: Vec<String> = (1..=player_count)
        .map(|index| format!(r#"{{"playerId":"duck-{index}","name":"Duck {index}"}}"#))
        .collect();
    let json = format!(
        r#"{{"raceId":"boost-test-{}","seed":"{seed}","protocolVersion":"{RACE_PROTOCOL_VERSION}","engineVersion":"{RACE_ENGINE_VERSION}","balanceVersion":"{RACE_BALANCE_VERSION}","trackVersion":"{TRACK_VERSION}","tickRate":{RACE_TICK_RATE},"players":[{}]}}"#,
        &seed[..8],
        players.join(","),
    );
    let input: RaceConfigInput = serde_json::from_str(&json).unwrap();
    input.resolve_ts_compat().unwrap()
}

/// `evaluateSmartDesiredLateralOffset(state, state.ducks[index], rng)`.
fn evaluate(state: &Simulation, index: usize, rng: &mut race_core::rng::DeterministicRng) -> f64 {
    evaluate_smart_desired_lateral_offset(
        &LaneContext {
            config: &state.config,
            track: &state.track,
            ducks: &state.ducks,
            item_state: &state.item_state,
            brains: &state.brains,
            pickup_state: &state.pickup_state,
            tick: state.tick,
        },
        &state.ducks[index],
        rng,
    )
}

#[test]
fn river_track_defines_4_distinct_4_lane_boost_gates() {
    // `createRiverTrack()` defaults to 'river-01-v2'.
    let track = create_river_track("river-01-v2");
    assert_eq!(track.boost_gates.len(), 4);
    for gate in &track.boost_gates {
        assert_eq!(gate.lanes.len(), 4);
        assert!(gate.progress > 0.0 && gate.progress < 1.0);
        let tiers: Vec<BoostLaneTier> = gate.lanes.iter().map(|lane| lane.tier).collect();
        assert!(tiers.contains(&BoostLaneTier::Hyper));
        assert!(tiers.contains(&BoostLaneTier::Super));
        assert!(tiers.contains(&BoostLaneTier::Standard));
        assert!(tiers.contains(&BoostLaneTier::Neutral));
    }
}

#[test]
fn ducks_trigger_boost_gate_passed_events_with_correct_tier_and_speed_boost() {
    let race_config = config(&"42".repeat(32), 6);
    let result = simulate_race(race_config, SimOptions::default(), None).unwrap();
    let boost_events: Vec<_> = result
        .events
        .iter()
        .filter(|event| event.type_name() == "BOOST_GATE_PASSED")
        .collect();
    assert!(
        boost_events.len() >= 6 * 3,
        "Expected at least 18 boost gate pass events, got {}",
        boost_events.len()
    );

    for event in boost_events {
        assert!(event.source_player_id.is_some());
        let EventKind::BoostGatePassed(meta) = &event.kind else {
            unreachable!()
        };
        assert!(!meta.gate_id.is_empty());
        assert!(!meta.lane_id.is_empty());
        assert!(matches!(
            meta.tier,
            BoostLaneTier::Hyper
                | BoostLaneTier::Super
                | BoostLaneTier::Standard
                | BoostLaneTier::Neutral
        ));
        assert!(meta.multiplier > 1.0);
        assert!(meta.duration_seconds > 0.0);
        // `typeof colorHex === 'number'`: the field is a `u32`.
        let _: u32 = meta.color_hex;
    }
}

#[test]
fn ai_evaluates_higher_scores_for_hyper_super_lanes_when_clear_and_avoids_overcrowded_lanes() {
    let race_config = config(&"77".repeat(32), 4);
    let mut state = create_simulation(race_config.clone(), SimOptions::default(), None);
    let mut rng = create_race_rng(race_config.seed.as_str(), "test-ai");

    // Put duck near first boost gate (progress 0.23, approaching gate at 0.26)
    state.ducks[0].progress = 0.23;
    state.ducks[0].lateral_offset = 0.0;

    // When lane is clear, target offset should favor the high buff lane
    let clear_target = evaluate(&state, 0, &mut rng);
    assert!((-0.85..=0.85).contains(&clear_target));

    // Put other ducks in HYPER lane right next to gate to create heavy congestion
    for duck in &mut state.ducks[1..=3] {
        duck.progress = 0.24;
        duck.lateral_offset = -0.6375;
    }

    // Now AI should smartly avoid the clogged HYPER lane and pick another clear lane
    let congested_target = evaluate(&state, 0, &mut rng);
    assert_ne!(congested_target, -0.6375);
}
