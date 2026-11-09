//! `race_core::math` JS helpers vs Node 24 (D4(c)).
//!
//! 100k generated inputs per helper plus edge cases, compared bit for bit
//! with `Math.round`, `Math.sign`, `Math.max`, `Math.min` and the sign of a
//! `(a, b) => a - b` sort comparator, on every host fixture
//! (`tests/fixtures/math-node24-<platform>-<arch>.json`, from
//! `scripts/oracle/dump-math-fixtures.ts`). These helpers are
//! host-independent in V8, and the test checks that too.
//!
//! The libm wrappers (`exp`, `pow`, `hypot`, `sin`, `cos`) are also measured
//! against `Math.*` on the 1M-input streams and the rates printed
//! (informational: they are not V8's algorithms; see `js_math`). Run with
//! `-- --nocapture` to see the rates; set `RACE_MATH_FULL_DIR` to a
//! `--full-dir` dump root for exact per-input counts.

#[path = "fixtures/math_gen.rs"]
mod math_gen;

use math_gen::{Stream, compare, load_all};
use race_core::math;

fn check_exact(name: &str, f: &dyn Fn(&[f64]) -> f64) {
    for fixture in load_all() {
        let report = compare(&fixture, name, Stream::Main, f);
        report.print();
        assert!(
            report.all_equal(),
            "{name}: not bit-equal to Node on {}",
            fixture.host()
        );
    }
}

#[test]
fn js_round_matches_node() {
    check_exact("round", &|a| math::js_round(a[0]));
}

#[test]
fn js_sign_matches_node() {
    check_exact("sign", &|a| math::js_sign(a[0]));
}

#[test]
fn js_max_matches_node() {
    check_exact("max", &|a| math::js_max(a[0], a[1]));
}

#[test]
fn js_min_matches_node() {
    check_exact("min", &|a| math::js_min(a[0], a[1]));
}

#[test]
fn cmp_f64_js_matches_node() {
    check_exact("cmp", &|a| math::cmp_f64_js_sign(a[0], a[1]));
}

#[test]
fn js_max_of_min_of_clamp() {
    let nan = f64::NAN;
    assert!(math::js_max_of(&[1.0, nan, 3.0]).is_nan());
    assert!(math::js_min_of(&[-0.0, 0.0]).is_sign_negative());
    assert!(math::js_max_of(&[-0.0, 0.0]).is_sign_positive());
    assert_eq!(math::js_min_of(&[]).to_bits(), f64::INFINITY.to_bits());
    assert_eq!(math::js_clamp(5.0, 0.0, 1.0).to_bits(), 1.0f64.to_bits());
    assert!(math::js_clamp(nan, 0.0, 1.0).is_nan());
}

/// libm wrappers vs V8 (informational; prints the match rate, never fails on
/// a mismatch). The engine must use `js_math` where TS parity matters.
#[test]
fn libm_wrappers_vs_node_report() {
    for fixture in load_all() {
        println!(
            "libm wrappers vs Node {} (V8 {}, {}):",
            fixture.node,
            fixture.v8,
            fixture.host()
        );
        let reports = [
            compare(&fixture, "exp", Stream::Main, &|a| math::exp(a[0])),
            compare(&fixture, "pow", Stream::Main, &|a| math::pow(a[0], a[1])),
            compare(&fixture, "pow", Stream::Legacy, &|a| math::pow(a[0], a[1])),
            compare(&fixture, "hypot2", Stream::Main, &|a| {
                math::hypot(a[0], a[1])
            }),
            compare(&fixture, "sin", Stream::Main, &|a| math::sin(a[0])),
            compare(&fixture, "cos", Stream::Main, &|a| math::cos(a[0])),
        ];
        for r in &reports {
            r.print();
        }
    }
}

/// Pins the outputs of the `math` libm wrappers (the Phase B engine's math)
/// so any change in libm, its features or the target shows up: sha256 over
/// the canonical-NaN LE bits of each wrapper's outputs on a seeded 1M-input
/// stream (`math-gen-v1` segments; `atan2` and `ln` reuse the `hypot2` and
/// `exp` inputs). CI runs this natively on x86_64 and aarch64 and under
/// `wasm32-wasip1`, so the pins also prove native == wasm.
#[test]
fn libm_wrapper_outputs_are_pinned() {
    type F = fn(&[f64]) -> f64;
    let cases: [(&str, &str, u32, F, &str); 8] = [
        ("exp", "exp", 11, |a| math::exp(a[0]), PIN_EXP),
        ("pow", "pow", 12, |a| math::pow(a[0], a[1]), PIN_POW),
        (
            "hypot",
            "hypot2",
            13,
            |a| math::hypot(a[0], a[1]),
            PIN_HYPOT,
        ),
        ("sin", "sin", 14, |a| math::sin(a[0]), PIN_SIN),
        ("cos", "cos", 15, |a| math::cos(a[0]), PIN_COS),
        (
            "atan2",
            "hypot2",
            16,
            |a| math::atan2(a[1], a[0]),
            PIN_ATAN2,
        ),
        ("ln", "exp", 17, |a| math::ln(math::abs(a[0]) * 1e3), PIN_LN),
        (
            "sqrt",
            "hypot2",
            18,
            |a| math::sqrt(math::abs(a[0] * a[1])),
            PIN_SQRT,
        ),
    ];
    let mut failures = Vec::new();
    for (name, stream, seed, f, pin) in cases {
        let outputs: Vec<f64> = math_gen::generate(stream, seed)
            .iter()
            .map(|s| f(&s.args))
            .collect();
        let digest = math_gen::full_digest(&outputs);
        println!(
            "libm pin {name}: {} outputs, sha256 {digest}",
            outputs.len()
        );
        if digest != pin {
            failures.push(format!("{name}: {digest} != pinned {pin}"));
        }
    }
    assert!(
        failures.is_empty(),
        "libm wrapper outputs changed:\n{}",
        failures.join("\n")
    );
}

// Pinned on darwin-arm64 (Rust 1.99.1, libm 0.2.16 force-soft-floats); a
// change here is an engine change (bump RACE_BALANCE_VERSION/engine version).
const PIN_EXP: &str = "b26795e0fb460f68ea0e6806745f8f34124a2a1f7b1e243e93ac064290068dc9";
const PIN_POW: &str = "366c46e0e7a801abdbfb6d7864c8482d30a5e83871ac2b02a0b2a8187111c0bd";
const PIN_HYPOT: &str = "e7ab0e7fe2b77969348d999b53146a091a38ef11409ec6cb4f1fb0b2bd57c5b1";
const PIN_SIN: &str = "93287fed766a7d4ecc9bf2aadd8a3f2c4ce965e7dba9bdc24301334222d663ac";
const PIN_COS: &str = "91ca8eec4a443fd4c38336ca3bf0df5a49a35847b7cec9a57dea79a1eae1c820";
const PIN_ATAN2: &str = "0949e45ae3c60a170a6755f1091b245831aca3b7ee034ac12cb68e36bd153dd6";
const PIN_LN: &str = "312539d66c4f73e73778cdcc9372149c3ca9b9d8c2f418743282f3f8eba407d8";
const PIN_SQRT: &str = "36df613df61f4eb307ff5743ec13a656cb837d5629a06037be55186defa91637";

#[derive(serde::Deserialize)]
struct ClampFixture {
    values: Vec<String>,
    outputs: Vec<String>,
}

/// `js_clamp` vs the TS engine's `Math.max(minimum, Math.min(maximum, value))`
/// over every triple of 21 values (inverted and `(0, -0)` bounds included);
/// fixture from `scripts/oracle/dump-clamp-fixture.ts`. NaN canonicalised.
#[test]
fn js_clamp_matches_ts_clamp() {
    let fixture: ClampFixture =
        serde_json::from_str(include_str!("fixtures/clamp-node24.json")).expect("clamp fixture");
    let values: Vec<f64> = fixture
        .values
        .iter()
        .map(|h| math_gen::parse_hex(h))
        .collect();
    let mut index = 0;
    let mut mismatches = Vec::new();
    for &x in &values {
        for &lo in &values {
            for &hi in &values {
                let got = math_gen::hex(math::js_clamp(x, lo, hi));
                if got != fixture.outputs[index] {
                    mismatches.push(format!(
                        "clamp({x:e}, {lo:e}, {hi:e}) = {got}, TS {}",
                        fixture.outputs[index]
                    ));
                }
                index += 1;
            }
        }
    }
    assert_eq!(index, fixture.outputs.len());
    assert!(
        mismatches.is_empty(),
        "{} of {index} differ:\n{}",
        mismatches.len(),
        mismatches[..mismatches.len().min(20)].join("\n")
    );
}
