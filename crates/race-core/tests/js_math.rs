//! `race_core::js_math` (feature `ts-compat`) vs Node 24, 1M generated
//! inputs per function plus edge cases, on every host fixture (D3, Phase 1
//! gate). Fixtures: `tests/fixtures/math-node24-<platform>-<arch>.json` from
//! `scripts/oracle/dump-math-fixtures.ts` (darwin-arm64 natively, Linux in
//! the official `node:24-bookworm-slim` image).
//!
//! Required to be bit-equal on every host:
//! - `Math.hypot` (2 and 3 args): host-independent.
//! - `Math.exp`: `exp_on(target)` (FMA contraction on arm64).
//! - `Math.pow` under `--no-use-std-math-pow`: `pow_legacy_on(target)`.
//! - `Math.pow` with default flags on Linux: `pow_on(target)` (glibc port).
//!
//! Measured, not required: `pow_on(DarwinArm64)` vs Node's default
//! `Math.pow` on macOS, which calls Apple's closed-source libm `pow`. The
//! mismatch count is pinned so that a change is noticed.
//!
//! Run with `-- --nocapture` to see the rates; set `RACE_MATH_FULL_DIR` to a
//! `--full-dir` dump root (`<root>/<platform>/<name>.bin`) for exact
//! per-input counts and failing samples.
#![cfg(feature = "ts-compat")]

#[path = "fixtures/math_gen.rs"]
mod math_gen;

use math_gen::{Fixture, Report, Stream, compare, load_all};
use race_core::js_math::{self, V8Target};

fn target(fixture: &Fixture) -> V8Target {
    V8Target::from_name(&fixture.host()).expect("supported host")
}

/// Print every host's report, then fail if any host is not bit-equal.
fn require_all(reports: &[Report]) {
    for r in reports {
        r.print();
    }
    let bad: Vec<&str> = reports
        .iter()
        .filter(|r| !r.all_equal())
        .map(|r| r.name.as_str())
        .collect();
    assert!(bad.is_empty(), "not bit-equal to Node: {bad:?}");
}

#[test]
fn hypot2_matches_node() {
    let reports: Vec<Report> = load_all()
        .iter()
        .map(|f| compare(f, "hypot2", Stream::Main, &|a| js_math::hypot2(a[0], a[1])))
        .collect();
    require_all(&reports);
}

#[test]
fn hypot3_matches_node() {
    let fixtures = load_all();
    let reports: Vec<Report> = fixtures
        .iter()
        .map(|f| {
            compare(f, "hypot3", Stream::Main, &|a| {
                js_math::hypot3(a[0], a[1], a[2])
            })
        })
        .collect();
    require_all(&reports);
    // The slice form is the same function.
    for f in &fixtures {
        assert!(compare(f, "hypot3", Stream::Main, &|a| js_math::hypot(a)).all_equal());
    }
}

#[test]
fn exp_matches_node() {
    let reports: Vec<Report> = load_all()
        .iter()
        .map(|f| {
            let t = target(f);
            compare(f, "exp", Stream::Main, &|a| js_math::exp_on(t, a[0]))
        })
        .collect();
    require_all(&reports);
}

#[test]
fn pow_legacy_matches_node_no_use_std_math_pow() {
    let reports: Vec<Report> = load_all()
        .iter()
        .map(|f| {
            let t = target(f);
            compare(f, "pow", Stream::Legacy, &|a| {
                js_math::pow_legacy_on(t, a[0], a[1])
            })
        })
        .collect();
    require_all(&reports);
}

#[test]
fn pow_matches_node_default_on_linux() {
    let reports: Vec<Report> = load_all()
        .iter()
        .filter(|f| !target(f).apple_libm())
        .map(|f| {
            let t = target(f);
            compare(f, "pow", Stream::Main, &|a| js_math::pow_on(t, a[0], a[1]))
        })
        .collect();
    require_all(&reports);
}

/// Exact count of generated pow inputs where `pow_on(DarwinArm64)` (the
/// glibc port) differs from Node's default `Math.pow` on darwin-arm64.
const DARWIN_POW_RESIDUAL: usize = 1255;

#[test]
fn pow_default_darwin_residual() {
    for f in load_all() {
        let t = target(&f);
        if !t.apple_libm() {
            continue;
        }
        let r = compare(&f, "pow", Stream::Main, &|a| js_math::pow_on(t, a[0], a[1]));
        r.print();
        if let Some(exact) = r.exact_mismatches {
            println!(
                "    pow_on(darwin-arm64) vs Apple libm pow: {exact} / {} differ ({:.4}%)",
                r.generated,
                100.0 * exact as f64 / r.generated as f64
            );
            assert_eq!(exact, DARWIN_POW_RESIDUAL, "darwin pow residual changed");
        } else {
            // Without the full dump only the chunk count is checkable.
            assert!(r.chunk_mismatches <= DARWIN_POW_RESIDUAL);
        }
        // How far Apple's pow is from V8's legacy pow, from the fixture.
        let d = f.functions["pow"].diff_vs_legacy.as_ref().unwrap();
        println!(
            "    Node default vs --no-use-std-math-pow on {}: {} / {} differ",
            f.host(),
            d.total,
            r.generated
        );
    }
}

type Check<'a> = (&'a str, Stream, &'a dyn Fn(&[f64]) -> f64);

/// Engine-shaped inputs must be exact on every host for the functions G1
/// depends on (exp, legacy pow, hypot), and the default pow on Linux.
#[test]
fn engine_segments_exact() {
    for f in load_all() {
        let t = target(&f);
        let checks: [Check<'_>; 3] = [
            ("exp", Stream::Main, &|a| js_math::exp_on(t, a[0])),
            ("pow", Stream::Legacy, &|a| {
                js_math::pow_legacy_on(t, a[0], a[1])
            }),
            ("hypot2", Stream::Main, &|a| js_math::hypot2(a[0], a[1])),
        ];
        for (name, stream, func) in checks {
            let r = compare(&f, name, stream, func);
            for (seg, (bad, _)) in &r.by_segment {
                if seg.starts_with("engine") {
                    assert_eq!(*bad, 0, "{} {name} segment {seg}", f.platform);
                }
            }
        }
    }
}

/// Review 2 finding 2: the host model picks the right `pow` and refuses to
/// claim exactness for darwin with the default std pow.
#[test]
fn oracle_host_selects_pow_variant() {
    use js_math::OracleHost;
    let darwin_std = OracleHost {
        target: V8Target::DarwinArm64,
        use_std_math_pow: true,
    };
    let darwin_legacy = OracleHost {
        target: V8Target::DarwinArm64,
        use_std_math_pow: false,
    };
    assert!(!darwin_std.is_exact());
    assert!(darwin_legacy.is_exact());
    for target in [
        V8Target::LinuxX64,
        V8Target::LinuxX64NoFma,
        V8Target::LinuxArm64,
    ] {
        assert!(
            OracleHost {
                target,
                use_std_math_pow: true
            }
            .is_exact()
        );
    }
    for k in [844.0, 1444.0, 2773.0, 3973.0] {
        let (x, y) = (0.5, k / 600.0);
        assert_eq!(
            darwin_legacy.pow(x, y).to_bits(),
            js_math::pow_legacy_on(V8Target::DarwinArm64, x, y).to_bits()
        );
        assert_eq!(
            darwin_std.pow(x, y).to_bits(),
            js_math::pow_on(V8Target::DarwinArm64, x, y).to_bits()
        );
    }
    let linux = OracleHost {
        target: V8Target::LinuxArm64,
        use_std_math_pow: true,
    };
    assert_eq!(
        linux.exp(-0.37).to_bits(),
        js_math::exp_on(V8Target::LinuxArm64, -0.37).to_bits()
    );
}
