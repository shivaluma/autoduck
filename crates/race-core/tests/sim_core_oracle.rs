//! Phase 2 M1: the core simulation (track, pacing, lane AI, collisions,
//! ranks, boost gates, results, events) against the TS oracle.
//!
//! `tests/fixtures/sim-core-oracle.json` holds 30 corpus cases (every Chaos
//! slot, lobbies of 2-16, ghosts, odd ids and seeds) with their loadouts,
//! `pickupConfig` and `itemTuning` removed, so only the M1 paths run, plus
//! the TS results from `scripts/oracle/dump-trace.ts`: `stateChainSha256`
//! (the `sh1` hash of every tick), `motionSha256`, `eventsSha256`,
//! `eventCount`, the final tick and the standings by f64 bits. The full
//! 2,000-case corpus runs with `race-cli oracle diff` (`scripts/oracle/README.md`).
//!
//! Needs `ts-compat` (ICU `localeCompare` model, V8 maths).

#![cfg(feature = "ts-compat")]

use race_core::digest::to_hex;
use race_core::hash::{HashFold, state_hash};
use race_core::js_math::{OracleHost, V8Target};
use race_core::sim::{
    EngineMath, EventsDigest, SimOptions, create_simulation, result_from_simulation, simulate_race,
    snapshot_world, step_simulation,
};
use race_protocol::config::RaceConfigInput;
use race_protocol::events::RaceEvent;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    host: Host,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Host {
    platform: String,
    arch: String,
    use_std_math_pow: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    case: u32,
    config: String,
    finished: bool,
    final_tick: u32,
    max_ticks: u32,
    state_chain_sha256: String,
    motion_sha256: String,
    event_count: u64,
    events_sha256: String,
    standings: Vec<Standing>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Standing {
    player_id: String,
    rank: u32,
    finish_time_bits: String,
}

fn fixture() -> Fixture {
    serde_json::from_str(include_str!("fixtures/sim-core-oracle.json")).expect("fixture parses")
}

fn options(host: &Host) -> SimOptions {
    let target = V8Target::from_node(&host.platform, &host.arch).expect("known oracle host");
    SimOptions {
        math: EngineMath::oracle(OracleHost {
            target,
            use_std_math_pow: host.use_std_math_pow,
        }),
        ..SimOptions::default()
    }
}

#[test]
fn core_cases_match_the_ts_oracle_tick_by_tick() {
    let fixture = fixture();
    assert_eq!(fixture.cases.len(), 30);
    for case in &fixture.cases {
        let input: RaceConfigInput = serde_json::from_str(&case.config).unwrap();
        let config = input.resolve_ts_compat().unwrap();
        let mut sim = create_simulation(config, options(&fixture.host), None);
        let mut chain = HashFold::new();
        let mut motion = HashFold::new();
        let mut digest = EventsDigest::new();
        let mut cursor = 0;
        let mut last;
        loop {
            last = state_hash(&sim);
            chain.push(sim.tick, &last);
            if HashFold::is_motion_tick(sim.tick) {
                motion.push(sim.tick, &last);
            }
            for event in &sim.events()[cursor..] {
                digest.push(event).unwrap();
            }
            cursor = sim.events().len();
            if sim.finished || sim.tick >= case.max_ticks {
                break;
            }
            step_simulation(&mut sim, None);
        }
        motion.push_final(sim.tick, &last);
        let label = format!("case {}", case.case);
        assert_eq!(sim.finished, case.finished, "{label}");
        assert_eq!(sim.tick, case.final_tick, "{label}");
        assert_eq!(
            to_hex(chain.value()),
            case.state_chain_sha256,
            "{label}: state chain"
        );
        assert_eq!(
            to_hex(motion.value()),
            case.motion_sha256,
            "{label}: motion"
        );
        assert_eq!(digest.count(), case.event_count, "{label}: event count");
        assert_eq!(
            to_hex(&digest.finish()),
            case.events_sha256,
            "{label}: events"
        );
        let result = result_from_simulation(&sim).unwrap();
        let standings: Vec<(String, u32, String)> = result
            .standings
            .iter()
            .map(|entry| {
                (
                    entry.player_id.as_str().to_owned(),
                    entry.rank,
                    format!("{:016x}", entry.finish_time_ms.to_bits()),
                )
            })
            .collect();
        let expected: Vec<(String, u32, String)> = case
            .standings
            .iter()
            .map(|entry| {
                (
                    entry.player_id.clone(),
                    entry.rank,
                    entry.finish_time_bits.clone(),
                )
            })
            .collect();
        assert_eq!(standings, expected, "{label}: standings");
    }
}

#[test]
fn sink_sees_every_event_and_record_events_off_keeps_the_motion() {
    let fixture = fixture();
    let case = &fixture.cases[3];
    let config = serde_json::from_str::<RaceConfigInput>(&case.config)
        .unwrap()
        .resolve_ts_compat()
        .unwrap();

    // `simulate_race` with a sink: the sink sees exactly the recorded events.
    let mut seen: Vec<RaceEvent> = Vec::new();
    let mut sink = |event: &RaceEvent| seen.push(event.clone());
    let result = simulate_race(config.clone(), options(&fixture.host), Some(&mut sink)).unwrap();
    assert_eq!(seen, result.events);
    assert!(
        seen.iter()
            .enumerate()
            .all(|(index, event)| event.seq as usize == index)
    );

    // `recordEvents: false`, no sink: same motion, no events kept (and no
    // DUCK_COLLISION, which TS only emits while recording).
    let mut quiet = create_simulation(
        config,
        SimOptions {
            record_events: false,
            ..options(&fixture.host)
        },
        None,
    );
    let mut chain = HashFold::new();
    loop {
        chain.push(quiet.tick, &state_hash(&quiet));
        if quiet.finished {
            break;
        }
        step_simulation(&mut quiet, None);
    }
    assert!(quiet.events().is_empty());
    assert_eq!(to_hex(chain.value()), case.state_chain_sha256);
    let world = snapshot_world(&quiet);
    assert_eq!(world.ducks.len(), quiet.ducks.len());
    assert!(
        world
            .ducks
            .windows(2)
            .all(|pair| pair[0].rank < pair[1].rank)
    );
    assert!(world.pickups.is_empty() && world.hazards.is_empty());
}
