//! JS-semantics float helpers and libm wrappers (D4(a), D4(c)).
//!
//! `f64::{max,min,signum,clamp,total_cmp,mul_add}` are banned by clippy in
//! this crate because their NaN/±0 semantics differ from JavaScript or
//! because they may fuse operations. The helpers below reproduce V8 exactly
//! (verified against Node 24 in `tests/math.rs`).
//!
//! Transcendentals go through `libm` built with `force-soft-floats` and
//! without the `arch` feature, so native and wasm builds call the same pure
//! Rust code and produce the same bits. These wrappers are *not* V8's
//! algorithms: `libm::{exp,pow,hypot}` differ from `Math.{exp,pow,hypot}` in
//! the last place for some inputs. For bit parity with the TS oracle, use
//! `crate::js_math` (feature `ts-compat`). See `docs/rewrite/phase1-notes.md`
//! ("## math") for measured match rates.
//!
//! **NaN payloads.** Every helper returns *a* NaN where JS does, but not
//! necessarily V8's payload or sign bit (V8 may return `0xfffe…` where these
//! return `0x7ff8…` or an unquieted input payload; x86_64 and aarch64 also
//! differ in the sign of a freshly produced NaN). Never compare engine floats
//! with raw `to_bits()`/`is_sign_*()` outside
//! [`crate::hash::canonical_f64_bits`], which maps every NaN to one pattern.

use core::cmp::Ordering;

/// JavaScript `Math.round`: rounds half toward +∞.
///
/// Port of V8's `Float64Round` (CSA): `c = ceil(x); if c - 0.5 > x { c - 1 }`.
/// This is exact for every input: `0.49999999999999994 → 0`, `-0.5 → -0`,
/// `-0.3 → -0`, `2.5 → 3`, `-2.5 → -2`; values with |x| ≥ 2^52, ±∞, ±0 and
/// NaN are returned unchanged (NaN stays NaN).
#[inline]
#[must_use]
pub fn js_round(x: f64) -> f64 {
    let c = libm::ceil(x);
    if c - 0.5 > x { c - 1.0 } else { c }
}

/// JavaScript `Math.max(a, b)`: NaN if either argument is NaN, and
/// `max(+0, -0) = max(-0, +0) = +0`.
#[inline]
#[must_use]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a > b {
        a
    } else if b > a {
        b
    } else if a.is_sign_negative() {
        // a == b; only ±0 can differ. Prefer +0.
        b
    } else {
        a
    }
}

/// JavaScript `Math.min(a, b)`: NaN if either argument is NaN, and
/// `min(+0, -0) = min(-0, +0) = -0`.
#[inline]
#[must_use]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a < b {
        a
    } else if b < a {
        b
    } else if a.is_sign_negative() {
        // a == b; only ±0 can differ. Prefer -0.
        a
    } else {
        b
    }
}

/// JavaScript `Math.max(...values)`; `-∞` for an empty slice.
#[must_use]
pub fn js_max_of(values: &[f64]) -> f64 {
    values
        .iter()
        .fold(f64::NEG_INFINITY, |acc, &v| js_max(acc, v))
}

/// JavaScript `Math.min(...values)`; `+∞` for an empty slice.
#[must_use]
pub fn js_min_of(values: &[f64]) -> f64 {
    values.iter().fold(f64::INFINITY, |acc, &v| js_min(acc, v))
}

/// The TS engine's `clamp(value, minimum, maximum)`, which every TS module
/// spells `Math.max(minimum, Math.min(maximum, value))` (`simulation.ts`,
/// `track.ts`, `evaluate.ts`, `pickups/engine.ts`, `aim.ts`).
///
/// The nesting matters: with inverted bounds (`lo > hi`) the result is `lo`,
/// and `clamp(x, 0, -0)` is `+0` for every non-NaN `x`. NaN in any argument
/// gives NaN.
#[inline]
#[must_use]
pub fn js_clamp(x: f64, lo: f64, hi: f64) -> f64 {
    js_max(lo, js_min(hi, x))
}

/// JavaScript `Math.sign`: `-1`, `+1`, or the argument itself for ±0 and NaN.
#[inline]
#[must_use]
pub fn js_sign(x: f64) -> f64 {
    if x > 0.0 {
        1.0
    } else if x < 0.0 {
        -1.0
    } else {
        // ±0 keeps its sign; NaN stays NaN.
        x
    }
}

/// Comparator matching a JS sort callback `(a, b) => a - b`.
///
/// Returns the sign of `a - b`, and `Equal` when `a - b` is NaN, which is
/// how `Array.prototype.sort` treats a NaN comparator result (it becomes
/// `+0`). Consequences, all identical to JS:
/// - `-0` and `+0` compare `Equal`;
/// - `+∞` vs `+∞` (and `-∞` vs `-∞`) is `Equal` (`∞ - ∞` is NaN);
/// - a NaN compares `Equal` to everything.
///
/// The last point means this is **not** a total order when NaN is present:
/// it is not transitive (`1 < 2`, but both "equal" NaN). Rust's `sort_by`
/// may then produce an order different from V8's `TimSort`, and since Rust
/// 1.81 it may panic on a detected order violation. Callers must keep NaN
/// out of sorted keys (the engine never produces NaN progress or distance).
/// For descending order use `cmp_f64_js(b, a)`, which is `(a, b) => b - a`.
/// A JS `x - y || tieBreak` chain maps to `cmp_f64_js(x, y).then_with(..)`:
/// `||` falls through on `0`, `-0` and NaN, exactly the `Equal` cases.
#[inline]
#[must_use]
pub fn cmp_f64_js(a: f64, b: f64) -> Ordering {
    let d = a - b;
    if d < 0.0 {
        Ordering::Less
    } else if d > 0.0 {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}

/// [`cmp_f64_js`] as the number a JS comparator effectively returns
/// (`-1`, `0` or `1`).
#[inline]
#[must_use]
pub fn cmp_f64_js_sign(a: f64, b: f64) -> f64 {
    match cmp_f64_js(a, b) {
        Ordering::Less => -1.0,
        Ordering::Equal => 0.0,
        Ordering::Greater => 1.0,
    }
}

/// Stable ascending sort by an `f64` key with JS `(a, b) => key(a) - key(b)`
/// semantics, refusing NaN keys up front.
///
/// [`cmp_f64_js`] is not a total order when a key is NaN, and Rust's
/// `sort_by` may then panic part-way ("does not correctly implement a total
/// order") or order differently from V8. Checking first makes the failure
/// immediate and identical on every target (native unwinds; the browser
/// build aborts). Use this instead of a bare `sort_by` on float keys.
///
/// # Panics
/// If any key is NaN.
pub fn sort_by_f64_key<T>(items: &mut [T], key: impl Fn(&T) -> f64) {
    assert_no_nan_keys(items, &key);
    items.sort_by(|a, b| cmp_f64_js(key(a), key(b)));
}

/// Like [`sort_by_f64_key`], descending (`(a, b) => key(b) - key(a)`).
///
/// # Panics
/// If any key is NaN.
pub fn sort_by_f64_key_desc<T>(items: &mut [T], key: impl Fn(&T) -> f64) {
    assert_no_nan_keys(items, &key);
    items.sort_by(|a, b| cmp_f64_js(key(b), key(a)));
}

/// Like [`sort_by_f64_key`], with a tie-break for `Equal` keys (the JS
/// `key(a) - key(b) || tieBreak(a, b)` form).
///
/// # Panics
/// If any key is NaN.
pub fn sort_by_f64_key_then<T>(
    items: &mut [T],
    key: impl Fn(&T) -> f64,
    mut tie_break: impl FnMut(&T, &T) -> Ordering,
) {
    assert_no_nan_keys(items, &key);
    items.sort_by(|a, b| cmp_f64_js(key(a), key(b)).then_with(|| tie_break(a, b)));
}

fn assert_no_nan_keys<T>(items: &[T], key: &impl Fn(&T) -> f64) {
    for (index, item) in items.iter().enumerate() {
        assert!(
            !key(item).is_nan(),
            "sort_by_f64_key: NaN key at index {index}"
        );
    }
}

// ---------------------------------------------------------------------------
// libm wrappers (soft-float, identical on every target).
// ---------------------------------------------------------------------------

/// Correctly rounded square root (`Math.sqrt` agrees for every input).
#[inline]
#[must_use]
pub fn sqrt(x: f64) -> f64 {
    libm::sqrt(x)
}

/// `e^x` (libm/musl algorithm; not bit-identical to `Math.exp`).
#[inline]
#[must_use]
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}

/// `x^y` (libm/FreeBSD algorithm with C99 special cases: `pow(1, NaN) = 1`
/// and `pow(±1, ±∞) = 1`, where JS gives NaN; not bit-identical to
/// `Math.pow`).
#[inline]
#[must_use]
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

/// `sqrt(x² + y²)` without undue overflow (libm algorithm; not
/// bit-identical to `Math.hypot`).
#[inline]
#[must_use]
pub fn hypot(x: f64, y: f64) -> f64 {
    libm::hypot(x, y)
}

/// Sine (libm, fdlibm-derived).
#[inline]
#[must_use]
pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

/// Cosine (libm, fdlibm-derived).
#[inline]
#[must_use]
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

/// `atan2(y, x)` (libm, fdlibm-derived).
#[inline]
#[must_use]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

/// Natural logarithm (libm).
#[inline]
#[must_use]
pub fn ln(x: f64) -> f64 {
    libm::log(x)
}

/// `Math.floor` (exact).
#[inline]
#[must_use]
pub fn floor(x: f64) -> f64 {
    libm::floor(x)
}

/// `Math.ceil` (exact).
#[inline]
#[must_use]
pub fn ceil(x: f64) -> f64 {
    libm::ceil(x)
}

/// `Math.trunc` (exact).
#[inline]
#[must_use]
pub fn trunc(x: f64) -> f64 {
    libm::trunc(x)
}

/// `Math.abs` (exact; clears the sign bit).
#[inline]
#[must_use]
pub fn abs(x: f64) -> f64 {
    libm::fabs(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_half_cases() {
        assert_eq!(js_round(0.499_999_999_999_999_94).to_bits(), 0);
        assert_eq!(js_round(-0.5).to_bits(), (-0.0f64).to_bits());
        assert_eq!(js_round(2.5).to_bits(), 3.0f64.to_bits());
        assert_eq!(js_round(-2.5).to_bits(), (-2.0f64).to_bits());
        assert_eq!(
            js_round(4_503_599_627_370_497.0).to_bits(),
            4_503_599_627_370_497.0f64.to_bits()
        );
        assert!(js_round(f64::NAN).is_nan());
    }

    #[test]
    fn max_min_zero_sign() {
        assert!(js_max(-0.0, 0.0).is_sign_positive());
        assert!(js_max(0.0, -0.0).is_sign_positive());
        assert!(js_min(-0.0, 0.0).is_sign_negative());
        assert!(js_min(0.0, -0.0).is_sign_negative());
        assert!(js_max(1.0, f64::NAN).is_nan());
        assert!(js_min(f64::NAN, 1.0).is_nan());
        assert_eq!(js_max_of(&[]).to_bits(), f64::NEG_INFINITY.to_bits());
    }

    #[test]
    fn clamp_matches_ts_nesting() {
        // TS: Math.max(lo, Math.min(hi, x)).
        assert_eq!(js_clamp(-2.0, -1.0, -2.0).to_bits(), (-1.0f64).to_bits());
        assert_eq!(js_clamp(5.0, 2.0, 1.0).to_bits(), 2.0f64.to_bits());
        assert_eq!(js_clamp(0.0, 2.0, 1.0).to_bits(), 2.0f64.to_bits());
        for x in [-1.0, -0.0, 0.0, 1.0, f64::INFINITY, f64::NEG_INFINITY] {
            assert_eq!(js_clamp(x, 0.0, -0.0).to_bits(), 0.0f64.to_bits(), "x={x}");
        }
        assert!(js_clamp(1.0, f64::NAN, 2.0).is_nan());
    }

    #[test]
    fn f64_key_sorts() {
        let mut v = [(3.0, 'a'), (-0.0, 'b'), (1.0, 'c'), (0.0, 'd'), (1.0, 'e')];
        sort_by_f64_key(&mut v, |p| p.0);
        assert_eq!(v.map(|p| p.1), ['b', 'd', 'c', 'e', 'a']);
        sort_by_f64_key_desc(&mut v, |p| p.0);
        assert_eq!(v.map(|p| p.1), ['a', 'c', 'e', 'b', 'd']);
        sort_by_f64_key_then(&mut v, |p| p.0, |a, b| b.1.cmp(&a.1));
        assert_eq!(v.map(|p| p.1), ['d', 'b', 'e', 'c', 'a']);
    }

    #[test]
    #[should_panic(expected = "NaN key")]
    fn f64_key_sort_refuses_nan() {
        let mut v = [1.0, f64::NAN, 0.0];
        sort_by_f64_key(&mut v, |x| *x);
    }

    #[test]
    fn sign_and_cmp() {
        assert!(js_sign(-0.0).is_sign_negative());
        assert_eq!(js_sign(-3.0).to_bits(), (-1.0f64).to_bits());
        assert_eq!(cmp_f64_js(f64::NAN, 1.0), Ordering::Equal);
        assert_eq!(cmp_f64_js(f64::INFINITY, f64::INFINITY), Ordering::Equal);
        assert_eq!(cmp_f64_js(f64::NEG_INFINITY, f64::INFINITY), Ordering::Less);
    }
}
