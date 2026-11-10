//! White-box port of `tests/race-pacing.test.ts` (Phase 2).
//!
//! Same test names in snake_case and the same assertions.
//!
//! Needs `ts-compat` (`resolve_ts_compat`, ICU id collation, V8 maths).

#![cfg(feature = "ts-compat")]
#![allow(clippy::float_cmp)]

use std::collections::BTreeMap;

use race_core::rng::create_race_rng;
use race_core::sim::{
    SimOptions, create_simulation, evaluate_pacing_multiplier, generate_duck_pacing_segments,
    step_simulation,
};
use race_protocol::config::RaceConfigInput;
use race_protocol::versions::RACE_TICK_RATE;
use race_protocol::versions::ts_compat::{
    RACE_BALANCE_VERSION, RACE_ENGINE_VERSION, RACE_PROTOCOL_VERSION, TRACK_VERSION,
};

#[test]
fn generate_duck_pacing_segments_guarantees_exact_average_of_1_0_across_segments() {
    for seed in 1..=50_u32 {
        let mut rng = create_race_rng(&format!("{seed:064x}"), "duck:test");
        let segments = generate_duck_pacing_segments(&mut rng, 4, 0.12);
        assert_eq!(segments.len(), 4);
        let sum = segments.iter().fold(0.0, |acc, value| acc + value);
        let average = sum / 4.0;
        assert!(
            (average - 1.0).abs() < 1e-9,
            "Expected average 1.0 but got {average}"
        );
        for value in segments {
            assert!(
                (0.7..=1.3).contains(&value),
                "Segment value {value} out of bounds"
            );
        }
    }
}

#[test]
fn evaluate_pacing_multiplier_smoothly_interpolates_and_preserves_exact_total_race_speed_budget() {
    let segments = [1.12, 1.06, 0.92, 0.90];
    assert_eq!(evaluate_pacing_multiplier(&segments, 0.0), 1.12);
    assert_eq!(evaluate_pacing_multiplier(&segments, 0.125), 1.12);
    assert_eq!(evaluate_pacing_multiplier(&segments, 0.375), 1.06);
    assert_eq!(evaluate_pacing_multiplier(&segments, 0.625), 0.92);
    assert_eq!(evaluate_pacing_multiplier(&segments, 0.875), 0.90);
    assert_eq!(evaluate_pacing_multiplier(&segments, 1.0), 0.90);

    // Midpoint between segment 0 (1.12) and segment 1 (1.06) at progress 0.25
    let mid01 = evaluate_pacing_multiplier(&segments, 0.25);
    assert!(
        (mid01 - 1.09).abs() < 1e-6,
        "Expected midpoint 1.09, got {mid01}"
    );

    // Numerical integration over [0, 1] with fine step size
    let steps = 10_000_u32;
    let mut integral = 0.0;
    for i in 0..steps {
        let p = (f64::from(i) + 0.5) / f64::from(steps);
        integral += evaluate_pacing_multiplier(&segments, p) * (1.0 / f64::from(steps));
    }
    assert!(
        (integral - 1.0).abs() < 1e-4,
        "Expected total integral ~1.0, got {integral}"
    );
}

#[test]
fn race_simulation_creates_dynamic_lead_changes_across_8_ducks() {
    let players: Vec<String> = (1..=8)
        .map(|index| format!(r#"{{"playerId":"duck-{index}","name":"Duck {index}"}}"#))
        .collect();
    let json = format!(
        r#"{{"raceId":"pacing-lead-changes-test","seed":"{}","protocolVersion":"{RACE_PROTOCOL_VERSION}","engineVersion":"{RACE_ENGINE_VERSION}","balanceVersion":"{RACE_BALANCE_VERSION}","trackVersion":"{TRACK_VERSION}","tickRate":{RACE_TICK_RATE},"players":[{}]}}"#,
        "7a".repeat(32),
        players.join(","),
    );
    let input: RaceConfigInput = serde_json::from_str(&json).unwrap();
    let config = input.resolve_ts_compat().unwrap();

    let mut state = create_simulation(config, SimOptions::default(), None);
    // The TS `Map` iterates in insertion order; the change count below does
    // not depend on the order, so a `BTreeMap` stands in for it.
    let mut rank_history_by_duck: BTreeMap<String, Vec<u32>> = state
        .ducks
        .iter()
        .map(|duck| (duck.player_id.as_str().to_owned(), Vec::new()))
        .collect();

    while !state.finished {
        step_simulation(&mut state, None);
        if state.tick.is_multiple_of(60) {
            for duck in &state.ducks {
                rank_history_by_duck
                    .get_mut(duck.player_id.as_str())
                    .unwrap()
                    .push(duck.current_rank);
            }
        }
    }

    // Count number of rank changes
    let mut total_rank_changes = 0;
    for ranks in rank_history_by_duck.values() {
        for window in ranks.windows(2) {
            if window[1] != window[0] {
                total_rank_changes += 1;
            }
        }
    }

    assert!(
        total_rank_changes > 10,
        "Expected multiple rank changes during race, got {total_rank_changes}"
    );
}
