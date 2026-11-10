//! Port of the engine-only assertions of `tests/race-core.test.ts`.
//!
//! (The file is not called `race_core.rs`: a test crate named `race_core`
//! would shadow the library it tests.)
//!
//! Not ported, because they need the server adapters (`lib/racing/audit.ts`,
//! `lib/racing/replay.ts`), which arrive with the Phase 3 server crate:
//! - `commit changes when immutable race config changes` (`createRaceCommit`);
//! - `replay verifies the persisted result digest` (`replayRace`);
//! - the `createResultDigest` equality in `same race config reproduces ...`
//!   and the `replayRace` call in `legacy S3.2 replay ...`.
//!
//! `config(seed)` omits the version fields, so it resolves to this engine's
//! own D2 versions (the TS helper passes the TS package constants).

#![allow(clippy::float_cmp)]

use race_core::sim::{
    SimOptions, create_simulation, simulate_race, snapshot_simulation, step_simulation,
};
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};

fn config_input(seed: &str, player_count: usize) -> RaceConfigInput {
    let players: Vec<String> = (1..=player_count)
        .map(|index| format!(r#"{{"playerId":"duck-{index}","name":"Duck {index}"}}"#))
        .collect();
    let json = format!(
        r#"{{"raceId":"test-{}","seed":"{seed}","tickRate":60,"players":[{}]}}"#,
        &seed[..8],
        players.join(",")
    );
    serde_json::from_str(&json).expect("config JSON")
}

/// `config(seed, playerCount)`.
fn config(seed: &str, player_count: usize) -> ResolvedRaceConfig {
    config_input(seed, player_count)
        .resolve()
        .expect("config resolves")
}

/// `seedFromIndex(index)`: hex, zero-padded to 64.
fn seed_from_index(index: u32) -> String {
    format!("{index:064x}")
}

#[test]
fn same_race_config_reproduces_the_exact_result_and_event_stream() {
    let race_config = config(&"ab".repeat(32), 8);
    let first = simulate_race(race_config.clone(), SimOptions::default(), None).unwrap();
    let second = simulate_race(race_config, SimOptions::default(), None).unwrap();
    assert_eq!(second, first);
    assert_eq!(first.standings.len(), 8);
    assert!(
        first.duration_ms >= 45_000.0 && first.duration_ms <= 75_000.0,
        "durationMs {}",
        first.duration_ms
    );
}

/// The engine half of `legacy S3.2 replay stays pickup-free and supported`.
/// Engine `1.1.0` configs only resolve through the TS-compat resolver.
#[cfg(feature = "ts-compat")]
#[test]
fn legacy_s3_2_replay_stays_pickup_free_and_supported() {
    let mut input = config_input(&"ed".repeat(32), 8);
    input.engine_version = Some("1.1.0".to_owned());
    input.balance_version = Some("S3.2".to_owned());
    input.track_version = Some("river-01-v1".to_owned());
    input.pickup_config = None;
    let legacy = input.resolve_ts_compat().expect("legacy config resolves");
    let result = simulate_race(legacy, SimOptions::default(), None).unwrap();
    assert!(!result.events.iter().any(|event| {
        let name = event.type_name();
        name.starts_with("PICKUP_") || name.starts_with("HAZARD_") || name.starts_with("GOLDEN_")
    }));
}

#[test]
fn fixed_step_simulation_stays_finite_bounded_and_produces_unique_ranks() {
    let mut state = create_simulation(config(&"cd".repeat(32), 16), SimOptions::default(), None);
    while !state.finished {
        step_simulation(&mut state, None);
        for duck in &state.ducks {
            assert!(duck.progress.is_finite());
            assert!(duck.speed.is_finite());
            assert!(duck.lateral_offset.is_finite());
            assert!(duck.progress >= 0.0 && duck.progress <= 1.0);
            assert!(duck.speed > 0.0);
            assert!(duck.lateral_offset >= -1.0 && duck.lateral_offset <= 1.0);
        }
    }
    let snapshot = snapshot_simulation(&state);
    let mut ranks: Vec<u32> = snapshot.iter().map(|duck| duck.rank).collect();
    assert_eq!(ranks, (1..=16).collect::<Vec<u32>>());
    ranks.dedup();
    assert_eq!(ranks.len(), 16);
}

/// 1,000 full races: about 5 minutes unoptimised, so it runs only in the
/// `--release` test jobs (`cargo test --release -- --include-ignored` runs it
/// in debug too).
#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "1,000 races; runs in the --release test jobs"
)]
fn player_slots_have_no_material_win_or_bottom_2_bias_over_many_seeds() {
    const RACES: u32 = 1_000;
    let mut wins = [0_u32; 8];
    let mut bottom_two = [0_u32; 8];
    let slot = |player_id: &str| -> usize {
        player_id
            .split('-')
            .nth(1)
            .and_then(|index| index.parse::<usize>().ok())
            .expect("duck-N")
            - 1
    };

    for race_index in 1..=RACES {
        let options = SimOptions {
            record_events: false,
            ..SimOptions::default()
        };
        let result = simulate_race(config(&seed_from_index(race_index), 8), options, None).unwrap();
        wins[slot(result.standings[0].player_id.as_str())] += 1;
        for entry in &result.standings[result.standings.len() - 2..] {
            bottom_two[slot(entry.player_id.as_str())] += 1;
        }
    }

    let races = f64::from(RACES);
    for count in wins {
        let rate = f64::from(count) / races;
        assert!((rate - 0.125).abs() <= 0.04, "win rate {rate}");
    }
    for count in bottom_two {
        let rate = f64::from(count) / races;
        assert!((rate - 0.25).abs() <= 0.055, "Bottom-2 rate {rate}");
    }
}
