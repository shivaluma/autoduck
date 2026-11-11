//! Phase B fixes F1-F13 (`docs/balance/S3.16.md`): the S3.16 behaviour of the
//! default build, and the S3.15 behaviour `ts-compat` keeps.

#![allow(clippy::float_cmp)]

use core::cmp::Ordering;

use race_core::sim::id_cmp;

// ---------------------------------------------------------------------------
// F1: byte-order ids
// ---------------------------------------------------------------------------

#[test]
fn f1_ids_order_by_bytes_in_s3_16_and_by_icu_in_ts_compat() {
    // Byte order: ':' (0x3a) > '1' (0x31), 'B' (0x42) < 'a' (0x61),
    // '_' (0x5f) > 'Z' (0x5a). ICU: punctuation before digits, case is a
    // tertiary difference (lowercase first), `_` first of all.
    let cases = [("a:1", "a1"), ("B", "a"), ("_x", "Zx"), ("10", "9")];
    let byte = [
        Ordering::Greater,
        Ordering::Less,
        Ordering::Greater,
        Ordering::Less,
    ];
    let icu = [
        Ordering::Less,
        Ordering::Greater,
        Ordering::Less,
        Ordering::Less,
    ];
    let expected = if race_core::TS_COMPAT { icu } else { byte };
    for ((left, right), want) in cases.into_iter().zip(expected) {
        assert_eq!(id_cmp(left, right), want, "{left} vs {right}");
        assert_eq!(id_cmp(right, left), want.reverse(), "{right} vs {left}");
    }
}

#[test]
fn f1_numeric_ids_order_the_same_in_both_builds() {
    // Production player ids are decimal user ids, where ICU and byte order
    // agree: F1 changes nothing for them.
    let mut ids = ["7", "10", "123", "9", "1", "100", "12"];
    ids.sort_by(|left, right| id_cmp(left, right));
    assert_eq!(ids, ["1", "10", "100", "12", "123", "7", "9"]);
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

fn resolve(json: &str) -> race_protocol::config::ResolvedRaceConfig {
    let input: race_protocol::config::RaceConfigInput =
        serde_json::from_str(json).expect("config parses");
    input.resolve().expect("config resolves")
}

/// A production-shaped 8-duck config with loadouts, pickups and hazards.
fn lobby(race_id: &str, chaos: &str) -> String {
    let items = [
        ["NITRO", "BANANA"],
        ["HOMING_ROCKET", "FEATHER"],
        ["DRAFT_FIN", "QUACK_HORN"],
        ["BUBBLE_SHIELD", "PADDLE_BURST"],
        ["SHOCK_ABSORBER", "NITRO"],
        ["BANANA", "HOMING_ROCKET"],
        ["FEATHER", "QUACK_HORN"],
        ["PADDLE_BURST", "DRAFT_FIN"],
    ];
    let players: Vec<String> = (1..=8)
        .map(|n| format!(r#"{{"playerId":"{n}","name":"Duck {n}"}}"#))
        .collect();
    let loadouts: Vec<String> = items
        .iter()
        .enumerate()
        .map(|(slot, [a, b])| {
            format!(
                r#"{{"playerId":"{}","itemIds":["{a}","{b}"],"source":"PLAYER"}}"#,
                slot + 1
            )
        })
        .collect();
    format!(
        r#"{{"raceId":"{race_id}","seed":"{seed}","players":[{players}],"loadouts":[{loadouts}],
"chaosConfig":{chaos},"pickupConfig":{{"enabled":true,"goldenBoxEnabled":true,
"hazardsEnabled":true,"positionAwareLoot":true,"spawnMultiplier":1.25,"regularPickupCap":3,
"autoItemsEnabled":true,"forceGoldenBox":false,"disabledItems":[]}}}}"#,
        seed = "5eed".repeat(16),
        players = players.join(","),
        loadouts = loadouts.join(","),
    )
}

fn digest(json: &str) -> race_core::sim::CaseDigest {
    race_core::sim::digest_case(resolve(json), race_core::sim::SimOptions::default())
        .expect("race digests")
}

const NORMAL: &str = r#"{"type":"NORMAL","targetPlayerId":null}"#;

// ---------------------------------------------------------------------------
// F2: no race id in engine RNG labels
// ---------------------------------------------------------------------------

#[test]
fn f2_engine_streams_drop_the_race_id() {
    assert_eq!(
        race_core::rng::engine_stream("pickup-loot", "42", "zone-1:7"),
        if race_core::TS_COMPAT {
            "pickup-loot:42:zone-1:7"
        } else {
            "pickup-loot:zone-1:7"
        }
    );
    assert_eq!(
        race_core::rng::engine_stream("hazards", "42", ""),
        if race_core::TS_COMPAT {
            "hazards:42"
        } else {
            "hazards"
        }
    );
}

#[test]
fn f2_renaming_a_race_changes_its_outcome_only_in_ts_compat() {
    let first = digest(&lobby("41", NORMAL));
    let renamed = digest(&lobby("race-lab-7", NORMAL));
    // Event metadata names the race in wild instance ids (`wild:<raceId>:…`),
    // so compare motion and standings, not the event digest.
    let same = first.state_chain_sha256 == renamed.state_chain_sha256
        && first.standings == renamed.standings;
    assert_eq!(same, !race_core::TS_COMPAT);
}

// ---------------------------------------------------------------------------
// F3: one goldenBoxProbability default
// ---------------------------------------------------------------------------

#[test]
fn f3_golden_box_probability_has_one_default() {
    let omitted = lobby("41", NORMAL);
    let explicit = omitted.replace(
        r#""forceGoldenBox":false"#,
        r#""forceGoldenBox":false,"goldenBoxProbability":0.15"#,
    );
    assert_ne!(omitted, explicit);
    assert_eq!(
        resolve(&omitted).pickup_config.golden_box_probability,
        race_protocol::config::DEFAULT_GOLDEN_BOX_PROBABILITY
    );
    assert_eq!(race_protocol::config::DEFAULT_GOLDEN_BOX_PROBABILITY, 0.15);
    // The engine has no fallback of its own: leaving the key out is exactly
    // 0.15.
    assert_eq!(digest(&omitted), digest(&explicit));
}

#[cfg(feature = "ts-compat")]
#[test]
fn f3_ts_compat_resolver_keeps_the_zod_default() {
    let input: race_protocol::config::RaceConfigInput =
        serde_json::from_str(&lobby("41", NORMAL)).expect("config parses");
    let resolved = input.resolve_ts_compat().expect("config resolves");
    assert_eq!(resolved.pickup_config.golden_box_probability, 0.12);
}

// ---------------------------------------------------------------------------
// F4: per-tick caches keyed by their exact inputs
// ---------------------------------------------------------------------------

fn duck(id: &str, progress: f64, rank: u32) -> race_core::sim::DuckPhysicsState {
    race_core::sim::DuckPhysicsState {
        player_id: race_protocol::ids::PlayerId::new(id).expect("valid id"),
        name: id.into(),
        progress,
        previous_progress: progress,
        lateral_offset: 0.0,
        speed: 0.0,
        acceleration: 0.0,
        lateral_velocity: 0.0,
        desired_speed: 0.0,
        desired_lateral_offset: 0.0,
        current_rank: rank,
        active_effects: Vec::new(),
        next_impulse_tick: 0,
        finished: false,
        finish_time_ms: None,
        pacing_segments: Vec::new(),
    }
}

#[test]
fn f4_chaos_utility_rebuilds_its_ranking_when_only_ranks_change() {
    let mut utility =
        race_core::auto_use::ChaosUtility::new(&race_protocol::config::RaceChaosConfig::default());
    let before = [duck("a", 0.5, 1), duck("b", 0.5, 2), duck("c", 0.5, 3)];
    assert!(!utility.is_losing_now("a", &before));
    // Same progress, new ranks: the S3.15 fingerprint ignores ranks and
    // reuses the stale order; S3.16 re-ranks.
    let after = [duck("a", 0.5, 3), duck("b", 0.5, 2), duck("c", 0.5, 1)];
    assert_eq!(utility.is_losing_now("a", &after), !race_core::TS_COMPAT);
}

#[test]
fn f4_director_read_follows_the_ducks() {
    let mut cache = race_core::auto_use::DirectorCache::default();
    let first = [duck("a", 0.6, 1), duck("b", 0.5, 2)];
    let leader = |cache: &mut race_core::auto_use::DirectorCache,
                  ducks: &[race_core::sim::DuckPhysicsState]| {
        race_core::auto_use::read_race(cache, ducks)
            .leader_id
            .as_ref()
            .map(|id| id.as_str().to_owned())
    };
    assert_eq!(leader(&mut cache, &first).as_deref(), Some("a"));
    let second = [duck("a", 0.5, 2), duck("b", 0.6, 1)];
    assert_eq!(leader(&mut cache, &second).as_deref(), Some("b"));
}

// ---------------------------------------------------------------------------
// F5: ghosts stay out of the in-sim ChaosUtility ranking
// ---------------------------------------------------------------------------

#[test]
fn f5_a_ghost_cannot_shield_a_real_duck_from_the_loser_set() {
    let ghost = race_protocol::ids::PlayerId::new("g").expect("valid id");
    let mut utility =
        race_core::auto_use::ChaosUtility::new(&race_protocol::config::RaceChaosConfig::default())
            .without_ghosts(&[ghost]);
    let ducks = [
        duck("a", 0.7, 1),
        duck("b", 0.6, 2),
        duck("g", 0.5, 3),
        duck("c", 0.4, 4),
    ];
    // NORMAL: the last two of the standings lose. The standings never hold
    // the ghost, so `b` is really second to last.
    assert_eq!(utility.is_losing_now("b", &ducks), !race_core::TS_COMPAT);
    assert!(utility.is_losing_now("c", &ducks));
}
