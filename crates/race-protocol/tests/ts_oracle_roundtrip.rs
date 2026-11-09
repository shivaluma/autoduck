//! Round-trips JSON produced by the TS engine (the oracle) through the Rust
//! wire types.
//!
//! Fixtures come from `fixtures/ts-oracle/dump-protocol-fixtures.mts` (see its
//! header). For every TS event, the test injects `seq`, deserialises it into
//! `RaceEvent`, re-serialises it, and requires the same key set at the top
//! level and in `metadata`, and the same values (numbers compared as f64).
//! Snapshots, results and configs get the same treatment.

#![allow(clippy::disallowed_types)] // serde_json::Value is fine in tests.

use std::collections::{BTreeMap, BTreeSet};

use race_protocol::config::{ConfigError, RaceConfigInput};
use race_protocol::events::{EventKind, RaceEvent};
use race_protocol::legacy::LegacyRaceConfigV1;
use race_protocol::result::RaceResult;
use race_protocol::snapshot::StateSnapshotMessage;
use serde_json::Value;

const RACES: &str = include_str!("fixtures/ts-oracle/races.json");
const VARIANTS: &str = include_str!("fixtures/ts-oracle/event-variants.json");
const TS_EVENT_TYPES: &str = include_str!("fixtures/ts-oracle/event-types.json");

/// Deep equality with numbers compared as f64 (JS writes `1`, Rust `1.0`).
fn json_eq(left: &Value, right: &Value, path: &str, diffs: &mut Vec<String>) {
    match (left, right) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            if a.to_bits() != b.to_bits() && !(a == 0.0 && b == 0.0) {
                diffs.push(format!("{path}: {a:?} != {b:?}"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            let keys_a: BTreeSet<_> = a.keys().collect();
            let keys_b: BTreeSet<_> = b.keys().collect();
            if keys_a != keys_b {
                diffs.push(format!("{path}: keys {keys_a:?} != {keys_b:?}"));
            }
            for key in keys_a.intersection(&keys_b) {
                json_eq(&a[*key], &b[*key], &format!("{path}.{key}"), diffs);
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                diffs.push(format!("{path}: len {} != {}", a.len(), b.len()));
            }
            for (index, (x, y)) in a.iter().zip(b).enumerate() {
                json_eq(x, y, &format!("{path}[{index}]"), diffs);
            }
        }
        (a, b) if a == b => {}
        (a, b) => diffs.push(format!("{path}: {a} != {b}")),
    }
}

fn with_seq(event: &Value, seq: usize) -> Value {
    let mut event = event.clone();
    event
        .as_object_mut()
        .unwrap()
        .insert("seq".into(), Value::from(seq));
    event
}

#[derive(Default)]
struct Tally {
    total: usize,
    deserialized: usize,
    identical: usize,
    by_type: BTreeMap<String, usize>,
    failures: Vec<String>,
}

impl Tally {
    fn check_event(&mut self, raw: &Value, seq: usize) {
        self.total += 1;
        let ty = raw["type"].as_str().unwrap().to_string();
        *self.by_type.entry(ty.clone()).or_default() += 1;
        let input = with_seq(raw, seq);
        let event: RaceEvent = match serde_json::from_value(input.clone()) {
            Ok(event) => event,
            Err(error) => {
                self.failures
                    .push(format!("{ty}: deserialize failed: {error}: {input}"));
                return;
            }
        };
        self.deserialized += 1;
        assert_eq!(event.type_name(), ty);
        let output = serde_json::to_value(&event).unwrap();
        let mut diffs = Vec::new();
        json_eq(&input, &output, "$", &mut diffs);
        if diffs.is_empty() {
            self.identical += 1;
        } else {
            self.failures.push(format!("{ty}: {diffs:?}"));
        }
    }

    fn report(&self, label: &str) {
        eprintln!(
            "[{label}] events: {} total, {} deserialized ({:.2}%), {} identical key sets and values ({:.2}%), {} types",
            self.total,
            self.deserialized,
            100.0 * self.deserialized as f64 / self.total as f64,
            self.identical,
            100.0 * self.identical as f64 / self.total as f64,
            self.by_type.len(),
        );
        for failure in self.failures.iter().take(20) {
            eprintln!("  FAIL {failure}");
        }
    }
}

#[test]
fn every_ts_event_type_has_a_variant_in_schema_order() {
    let ts: Vec<String> = serde_json::from_str(TS_EVENT_TYPES).unwrap();
    let rust: Vec<String> = EventKind::TYPE_NAMES
        .iter()
        .map(|name| name.to_string())
        .collect();
    assert_eq!(
        rust, ts,
        "EventKind::TYPE_NAMES must equal raceEventTypeSchema.options"
    );
    assert_eq!(rust.len(), 69);
}

#[test]
fn full_race_events_round_trip() {
    let races: Vec<Value> = serde_json::from_str(RACES).unwrap();
    let mut tally = Tally::default();
    for race in &races {
        for (seq, event) in race["result"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            tally.check_event(event, seq);
        }
    }
    tally.report("full races");
    assert!(tally.total > 1000, "fixture too small: {}", tally.total);
    assert!(
        tally.failures.is_empty(),
        "{} failures",
        tally.failures.len()
    );
}

#[test]
fn event_variants_round_trip() {
    let variants: Vec<Value> = serde_json::from_str(VARIANTS).unwrap();
    let mut tally = Tally::default();
    for (seq, event) in variants.iter().enumerate() {
        tally.check_event(event, seq);
    }
    tally.report("variants over 400 races");
    assert!(
        tally.failures.is_empty(),
        "{} failures",
        tally.failures.len()
    );
}

/// Events the 400 fixture races do not produce, written from the TS emit
/// sites (and the season layer for meta events).
const HANDWRITTEN: &[&str] = &[
    // items/engine.ts:581 (prep rocket whose target finished)
    r#"{"raceId":"7","type":"ROCKET_EXPIRED","tick":900,"timestampWithinRaceMs":15000,"sourcePlayerId":"1","targetPlayerId":"2","metadata":{}}"#,
    // items/engine.ts:581 (wild rocket)
    r#"{"raceId":"7","type":"MINI_ROCKET_EXPIRED","tick":901,"timestampWithinRaceMs":15016.666666666666,"sourcePlayerId":"1","targetPlayerId":"2","metadata":{}}"#,
    // lib/season3-race.ts:314-323
    r#"{"raceId":"7","type":"CHAOS_RESOLVED","tick":2405,"timestampWithinRaceMs":40071.2,"metadata":{"chaosType":"CUT_LINE","loserPlayerIds":["3","9"]}}"#,
    // lib/season3-race.ts:446-456
    r#"{"raceId":"7","type":"QP_TRACK_REWARD_GRANTED","tick":1210,"timestampWithinRaceMs":20166.666666666668,"sourcePlayerId":"4","metadata":{"pickupId":"gold:pickup-zone-2:z2-a3","amount":1,"reason":"TRACK_GOLDEN_BOX"}}"#,
    // Declared, never emitted.
    r#"{"raceId":"7","type":"ITEM_ACTIVATED","tick":1,"timestampWithinRaceMs":16.666666666666668,"metadata":{}}"#,
    r#"{"raceId":"7","type":"PREDATOR_RUSH_ENDED","tick":1,"timestampWithinRaceMs":16.666666666666668,"sourcePlayerId":"1","metadata":{}}"#,
    // auto-use/execute.ts:50 with a null draft target (possible by type).
    r#"{"raceId":"7","type":"DRAFT_FIN_STARTED","tick":300,"timestampWithinRaceMs":5000,"sourcePlayerId":"1","metadata":{"untilTick":396,"durationSeconds":1.6,"multiplier":1.21,"draftTarget":null,"autoReason":"OPPORTUNITY"}}"#,
    // items/engine.ts:420 (replacement) and auto-use/execute.ts:155 (intact bubble)
    r#"{"raceId":"7","type":"SPEED_BOOST_QUEUED","tick":300,"timestampWithinRaceMs":5000,"sourcePlayerId":"1","metadata":{"itemId":"NITRO","durationSeconds":1.8,"multiplier":1.25,"replacedPrevious":true,"replacedItemId":"PADDLE_BURST"}}"#,
    r#"{"raceId":"7","type":"BUBBLE_POPPED","tick":300,"timestampWithinRaceMs":5000,"sourcePlayerId":"2","targetPlayerId":"1","metadata":{"blocked":"QUACK_HORN","intact":true}}"#,
];

#[test]
fn handwritten_events_round_trip_and_cover_every_type() {
    let mut tally = Tally::default();
    for (seq, text) in HANDWRITTEN.iter().enumerate() {
        tally.check_event(&serde_json::from_str(text).unwrap(), seq);
    }
    tally.report("handwritten");
    assert!(tally.failures.is_empty());

    let races: Vec<Value> = serde_json::from_str(RACES).unwrap();
    let variants: Vec<Value> = serde_json::from_str(VARIANTS).unwrap();
    let mut seen: BTreeSet<String> = tally.by_type.keys().cloned().collect();
    for event in races
        .iter()
        .flat_map(|race| race["result"]["events"].as_array().unwrap().iter())
        .chain(variants.iter())
    {
        seen.insert(event["type"].as_str().unwrap().to_string());
    }
    let missing: Vec<_> = EventKind::TYPE_NAMES
        .iter()
        .filter(|name| !seen.contains(**name))
        .collect();
    eprintln!(
        "[coverage] {} of {} event types exercised",
        seen.len(),
        EventKind::TYPE_NAMES.len()
    );
    assert!(
        missing.is_empty(),
        "event types without a fixture: {missing:?}"
    );
}

#[test]
fn meta_events_are_flagged() {
    for text in HANDWRITTEN {
        let mut value: Value = serde_json::from_str(text).unwrap();
        value["seq"] = Value::from(0);
        let event: RaceEvent = serde_json::from_value(value).unwrap();
        assert_eq!(
            event.is_meta(),
            EventKind::META_TYPE_NAMES.contains(&event.type_name()),
            "{}",
            event.type_name()
        );
    }
}

#[test]
fn snapshots_round_trip() {
    let races: Vec<Value> = serde_json::from_str(RACES).unwrap();
    let (mut total, mut identical) = (0usize, 0usize);
    let mut failures = Vec::new();
    for race in &races {
        for snapshot in race["snapshots"].as_array().unwrap() {
            total += 1;
            let message: StateSnapshotMessage = serde_json::from_value(snapshot.clone())
                .unwrap_or_else(|error| panic!("snapshot failed: {error}: {snapshot}"));
            let output = serde_json::to_value(&message).unwrap();
            let mut diffs = Vec::new();
            json_eq(snapshot, &output, "$", &mut diffs);
            if diffs.is_empty() {
                identical += 1;
            } else {
                failures.push(diffs);
            }
        }
    }
    eprintln!(
        "[snapshots] {total} total, {identical} identical ({:.2}%)",
        100.0 * identical as f64 / total as f64
    );
    assert!(total > 50);
    assert!(
        failures.is_empty(),
        "{:?}",
        &failures[..failures.len().min(3)]
    );
}

#[test]
fn results_round_trip() {
    let races: Vec<Value> = serde_json::from_str(RACES).unwrap();
    for race in &races {
        let mut result = race["result"].clone();
        for (seq, event) in result["events"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .enumerate()
        {
            event["seq"] = Value::from(seq);
        }
        let typed: RaceResult = serde_json::from_value(result.clone()).unwrap();
        assert!(!typed.standings.is_empty());
        let output = serde_json::to_value(&typed).unwrap();
        let mut diffs = Vec::new();
        json_eq(&result, &output, "$", &mut diffs);
        assert!(diffs.is_empty(), "{diffs:?}");
    }
}

#[test]
fn configs_resolve_like_the_ts_engine() {
    let races: Vec<Value> = serde_json::from_str(RACES).unwrap();
    for race in &races {
        let input: RaceConfigInput = serde_json::from_value(race["input"].clone()).unwrap();
        let resolved = input.resolve().unwrap();
        let zod = &race["parsedConfig"];

        // Fields that both sides resolve the same way.
        assert_eq!(resolved.race_id.as_str(), zod["raceId"].as_str().unwrap());
        assert_eq!(resolved.seed.as_str(), zod["seed"].as_str().unwrap());
        assert_eq!(resolved.tick_rate, 60);
        assert_eq!(
            resolved.track_version,
            zod["trackVersion"].as_str().unwrap()
        );
        let players = zod["players"].as_array().unwrap();
        assert_eq!(resolved.players.len(), players.len());
        for (rust, ts) in resolved.players.iter().zip(players) {
            assert_eq!(rust.player_id.as_str(), ts["playerId"].as_str().unwrap());
            assert_eq!(rust.name, ts["name"].as_str().unwrap());
            assert_eq!(rust.is_ghost, ts["isGhost"].as_bool().unwrap_or(false));
            assert_eq!(rust.cosmetic_key.as_deref(), ts["cosmeticKey"].as_str());
        }
        let loadouts = serde_json::to_value(&resolved.loadouts).unwrap();
        assert_eq!(loadouts, zod["loadouts"]);
        assert_eq!(
            resolved.chaos_config.chaos_type.as_str(),
            zod["chaosConfig"]["type"].as_str().unwrap()
        );
        let groups = serde_json::to_value(&resolved.chaos_config.groups).unwrap();
        assert_eq!(
            groups,
            zod["chaosConfig"]
                .get("groups")
                .cloned()
                .unwrap_or(Value::Array(vec![]))
        );
        let pickup = serde_json::to_value(&resolved.pickup_config).unwrap();
        let mut diffs = Vec::new();
        json_eq(&pickup, &zod["pickupConfig"], "$.pickupConfig", &mut diffs);
        assert!(diffs.is_empty(), "{diffs:?}");

        // D2: a fresh config gets the 2.0 versions, not the TS 1.x ones.
        assert_eq!(
            resolved.engine_version,
            race_protocol::versions::RACE_ENGINE_VERSION
        );
        assert_eq!(
            resolved.balance_version,
            race_protocol::versions::RACE_BALANCE_VERSION
        );

        // A stored TS config (engine 1.2.0) is legacy: resolve refuses it and
        // LegacyRaceConfigV1 reads it, keeping every key.
        let stored: RaceConfigInput = serde_json::from_value(zod.clone()).unwrap();
        assert!(matches!(
            stored.resolve(),
            Err(ConfigError::LegacyEngineVersion { .. })
        ));
        let legacy = LegacyRaceConfigV1::parse(&zod.to_string()).unwrap();
        assert_eq!(legacy.engine_version.as_deref(), Some("1.2.0"));
        let mut diffs = Vec::new();
        json_eq(
            zod,
            &serde_json::to_value(&legacy).unwrap(),
            "$",
            &mut diffs,
        );
        assert!(diffs.is_empty(), "{diffs:?}");
    }
}

/// Every event of the 400 variant races (~179k), not just one per shape.
/// Generate with `ALL_EVENTS_OUT=<path>` (see the dump script) and run with
/// `RACE_PROTOCOL_ALL_EVENTS=<path> cargo test -p race-protocol --test
/// ts_oracle_roundtrip -- --ignored --nocapture`.
#[test]
#[ignore = "needs RACE_PROTOCOL_ALL_EVENTS=<ndjson from the dump script>"]
fn all_oracle_events_round_trip() {
    let path = std::env::var("RACE_PROTOCOL_ALL_EVENTS").expect("set RACE_PROTOCOL_ALL_EVENTS");
    let text = std::fs::read_to_string(path).unwrap();
    let mut tally = Tally::default();
    for (seq, line) in text.lines().filter(|line| !line.is_empty()).enumerate() {
        tally.check_event(&serde_json::from_str(line).unwrap(), seq);
    }
    tally.report("all events, 400 races");
    assert!(
        tally.failures.is_empty(),
        "{} failures",
        tally.failures.len()
    );
}
