//! `sh1` state hash and event digest vs the TS oracle encoder (review 3 m1).
//!
//! Fixtures (corpus-v1 case 13, 900 ticks, regenerate with):
//!
//! ```text
//! cargo run -p race-cli -- corpus gen --count 20 --out corpus.jsonl
//! node --import tsx scripts/oracle/dump-trace.ts --corpus corpus.jsonl --from 13 --limit 1 \
//!   --full-at 13 --max-ticks 900 --out trace-sh1-case13.jsonl --full-out full.jsonl
//! gzip -9 -n -c full.jsonl > trace-sh1-case13.full.jsonl.gz
//! ```
//!
//! The test re-encodes every tick's `--full-at` field dump with
//! `race_core::hash::StateHasher` and requires the TS `stateSha256`, then
//! folds `stateChainSha256` / `motionSha256` with `HashFold` and the
//! `eventsSha256` digest, and requires the trace record's values. Every
//! event's JCS text must also parse into the typed `RaceEvent`.

#![allow(clippy::disallowed_types)] // serde_json::Value is fine in tests.

use std::io::Read as _;

use race_core::digest::to_hex;
use race_core::hash::{HashFold, StateHasher, StateWrite};
use race_protocol::events::RaceEvent;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

const FULL: &[u8] = include_bytes!("fixtures/trace-sh1-case13.full.jsonl.gz");
const TRACE: &str = include_str!("fixtures/trace-sh1-case13.jsonl");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FullTick {
    tick: u32,
    state_sha256: String,
    fields: Vec<(String, String, Value)>,
    events: Vec<FullEvent>,
}

#[derive(Deserialize)]
struct FullEvent {
    jcs: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    state_chain_sha256: String,
    motion_sha256: String,
    events_sha256: String,
    event_count: u64,
    final_tick: u32,
    tick_hashes: String,
    hash_prefix_bytes: usize,
}

fn encode(fields: &[(String, String, Value)]) -> [u8; 32] {
    let mut hasher = StateHasher::new();
    for (name, kind, value) in fields {
        match kind.as_str() {
            "u8" => hasher.write_u8(u8::try_from(value.as_u64().unwrap()).unwrap()),
            "u32" => hasher.write_u32(u32::try_from(value.as_u64().unwrap()).unwrap()),
            "f64" => {
                let bits = u64::from_str_radix(value.as_str().unwrap(), 16).unwrap();
                hasher.write_f64(f64::from_bits(bits));
            }
            "str" => hasher.write_str(value.as_str().unwrap()),
            other => panic!("field {name}: unknown type {other}"),
        }
    }
    hasher.finish()
}

#[test]
fn sh1_and_event_digest_match_the_ts_oracle() {
    let mut text = String::new();
    flate2::read::GzDecoder::new(FULL)
        .read_to_string(&mut text)
        .unwrap();
    let mut lines = TRACE.lines();
    let header = lines.next().unwrap();
    assert!(header.starts_with(r#"{"kind":"header""#));
    let record: Record = serde_json::from_str(lines.next().unwrap()).unwrap();

    let mut chain = HashFold::new();
    let mut motion = HashFold::new();
    let mut events = Sha256::new();
    let (mut ticks, mut event_count, mut last_tick) = (0u32, 0u64, 0u32);
    for line in text.lines() {
        let tick: FullTick = serde_json::from_str(line).unwrap();
        let state_hash = encode(&tick.fields);
        assert_eq!(to_hex(&state_hash), tick.state_sha256, "tick {}", tick.tick);
        let prefix = record.hash_prefix_bytes * 2;
        let at = tick.tick as usize * prefix;
        assert_eq!(
            &to_hex(&state_hash)[..prefix],
            &record.tick_hashes[at..at + prefix]
        );
        chain.push(tick.tick, &state_hash);
        if HashFold::is_motion_tick(tick.tick) {
            motion.push(tick.tick, &state_hash);
        }
        if tick.tick == record.final_tick {
            motion.push_final(tick.tick, &state_hash);
        }
        for event in &tick.events {
            events.update(event.jcs.as_bytes());
            events.update(b"\n");
            let mut value: Value = serde_json::from_str(&event.jcs).unwrap();
            value["seq"] = Value::from(event_count);
            serde_json::from_value::<RaceEvent>(value).unwrap_or_else(|e| {
                panic!("tick {}: {} does not parse: {e}", tick.tick, event.jcs)
            });
            event_count += 1;
        }
        ticks += 1;
        last_tick = tick.tick;
    }
    assert_eq!(last_tick, record.final_tick);
    assert_eq!(ticks, record.final_tick + 1);
    assert_eq!(to_hex(chain.value()), record.state_chain_sha256);
    assert_eq!(to_hex(motion.value()), record.motion_sha256);
    assert_eq!(event_count, record.event_count);
    assert!(event_count > 0, "fixture should exercise events");
    assert_eq!(to_hex(events.finalize().as_slice()), record.events_sha256);
    println!("sh1: {ticks} ticks and {event_count} events match the TS oracle");
}
