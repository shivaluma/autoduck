//! Pinned whole-race digests for both feature sets (D26; Phase 2 review 2
//! MAJOR 2).
//!
//! `fixtures/determinism-pinned.json` holds 42 corpus cases covering every
//! Chaos type: 32 `full`-profile cases (lobbies of 4-16 with loadouts,
//! pickups, hazards, ghosts and legacy 1.2.0 configs) and 10 `items`-profile
//! cases with manual wild-item inputs. Each carries the
//! [`race_core::sim::digest_case`] values per feature set: `tsCompat` from the
//! TS oracle trace (so a pass here is G1 on these cases), `default` from the
//! shipped engine. CI runs this file natively and under wasm32-wasip1
//! (wasmtime) on x86_64 and aarch64, in release, with and without
//! `ts-compat`; `scripts/ci/wasm-determinism.mjs` checks `default` through
//! the shipped wasm-bindgen package in Node.
//!
//! When an intended engine change moves the `default` digests (Phase B),
//! regenerate them with `cargo run -p race-cli -- corpus pin`. The `tsCompat`
//! digests only move if the faithful port does.

use race_core::sim::{CaseDigest, EngineMath, digest_corpus_line};
use serde::Deserialize;
use serde::de::IgnoredAny;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    cases: Vec<Case>,
    #[cfg_attr(not(feature = "ts-compat"), allow(dead_code))]
    ts_compat_host: Host,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(feature = "ts-compat"), allow(dead_code))]
struct Host {
    platform: String,
    arch: String,
    use_std_math_pow: bool,
}

/// Each build reads only its own feature set's digest.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct Case {
    id: String,
    line: String,
    default: CaseDigest,
    ts_compat: CaseDigest,
}

fn fixture() -> Fixture {
    serde_json::from_str(include_str!("fixtures/determinism-pinned.json")).expect("fixture parses")
}

#[cfg(feature = "ts-compat")]
fn math(fixture: &Fixture) -> EngineMath {
    use race_core::js_math::{OracleHost, V8Target};
    let host = &fixture.ts_compat_host;
    EngineMath::oracle(OracleHost {
        target: V8Target::from_node(&host.platform, &host.arch).expect("known oracle host"),
        use_std_math_pow: host.use_std_math_pow,
    })
}

#[cfg(not(feature = "ts-compat"))]
fn math(_: &Fixture) -> EngineMath {
    EngineMath::default()
}

#[cfg(feature = "ts-compat")]
fn expected(case: &Case) -> &CaseDigest {
    &case.ts_compat
}

#[cfg(not(feature = "ts-compat"))]
fn expected(case: &Case) -> &CaseDigest {
    &case.default
}

/// Number of shards: the cases are split over several tests so the harness
/// runs them in parallel (wasmtime runs them one by one).
const SHARDS: usize = 6;

fn check_shard(shard: usize) {
    let fixture = fixture();
    let math = math(&fixture);
    assert_eq!(fixture.cases.len(), 42, "fixture case count");
    let mut failures = Vec::new();
    for case in fixture.cases.iter().skip(shard).step_by(SHARDS) {
        let digest = digest_corpus_line(&case.line, math)
            .unwrap_or_else(|error| panic!("case {}: {error}", case.id));
        if &digest != expected(case) {
            failures.push(format!(
                "case {}: expected {:?}\n    got {:?}",
                case.id,
                expected(case),
                digest
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn pinned_digests_shard_0() {
    check_shard(0);
}

#[test]
fn pinned_digests_shard_1() {
    check_shard(1);
}

#[test]
fn pinned_digests_shard_2() {
    check_shard(2);
}

#[test]
fn pinned_digests_shard_3() {
    check_shard(3);
}

#[test]
fn pinned_digests_shard_4() {
    check_shard(4);
}

#[test]
fn pinned_digests_shard_5() {
    check_shard(5);
}

/// The parts of a corpus line the coverage check reads.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LineShape {
    players: Vec<IgnoredAny>,
    chaos_config: Option<ChaosShape>,
    oracle_manual_inputs: Option<Vec<IgnoredAny>>,
}

#[derive(Deserialize)]
struct ChaosShape {
    #[serde(rename = "type")]
    kind: String,
}

#[test]
fn fixture_covers_every_chaos_type_and_manual_inputs() {
    let fixture = fixture();
    let lines: Vec<LineShape> = fixture
        .cases
        .iter()
        .map(|case| serde_json::from_str(&case.line).expect("case line parses"))
        .collect();
    for chaos in [
        "NORMAL",
        "REVERSE",
        "DUO",
        "TRIPLE_ELIMINATION",
        "CUT_LINE",
        "CONSTRUCTORS",
        "BOUNTY_HUNT",
    ] {
        assert!(
            lines.iter().any(|line| line
                .chaos_config
                .as_ref()
                .is_some_and(|config| config.kind == chaos)),
            "no {chaos} case"
        );
    }
    assert!(lines.iter().any(|line| line.players.len() == 16));
    assert!(
        lines
            .iter()
            .filter(|line| line
                .oracle_manual_inputs
                .as_ref()
                .is_some_and(|inputs| !inputs.is_empty()))
            .count()
            >= 8
    );
}
