//! V8-compatible `Math.{hypot,exp,pow}` for the TS oracle (D3, feature
//! `ts-compat`).
//!
//! These reproduce what Node 24 (V8 13.6) computes, bit for bit, so the
//! Phase A port can be diffed against the TS engine (gate G1). The engine
//! call sites that matter are `pickups/engine.ts:319-320` (`Math.hypot` of
//! small deltas), `chaos-utility.ts:107,131` (`Math.exp(-gap / 0.02)`) and
//! `brain.ts:114` (`Math.pow(0.5, ticks / 600)`).
//!
//! V8's results are **host-dependent**, so every function that can differ
//! takes a [`V8Target`]:
//!
//! - The compiler may fuse `a * b + c` into an FMA on arm64 (never on
//!   baseline x86-64). macOS Node is built by Apple clang
//!   (`-ffp-contract=on`: within one C expression); Linux Node and glibc by
//!   gcc (`-ffp-contract=fast`: also across statements, when every use of
//!   the product is an add in the same basic block). That changes `exp` and
//!   the legacy `pow` in the last bit for ~0.04% / ~0.03% of inputs.
//! - `Math.pow` defaults to `--use-std-math-pow` in V8 13.6, i.e. the host C
//!   library's `pow`: glibc on Linux (ported here, both its FMA build and its
//!   portable build), Apple's closed-source libm on macOS (not portable;
//!   [`pow_on`] for [`V8Target::DarwinArm64`] uses the glibc port and
//!   carries a measured 0.13% residual).
//! - V8's legacy `pow` (`--no-use-std-math-pow`) calls the C library's
//!   `scalbn` for subnormal results; Apple's double-rounds there.
//!
//! What each function ports:
//!
//! - [`hypot`]: V8's Torque `MathHypot`/`FastMathHypot` (`src/builtins/
//!   math.tq`): max-scaling plus a compensated sum. Host-independent (CSA
//!   code, no C++ contraction).
//! - [`exp_on`]: `base::ieee754::exp` (FreeBSD msun `e_exp.c` with V8's
//!   `exp(1) == E` special case and `twopk` scaling).
//! - [`pow_legacy_on`]: `base::ieee754::legacy::pow` (fdlibm `e_pow.c` with
//!   ECMAScript special cases and V8's misplaced parenthesis in the final
//!   `r` term, ported as is).
//! - [`pow_on`]: `v8::internal::math::pow` with the default flag: the
//!   ECMAScript special cases in `src/numbers/ieee754.cc`, then the host
//!   `pow`.
//!
//! Everything uses plain `+ - * /` on `f64`, integer bit manipulation and
//! the software `libm::{fma,sqrt,scalbn}`, so a given target's results are
//! identical natively and on wasm. Verified against Node 24 on 1M inputs per
//! function and host in `tests/js_math.rs`; rates are in
//! `docs/rewrite/phase1-notes.md` ("## math").

/// The Node 24 build (and CPU) whose `Math.*` results are reproduced.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum V8Target {
    /// `linux-x64` on a CPU with FMA (every x86-64 server since ~2013; the
    /// production image and CI): V8 without contraction, glibc's FMA `pow`.
    LinuxX64,
    /// `linux-x64` on a CPU without FMA: glibc's portable `pow`. Not
    /// detectable from `process.arch`; select it explicitly.
    LinuxX64NoFma,
    /// `linux-arm64`: gcc contraction, glibc's FMA `pow`.
    LinuxArm64,
    /// `darwin-arm64` (Apple silicon dev machines): clang contraction, Apple
    /// libm (`pow` not portable, `scalbn` double-rounds).
    DarwinArm64,
}

impl V8Target {
    /// The oracle host used when nothing else is specified: the production
    /// platform.
    pub const DEFAULT: Self = Self::LinuxX64;

    /// Every supported target.
    pub const ALL: [Self; 4] = [
        Self::LinuxX64,
        Self::LinuxX64NoFma,
        Self::LinuxArm64,
        Self::DarwinArm64,
    ];

    /// From Node's `process.platform` and `process.arch` (an x86-64 Linux
    /// host is assumed to have FMA).
    #[must_use]
    pub fn from_node(platform: &str, arch: &str) -> Option<Self> {
        match (platform, arch) {
            ("linux", "x64") => Some(Self::LinuxX64),
            ("linux", "arm64") => Some(Self::LinuxArm64),
            ("darwin", "arm64") => Some(Self::DarwinArm64),
            _ => None,
        }
    }

    /// `"<platform>-<arch>[-<variant>]"`, e.g. `"linux-x64"` or
    /// `"linux-x64-nofma"` (the fixture naming).
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::LinuxX64 => "linux-x64",
            Self::LinuxX64NoFma => "linux-x64-nofma",
            Self::LinuxArm64 => "linux-arm64",
            Self::DarwinArm64 => "darwin-arm64",
        }
    }

    /// Inverse of [`V8Target::name`].
    #[must_use]
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.name() == name)
    }

    /// Whether the compiler fused `a * b + c` into FMAs in V8's C++.
    #[must_use]
    pub const fn fp_contract(self) -> bool {
        matches!(self, Self::LinuxArm64 | Self::DarwinArm64)
    }

    /// Whether the C library is Apple's libm.
    #[must_use]
    pub const fn apple_libm(self) -> bool {
        matches!(self, Self::DarwinArm64)
    }
}

/// The oracle host a TS trace was produced on: the [`V8Target`] plus V8's
/// `--use-std-math-pow` flag. `race-cli oracle diff` builds it from the
/// trace header (`scripts/oracle/dump-trace.ts`, review 2 finding 2) and
/// Phase 2 threads it through the sim options, so engine code never calls
/// the host-blind [`exp`]/[`pow`] defaults.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OracleHost {
    pub target: V8Target,
    /// `true` (V8's default): `Math.pow` uses the host C library
    /// ([`pow_on`]); `false` (`--no-use-std-math-pow`): fdlibm
    /// ([`pow_legacy_on`]).
    pub use_std_math_pow: bool,
}

impl OracleHost {
    /// Whether every `js_math` function reproduces this host bit for bit on
    /// the Phase 1 fixtures. `false` only for darwin with the default std
    /// `pow` (Apple's `pow` is not portable: 0.13% of inputs, and grudge
    /// decay `pow(0.5, k/600)` hits it from k = 844). `oracle diff` refuses
    /// such a host.
    #[must_use]
    pub const fn is_exact(self) -> bool {
        !(self.use_std_math_pow && self.target.apple_libm())
    }

    /// `Math.exp(x)` on this host.
    #[inline]
    #[must_use]
    pub fn exp(self, x: f64) -> f64 {
        exp_on(self.target, x)
    }

    /// `Math.pow(x, y)` (and `x ** y`) on this host.
    #[inline]
    #[must_use]
    pub fn pow(self, x: f64, y: f64) -> f64 {
        if self.use_std_math_pow {
            pow_on(self.target, x, y)
        } else {
            pow_legacy_on(self.target, x, y)
        }
    }

    /// `Math.hypot(a, b)` (host-independent).
    #[inline]
    #[must_use]
    pub fn hypot2(self, a: f64, b: f64) -> f64 {
        hypot2(a, b)
    }
}

#[inline]
fn hi_word(x: f64) -> i32 {
    (x.to_bits() >> 32) as i32
}

#[inline]
fn lo_word(x: f64) -> u32 {
    x.to_bits() as u32
}

#[inline]
fn from_words(hi: u32, lo: u32) -> f64 {
    f64::from_bits((u64::from(hi) << 32) | u64::from(lo))
}

#[inline]
fn with_hi(x: f64, hi: u32) -> f64 {
    from_words(hi, lo_word(x))
}

#[inline]
fn with_lo(x: f64, lo: u32) -> f64 {
    from_words(hi_word(x) as u32, lo)
}

/// `a * b + c`, either with two roundings (`FUSED = false`, what the C++
/// source says) or as one fused multiply-add (`FUSED = true`, what clang's
/// `-ffp-contract=on` emits for `a * b + c` inside one expression on arm64).
/// `libm::fma` is a software FMA, so both forms are deterministic everywhere.
#[inline(always)]
fn madd<const FUSED: bool>(a: f64, b: f64, c: f64) -> f64 {
    if FUSED { libm::fma(a, b, c) } else { a * b + c }
}

// ---------------------------------------------------------------------------
// Math.hypot
// ---------------------------------------------------------------------------

/// `Math.hypot(...values)` exactly as V8's Torque `MathHypot`:
///
/// ```text
/// max = 0; oneArgIsNaN = false
/// for v: if NaN(v) oneArgIsNaN = true else { a = |v|; if a > max: max = a }
/// if max == ∞ return ∞; if oneArgIsNaN return NaN; if max == 0 return 0
/// sum = 0; c = 0
/// for v: n = |v| / max; s = n*n - c; p = sum + s; c = (p - sum) - s; sum = p
/// return sqrt(sum) * max
/// ```
///
/// V8 13.6 runs `FastMathHypot` for up to three arguments
/// (`sqrt((a/m)*(a/m) + (b/m)*(b/m)) * m`, and for three arguments a single
/// compensation step); for those arities it performs exactly the same
/// operations in the same order as the loop above, including the `∞`-before-
/// NaN ordering. The empty and all-zero calls return `+0`.
#[must_use]
pub fn hypot(values: &[f64]) -> f64 {
    let mut max = 0.0f64;
    let mut one_arg_is_nan = false;
    for &v in values {
        if v.is_nan() {
            one_arg_is_nan = true;
        } else {
            let a = libm::fabs(v);
            if a > max {
                max = a;
            }
        }
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if one_arg_is_nan {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut compensation = 0.0f64;
    for &v in values {
        let n = libm::fabs(v) / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    libm::sqrt(sum) * max
}

/// `Math.hypot(a, b)`.
#[inline]
#[must_use]
pub fn hypot2(a: f64, b: f64) -> f64 {
    hypot(&[a, b])
}

/// `Math.hypot(a, b, c)`.
#[inline]
#[must_use]
pub fn hypot3(a: f64, b: f64, c: f64) -> f64 {
    hypot(&[a, b, c])
}

// ---------------------------------------------------------------------------
// Math.exp — V8 base::ieee754::exp (FreeBSD e_exp.c)
// ---------------------------------------------------------------------------

const EXP_HALF: [f64; 2] = [0.5, -0.5];
const EXP_O_THRESHOLD: f64 = f64::from_bits(0x4086_2e42_fefa_39ef);
const EXP_U_THRESHOLD: f64 = f64::from_bits(0xc087_4910_d52d_3051);
const EXP_LN2_HI: [f64; 2] = [
    f64::from_bits(0x3fe6_2e42_fee0_0000),
    f64::from_bits(0xbfe6_2e42_fee0_0000),
];
const EXP_LN2_LO: [f64; 2] = [
    f64::from_bits(0x3dea_39ef_3579_3c76),
    f64::from_bits(0xbdea_39ef_3579_3c76),
];
const EXP_INVLN2: f64 = f64::from_bits(0x3ff7_1547_652b_82fe);
const P1: f64 = f64::from_bits(0x3fc5_5555_5555_553e);
const P2: f64 = f64::from_bits(0xbf66_c16c_16be_bd93);
const P3: f64 = f64::from_bits(0x3f11_566a_af25_de2c);
const P4: f64 = f64::from_bits(0xbebb_bd41_c5d2_6bf1);
const P5: f64 = f64::from_bits(0x3e66_3769_72be_a4d0);
const EXP_E: f64 = f64::from_bits(0x4005_bf0a_8b14_5769);
const EXP_HUGE: f64 = 1.0e300;
const EXP_TWOM1000: f64 = f64::from_bits(0x0170_0000_0000_0000);
const EXP_TWO1023: f64 = f64::from_bits(0x7fe0_0000_0000_0000);

/// `Math.exp(x)` on [`V8Target::DEFAULT`] (linux-x64). For tests and
/// tools only: results differ on other hosts (495 / 1M engine-shaped inputs
/// vs linux-arm64), so engine code must use [`OracleHost::exp`].
#[inline]
#[must_use]
pub fn exp(x: f64) -> f64 {
    exp_on(V8Target::DEFAULT, x)
}

/// `Math.exp(x)` as Node 24 computes it on `target`: V8's
/// `base::ieee754::exp`, with FMA contraction on arm64 hosts. (gcc's
/// cross-statement fusion finds nothing extra here: the candidates are in
/// different basic blocks.)
#[inline]
#[must_use]
pub fn exp_on(target: V8Target, x: f64) -> f64 {
    if target.fp_contract() {
        exp_impl::<true>(x)
    } else {
        exp_impl::<false>(x)
    }
}

fn exp_impl<const F: bool>(x: f64) -> f64 {
    let mut x = x;
    let mut hx = hi_word(x) as u32;
    let xsb = ((hx >> 31) & 1) as usize; // sign bit of x
    hx &= 0x7fff_ffff; // high word of |x|

    // Filter out non-finite argument.
    if hx >= 0x4086_2E42 {
        // |x| >= 709.78...
        if hx >= 0x7FF0_0000 {
            if ((hx & 0xF_FFFF) | lo_word(x)) != 0 {
                return x + x; // NaN
            }
            return if xsb == 0 { x } else { 0.0 }; // exp(+-inf) = {inf, 0}
        }
        if x > EXP_O_THRESHOLD {
            return EXP_HUGE * EXP_HUGE; // overflow
        }
        if x < EXP_U_THRESHOLD {
            return EXP_TWOM1000 * EXP_TWOM1000; // underflow
        }
    }

    // Argument reduction.
    let mut hi = 0.0f64;
    let mut lo = 0.0f64;
    let k: i32;
    if hx > 0x3FD6_2E42 {
        // |x| > 0.5 ln2
        if hx < 0x3FF0_A2B2 {
            // and |x| < 1.5 ln2
            if x == 1.0 {
                return EXP_E;
            }
            hi = x - EXP_LN2_HI[xsb];
            lo = EXP_LN2_LO[xsb];
            k = 1 - 2 * xsb as i32;
        } else {
            // C++ static_cast<int>: truncation toward zero (|k| <= 1075).
            k = madd::<F>(EXP_INVLN2, x, EXP_HALF[xsb]) as i32;
            let t = f64::from(k);
            hi = madd::<F>(-t, EXP_LN2_HI[0], x); // t*ln2HI is exact here
            lo = t * EXP_LN2_LO[0];
        }
        x = hi - lo;
    } else if hx < 0x3E30_0000 {
        // |x| < 2^-28: `if (huge + x > one) return one + x;` (always true).
        return 1.0 + x;
    } else {
        k = 0;
    }

    // x is now in primary range.
    let t = x * x;
    let twopk = if k >= -1021 {
        from_words((0x3FF0_0000_i32 + (k << 20)) as u32, 0)
    } else {
        from_words((0x3FF0_0000_i32 + ((k + 1000) << 20)) as u32, 0)
    };
    let poly = madd::<F>(
        t,
        madd::<F>(t, madd::<F>(t, madd::<F>(t, P5, P4), P3), P2),
        P1,
    );
    let c = madd::<F>(-t, poly, x);
    if k == 0 {
        return 1.0 - ((x * c) / (c - 2.0) - x);
    }
    let y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
    if k >= -1021 {
        if k == 1024 {
            return y * 2.0 * EXP_TWO1023;
        }
        y * twopk
    } else {
        y * twopk * EXP_TWOM1000
    }
}

// ---------------------------------------------------------------------------
// Math.pow (default flags) — v8::internal::math::pow + host pow
// ---------------------------------------------------------------------------

/// `Math.pow(x, y)` on [`V8Target::DEFAULT`] (linux-x64, std pow). For
/// tests and tools only: engine code must use [`OracleHost::pow`].
#[inline]
#[must_use]
pub fn pow(x: f64, y: f64) -> f64 {
    pow_on(V8Target::DEFAULT, x, y)
}

/// `Math.pow(x, y)` as Node 24 computes it with default flags on `target`
/// (`--use-std-math-pow`): the special cases of `src/numbers/ieee754.cc`,
/// then the host C library's `pow`. Exact for the Linux targets (glibc);
/// for [`V8Target::DarwinArm64`] Apple's `pow` is not portable (and not
/// correctly rounded either) and the glibc port is used instead (0.13% of
/// inputs differ by 1 ulp, see the phase 1 notes). On macOS, run the oracle
/// with `--no-use-std-math-pow` and use [`pow_legacy_on`] to be exact.
#[must_use]
pub fn pow_on(target: V8Target, x: f64, y: f64) -> f64 {
    let mut x = x;
    if y.is_nan() {
        return f64::NAN;
    }
    if y.is_infinite() && (x == 1.0 || x == -1.0) {
        return f64::NAN;
    }
    if x.is_nan() {
        x = f64::NAN; // JS does not distinguish signaling NaNs
    }
    // V8 mirrors its optimizing compilers, which never call `pow` for these.
    if y == 2.0 {
        return x * x;
    }
    if y == 0.5 {
        return if x.is_infinite() {
            f64::INFINITY
        } else {
            libm::sqrt(x + 0.0) // +0 so that (-0) ** 0.5 is +0
        };
    }
    match target {
        V8Target::LinuxX64 => glibc_pow_impl::<true, false>(x, y),
        V8Target::LinuxX64NoFma => glibc_pow_impl::<false, false>(x, y),
        V8Target::LinuxArm64 | V8Target::DarwinArm64 => glibc_pow_impl::<true, true>(x, y),
    }
}

// ---------------------------------------------------------------------------
// Math.pow (--no-use-std-math-pow) — V8 base::ieee754::legacy::pow
// ---------------------------------------------------------------------------

const POW_BP: [f64; 2] = [1.0, 1.5];
const POW_DP_H: [f64; 2] = [0.0, f64::from_bits(0x3fe2_b803_4000_0000)];
const POW_DP_L: [f64; 2] = [0.0, f64::from_bits(0x3e4c_fdeb_43cf_d006)];
const POW_TWO53: f64 = 9_007_199_254_740_992.0;
const POW_HUGE: f64 = 1.0e300;
const POW_TINY: f64 = 1.0e-300;
const POW_L1: f64 = f64::from_bits(0x3fe3_3333_3333_3303);
const POW_L2: f64 = f64::from_bits(0x3fdb_6db6_db6f_abff);
const POW_L3: f64 = f64::from_bits(0x3fd5_5555_518f_264d);
const POW_L4: f64 = f64::from_bits(0x3fd1_7460_a91d_4101);
const POW_L5: f64 = f64::from_bits(0x3fcd_864a_93c9_db65);
const POW_L6: f64 = f64::from_bits(0x3fca_7e28_4a45_4eef);
const POW_LG2: f64 = f64::from_bits(0x3fe6_2e42_fefa_39ef);
const POW_LG2_H: f64 = f64::from_bits(0x3fe6_2e43_0000_0000);
const POW_LG2_L: f64 = f64::from_bits(0xbe20_5c61_0ca8_6c39);
const POW_OVT: f64 = f64::from_bits(0x3c97_1547_652b_82fe); // 8.0085662595372944372e-17
const POW_CP: f64 = f64::from_bits(0x3fee_c709_dc3a_03fd);
const POW_CP_H: f64 = f64::from_bits(0x3fee_c709_e000_0000);
const POW_CP_L: f64 = f64::from_bits(0xbe3e_2fe0_145b_01f5);
const POW_IVLN2: f64 = f64::from_bits(0x3ff7_1547_652b_82fe);
const POW_IVLN2_H: f64 = f64::from_bits(0x3ff7_1547_6000_0000);
const POW_IVLN2_L: f64 = f64::from_bits(0x3e54_ae0b_f85d_df44);
const POW_THIRD: f64 = f64::from_bits(0x3fd5_5555_5555_5555); // 0.3333333333333333333333

/// `Math.pow(x, y)` as Node 24 computes it under `--no-use-std-math-pow`
/// on `target`: V8's fdlibm-derived `base::ieee754::legacy::pow`.
///
/// Contraction model: clang-style (in-expression, left product first) on
/// both arm64 targets, plus gcc's one extra cross-statement fusion of
/// `u = ivln2_h * t` in the `|y| > 2^31` branch on linux-arm64. Elsewhere
/// gcc's choices coincide with clang's for this code (1M-input fixtures).
#[inline]
#[must_use]
pub fn pow_legacy_on(target: V8Target, x: f64, y: f64) -> f64 {
    match (target.fp_contract(), target.apple_libm()) {
        (false, false) => pow_legacy_impl::<false, false>(x, y),
        (true, false) => pow_legacy_impl::<true, false>(x, y),
        (false, true) => pow_legacy_impl::<false, true>(x, y),
        (true, true) => pow_legacy_impl::<true, true>(x, y),
    }
}

/// `scalbn(x, n)` for the subnormal-result path of the legacy `pow`
/// (`n` in `[-1075, -1022]`, `|x|` in `[0.7, 1.5)`).
///
/// glibc rounds once. Apple's libm behaves as `x * 2^-1022 * 2^(n + 1022)`,
/// rounding twice when the first product is already subnormal (observed on
/// Node 24 darwin-arm64; the model matches every subnormal output in the
/// fixture).
#[inline]
fn pow_scalbn<const APPLE: bool>(x: f64, n: i32) -> f64 {
    if APPLE && n < -1022 {
        let once = x * f64::from_bits(0x0010_0000_0000_0000); // 2^-1022
        return libm::scalbn(once, n + 1022);
    }
    libm::scalbn(x, n)
}

#[allow(clippy::too_many_lines)]
fn pow_legacy_impl<const F: bool, const APPLE: bool>(x: f64, y: f64) -> f64 {
    let hx = hi_word(x);
    let lx = lo_word(x);
    let hy = hi_word(y);
    let ly = lo_word(y);
    let mut ix = hx & 0x7fff_ffff;
    let iy = hy & 0x7fff_ffff;

    // y == 0: x**0 = 1 (even for NaN x).
    if (iy as u32 | ly) == 0 {
        return 1.0;
    }

    // NaN in either argument (incl. 1**NaN, which ES requires to be NaN).
    if ix > 0x7ff0_0000
        || (ix == 0x7ff0_0000 && lx != 0)
        || iy > 0x7ff0_0000
        || (iy == 0x7ff0_0000 && ly != 0)
    {
        return x + y;
    }

    // yisint: 0 = y not an integer, 1 = odd integer, 2 = even integer
    // (only computed when x < 0).
    let mut yisint = 0i32;
    if hx < 0 {
        if iy >= 0x4340_0000 {
            yisint = 2; // even integer y
        } else if iy >= 0x3ff0_0000 {
            let k = (iy >> 20) - 0x3ff; // exponent
            if k > 20 {
                let j = ly >> (52 - k);
                if (j << (52 - k)) == ly {
                    yisint = 2 - (j & 1) as i32;
                }
            } else if ly == 0 {
                let j = iy >> (20 - k);
                if (j << (20 - k)) == iy {
                    yisint = 2 - (j & 1);
                }
            }
        }
    }

    // Special value of y.
    if ly == 0 {
        if iy == 0x7ff0_0000 {
            // y is +-inf
            if ((ix - 0x3ff0_0000) | lx as i32) == 0 {
                return f64::NAN; // (+-1)**+-inf is NaN (ECMAScript; C: y - y)
            } else if ix >= 0x3ff0_0000 {
                // (|x|>1)**+-inf = inf, 0
                return if hy >= 0 { y } else { 0.0 };
            }
            // (|x|<1)**-,+inf = inf, 0
            return if hy < 0 { -y } else { 0.0 };
        }
        if iy == 0x3ff0_0000 {
            // y is +-1
            return if hy < 0 { 1.0 / x } else { x };
        }
        if hy == 0x4000_0000 {
            return x * x; // y is 2
        }
        if hy == 0x3fe0_0000 && hx >= 0 {
            // y is 0.5 and x >= +0
            return libm::sqrt(x);
        }
    }

    let mut ax = libm::fabs(x);
    // Special value of x.
    if lx == 0 && (ix == 0x7ff0_0000 || ix == 0 || ix == 0x3ff0_0000) {
        // x is +-0, +-inf, +-1
        let mut z = ax;
        if hy < 0 {
            z = 1.0 / z; // z = (1/|x|)
        }
        if hx < 0 {
            if ((ix - 0x3ff0_0000) | yisint) == 0 {
                z = f64::NAN; // (-1)**non-int is NaN
            } else if yisint == 1 {
                z = -z; // (x<0)**odd = -(|x|**odd)
            }
        }
        return z;
    }

    // Sign of the result.
    let mut s = 1.0f64;
    if hx < 0 {
        if yisint == 0 {
            return f64::NAN; // (x<0)**(non-int) is NaN
        }
        if yisint == 1 {
            s = -1.0; // (x<0)**(odd int)
        }
    }

    let t1: f64;
    let t2: f64;
    if iy > 0x41e0_0000 {
        // |y| > 2**31
        if iy > 0x43f0_0000 {
            // |y| > 2**64, must o/uflow
            if ix <= 0x3fef_ffff {
                return if hy < 0 {
                    POW_HUGE * POW_HUGE
                } else {
                    POW_TINY * POW_TINY
                };
            }
            if ix >= 0x3ff0_0000 {
                return if hy > 0 {
                    POW_HUGE * POW_HUGE
                } else {
                    POW_TINY * POW_TINY
                };
            }
        }
        // Over/underflow if x is not close to one.
        if ix < 0x3fef_ffff {
            return if hy < 0 {
                s * POW_HUGE * POW_HUGE
            } else {
                s * POW_TINY * POW_TINY
            };
        }
        if ix > 0x3ff0_0000 {
            return if hy > 0 {
                s * POW_HUGE * POW_HUGE
            } else {
                s * POW_TINY * POW_TINY
            };
        }
        // Now |1-x| is tiny <= 2**-20; log(x) by x - x^2/2 + x^3/3 - x^4/4.
        let t = ax - 1.0; // t has 20 trailing zeros
        let w = (t * t) * madd::<F>(-t, madd::<F>(-t, 0.25, POW_THIRD), 0.5);
        let u = POW_IVLN2_H * t; // ivln2_h has 21 sig. bits
        let v = madd::<F>(t, POW_IVLN2_L, -(w * POW_IVLN2));
        if F && !APPLE {
            // gcc (`-ffp-contract=fast`): every use of `u` is an add in this
            // block, so both are fused (`ivln2_h * t` is not exact).
            t1 = with_lo(libm::fma(POW_IVLN2_H, t, v), 0);
            t2 = v - libm::fma(-POW_IVLN2_H, t, t1);
        } else {
            t1 = with_lo(u + v, 0);
            t2 = v - (t1 - u);
        }
    } else {
        let mut n = 0i32;
        // Take care of subnormal numbers.
        if ix < 0x0010_0000 {
            ax *= POW_TWO53;
            n -= 53;
            ix = hi_word(ax);
        }
        n += (ix >> 20) - 0x3ff;
        let j = ix & 0x000f_ffff;
        // Determine interval.
        ix = j | 0x3ff0_0000; // normalize ix
        let k: usize = if j <= 0x3988E {
            0 // |x| < sqrt(3/2)
        } else if j < 0xBB67A {
            1 // |x| < sqrt(3)
        } else {
            n += 1;
            ix -= 0x0010_0000;
            0
        };
        ax = with_hi(ax, ix as u32);

        // Compute ss = s_h + s_l = (x-1)/(x+1) or (x-1.5)/(x+1.5).
        let u = ax - POW_BP[k]; // bp[0]=1.0, bp[1]=1.5
        let v = 1.0 / (ax + POW_BP[k]);
        let ss = u * v;
        let s_h = with_lo(ss, 0);
        // t_h = ax + bp[k] High.
        let t_h = from_words(
            (((ix as u32) >> 1) | 0x2000_0000) + 0x0008_0000 + ((k as u32) << 18),
            0,
        );
        let t_l = ax - (t_h - POW_BP[k]);
        let s_l = v * madd::<F>(-s_h, t_l, madd::<F>(-s_h, t_h, u));
        // Compute log(ax).
        let s2 = ss * ss;
        let poly = madd::<F>(
            s2,
            madd::<F>(
                s2,
                madd::<F>(
                    s2,
                    madd::<F>(s2, madd::<F>(s2, POW_L6, POW_L5), POW_L4),
                    POW_L3,
                ),
                POW_L2,
            ),
            POW_L1,
        );
        let mut r = s2 * s2 * poly;
        r = madd::<F>(s_l, s_h + ss, r); // r += s_l * (s_h + ss)
        let s2 = s_h * s_h;
        let t_h = with_lo(3.0 + s2 + r, 0);
        let t_l = r - ((t_h - 3.0) - s2);
        // u + v = ss*(1+...).
        let u = s_h * t_h;
        let v = madd::<F>(s_l, t_h, t_l * ss);
        // 2/(3log2)*(ss+...).
        let p_h = with_lo(u + v, 0);
        let p_l = v - (p_h - u);
        let z_h = POW_CP_H * p_h; // cp_h+cp_l = 2/(3*log2)
        let z_l = madd::<F>(POW_CP_L, p_h, p_l * POW_CP) + POW_DP_L[k];
        // log2(ax) = (ss+..)*2/(3*log2) = n + dp_h + z_h + z_l.
        let t = f64::from(n);
        t1 = with_lo(((z_h + z_l) + POW_DP_H[k]) + t, 0);
        t2 = z_l - (((t1 - t) - POW_DP_H[k]) - z_h);
    }

    // Split up y into y1+y2 and compute (y1+y2)*(t1+t2).
    let y1 = with_lo(y, 0);
    let p_l = madd::<F>(y - y1, t1, y * t2);
    let mut p_h = y1 * t1;
    let z = p_l + p_h;
    let mut j = hi_word(z);
    let i = lo_word(z) as i32;
    if j >= 0x4090_0000 {
        // z >= 1024
        if ((j - 0x4090_0000) | i) != 0 {
            return s * POW_HUGE * POW_HUGE; // overflow
        }
        if p_l + POW_OVT > z - p_h {
            return s * POW_HUGE * POW_HUGE; // overflow
        }
    } else if (j & 0x7fff_ffff) >= 0x4090_cc00 {
        // z <= -1075
        if ((j as u32).wrapping_sub(0xc090_cc00) | i as u32) != 0 {
            return s * POW_TINY * POW_TINY; // underflow
        }
        if p_l <= z - p_h {
            return s * POW_TINY * POW_TINY; // underflow
        }
    }

    // Compute 2**(p_h+p_l).
    let i = j & 0x7fff_ffff;
    let mut k = (i >> 20) - 0x3ff;
    let mut n = 0i32;
    if i > 0x3fe0_0000 {
        // if |z| > 0.5, set n = [z+0.5]
        n = j + (0x0010_0000 >> (k + 1));
        k = ((n & 0x7fff_ffff) >> 20) - 0x3ff; // new k for n
        let t = from_words((n & !(0x000f_ffff >> k)) as u32, 0);
        n = ((n & 0x000f_ffff) | 0x0010_0000) >> (20 - k);
        if j < 0 {
            n = -n;
        }
        p_h -= t;
    }
    let t = with_lo(p_l + p_h, 0);
    let u = t * POW_LG2_H;
    let v = madd::<F>(p_l - (t - p_h), POW_LG2, t * POW_LG2_L);
    let mut z = u + v;
    let w = v - (z - u);
    let t = z * z;
    let poly = madd::<F>(
        t,
        madd::<F>(t, madd::<F>(t, madd::<F>(t, P5, P4), P3), P2),
        P1,
    );
    let t1 = madd::<F>(-t, poly, z);
    // V8 deviates from fdlibm here (a misplaced parenthesis in
    // src/base/ieee754.cc): `r = Divide(z * t1, (t1 - two) - (w + z * w))`
    // instead of fdlibm's `(z * t1) / (t1 - two) - (w + z * w)`. Ported as is.
    let r = (z * t1) / ((t1 - 2.0) - madd::<F>(z, w, w));
    z = 1.0 - (r - z);
    j = hi_word(z);
    j += n << 20;
    if (j >> 20) <= 0 {
        z = pow_scalbn::<APPLE>(z, n); // subnormal output
    } else {
        z = with_hi(z, j as u32);
    }
    s * z
}

// ---------------------------------------------------------------------------
// glibc pow (ARM optimized-routines, also musl >= 1.1.20)
// ---------------------------------------------------------------------------

#[inline]
fn top12(x: f64) -> u32 {
    (x.to_bits() >> 52) as u32
}

/// `pow(x, y)` as glibc 2.28+ computes it (`sysdeps/ieee754/dbl-64/e_pow.c`,
/// the ARM optimized-routines algorithm, worst case 0.52 ULP; C99 special
/// cases). Ported from musl's MIT-licensed copy of the same code and tables
/// (identical to glibc 2.36's).
///
/// `FMA` selects glibc's `__FP_FAST_FMA` build, which is what Linux Node
/// runs: aarch64 always, and x86-64 through the `ifunc` variant compiled
/// with `-mfma -mavx2` on any CPU with FMA. glibc is compiled in GNU C mode,
/// so gcc's default `-ffp-contract=fast` also fuses multiplies into the
/// following add across statements; the FMA form models that. `TOINT`
/// selects aarch64's `TOINT_INTRINSICS` (`round`/`lround` of the unfused
/// product instead of the fused shift trick of x86-64).
#[allow(clippy::too_many_lines)]
fn glibc_pow_impl<const FMA: bool, const TOINT: bool>(x: f64, y: f64) -> f64 {
    const SIGN_BIAS: u64 = 0x800 << 7; // 0x800 << EXP_TABLE_BITS
    const ONE: u64 = 0x3ff0_0000_0000_0000;
    const INF: u64 = 0x7ff0_0000_0000_0000;
    let mut sign_bias = 0u64;
    let mut ix = x.to_bits();
    let iy = y.to_bits();
    let mut topx = top12(x);
    let topy = top12(y);
    if topx.wrapping_sub(0x001) >= 0x7ff - 0x001
        || (topy & 0x7ff).wrapping_sub(0x3be) >= 0x43e - 0x3be
    {
        // Special cases: (x < 0x1p-126 or inf or nan) or
        // (|y| < 0x1p-65 or |y| >= 0x1p63 or nan).
        if zeroinfnan(iy) {
            if iy << 1 == 0 {
                return 1.0;
            }
            if ix == ONE {
                return 1.0;
            }
            if ix << 1 > INF << 1 || iy << 1 > INF << 1 {
                return x + y;
            }
            if ix << 1 == ONE << 1 {
                return 1.0;
            }
            if (ix << 1 < ONE << 1) == (iy >> 63 == 0) {
                return 0.0; // |x|<1 && y==inf or |x|>1 && y==-inf
            }
            return y * y;
        }
        if zeroinfnan(ix) {
            let mut x2 = x * x;
            if ix >> 63 != 0 && checkint(iy) == 1 {
                x2 = -x2;
            }
            return if iy >> 63 != 0 { 1.0 / x2 } else { x2 };
        }
        // Here x and y are non-zero finite.
        if ix >> 63 != 0 {
            // Finite x < 0.
            let yint = checkint(iy);
            if yint == 0 {
                return f64::NAN; // __math_invalid
            }
            if yint == 1 {
                sign_bias = SIGN_BIAS;
            }
            ix &= 0x7fff_ffff_ffff_ffff;
            topx &= 0x7ff;
        }
        if (topy & 0x7ff).wrapping_sub(0x3be) >= 0x43e - 0x3be {
            // Note: sign_bias == 0 here because y is not odd.
            if ix == ONE {
                return 1.0;
            }
            if (topy & 0x7ff) < 0x3be {
                // |y| < 2^-65, x^y ~= 1 + y*log(x).
                return if ix > ONE { 1.0 + y } else { 1.0 - y };
            }
            return if (ix > ONE) == (topy < 0x800) {
                math_oflow(0)
            } else {
                math_uflow(0)
            };
        }
        if topx == 0 {
            // Normalize subnormal x so exponent becomes negative.
            ix = (x * f64::from_bits(0x4330_0000_0000_0000)).to_bits(); // x * 2^52
            ix &= 0x7fff_ffff_ffff_ffff;
            ix = ix.wrapping_sub(52 << 52);
        }
    }

    let (hi, lo) = glibc_log_inline::<FMA>(ix);
    let (ehi, elo) = if FMA {
        let ehi = y * hi;
        (ehi, libm::fma(y, lo, libm::fma(y, hi, -ehi)))
    } else {
        let yhi = f64::from_bits(iy & (u64::MAX << 27));
        let ylo = y - yhi;
        let lhi = f64::from_bits(hi.to_bits() & (u64::MAX << 27));
        let llo = hi - lhi + lo;
        (yhi * lhi, ylo * lhi + y * llo) // |elo| < |ehi| * 2^-25
    };
    glibc_exp_inline::<FMA, TOINT>(ehi, elo, sign_bias)
}

#[inline]
fn zeroinfnan(i: u64) -> bool {
    (i << 1).wrapping_sub(1) >= (0x7ff0_0000_0000_0000u64 << 1).wrapping_sub(1)
}

/// 0 if not an integer, 1 if odd, 2 if even (`iy` non-zero finite).
#[inline]
fn checkint(iy: u64) -> i32 {
    let e = ((iy >> 52) & 0x7ff) as i32;
    if e < 0x3ff {
        return 0;
    }
    if e > 0x3ff + 52 {
        return 2;
    }
    let shift = (0x3ff + 52 - e) as u32;
    if iy & ((1u64 << shift) - 1) != 0 {
        return 0;
    }
    if iy & (1u64 << shift) != 0 {
        return 1;
    }
    2
}

#[inline]
fn math_xflow(sign: u64, y: f64) -> f64 {
    (if sign != 0 { -y } else { y }) * y
}

#[inline]
fn math_oflow(sign: u64) -> f64 {
    math_xflow(sign, f64::from_bits(0x7000_0000_0000_0000)) // 0x1p769
}

#[inline]
fn math_uflow(sign: u64) -> f64 {
    math_xflow(sign, f64::from_bits(0x1000_0000_0000_0000)) // 0x1p-767
}

/// `log(x)` as `hi + lo` with ~15 extra bits (`log_inline`).
#[inline]
fn glibc_log_inline<const FMA: bool>(ix: u64) -> (f64, f64) {
    const OFF: u64 = 0x3fe6_9555_0000_0000;
    let tmp = ix.wrapping_sub(OFF);
    let i = ((tmp >> (52 - 7)) % 128) as usize;
    let k = (tmp as i64) >> 52; // arithmetic shift
    let iz = ix.wrapping_sub(tmp & (0xfff << 52));
    let z = f64::from_bits(iz);
    let kd = k as f64;

    let [invc, logc, logctail] = GP_LOG_TAB[i];
    let invc = f64::from_bits(invc);
    let logc = f64::from_bits(logc);
    let logctail = f64::from_bits(logctail);

    if FMA {
        let r = libm::fma(z, invc, -1.0);
        // k*Ln2 + log(c) + r.
        let t1 = libm::fma(kd, GP_LN2HI, logc);
        let t2 = t1 + r;
        let lo1 = libm::fma(kd, GP_LN2LO, logctail);
        let lo2 = t1 - t2 + r;
        let ar = GP_A[0] * r; // A[0] = -0.5
        let ar2 = r * ar;
        let ar3 = r * ar2;
        // k*Ln2 + log(c) + r + A[0]*r*r.
        let hi = t2 + ar2;
        let lo3 = libm::fma(ar, r, -ar2);
        let lo4 = t2 - hi + ar2;
        // p = log1p(r) - r - A[0]*r*r, fused into the final sum.
        let q = libm::fma(
            ar2,
            libm::fma(
                ar2,
                libm::fma(r, GP_A[6], GP_A[5]),
                libm::fma(r, GP_A[4], GP_A[3]),
            ),
            libm::fma(r, GP_A[2], GP_A[1]),
        );
        let lo = libm::fma(ar3, q, lo1 + lo2 + lo3 + lo4);
        let y = hi + lo;
        return (y, hi - y + lo);
    }

    // Split z such that rhi, rlo and rhi*rhi are exact and |rlo| <= |r|.
    let zhi = f64::from_bits((iz + (1u64 << 31)) & (u64::MAX << 32));
    let zlo = z - zhi;
    let rhi = zhi * invc - 1.0;
    let rlo = zlo * invc;
    let r = rhi + rlo;
    // k*Ln2 + log(c) + r.
    let t1 = kd * GP_LN2HI + logc;
    let t2 = t1 + r;
    let lo1 = kd * GP_LN2LO + logctail;
    let lo2 = t1 - t2 + r;
    let ar = GP_A[0] * r; // A[0] = -0.5
    let ar2 = r * ar;
    let ar3 = r * ar2;
    // k*Ln2 + log(c) + r + A[0]*r*r.
    let arhi = GP_A[0] * rhi;
    let arhi2 = rhi * arhi;
    let hi = t2 + arhi2;
    let lo3 = rlo * (ar + arhi);
    let lo4 = t2 - hi + arhi2;
    // p = log1p(r) - r - A[0]*r*r.
    let p = ar3
        * (GP_A[1] + r * GP_A[2] + ar2 * (GP_A[3] + r * GP_A[4] + ar2 * (GP_A[5] + r * GP_A[6])));
    let lo = lo1 + lo2 + lo3 + lo4 + p;
    let y = hi + lo;
    (y, hi - y + lo)
}

/// `a * b + c`, fused in the FMA build.
#[inline(always)]
fn gmadd<const FMA: bool>(a: f64, b: f64, c: f64) -> f64 {
    if FMA { libm::fma(a, b, c) } else { a * b + c }
}

/// `sign * exp(x + xtail)` (`exp_inline`).
#[inline]
fn glibc_exp_inline<const FMA: bool, const TOINT: bool>(x: f64, xtail: f64, sign_bias: u64) -> f64 {
    let mut abstop = top12(x) & 0x7ff;
    let tiny = top12(f64::from_bits(0x3c90_0000_0000_0000)); // 0x1p-54
    let big = top12(512.0);
    if abstop.wrapping_sub(tiny) >= big - tiny {
        if abstop.wrapping_sub(tiny) >= 0x8000_0000 {
            // Avoid spurious underflow for tiny x.
            let one = 1.0 + x;
            return if sign_bias != 0 { -one } else { one };
        }
        if abstop >= top12(1024.0) {
            // Note: inf and nan are already handled.
            return if x.to_bits() >> 63 != 0 {
                math_uflow(sign_bias)
            } else {
                math_oflow(sign_bias)
            };
        }
        // Large x is special cased below.
        abstop = 0;
    }

    // exp(x) = 2^(k/N) * exp(r), with exp(r) in [2^(-1/2N),2^(1/2N)].
    let (kd, ki) = if TOINT {
        // aarch64: roundtoint = round(), converttoint = lround().
        let z = GE_INVLN2N * x;
        let kd = libm::round(z);
        (kd, (kd as i64) as u64)
    } else {
        // z + Shift; gcc fuses `z = InvLn2N * x` into it in the FMA build.
        let kd = gmadd::<FMA>(GE_INVLN2N, x, GE_SHIFT);
        let ki = kd.to_bits();
        (kd - GE_SHIFT, ki)
    };
    let mut r = gmadd::<FMA>(kd, GE_NEGLN2LON, gmadd::<FMA>(kd, GE_NEGLN2HIN, x));
    // The code assumes 2^-200 < |xtail| < 2^-8/N.
    r += xtail;
    // 2^(k/N) ~= scale * (1 + tail).
    let idx = (2 * (ki % 128)) as usize;
    let top = ki.wrapping_add(sign_bias) << (52 - 7);
    let tail = f64::from_bits(GE_TAB[idx]);
    // This is only a valid scale when -1023*N < k < 1024*N.
    let sbits = GE_TAB[idx + 1].wrapping_add(top);
    // exp(x) = 2^(k/N) * exp(r) ~= scale + scale * (tail + exp(r) - 1).
    let r2 = r * r;
    let tmp = gmadd::<FMA>(
        r2 * r2,
        gmadd::<FMA>(r, GE_C5, GE_C4),
        gmadd::<FMA>(r2, gmadd::<FMA>(r, GE_C3, GE_C2), tail + r),
    );
    if abstop == 0 {
        return glibc_exp_specialcase::<FMA>(tmp, sbits, ki);
    }
    let scale = f64::from_bits(sbits);
    gmadd::<FMA>(scale, tmp, scale)
}

#[inline]
fn glibc_exp_specialcase<const FMA: bool>(tmp: f64, sbits: u64, ki: u64) -> f64 {
    // k > 0: `scale * tmp` has a single use, fused in the FMA build.
    if ki & 0x8000_0000 == 0 {
        // k > 0, the exponent of scale might have overflowed by <= 460.
        let sbits = sbits.wrapping_sub(1009 << 52);
        let scale = f64::from_bits(sbits);
        return f64::from_bits(0x7f00_0000_0000_0000) * gmadd::<FMA>(scale, tmp, scale); // 0x1p1009
    }
    // k < 0, need special care in the subnormal range.
    let sbits = sbits.wrapping_add(1022 << 52);
    let scale = f64::from_bits(sbits); // signed scale
    // `scale * tmp` is CSE'd and also used inside the `if` below, a
    // different basic block, so gcc fuses neither use (observed on Linux).
    let scale_tmp = scale * tmp;
    let mut y = scale + scale_tmp;
    if libm::fabs(y) < 1.0 {
        // Round y to the right precision before scaling it into the
        // subnormal range to avoid double rounding.
        let one = if y < 0.0 { -1.0 } else { 1.0 };
        let lo = scale - y + scale_tmp;
        let hi = one + y;
        let lo = one - hi + y + lo;
        y = (hi + lo) - one;
        // Fix the sign of 0.
        if y == 0.0 {
            y = f64::from_bits(sbits & 0x8000_0000_0000_0000);
        }
    }
    f64::from_bits(0x0010_0000_0000_0000) * y // 0x1p-1022
}

// ---------------------------------------------------------------------------
// glibc pow tables
// ---------------------------------------------------------------------------

// Generated from musl v1.2.5 src/math/pow_data.c and exp_data.c
// (ARM optimized-routines, Copyright (c) 2018 Arm Limited, SPDX-License-Identifier: MIT).
// Identical to glibc 2.36 sysdeps/ieee754/dbl-64/e_pow_log_data.c / e_exp_data.c.
const GP_LN2HI: f64 = f64::from_bits(0x3fe62e42fefa3800);
const GP_LN2LO: f64 = f64::from_bits(0x3d2ef35793c76730);
const GP_A: [f64; 7] = [
    f64::from_bits(0xbfe0000000000000),
    f64::from_bits(0xbfe5555555555560),
    f64::from_bits(0x3fe0000000000006),
    f64::from_bits(0x3fe999999959554e),
    f64::from_bits(0xbfe555555529a47a),
    f64::from_bits(0xbff2495b9b4845e9),
    f64::from_bits(0x3ff0002b8b263fc3),
];
/// `{invc, logc, logctail}` per subinterval (the C table's `pad` is dropped).
const GP_LOG_TAB: [[u64; 3]; 128] = [
    [0x3ff6a00000000000, 0xbfd62c82f2b9c800, 0x3cfab42428375680],
    [0x3ff6800000000000, 0xbfd5d1bdbf580800, 0xbd1ca508d8e0f720],
    [0x3ff6600000000000, 0xbfd5767717455800, 0xbd2362a4d5b6506d],
    [0x3ff6400000000000, 0xbfd51aad872df800, 0xbce684e49eb067d5],
    [0x3ff6200000000000, 0xbfd4be5f95777800, 0xbd041b6993293ee0],
    [0x3ff6000000000000, 0xbfd4618bc21c6000, 0x3d13d82f484c84cc],
    [0x3ff5e00000000000, 0xbfd404308686a800, 0x3cdc42f3ed820b3a],
    [0x3ff5c00000000000, 0xbfd3a64c55694800, 0x3d20b1c686519460],
    [0x3ff5a00000000000, 0xbfd347dd9a988000, 0x3d25594dd4c58092],
    [0x3ff5800000000000, 0xbfd2e8e2bae12000, 0x3d267b1e99b72bd8],
    [0x3ff5600000000000, 0xbfd2895a13de8800, 0x3d15ca14b6cfb03f],
    [0x3ff5600000000000, 0xbfd2895a13de8800, 0x3d15ca14b6cfb03f],
    [0x3ff5400000000000, 0xbfd22941fbcf7800, 0xbd165a242853da76],
    [0x3ff5200000000000, 0xbfd1c898c1699800, 0xbd1fafbc68e75404],
    [0x3ff5000000000000, 0xbfd1675cababa800, 0x3d1f1fc63382a8f0],
    [0x3ff4e00000000000, 0xbfd1058bf9ae4800, 0xbd26a8c4fd055a66],
    [0x3ff4c00000000000, 0xbfd0a324e2739000, 0xbd0c6bee7ef4030e],
    [0x3ff4a00000000000, 0xbfd0402594b4d000, 0xbcf036b89ef42d7f],
    [0x3ff4a00000000000, 0xbfd0402594b4d000, 0xbcf036b89ef42d7f],
    [0x3ff4800000000000, 0xbfcfb9186d5e4000, 0x3d0d572aab993c87],
    [0x3ff4600000000000, 0xbfcef0adcbdc6000, 0x3d2b26b79c86af24],
    [0x3ff4400000000000, 0xbfce27076e2af000, 0xbd172f4f543fff10],
    [0x3ff4200000000000, 0xbfcd5c216b4fc000, 0x3d21ba91bbca681b],
    [0x3ff4000000000000, 0xbfcc8ff7c79aa000, 0x3d27794f689f8434],
    [0x3ff4000000000000, 0xbfcc8ff7c79aa000, 0x3d27794f689f8434],
    [0x3ff3e00000000000, 0xbfcbc286742d9000, 0x3d194eb0318bb78f],
    [0x3ff3c00000000000, 0xbfcaf3c94e80c000, 0x3cba4e633fcd9066],
    [0x3ff3a00000000000, 0xbfca23bc1fe2b000, 0xbd258c64dc46c1ea],
    [0x3ff3a00000000000, 0xbfca23bc1fe2b000, 0xbd258c64dc46c1ea],
    [0x3ff3800000000000, 0xbfc9525a9cf45000, 0xbd2ad1d904c1d4e3],
    [0x3ff3600000000000, 0xbfc87fa06520d000, 0x3d2bbdbf7fdbfa09],
    [0x3ff3400000000000, 0xbfc7ab890210e000, 0x3d2bdb9072534a58],
    [0x3ff3400000000000, 0xbfc7ab890210e000, 0x3d2bdb9072534a58],
    [0x3ff3200000000000, 0xbfc6d60fe719d000, 0xbd10e46aa3b2e266],
    [0x3ff3000000000000, 0xbfc5ff3070a79000, 0xbd1e9e439f105039],
    [0x3ff3000000000000, 0xbfc5ff3070a79000, 0xbd1e9e439f105039],
    [0x3ff2e00000000000, 0xbfc526e5e3a1b000, 0xbd20de8b90075b8f],
    [0x3ff2c00000000000, 0xbfc44d2b6ccb8000, 0x3d170cc16135783c],
    [0x3ff2c00000000000, 0xbfc44d2b6ccb8000, 0x3d170cc16135783c],
    [0x3ff2a00000000000, 0xbfc371fc201e9000, 0x3cf178864d27543a],
    [0x3ff2800000000000, 0xbfc29552f81ff000, 0xbd248d301771c408],
    [0x3ff2600000000000, 0xbfc1b72ad52f6000, 0xbd2e80a41811a396],
    [0x3ff2600000000000, 0xbfc1b72ad52f6000, 0xbd2e80a41811a396],
    [0x3ff2400000000000, 0xbfc0d77e7cd09000, 0x3d0a699688e85bf4],
    [0x3ff2400000000000, 0xbfc0d77e7cd09000, 0x3d0a699688e85bf4],
    [0x3ff2200000000000, 0xbfbfec9131dbe000, 0xbd2575545ca333f2],
    [0x3ff2000000000000, 0xbfbe27076e2b0000, 0x3d2a342c2af0003c],
    [0x3ff2000000000000, 0xbfbe27076e2b0000, 0x3d2a342c2af0003c],
    [0x3ff1e00000000000, 0xbfbc5e548f5bc000, 0xbd1d0c57585fbe06],
    [0x3ff1c00000000000, 0xbfba926d3a4ae000, 0x3d253935e85baac8],
    [0x3ff1c00000000000, 0xbfba926d3a4ae000, 0x3d253935e85baac8],
    [0x3ff1a00000000000, 0xbfb8c345d631a000, 0x3d137c294d2f5668],
    [0x3ff1a00000000000, 0xbfb8c345d631a000, 0x3d137c294d2f5668],
    [0x3ff1800000000000, 0xbfb6f0d28ae56000, 0xbd269737c93373da],
    [0x3ff1600000000000, 0xbfb51b073f062000, 0x3d1f025b61c65e57],
    [0x3ff1600000000000, 0xbfb51b073f062000, 0x3d1f025b61c65e57],
    [0x3ff1400000000000, 0xbfb341d7961be000, 0x3d2c5edaccf913df],
    [0x3ff1400000000000, 0xbfb341d7961be000, 0x3d2c5edaccf913df],
    [0x3ff1200000000000, 0xbfb16536eea38000, 0x3d147c5e768fa309],
    [0x3ff1000000000000, 0xbfaf0a30c0118000, 0x3d2d599e83368e91],
    [0x3ff1000000000000, 0xbfaf0a30c0118000, 0x3d2d599e83368e91],
    [0x3ff0e00000000000, 0xbfab42dd71198000, 0x3d1c827ae5d6704c],
    [0x3ff0e00000000000, 0xbfab42dd71198000, 0x3d1c827ae5d6704c],
    [0x3ff0c00000000000, 0xbfa77458f632c000, 0xbd2cfc4634f2a1ee],
    [0x3ff0c00000000000, 0xbfa77458f632c000, 0xbd2cfc4634f2a1ee],
    [0x3ff0a00000000000, 0xbfa39e87b9fec000, 0x3cf502b7f526feaa],
    [0x3ff0a00000000000, 0xbfa39e87b9fec000, 0x3cf502b7f526feaa],
    [0x3ff0800000000000, 0xbf9f829b0e780000, 0xbd2980267c7e09e4],
    [0x3ff0800000000000, 0xbf9f829b0e780000, 0xbd2980267c7e09e4],
    [0x3ff0600000000000, 0xbf97b91b07d58000, 0xbd288d5493faa639],
    [0x3ff0400000000000, 0xbf8fc0a8b0fc0000, 0xbcdf1e7cf6d3a69c],
    [0x3ff0400000000000, 0xbf8fc0a8b0fc0000, 0xbcdf1e7cf6d3a69c],
    [0x3ff0200000000000, 0xbf7fe02a6b100000, 0xbd19e23f0dda40e4],
    [0x3ff0200000000000, 0xbf7fe02a6b100000, 0xbd19e23f0dda40e4],
    [0x3ff0000000000000, 0x0000000000000000, 0x0000000000000000],
    [0x3ff0000000000000, 0x0000000000000000, 0x0000000000000000],
    [0x3fefc00000000000, 0x3f80101575890000, 0xbd10c76b999d2be8],
    [0x3fef800000000000, 0x3f90205658938000, 0xbd23dc5b06e2f7d2],
    [0x3fef400000000000, 0x3f98492528c90000, 0xbd2aa0ba325a0c34],
    [0x3fef000000000000, 0x3fa0415d89e74000, 0x3d0111c05cf1d753],
    [0x3feec00000000000, 0x3fa466aed42e0000, 0xbd2c167375bdfd28],
    [0x3fee800000000000, 0x3fa894aa149fc000, 0xbd197995d05a267d],
    [0x3fee400000000000, 0x3faccb73cdddc000, 0xbd1a68f247d82807],
    [0x3fee200000000000, 0x3faeea31c006c000, 0xbd0e113e4fc93b7b],
    [0x3fede00000000000, 0x3fb1973bd1466000, 0xbd25325d560d9e9b],
    [0x3feda00000000000, 0x3fb3bdf5a7d1e000, 0x3d2cc85ea5db4ed7],
    [0x3fed600000000000, 0x3fb5e95a4d97a000, 0xbd2c69063c5d1d1e],
    [0x3fed400000000000, 0x3fb700d30aeac000, 0x3cec1e8da99ded32],
    [0x3fed000000000000, 0x3fb9335e5d594000, 0x3d23115c3abd47da],
    [0x3fecc00000000000, 0x3fbb6ac88dad6000, 0xbd1390802bf768e5],
    [0x3feca00000000000, 0x3fbc885801bc4000, 0x3d2646d1c65aacd3],
    [0x3fec600000000000, 0x3fbec739830a2000, 0xbd2dc068afe645e0],
    [0x3fec400000000000, 0x3fbfe89139dbe000, 0xbd2534d64fa10afd],
    [0x3fec000000000000, 0x3fc1178e8227e000, 0x3d21ef78ce2d07f2],
    [0x3febe00000000000, 0x3fc1aa2b7e23f000, 0x3d2ca78e44389934],
    [0x3feba00000000000, 0x3fc2d1610c868000, 0x3d039d6ccb81b4a1],
    [0x3feb800000000000, 0x3fc365fcb0159000, 0x3cc62fa8234b7289],
    [0x3feb400000000000, 0x3fc4913d8333b000, 0x3d25837954fdb678],
    [0x3feb200000000000, 0x3fc527e5e4a1b000, 0x3d2633e8e5697dc7],
    [0x3feae00000000000, 0x3fc6574ebe8c1000, 0x3d19cf8b2c3c2e78],
    [0x3feac00000000000, 0x3fc6f0128b757000, 0xbd25118de59c21e1],
    [0x3feaa00000000000, 0x3fc7898d85445000, 0xbd1c661070914305],
    [0x3fea600000000000, 0x3fc8beafeb390000, 0xbd073d54aae92cd1],
    [0x3fea400000000000, 0x3fc95a5adcf70000, 0x3d07f22858a0ff6f],
    [0x3fea000000000000, 0x3fca93ed3c8ae000, 0xbd28724350562169],
    [0x3fe9e00000000000, 0x3fcb31d8575bd000, 0xbd0c358d4eace1aa],
    [0x3fe9c00000000000, 0x3fcbd087383be000, 0xbd2d4bc4595412b6],
    [0x3fe9a00000000000, 0x3fcc6ffbc6f01000, 0xbcf1ec72c5962bd2],
    [0x3fe9600000000000, 0x3fcdb13db0d49000, 0xbd2aff2af715b035],
    [0x3fe9400000000000, 0x3fce530effe71000, 0x3cc212276041f430],
    [0x3fe9200000000000, 0x3fcef5ade4dd0000, 0xbcca211565bb8e11],
    [0x3fe9000000000000, 0x3fcf991c6cb3b000, 0x3d1bcbecca0cdf30],
    [0x3fe8c00000000000, 0x3fd07138604d5800, 0x3cf89cdb16ed4e91],
    [0x3fe8a00000000000, 0x3fd0c42d67616000, 0x3d27188b163ceae9],
    [0x3fe8800000000000, 0x3fd1178e8227e800, 0xbd2c210e63a5f01c],
    [0x3fe8600000000000, 0x3fd16b5ccbacf800, 0x3d2b9acdf7a51681],
    [0x3fe8400000000000, 0x3fd1bf99635a6800, 0x3d2ca6ed5147bdb7],
    [0x3fe8200000000000, 0x3fd214456d0eb800, 0x3d0a87deba46baea],
    [0x3fe7e00000000000, 0x3fd2bef07cdc9000, 0x3d2a9cfa4a5004f4],
    [0x3fe7c00000000000, 0x3fd314f1e1d36000, 0xbd28e27ad3213cb8],
    [0x3fe7a00000000000, 0x3fd36b6776be1000, 0x3d116ecdb0f177c8],
    [0x3fe7800000000000, 0x3fd3c25277333000, 0x3d183b54b606bd5c],
    [0x3fe7600000000000, 0x3fd419b423d5e800, 0x3d08e436ec90e09d],
    [0x3fe7400000000000, 0x3fd4718dc271c800, 0xbd2f27ce0967d675],
    [0x3fe7200000000000, 0x3fd4c9e09e173000, 0xbd2e20891b0ad8a4],
    [0x3fe7000000000000, 0x3fd522ae0738a000, 0x3d2ebe708164c759],
    [0x3fe6e00000000000, 0x3fd57bf753c8d000, 0x3d1fadedee5d40ef],
    [0x3fe6c00000000000, 0x3fd5d5bddf596000, 0xbd0a0b2a08a465dc],
];
const GE_INVLN2N: f64 = f64::from_bits(0x40671547652b82fe);
const GE_NEGLN2HIN: f64 = f64::from_bits(0xbf762e42fefa0000);
const GE_NEGLN2LON: f64 = f64::from_bits(0xbd0cf79abc9e3b3a);
const GE_SHIFT: f64 = f64::from_bits(0x4338000000000000); // 0x1.8p52
const GE_C2: f64 = f64::from_bits(0x3fdffffffffffdbd);
const GE_C3: f64 = f64::from_bits(0x3fc555555555543c);
const GE_C4: f64 = f64::from_bits(0x3fa55555cf172b91);
const GE_C5: f64 = f64::from_bits(0x3f81111167a4d017);
/// `2^(i/N)` as `{tail bits, scale bits - (i << 45)}` pairs.
const GE_TAB: [u64; 256] = [
    0x0000000000000000,
    0x3ff0000000000000,
    0x3c9b3b4f1a88bf6e,
    0x3feff63da9fb3335,
    0xbc7160139cd8dc5d,
    0x3fefec9a3e778061,
    0xbc905e7a108766d1,
    0x3fefe315e86e7f85,
    0x3c8cd2523567f613,
    0x3fefd9b0d3158574,
    0xbc8bce8023f98efa,
    0x3fefd06b29ddf6de,
    0x3c60f74e61e6c861,
    0x3fefc74518759bc8,
    0x3c90a3e45b33d399,
    0x3fefbe3ecac6f383,
    0x3c979aa65d837b6d,
    0x3fefb5586cf9890f,
    0x3c8eb51a92fdeffc,
    0x3fefac922b7247f7,
    0x3c3ebe3d702f9cd1,
    0x3fefa3ec32d3d1a2,
    0xbc6a033489906e0b,
    0x3fef9b66affed31b,
    0xbc9556522a2fbd0e,
    0x3fef9301d0125b51,
    0xbc5080ef8c4eea55,
    0x3fef8abdc06c31cc,
    0xbc91c923b9d5f416,
    0x3fef829aaea92de0,
    0x3c80d3e3e95c55af,
    0x3fef7a98c8a58e51,
    0xbc801b15eaa59348,
    0x3fef72b83c7d517b,
    0xbc8f1ff055de323d,
    0x3fef6af9388c8dea,
    0x3c8b898c3f1353bf,
    0x3fef635beb6fcb75,
    0xbc96d99c7611eb26,
    0x3fef5be084045cd4,
    0x3c9aecf73e3a2f60,
    0x3fef54873168b9aa,
    0xbc8fe782cb86389d,
    0x3fef4d5022fcd91d,
    0x3c8a6f4144a6c38d,
    0x3fef463b88628cd6,
    0x3c807a05b0e4047d,
    0x3fef3f49917ddc96,
    0x3c968efde3a8a894,
    0x3fef387a6e756238,
    0x3c875e18f274487d,
    0x3fef31ce4fb2a63f,
    0x3c80472b981fe7f2,
    0x3fef2b4565e27cdd,
    0xbc96b87b3f71085e,
    0x3fef24dfe1f56381,
    0x3c82f7e16d09ab31,
    0x3fef1e9df51fdee1,
    0xbc3d219b1a6fbffa,
    0x3fef187fd0dad990,
    0x3c8b3782720c0ab4,
    0x3fef1285a6e4030b,
    0x3c6e149289cecb8f,
    0x3fef0cafa93e2f56,
    0x3c834d754db0abb6,
    0x3fef06fe0a31b715,
    0x3c864201e2ac744c,
    0x3fef0170fc4cd831,
    0x3c8fdd395dd3f84a,
    0x3feefc08b26416ff,
    0xbc86a3803b8e5b04,
    0x3feef6c55f929ff1,
    0xbc924aedcc4b5068,
    0x3feef1a7373aa9cb,
    0xbc9907f81b512d8e,
    0x3feeecae6d05d866,
    0xbc71d1e83e9436d2,
    0x3feee7db34e59ff7,
    0xbc991919b3ce1b15,
    0x3feee32dc313a8e5,
    0x3c859f48a72a4c6d,
    0x3feedea64c123422,
    0xbc9312607a28698a,
    0x3feeda4504ac801c,
    0xbc58a78f4817895b,
    0x3feed60a21f72e2a,
    0xbc7c2c9b67499a1b,
    0x3feed1f5d950a897,
    0x3c4363ed60c2ac11,
    0x3feece086061892d,
    0x3c9666093b0664ef,
    0x3feeca41ed1d0057,
    0x3c6ecce1daa10379,
    0x3feec6a2b5c13cd0,
    0x3c93ff8e3f0f1230,
    0x3feec32af0d7d3de,
    0x3c7690cebb7aafb0,
    0x3feebfdad5362a27,
    0x3c931dbdeb54e077,
    0x3feebcb299fddd0d,
    0xbc8f94340071a38e,
    0x3feeb9b2769d2ca7,
    0xbc87deccdc93a349,
    0x3feeb6daa2cf6642,
    0xbc78dec6bd0f385f,
    0x3feeb42b569d4f82,
    0xbc861246ec7b5cf6,
    0x3feeb1a4ca5d920f,
    0x3c93350518fdd78e,
    0x3feeaf4736b527da,
    0x3c7b98b72f8a9b05,
    0x3feead12d497c7fd,
    0x3c9063e1e21c5409,
    0x3feeab07dd485429,
    0x3c34c7855019c6ea,
    0x3feea9268a5946b7,
    0x3c9432e62b64c035,
    0x3feea76f15ad2148,
    0xbc8ce44a6199769f,
    0x3feea5e1b976dc09,
    0xbc8c33c53bef4da8,
    0x3feea47eb03a5585,
    0xbc845378892be9ae,
    0x3feea34634ccc320,
    0xbc93cedd78565858,
    0x3feea23882552225,
    0x3c5710aa807e1964,
    0x3feea155d44ca973,
    0xbc93b3efbf5e2228,
    0x3feea09e667f3bcd,
    0xbc6a12ad8734b982,
    0x3feea012750bdabf,
    0xbc6367efb86da9ee,
    0x3fee9fb23c651a2f,
    0xbc80dc3d54e08851,
    0x3fee9f7df9519484,
    0xbc781f647e5a3ecf,
    0x3fee9f75e8ec5f74,
    0xbc86ee4ac08b7db0,
    0x3fee9f9a48a58174,
    0xbc8619321e55e68a,
    0x3fee9feb564267c9,
    0x3c909ccb5e09d4d3,
    0x3feea0694fde5d3f,
    0xbc7b32dcb94da51d,
    0x3feea11473eb0187,
    0x3c94ecfd5467c06b,
    0x3feea1ed0130c132,
    0x3c65ebe1abd66c55,
    0x3feea2f336cf4e62,
    0xbc88a1c52fb3cf42,
    0x3feea427543e1a12,
    0xbc9369b6f13b3734,
    0x3feea589994cce13,
    0xbc805e843a19ff1e,
    0x3feea71a4623c7ad,
    0xbc94d450d872576e,
    0x3feea8d99b4492ed,
    0x3c90ad675b0e8a00,
    0x3feeaac7d98a6699,
    0x3c8db72fc1f0eab4,
    0x3feeace5422aa0db,
    0xbc65b6609cc5e7ff,
    0x3feeaf3216b5448c,
    0x3c7bf68359f35f44,
    0x3feeb1ae99157736,
    0xbc93091fa71e3d83,
    0x3feeb45b0b91ffc6,
    0xbc5da9b88b6c1e29,
    0x3feeb737b0cdc5e5,
    0xbc6c23f97c90b959,
    0x3feeba44cbc8520f,
    0xbc92434322f4f9aa,
    0x3feebd829fde4e50,
    0xbc85ca6cd7668e4b,
    0x3feec0f170ca07ba,
    0x3c71affc2b91ce27,
    0x3feec49182a3f090,
    0x3c6dd235e10a73bb,
    0x3feec86319e32323,
    0xbc87c50422622263,
    0x3feecc667b5de565,
    0x3c8b1c86e3e231d5,
    0x3feed09bec4a2d33,
    0xbc91bbd1d3bcbb15,
    0x3feed503b23e255d,
    0x3c90cc319cee31d2,
    0x3feed99e1330b358,
    0x3c8469846e735ab3,
    0x3feede6b5579fdbf,
    0xbc82dfcd978e9db4,
    0x3feee36bbfd3f37a,
    0x3c8c1a7792cb3387,
    0x3feee89f995ad3ad,
    0xbc907b8f4ad1d9fa,
    0x3feeee07298db666,
    0xbc55c3d956dcaeba,
    0x3feef3a2b84f15fb,
    0xbc90a40e3da6f640,
    0x3feef9728de5593a,
    0xbc68d6f438ad9334,
    0x3feeff76f2fb5e47,
    0xbc91eee26b588a35,
    0x3fef05b030a1064a,
    0x3c74ffd70a5fddcd,
    0x3fef0c1e904bc1d2,
    0xbc91bdfbfa9298ac,
    0x3fef12c25bd71e09,
    0x3c736eae30af0cb3,
    0x3fef199bdd85529c,
    0x3c8ee3325c9ffd94,
    0x3fef20ab5fffd07a,
    0x3c84e08fd10959ac,
    0x3fef27f12e57d14b,
    0x3c63cdaf384e1a67,
    0x3fef2f6d9406e7b5,
    0x3c676b2c6c921968,
    0x3fef3720dcef9069,
    0xbc808a1883ccb5d2,
    0x3fef3f0b555dc3fa,
    0xbc8fad5d3ffffa6f,
    0x3fef472d4a07897c,
    0xbc900dae3875a949,
    0x3fef4f87080d89f2,
    0x3c74a385a63d07a7,
    0x3fef5818dcfba487,
    0xbc82919e2040220f,
    0x3fef60e316c98398,
    0x3c8e5a50d5c192ac,
    0x3fef69e603db3285,
    0x3c843a59ac016b4b,
    0x3fef7321f301b460,
    0xbc82d52107b43e1f,
    0x3fef7c97337b9b5f,
    0xbc892ab93b470dc9,
    0x3fef864614f5a129,
    0x3c74b604603a88d3,
    0x3fef902ee78b3ff6,
    0x3c83c5ec519d7271,
    0x3fef9a51fbc74c83,
    0xbc8ff7128fd391f0,
    0x3fefa4afa2a490da,
    0xbc8dae98e223747d,
    0x3fefaf482d8e67f1,
    0x3c8ec3bc41aa2008,
    0x3fefba1bee615a27,
    0x3c842b94c3a9eb32,
    0x3fefc52b376bba97,
    0x3c8a64a931d185ee,
    0x3fefd0765b6e4540,
    0xbc8e37bae43be3ed,
    0x3fefdbfdad9cbe14,
    0x3c77893b4d91cd9d,
    0x3fefe7c1819e90d8,
    0x3c5305c14160cc89,
    0x3feff3c22b8f71f1,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypot_special_ordering() {
        assert_eq!(hypot(&[]).to_bits(), 0);
        assert_eq!(
            hypot2(f64::NAN, f64::NEG_INFINITY).to_bits(),
            f64::INFINITY.to_bits()
        );
        assert!(hypot2(f64::NAN, 1.0).is_nan());
        assert_eq!(hypot2(-0.0, -0.0).to_bits(), 0);
        assert_eq!(hypot2(3.0, 4.0).to_bits(), 5.0f64.to_bits());
    }

    #[test]
    fn exp_specials() {
        for t in V8Target::ALL {
            assert_eq!(exp_on(t, 1.0).to_bits(), core::f64::consts::E.to_bits());
            assert_eq!(exp_on(t, 0.0).to_bits(), 1.0f64.to_bits());
            assert_eq!(exp_on(t, f64::NEG_INFINITY).to_bits(), 0);
            assert!(exp_on(t, f64::NAN).is_nan());
        }
    }

    #[test]
    fn pow_es_specials() {
        for t in V8Target::ALL {
            for f in [pow_on, pow_legacy_on] {
                assert!(f(t, 1.0, f64::NAN).is_nan());
                assert!(f(t, -1.0, f64::INFINITY).is_nan());
                assert!(f(t, 1.0, f64::NEG_INFINITY).is_nan());
                assert_eq!(f(t, f64::NAN, 0.0).to_bits(), 1.0f64.to_bits());
                assert_eq!(f(t, -0.0, 0.5).to_bits(), 0);
                assert_eq!(
                    f(t, f64::NEG_INFINITY, 0.5).to_bits(),
                    f64::INFINITY.to_bits()
                );
                assert_eq!(f(t, 2.0, 10.0).to_bits(), 1024.0f64.to_bits());
                assert_eq!(f(t, -2.0, 3.0).to_bits(), (-8.0f64).to_bits());
                assert!(f(t, -2.0, 0.5).is_nan());
            }
        }
    }

    #[test]
    fn target_names_round_trip() {
        for t in V8Target::ALL {
            assert_eq!(V8Target::from_name(t.name()), Some(t));
        }
        assert_eq!(
            V8Target::from_node("linux", "x64"),
            Some(V8Target::LinuxX64)
        );
        assert_eq!(
            V8Target::from_node("linux", "arm64"),
            Some(V8Target::LinuxArm64)
        );
        assert_eq!(
            V8Target::from_node("darwin", "arm64"),
            Some(V8Target::DarwinArm64)
        );
        assert_eq!(V8Target::from_node("win32", "x64"), None);
    }
}
