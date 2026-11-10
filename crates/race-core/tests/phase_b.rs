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
