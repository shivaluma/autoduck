//! `race-cli golden`: the frozen golden digests behind the `golden-version`
//! CI job (plan §3 Phase 6, D4, D26).
//!
//! `crates/race-core/tests/fixtures/golden-digests.json` freezes, per
//! version key (engine, balance, track, pickup-spawn and hazard versions),
//! the whole-race digest of every case of the determinism fixture
//! (`determinism-pinned.json`, default build) and the sha256 of
//! `rust-toolchain.toml`.
//!
//! `golden check` fails when:
//! - the current version key has no frozen entry (a version bump must be
//!   frozen with `golden freeze`),
//! - any digest differs from the frozen one (engine output changed without
//!   a version bump), or a case line changed,
//! - `rust-toolchain.toml` differs from the frozen hash (a toolchain bump is
//!   an engine change, D4: rerun `golden freeze`, which only records the new
//!   hash if every digest still matches).
//!
//! `golden freeze` adds the current key, or refreshes the toolchain hash of
//! an existing key whose digests all match. It never rewrites a frozen
//! digest. Old keys stay as history.

use std::collections::BTreeMap;

use anyhow::{Context, Result, anyhow, bail};
use race_protocol::versions;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const DEFAULT_FIXTURE: &str = "crates/race-core/tests/fixtures/golden-digests.json";
pub const DEFAULT_CASES: &str = "crates/race-core/tests/fixtures/determinism-pinned.json";
pub const DEFAULT_TOOLCHAIN: &str = "rust-toolchain.toml";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenCase {
    id: String,
    line_sha256: String,
    digest_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenEntry {
    toolchain_sha256: String,
    cases: Vec<GoldenCase>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFixture {
    about: String,
    versions: BTreeMap<String, GoldenEntry>,
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

fn sha256(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

/// The version key of this build.
pub fn version_key() -> String {
    format!(
        "engine={} balance={} track={} pickups={} hazards={}",
        versions::RACE_ENGINE_VERSION,
        versions::RACE_BALANCE_VERSION,
        versions::TRACK_VERSION,
        versions::PICKUP_SPAWN_VERSION,
        versions::HAZARD_BALANCE_VERSION
    )
}

/// Digests of every case line of `cases_path` with the shipped engine.
fn compute(cases_path: &str) -> Result<Vec<GoldenCase>> {
    if race_core::build_id::ENGINE_BUILD_TS_COMPAT {
        bail!(
            "golden digests are for the shipped engine: build race-cli without race-core/ts-compat"
        );
    }
    let text = std::fs::read_to_string(cases_path).with_context(|| format!("read {cases_path}"))?;
    let fixture: Value =
        serde_json::from_str(&text).with_context(|| format!("parse {cases_path}"))?;
    let cases = fixture
        .get("cases")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("{cases_path} has no cases array"))?;
    cases
        .par_iter()
        .map(|case| {
            let id = case
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("case without id"))?;
            let line = case
                .get("line")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("case {id} without line"))?;
            let digest =
                race_core::sim::digest_corpus_line(line, race_core::sim::EngineMath::default())
                    .map_err(|error| anyhow!("case {id}: {error}"))?;
            let jcs = race_core::serde_jcs::to_jcs_string(&digest)
                .map_err(|error| anyhow!("case {id}: {error}"))?;
            Ok(GoldenCase {
                id: id.to_owned(),
                line_sha256: sha256(line.as_bytes()),
                digest_sha256: sha256(jcs.as_bytes()),
            })
        })
        .collect()
}

fn read_fixture(path: &str) -> Result<GoldenFixture> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).with_context(|| format!("parse {path}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(GoldenFixture {
            about: String::new(),
            versions: BTreeMap::new(),
        }),
        Err(error) => Err(error).with_context(|| format!("read {path}")),
    }
}

/// Lists the cases whose digest or line differs.
fn diff(frozen: &[GoldenCase], now: &[GoldenCase]) -> Vec<String> {
    let mut out = Vec::new();
    if frozen.len() != now.len() {
        out.push(format!("{} frozen cases, {} now", frozen.len(), now.len()));
    }
    for (a, b) in frozen.iter().zip(now) {
        if a.id != b.id || a.line_sha256 != b.line_sha256 {
            out.push(format!("case {} -> {}: line changed", a.id, b.id));
        } else if a.digest_sha256 != b.digest_sha256 {
            out.push(format!("case {}: digest changed", a.id));
        }
    }
    out
}

/// `race-cli golden check`.
pub fn check(fixture_path: &str, cases_path: &str, toolchain_path: &str) -> Result<()> {
    let fixture = read_fixture(fixture_path)?;
    let key = version_key();
    let toolchain =
        sha256(&std::fs::read(toolchain_path).with_context(|| format!("read {toolchain_path}"))?);
    let entry = fixture.versions.get(&key).ok_or_else(|| {
        anyhow!(
            "no frozen golden for `{key}`: freeze the new version with \
             `cargo run -p race-cli --release -- golden freeze`"
        )
    })?;
    let now = compute(cases_path)?;
    let changed = diff(&entry.cases, &now);
    if !changed.is_empty() {
        for line in changed.iter().take(10) {
            eprintln!("  {line}");
        }
        bail!(
            "{} golden case(s) differ for `{key}`: engine output changed without a version bump \
             (bump RACE_BALANCE_VERSION or RACE_ENGINE_VERSION, then `golden freeze`)",
            changed.len()
        );
    }
    if entry.toolchain_sha256 != toolchain {
        bail!(
            "{toolchain_path} changed since `{key}` was frozen (a toolchain bump is an engine \
             change, D4): rerun `golden freeze` to record it once every digest still matches"
        );
    }
    println!(
        "golden check: {}/{} digests match `{key}`, toolchain unchanged",
        now.len(),
        now.len()
    );
    Ok(())
}

/// `race-cli golden freeze`.
pub fn freeze(fixture_path: &str, cases_path: &str, toolchain_path: &str) -> Result<()> {
    let mut fixture = read_fixture(fixture_path)?;
    let key = version_key();
    let toolchain =
        sha256(&std::fs::read(toolchain_path).with_context(|| format!("read {toolchain_path}"))?);
    let now = compute(cases_path)?;
    if let Some(entry) = fixture.versions.get_mut(&key) {
        let changed = diff(&entry.cases, &now);
        if !changed.is_empty() {
            bail!(
                "`{key}` is frozen and {} case(s) differ: a frozen golden is never rewritten, \
                 bump the version instead",
                changed.len()
            );
        }
        entry.toolchain_sha256 = toolchain;
        println!("golden freeze: `{key}` digests match; toolchain hash recorded");
    } else {
        fixture.versions.insert(
            key.clone(),
            GoldenEntry {
                toolchain_sha256: toolchain,
                cases: now,
            },
        );
        println!("golden freeze: froze `{key}`");
    }
    fixture.about = "Frozen whole-race digests per engine/balance version (race-cli golden; \
        the golden-version CI job). Cases: the lines of determinism-pinned.json, shipped engine \
        (no ts-compat). digestSha256 = sha256 of the JCS of race_core::sim::CaseDigest. A frozen \
        entry is never rewritten: changing engine output needs a version bump and a new entry."
        .to_owned();
    let mut out = serde_json::to_string_pretty(&fixture)?;
    out.push('\n');
    std::fs::write(fixture_path, out).with_context(|| format!("write {fixture_path}"))?;
    Ok(())
}
