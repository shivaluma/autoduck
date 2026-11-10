//! `race-cli corpus pin`: (re)computes the pinned whole-race digests in
//! `crates/race-core/tests/fixtures/determinism-pinned.json` (D26; Phase 2
//! review 2 MAJOR 2).
//!
//! The fixture holds full-profile and items-profile corpus lines with, per
//! feature set, the digest of [`race_core::sim::digest_corpus_line`]:
//!
//! - `"default"`: the shipped engine (no `ts-compat`; libm maths, byte-order
//!   ids, version labels dropped). Phase B fixes change these, so every such
//!   commit reruns `cargo run -p race-cli -- corpus pin`.
//! - `"tsCompat"`: the TS-compat engine on the fixture's `tsCompatHost`. These
//!   came from the TS oracle trace (`dump-trace.ts`), so they only change if
//!   the faithful port does; `--features ts-compat -- corpus pin --check`
//!   verifies them.
//!
//! The same values are checked natively and under wasm32-wasip1 by
//! `cargo test -p race-core --test determinism_pinned`, and in Node by
//! `scripts/ci/wasm-determinism.mjs` through the shipped package.

use anyhow::{Context, Result, anyhow, bail};
use rayon::prelude::*;
use serde_json::Value;

/// The fixture key this build computes.
const KEY: &str = if race_core::build_id::ENGINE_BUILD_TS_COMPAT {
    "tsCompat"
} else {
    "default"
};

/// The engine maths for this build: the fixture's oracle host under
/// `ts-compat`, the libm wrappers otherwise.
#[cfg(feature = "ts-compat")]
fn math(fixture: &Value) -> Result<race_core::sim::EngineMath> {
    use race_core::js_math::{OracleHost, V8Target};
    let host = fixture
        .get("tsCompatHost")
        .ok_or_else(|| anyhow!("fixture has no tsCompatHost"))?;
    let field = |name: &str| {
        host.get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("tsCompatHost.{name} missing"))
    };
    let target = V8Target::from_node(field("platform")?, field("arch")?)
        .ok_or_else(|| anyhow!("tsCompatHost: no js_math model"))?;
    let use_std_math_pow = host
        .get("useStdMathPow")
        .and_then(Value::as_bool)
        .ok_or_else(|| anyhow!("tsCompatHost.useStdMathPow missing"))?;
    Ok(race_core::sim::EngineMath::oracle(OracleHost {
        target,
        use_std_math_pow,
    }))
}

#[cfg(not(feature = "ts-compat"))]
#[allow(clippy::unnecessary_wraps)]
fn math(_: &Value) -> Result<race_core::sim::EngineMath> {
    Ok(race_core::sim::EngineMath::default())
}

/// Recomputes this build's key for every case. With `check`, only compares
/// and fails on a difference; otherwise rewrites the fixture.
pub fn run_pin(path: &str, check: bool) -> Result<()> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {path}"))?;
    let mut fixture: Value =
        serde_json::from_str(&text).with_context(|| format!("parse {path}"))?;
    let math = math(&fixture)?;
    let cases = fixture
        .get_mut("cases")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| anyhow!("fixture has no cases array"))?;
    let digests: Vec<Result<Value>> = cases
        .par_iter()
        .map(|case| {
            let line = case
                .get("line")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("case without line"))?;
            let digest =
                race_core::sim::digest_corpus_line(line, math).map_err(|error| anyhow!(error))?;
            Ok(serde_json::to_value(digest)?)
        })
        .collect();
    let mut changed = 0usize;
    for (case, digest) in cases.iter_mut().zip(digests) {
        let id = case
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("?")
            .to_owned();
        let digest = digest.with_context(|| format!("case {id}"))?;
        let object = case
            .as_object_mut()
            .ok_or_else(|| anyhow!("case {id} is not an object"))?;
        if object.get(KEY) != Some(&digest) {
            changed += 1;
            if check {
                eprintln!("  case {id}: {KEY} differs");
            }
            object.insert(KEY.to_owned(), digest);
        }
    }
    let total = cases.len();
    if check {
        if changed > 0 {
            bail!("{changed}/{total} {KEY} digests differ from {path}");
        }
        println!("corpus pin --check: {total}/{total} {KEY} digests match {path}");
        return Ok(());
    }
    let mut out = serde_json::to_string_pretty(&fixture)?;
    out.push('\n');
    std::fs::write(path, out).with_context(|| format!("write {path}"))?;
    println!("corpus pin: {changed}/{total} {KEY} digests updated in {path}");
    Ok(())
}
