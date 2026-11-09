//! `race-cli oracle meta`: Season meta parity (D5, R7) against the fixture
//! from `scripts/oracle/dump-meta-fixtures.ts` (Chaos rules, card draws on
//! `chaos:week:N` / `chaos:manual:N:<ms>`, toggle-skip, auto-loadouts,
//! `validateLoadout`, catalog tables). The checker is shared with
//! `crates/race-core/tests/meta_parity.rs`.
//!
//! Needs race-core's `ts-compat` (ICU `localeCompare` model for rank ties):
//! `cargo run -p race-cli --features ts-compat -- oracle meta`. The feature is
//! off by default so it never reaches `ENGINE_BUILD_ID` through workspace
//! feature unification (review 1 MINOR 12).

use std::fs::File;
use std::io::Read;

use anyhow::{Context, Result, anyhow, bail};

#[path = "../../race-core/tests/support/meta_parity.rs"]
mod checker;

/// The committed fixture.
pub const DEFAULT_FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../race-core/tests/fixtures/meta-parity.json.gz"
);

/// Runs every case in `fixture` (gzip or plain JSON); fails unless all pass.
pub fn run_meta(fixture: &str, show: usize) -> Result<()> {
    if !race_core::build_id::ENGINE_BUILD_TS_COMPAT {
        bail!(
            "race-core was built without `ts-compat`, so Chaos rank ties use byte order (D6 Phase B), not the TS localeCompare; rerun with `cargo run -p race-cli --features ts-compat -- oracle meta`"
        );
    }
    let mut file = File::open(fixture).with_context(|| format!("open {fixture}"))?;
    let mut json = Vec::new();
    if fixture.ends_with(".gz") {
        flate2::read::GzDecoder::new(file)
            .read_to_end(&mut json)
            .with_context(|| format!("gunzip {fixture}"))?;
    } else {
        file.read_to_end(&mut json)
            .with_context(|| format!("read {fixture}"))?;
    }
    let (fixture_data, report) = checker::run(&json, show).map_err(|error| anyhow!(error))?;

    println!(
        "fixture {fixture}: {} ({}, node {})",
        fixture_data.format, fixture_data.generator, fixture_data.node
    );
    for (file, sha) in &fixture_data.oracle_sha256 {
        println!("  oracle {file} sha256 {sha}");
    }
    println!(
        "catalog/presets/CHAOS_CARDS: {}",
        if report.catalog_ok { "match" } else { "DIFFER" }
    );
    for problem in &report.catalog_problems {
        println!("  {problem}");
    }
    for (kind, (passed, total)) in &report.by_kind {
        println!("{kind:>13}: {passed}/{total}");
    }
    let (passed, total) = report.total();
    println!("{:>13}: {passed}/{total}", "total");
    for mismatch in &report.mismatches {
        println!("  {mismatch}");
    }
    if report.passed() {
        Ok(())
    } else {
        bail!(
            "meta parity failed: {} of {total} cases differ{}",
            report.mismatch_count,
            if report.catalog_ok {
                ""
            } else {
                ", catalog differs"
            }
        )
    }
}
