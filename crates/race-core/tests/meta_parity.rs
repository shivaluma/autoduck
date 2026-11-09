//! D5/R7 meta parity: Chaos rules, Season 3 card draws (`chaos:week:N`,
//! `chaos:manual:N:<ms>`, toggle-skip), auto-loadouts and `validateLoadout`
//! against `tests/fixtures/meta-parity.json.gz` from the TS oracle.
//!
//! Regenerate with
//! `node --no-use-std-math-pow --import tsx scripts/oracle/dump-meta-fixtures.ts`.
//! The same check runs as `race-cli oracle meta` (built with `--features ts-compat`).
//!
//! `localeCompare` tie-breaks need the ICU model, so this test needs
//! `ts-compat`; without it Chaos orders ids by bytes (D6, Phase B).
#![cfg(feature = "ts-compat")]

#[path = "support/meta_parity.rs"]
mod meta_parity;

use std::fs::File;
use std::io::Read;
use std::path::PathBuf;

use flate2::read::GzDecoder;

#[test]
fn meta_parity_fixture_matches_100_percent() {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "tests",
        "fixtures",
        "meta-parity.json.gz",
    ]
    .iter()
    .collect();
    let file = File::open(&path).unwrap_or_else(|error| {
        panic!(
            "missing fixture {} ({error}); run `node --no-use-std-math-pow --import tsx scripts/oracle/dump-meta-fixtures.ts`",
            path.display()
        )
    });
    let mut json = Vec::new();
    GzDecoder::new(file)
        .read_to_end(&mut json)
        .expect("gunzip fixture");
    let (_, report) = meta_parity::run(&json, 20).expect("run meta parity");
    let (passed, total) = report.total();
    assert!(
        report.catalog_ok,
        "catalog differs: {:?}",
        report.catalog_problems
    );
    assert!(total >= 10_000, "only {total} cases");
    assert_eq!(
        passed, total,
        "{} mismatches, first: {:#?}",
        report.mismatch_count, report.mismatches
    );
}
