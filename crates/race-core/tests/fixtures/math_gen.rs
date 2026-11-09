//! Input generator and fixture reader shared by `tests/math.rs` and
//! `tests/js_math.rs`.
//!
//! The generator mirrors `scripts/oracle/dump-math-fixtures.ts` bit for bit
//! (`math-gen-v1`): same PRNG, same segment table, same call order, and only
//! exact IEEE operations (`+ - * /`, `abs`, bit construction). Any change
//! here must be made there too, and the fixture regenerated.

#![allow(dead_code)]

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fmt::Write as _;

pub const GENERATOR_VERSION: &str = "math-gen-v1";

/// One fixture per Node host (`<platform>-<arch>`), see
/// `scripts/oracle/dump-math-fixtures.ts`.
pub const FIXTURES: [(&str, &str); 4] = [
    ("linux-x64", include_str!("math-node24-linux-x64.json")),
    (
        "linux-x64-nofma",
        include_str!("math-node24-linux-x64-nofma.json"),
    ),
    ("linux-arm64", include_str!("math-node24-linux-arm64.json")),
    (
        "darwin-arm64",
        include_str!("math-node24-darwin-arm64.json"),
    ),
];
pub const CANON_NAN: u64 = 0x7ff8_0000_0000_0000;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Fixture {
    pub version: u32,
    pub generator: String,
    pub chunk_size: u32,
    pub node: String,
    pub v8: String,
    pub platform: String,
    pub variant: Option<String>,
    pub functions: BTreeMap<String, FnFixture>,
}

impl Fixture {
    /// `<platform>-<arch>[-<variant>]`, the fixture/full-dump name.
    pub fn host(&self) -> String {
        match &self.variant {
            Some(v) => format!("{}-{v}", self.platform),
            None => self.platform.clone(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FnFixture {
    pub arity: u32,
    pub seed: u32,
    pub count: u32,
    pub segments: Vec<SegmentInfo>,
    pub chunks: Vec<String>,
    pub sha256: String,
    pub edges: Vec<Edge>,
    pub legacy: Option<Legacy>,
    pub diff_vs_legacy: Option<DiffVsLegacy>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffVsLegacy {
    pub total: u32,
    pub by_segment: BTreeMap<String, u32>,
    /// `(index, default bits, legacy bits)` for the first differing inputs.
    pub samples: Vec<(u32, String, String)>,
}

#[derive(Deserialize)]
pub struct SegmentInfo {
    pub name: String,
    pub count: u32,
}

#[derive(Deserialize)]
pub struct Edge {
    #[serde(rename = "in")]
    pub inputs: Vec<String>,
    pub out: String,
}

#[derive(Deserialize)]
pub struct Legacy {
    pub chunks: Vec<String>,
    pub sha256: String,
    pub edges: Vec<String>,
}

/// Every host fixture, in `FIXTURES` order.
pub fn load_all() -> Vec<Fixture> {
    FIXTURES
        .iter()
        .map(|(platform, text)| {
            let f: Fixture = serde_json::from_str(text).expect("math fixture parses");
            assert_eq!(f.version, 1);
            assert_eq!(f.generator, GENERATOR_VERSION, "generator version mismatch");
            assert_eq!(f.host(), *platform, "fixture file/host mismatch");
            f
        })
        .collect()
}

pub fn parse_hex(s: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(s, 16).expect("hex f64"))
}

pub fn canon(x: f64) -> u64 {
    if x.is_nan() { CANON_NAN } else { x.to_bits() }
}

pub fn hex(x: f64) -> String {
    format!("{:016x}", canon(x))
}

/// Per-chunk digests in the fixture encoding (LE u64 bits, canonical NaN).
pub fn chunk_digests(values: &[f64], chunk: usize) -> Vec<String> {
    values
        .chunks(chunk)
        .map(|c| {
            let mut h = Sha256::new();
            for &v in c {
                h.update(canon(v).to_le_bytes());
            }
            let d = h.finalize();
            let mut s = String::with_capacity(16);
            for b in &d[..8] {
                write!(s, "{b:02x}").unwrap();
            }
            s
        })
        .collect()
}

pub fn full_digest(values: &[f64]) -> String {
    let mut h = Sha256::new();
    for &v in values {
        h.update(canon(v).to_le_bytes());
    }
    let d = h.finalize();
    let mut s = String::with_capacity(64);
    for b in d.iter() {
        write!(s, "{b:02x}").unwrap();
    }
    s
}

/// Optional full output stream written by `--full-dir`: env
/// `RACE_MATH_FULL_DIR=<root>` with `<root>/<platform>/<name>.bin`.
pub fn load_full(platform: &str, name: &str) -> Option<Vec<f64>> {
    let dir = std::env::var_os("RACE_MATH_FULL_DIR")?;
    let path = std::path::Path::new(&dir)
        .join(platform)
        .join(format!("{name}.bin"));
    let bytes = std::fs::read(&path).ok()?;
    Some(
        bytes
            .as_chunks::<8>()
            .0
            .iter()
            .map(|b| f64::from_le_bytes(*b))
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

pub struct Gen {
    s: u32,
}

impl Gen {
    pub fn new(seed: u32) -> Self {
        Self { s: seed }
    }

    pub fn next(&mut self) -> u32 {
        self.s = self.s.wrapping_add(0x9e37_79b9);
        let mut z = self.s;
        z = (z ^ (z >> 16)).wrapping_mul(0x85eb_ca6b);
        z = (z ^ (z >> 13)).wrapping_mul(0xc2b2_ae35);
        z ^ (z >> 16)
    }

    pub fn u53(&mut self) -> f64 {
        let a = f64::from(self.next() >> 5);
        let b = f64::from(self.next() >> 6);
        (a * 67_108_864.0 + b) / 9_007_199_254_740_992.0
    }

    pub fn uniform(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.u53() * (hi - lo)
    }

    pub fn bits(&mut self) -> f64 {
        let hi = u64::from(self.next());
        let lo = u64::from(self.next());
        f64::from_bits((hi << 32) | lo)
    }

    pub fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }

    pub fn logu(&mut self, min_e: i32, max_e: i32) -> f64 {
        let sbit = self.next() & 1;
        let span = u32::try_from(max_e - min_e + 1).unwrap();
        let e = min_e + i32::try_from(self.below(span)).unwrap();
        let m = 1.0 + self.u53();
        let v = m * pow2(e);
        if sbit == 1 { -v } else { v }
    }

    pub fn pick(&mut self, values: &[f64]) -> f64 {
        let n = u32::try_from(values.len()).unwrap();
        values[self.below(n) as usize]
    }

    pub fn ulps_around(&mut self, base: f64) -> f64 {
        let offset = i64::from(self.below(129)) - 64;
        // JS: BigInt(toBits(base)) + offset, mod 2^64. NaN bases are the
        // canonical quiet NaN in both (DataView.setFloat64 canonicalizes).
        f64::from_bits(canon(base).wrapping_add_signed(offset))
    }
}

pub fn pow2(e: i32) -> f64 {
    let hi = u64::try_from(e + 1023).unwrap() << 20;
    f64::from_bits(hi << 32)
}

fn from_words(hi: u32, lo: u32) -> f64 {
    f64::from_bits((u64::from(hi) << 32) | u64::from(lo))
}

pub fn min_sub() -> f64 {
    from_words(0, 1)
}

pub fn specials() -> Vec<f64> {
    let min_sub = from_words(0, 1);
    let min_normal = from_words(0x0010_0000, 0);
    let max = from_words(0x7fef_ffff, 0xffff_ffff);
    let one_plus = from_words(0x3ff0_0000, 1);
    let one_minus = from_words(0x3fef_ffff, 0xffff_ffff);
    let half_minus = from_words(0x3fdf_ffff, 0xffff_ffff);
    vec![
        0.0,
        -0.0,
        1.0,
        -1.0,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NAN,
        0.5,
        -0.5,
        2.0,
        -2.0,
        3.0,
        -3.0,
        1.5,
        -1.5,
        min_sub,
        -min_sub,
        min_normal,
        max,
        -max,
        one_plus,
        one_minus,
        1e-300,
        1e300,
        half_minus,
    ]
}

const EXP_BOUNDARIES: [f64; 13] = [
    0.346_573_590_279_972_64,
    1.039_720_770_839_917_9,
    core::f64::consts::LN_2,
    709.782_712_893_384,
    -745.133_219_101_941_1,
    -708.396_418_532_264_1,
    -707.703_271_351_704_2,
    -709.089_565_712_824_1,
    3.725_290_298_461_914e-9,
    1.0,
    2.0,
    10.0,
    0.5,
];

pub type Args = Vec<f64>;

/// One generated input with the name of the segment it came from.
pub struct Sample {
    pub segment: &'static str,
    pub args: Args,
}

fn seg(
    names: &[(&'static str, u32)],
    g: &mut Gen,
    mut make: impl FnMut(&'static str, &mut Gen) -> Args,
) -> Vec<Sample> {
    let mut out = Vec::new();
    for &(name, count) in names {
        for _ in 0..count {
            let args = make(name, g);
            out.push(Sample {
                segment: name,
                args,
            });
        }
    }
    out
}

pub fn generate(name: &str, seed: u32) -> Vec<Sample> {
    let mut g = Gen::new(seed);
    let sp = specials();
    match name {
        "exp" => seg(
            &[
                ("engine_gap", 250_000),
                ("engine_progress", 50_000),
                ("unit", 150_000),
                ("reduction", 150_000),
                ("full_range", 150_000),
                ("log_magnitude", 100_000),
                ("boundaries", 50_000),
                ("bits", 100_000),
            ],
            &mut g,
            |s, g| match s {
                "engine_gap" => {
                    let p1 = g.u53();
                    let d = g.uniform(-0.12, 0.12);
                    let p2 = p1 + d;
                    let gap = (p2 - p1).abs();
                    vec![-gap / 0.02]
                }
                "engine_progress" => {
                    let a = g.uniform(0.0, 1.05);
                    let b = g.uniform(0.0, 1.05);
                    vec![-(a - b).abs() / 0.02]
                }
                "unit" => vec![g.uniform(-1.0, 1.0)],
                "reduction" => vec![g.uniform(-2.0, 2.0)],
                "full_range" => vec![g.uniform(-746.0, 710.0)],
                "log_magnitude" => vec![g.logu(-60, 10)],
                "boundaries" => {
                    let base = g.pick(&EXP_BOUNDARIES);
                    let signed = if g.next() & 1 == 1 { -base } else { base };
                    vec![g.ulps_around(signed)]
                }
                "bits" => vec![g.bits()],
                _ => unreachable!(),
            },
        ),
        "pow" => seg(
            &[
                ("engine_grudge", 250_000),
                ("engine_half", 150_000),
                ("half_wide", 50_000),
                ("positive", 150_000),
                ("near_one", 100_000),
                ("int_exponent", 100_000),
                ("unit", 50_000),
                ("magnitude", 50_000),
                ("bits", 50_000),
                ("specials", 50_000),
            ],
            &mut g,
            |s, g| match s {
                "engine_grudge" => {
                    let tick = g.below(5401);
                    let grudge_tick = g.below(tick + 1);
                    vec![
                        0.5,
                        (f64::from(tick) - f64::from(grudge_tick)) / (10.0 * 60.0),
                    ]
                }
                "engine_half" => vec![0.5, g.uniform(0.0, 60.0)],
                "half_wide" => vec![0.5, g.uniform(-1100.0, 1100.0)],
                "positive" => {
                    let x = g.uniform(0.0, 10.0);
                    let y = g.uniform(-30.0, 30.0);
                    vec![x, y]
                }
                "near_one" => {
                    let x = 1.0 + g.logu(-60, -5);
                    let y = g.logu(-5, 70);
                    vec![x, y]
                }
                "int_exponent" => {
                    let x = g.uniform(-100.0, 100.0);
                    let y = f64::from(g.below(129)) - 64.0;
                    vec![x, y]
                }
                "unit" => {
                    let x = g.uniform(0.0, 2.0);
                    let y = g.uniform(-1.0, 1.0);
                    vec![x, y]
                }
                "magnitude" => {
                    let x = g.logu(-1022, 1023).abs();
                    let y = g.uniform(-4.0, 4.0);
                    vec![x, y]
                }
                "bits" => {
                    let x = g.bits();
                    let y = g.bits();
                    vec![x, y]
                }
                "specials" => match g.below(3) {
                    0 => {
                        let x = g.pick(&sp);
                        let y = g.pick(&sp);
                        vec![x, y]
                    }
                    1 => {
                        let x = g.pick(&sp);
                        let y = g.uniform(-10.0, 10.0);
                        vec![x, y]
                    }
                    _ => {
                        let x = g.uniform(-10.0, 10.0);
                        let y = g.pick(&sp);
                        vec![x, y]
                    }
                },
                _ => unreachable!(),
            },
        ),
        "hypot2" => seg(
            &[
                ("engine_pickup", 300_000),
                ("engine_track", 100_000),
                ("uniform", 200_000),
                ("unit", 100_000),
                ("magnitude", 150_000),
                ("close_magnitude", 50_000),
                ("specials", 50_000),
                ("bits", 50_000),
            ],
            &mut g,
            |s, g| match s {
                "engine_pickup" => {
                    let pickup_progress = g.u53();
                    let dp = g.uniform(-0.03, 0.03);
                    let duck_progress = pickup_progress + dp;
                    let pickup_lateral = g.uniform(-1.0, 1.0);
                    let dl = g.uniform(-0.35, 0.35);
                    let duck_lateral = pickup_lateral + dl;
                    vec![
                        duck_progress - pickup_progress,
                        duck_lateral - pickup_lateral,
                    ]
                }
                "engine_track" => vec![4200.0, g.uniform(-3950.0, 3950.0)],
                "uniform" => {
                    let a = g.uniform(-1000.0, 1000.0);
                    let b = g.uniform(-1000.0, 1000.0);
                    vec![a, b]
                }
                "unit" => {
                    let a = g.uniform(-1.0, 1.0);
                    let b = g.uniform(-1.0, 1.0);
                    vec![a, b]
                }
                "magnitude" => {
                    let a = g.logu(-1022, 1023);
                    let b = g.logu(-1022, 1023);
                    vec![a, b]
                }
                "close_magnitude" => {
                    let a = g.logu(-50, 50);
                    let b = a * g.uniform(0.5, 2.0);
                    vec![a, b]
                }
                "specials" => {
                    let a = g.pick(&sp);
                    let b = if g.next() & 1 == 1 {
                        g.pick(&sp)
                    } else {
                        g.uniform(-10.0, 10.0)
                    };
                    if g.next() & 1 == 1 {
                        vec![a, b]
                    } else {
                        vec![b, a]
                    }
                }
                "bits" => {
                    let a = g.bits();
                    let b = g.bits();
                    vec![a, b]
                }
                _ => unreachable!(),
            },
        ),
        "hypot3" => seg(
            &[
                ("uniform", 300_000),
                ("unit", 200_000),
                ("small", 200_000),
                ("magnitude", 150_000),
                ("specials", 100_000),
                ("bits", 50_000),
            ],
            &mut g,
            |s, g| match s {
                "uniform" => {
                    let a = g.uniform(-1000.0, 1000.0);
                    let b = g.uniform(-1000.0, 1000.0);
                    let c = g.uniform(-1000.0, 1000.0);
                    vec![a, b, c]
                }
                "unit" => {
                    let a = g.uniform(-1.0, 1.0);
                    let b = g.uniform(-1.0, 1.0);
                    let c = g.uniform(-1.0, 1.0);
                    vec![a, b, c]
                }
                "small" => {
                    let a = g.uniform(-0.05, 0.05);
                    let b = g.uniform(-0.5, 0.5);
                    let c = g.uniform(-0.05, 0.05);
                    vec![a, b, c]
                }
                "magnitude" => {
                    let a = g.logu(-1022, 1023);
                    let b = g.logu(-1022, 1023);
                    let c = g.logu(-1022, 1023);
                    vec![a, b, c]
                }
                "specials" => {
                    let a = g.pick(&sp);
                    let b = g.pick(&sp);
                    let c = g.uniform(-10.0, 10.0);
                    match g.below(3) {
                        0 => vec![a, b, c],
                        1 => vec![c, a, b],
                        _ => vec![b, c, a],
                    }
                }
                "bits" => {
                    let a = g.bits();
                    let b = g.bits();
                    let c = g.bits();
                    vec![a, b, c]
                }
                _ => unreachable!(),
            },
        ),
        "sin" | "cos" => seg(
            &[
                ("engine_track", 500_000),
                ("uniform", 200_000),
                ("wide", 100_000),
                ("log_magnitude", 100_000),
                ("bits", 100_000),
            ],
            &mut g,
            |s, g| match s {
                "engine_track" => {
                    let p = g.u53();
                    match g.below(3) {
                        0 => vec![p * core::f64::consts::PI * 2.25],
                        1 => vec![p * core::f64::consts::PI * 5.1 + 0.7],
                        _ => vec![p * core::f64::consts::PI * 3.7 + 0.4],
                    }
                }
                "uniform" => vec![g.uniform(-10.0, 10.0)],
                "wide" => vec![g.uniform(-1e6, 1e6)],
                "log_magnitude" => vec![g.logu(-30, 30)],
                "bits" => vec![g.bits()],
                _ => unreachable!(),
            },
        ),
        "round" | "sign" => {
            let mut round_specials = sp.clone();
            round_specials.extend_from_slice(&[
                4_503_599_627_370_496.0,
                4_503_599_627_370_497.0,
                9_007_199_254_740_991.0,
                9_007_199_254_740_992.0,
                0.5,
                2.5,
                -2.5,
            ]);
            seg(
                &[
                    ("bits", 20_000),
                    ("uniform", 20_000),
                    ("half_integers", 20_000),
                    ("log_magnitude", 20_000),
                    ("specials", 20_000),
                ],
                &mut g,
                |s, g| match s {
                    "bits" => vec![g.bits()],
                    "uniform" => vec![g.uniform(-10.0, 10.0)],
                    "half_integers" => {
                        let k = f64::from(g.below(2001)) - 1000.0;
                        vec![g.ulps_around(k + 0.5)]
                    }
                    "log_magnitude" => vec![g.logu(-60, 60)],
                    "specials" => {
                        let base = g.pick(&round_specials);
                        vec![g.ulps_around(base)]
                    }
                    _ => unreachable!(),
                },
            )
        }
        "max" | "min" | "cmp" => seg(
            &[
                ("uniform", 30_000),
                ("specials", 30_000),
                ("equal_or_near", 20_000),
                ("bits", 20_000),
            ],
            &mut g,
            |s, g| match s {
                "uniform" => {
                    let a = g.uniform(-10.0, 10.0);
                    let b = g.uniform(-10.0, 10.0);
                    vec![a, b]
                }
                "specials" => {
                    let a = g.pick(&sp);
                    let b = g.pick(&sp);
                    vec![a, b]
                }
                "equal_or_near" => {
                    let a = g.uniform(-10.0, 10.0);
                    let b = g.ulps_around(a);
                    if g.next() & 1 == 1 {
                        vec![a, b]
                    } else {
                        vec![a, a]
                    }
                }
                "bits" => {
                    let a = g.bits();
                    let b = g.bits();
                    vec![a, b]
                }
                _ => unreachable!(),
            },
        ),
        other => panic!("unknown math fixture function {other}"),
    }
}

/// Result of comparing one function's outputs with the fixture.
pub struct Report {
    pub name: String,
    pub generated: usize,
    pub chunk_mismatches: usize,
    pub chunks: usize,
    /// Exact per-input mismatches, when the full stream is available.
    pub exact_mismatches: Option<usize>,
    /// Mismatch count per segment (only with the full stream).
    pub by_segment: BTreeMap<&'static str, (usize, usize)>,
    /// A few failing inputs (hex args, ours, node).
    pub samples: Vec<String>,
    pub edges: usize,
    pub edge_mismatches: Vec<String>,
    pub sha_match: bool,
}

impl Report {
    pub fn print(&self) {
        let exact = match self.exact_mismatches {
            Some(m) => format!(
                "exact: {} / {} differ, match rate {:.6}%",
                m,
                self.generated,
                100.0 * (1.0 - m as f64 / self.generated as f64)
            ),
            None => "exact per-input rate needs RACE_MATH_FULL_DIR".to_string(),
        };
        println!(
            "[{}] generated {}: chunk digests {}/{} equal (sha256 {}); {}; edges {}/{} equal",
            self.name,
            self.generated,
            self.chunks - self.chunk_mismatches,
            self.chunks,
            if self.sha_match { "equal" } else { "differs" },
            exact,
            self.edges - self.edge_mismatches.len(),
            self.edges,
        );
        for (seg, (bad, total)) in &self.by_segment {
            if *bad > 0 {
                println!("    segment {seg}: {bad} / {total} differ");
            }
        }
        for s in self.samples.iter().take(8) {
            println!("    sample: {s}");
        }
        for s in self.edge_mismatches.iter().take(8) {
            println!("    edge: {s}");
        }
    }

    pub fn all_equal(&self) -> bool {
        self.sha_match
            && self.chunk_mismatches == 0
            && self.edge_mismatches.is_empty()
            && self.exact_mismatches.unwrap_or(0) == 0
    }
}

/// Compare `f` against the fixture's expected stream for `name`.
pub fn compare(fixture: &Fixture, name: &str, stream: Stream, f: &dyn Fn(&[f64]) -> f64) -> Report {
    let ff = &fixture.functions[name];
    let samples = generate(name, ff.seed);
    assert_eq!(samples.len(), ff.count as usize, "{name}: generated count");
    let ours: Vec<f64> = samples.iter().map(|s| f(&s.args)).collect();
    let chunk = fixture.chunk_size as usize;
    let digests = chunk_digests(&ours, chunk);
    let (exp_chunks, exp_sha, full_name): (&[String], &str, String) = match stream {
        Stream::Main => (&ff.chunks, &ff.sha256, name.to_string()),
        Stream::Legacy => {
            let l = ff.legacy.as_ref().expect("legacy stream");
            (&l.chunks, &l.sha256, format!("{name}_legacy"))
        }
    };
    assert_eq!(digests.len(), exp_chunks.len(), "{name}: chunk count");
    let chunk_mismatches = digests
        .iter()
        .zip(exp_chunks)
        .filter(|(a, b)| a != b)
        .count();
    let sha_match = full_digest(&ours) == exp_sha;

    let mut by_segment: BTreeMap<&'static str, (usize, usize)> = BTreeMap::new();
    let mut sample_lines = Vec::new();
    let exact_mismatches = load_full(&fixture.host(), &full_name).map(|node| {
        assert_eq!(node.len(), ours.len(), "{name}: full dump length");
        let mut bad = 0usize;
        for (i, (s, (&a, &b))) in samples.iter().zip(ours.iter().zip(&node)).enumerate() {
            let e = by_segment.entry(s.segment).or_insert((0, 0));
            e.1 += 1;
            if canon(a) != canon(b) {
                bad += 1;
                e.0 += 1;
                if sample_lines.len() < 32 {
                    let args: Vec<String> = s.args.iter().map(|&x| format!("{x:e}")).collect();
                    sample_lines.push(format!(
                        "#{i} {}({}) ours={} ({:e}) node={} ({:e})",
                        s.segment,
                        args.join(", "),
                        hex(a),
                        a,
                        hex(b),
                        b
                    ));
                }
            }
        }
        bad
    });

    let mut edge_mismatches = Vec::new();
    for (i, e) in ff.edges.iter().enumerate() {
        let args: Vec<f64> = e.inputs.iter().map(|h| parse_hex(h)).collect();
        let want = match stream {
            Stream::Main => e.out.clone(),
            Stream::Legacy => ff.legacy.as_ref().unwrap().edges[i].clone(),
        };
        let got = hex(f(&args));
        if got != want {
            let a: Vec<String> = args.iter().map(|&x| format!("{x:e}")).collect();
            edge_mismatches.push(format!("({}) ours={got} node={want}", a.join(", ")));
        }
    }

    Report {
        name: match stream {
            Stream::Main => format!("{} {name}", fixture.host()),
            Stream::Legacy => format!("{} {name}_legacy", fixture.host()),
        },
        generated: ours.len(),
        chunk_mismatches,
        chunks: exp_chunks.len(),
        exact_mismatches,
        by_segment,
        samples: sample_lines,
        edges: ff.edges.len(),
        edge_mismatches,
        sha_match,
    }
}

#[derive(Clone, Copy)]
pub enum Stream {
    /// The function's main stream (Node 24 with default flags).
    Main,
    /// `pow` only: Node 24 under `--no-use-std-math-pow`.
    Legacy,
}
