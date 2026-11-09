//! Review 3 M1 / gate G1: `RaceConfigInput::resolve_ts_compat` must resolve
//! every generated corpus case to exactly the config the TS S3.15 oracle runs
//! (Zod parse + engine fallbacks), including `goldenBoxProbability` 0.12.
//!
//! The corpus is regenerated in-process (`corpus-v1`, default root seed, the
//! first `CASES` lines); the expected values come from
//! `scripts/oracle/dump-config-effective.ts` over the same lines:
//!
//! ```text
//! cargo run -p race-cli -- corpus gen --count 2000 --out corpus.jsonl
//! node --import tsx scripts/oracle/dump-config-effective.ts --corpus corpus.jsonl
//! ```

#![allow(clippy::disallowed_methods, clippy::disallowed_types)]

use std::collections::BTreeSet;
use std::io::Read as _;

use race_protocol::config::RaceConfigInput;
use serde_json::Value;

#[path = "../src/corpus.rs"]
#[allow(dead_code)]
mod corpus;

const CASES: u64 = 2000;
const FIXTURE: &[u8] = include_bytes!("fixtures/corpus-ts-effective.jsonl.gz");

/// Deep equality with numbers compared as f64 bits (`-0 == 0`, as
/// `JSON.stringify` writes `-0` as `0`).
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

#[test]
fn corpus_resolves_like_zod_plus_engine_fallbacks() {
    let mut text = String::new();
    flate2::read::GzDecoder::new(FIXTURE)
        .read_to_string(&mut text)
        .unwrap();
    let expected: Vec<&str> = text.lines().collect();
    assert_eq!(expected.len() as u64, CASES, "fixture case count");

    let mut failures = Vec::new();
    let mut zero_point_twelve = 0;
    for index in 0..CASES {
        let line = corpus::case_line(corpus::DEFAULT_ROOT_SEED, index);
        let want: Value = serde_json::from_str(expected[index as usize]).unwrap();
        let input: Result<RaceConfigInput, _> = serde_json::from_str(&line);
        let got = input
            .map_err(|e| e.to_string())
            .and_then(|i| i.resolve_ts_compat().map_err(|e| e.to_string()));
        match (got, want.get("error")) {
            (Ok(resolved), None) => {
                if resolved.pickup_config.golden_box_probability == 0.12 {
                    zero_point_twelve += 1;
                }
                let got = serde_json::to_value(&resolved).unwrap();
                let mut diffs = Vec::new();
                json_eq(&got, &want, "$", &mut diffs);
                if !diffs.is_empty() {
                    failures.push(format!("case {index}: {diffs:?}"));
                }
            }
            (Err(_), Some(_)) => {}
            (Ok(_), Some(error)) => failures.push(format!(
                "case {index}: Zod rejects ({error}), Rust resolves"
            )),
            (Err(error), None) => {
                failures.push(format!("case {index}: Rust rejects ({error}), Zod accepts"))
            }
        }
    }
    println!(
        "{CASES} cases, {zero_point_twelve} resolve goldenBoxProbability to the Zod default 0.12"
    );
    assert!(
        zero_point_twelve > 0,
        "corpus never exercises the Zod golden-box default"
    );
    assert!(
        failures.is_empty(),
        "{} of {CASES} differ:\n{}",
        failures.len(),
        failures[..failures.len().min(10)].join("\n")
    );
}
