//! D5 parity: `race_core::rng` against fixtures dumped from the TS oracle
//! (`packages/race-core/src/rng.ts`) by `scripts/oracle/dump-rng-fixtures.ts`.
//!
//! Regenerate with `node --import tsx scripts/oracle/dump-rng-fixtures.ts`.

use std::fs::File;
use std::io::Read;
use std::path::PathBuf;

use flate2::read::GzDecoder;
use race_core::rng::{DeterministicRng, create_race_rng, hash_string, hash_utf16};
use serde::Deserialize;
use sha2::{Digest, Sha256};

fn load_fixture<T: for<'de> Deserialize<'de>>(name: &str) -> T {
    let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "tests", "fixtures", name]
        .iter()
        .collect();
    let file = File::open(&path).unwrap_or_else(|error| {
        panic!(
            "missing fixture {} ({error}); run `node --import tsx scripts/oracle/dump-rng-fixtures.ts`",
            path.display()
        )
    });
    let mut bytes = Vec::new();
    GzDecoder::new(file)
        .read_to_end(&mut bytes)
        .expect("gunzip fixture");
    serde_json::from_slice(&bytes).expect("parse fixture JSON")
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

fn f64_from_hex(value: &str) -> f64 {
    f64::from_bits(u64::from_str_radix(value, 16).expect("f64 bit-hex"))
}

fn f64_hex(value: f64) -> String {
    format!("{:016x}", value.to_bits())
}

// ---------------------------------------------------------------------------
// strgen-v1, ported from scripts/oracle/dump-rng-fixtures.ts.

struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }

    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }
}

struct CharClass {
    astral: bool,
    ranges: &'static [(u32, u32)],
}

const CLASSES: [CharClass; 16] = [
    CharClass {
        astral: false,
        ranges: &[(0x20, 0x7e)],
    },
    CharClass {
        astral: false,
        ranges: &[(0x61, 0x7a), (0x30, 0x39)],
    },
    CharClass {
        astral: false,
        ranges: &[
            (0x3a, 0x3a),
            (0x2d, 0x2d),
            (0x5f, 0x5f),
            (0x20, 0x20),
            (0x2f, 0x2f),
        ],
    },
    CharClass {
        astral: false,
        ranges: &[(0xc0, 0xff)],
    },
    CharClass {
        astral: false,
        ranges: &[(0x1ea0, 0x1ef9)],
    },
    CharClass {
        astral: false,
        ranges: &[
            (0x102, 0x103),
            (0x110, 0x111),
            (0x128, 0x129),
            (0x168, 0x169),
            (0x1a0, 0x1a1),
            (0x1af, 0x1b0),
        ],
    },
    CharClass {
        astral: false,
        ranges: &[(0x300, 0x323)],
    },
    CharClass {
        astral: false,
        ranges: &[(0x4e00, 0x9fff)],
    },
    CharClass {
        astral: false,
        ranges: &[(0xac00, 0xd7a3)],
    },
    CharClass {
        astral: true,
        ranges: &[(0x1f300, 0x1faff), (0x1f1e6, 0x1f1ff)],
    },
    CharClass {
        astral: true,
        ranges: &[(0x10000, 0x10ffff)],
    },
    CharClass {
        astral: false,
        ranges: &[(0xd800, 0xdbff)],
    },
    CharClass {
        astral: false,
        ranges: &[(0xdc00, 0xdfff)],
    },
    CharClass {
        astral: false,
        ranges: &[(0x0000, 0xffff)],
    },
    CharClass {
        astral: false,
        ranges: &[(0x00, 0x1f), (0x7f, 0x9f)],
    },
    CharClass {
        astral: false,
        ranges: &[(0xfeff, 0xfeff), (0xfffd, 0xffff), (0x200b, 0x200d)],
    },
];

const PROFILES: [&[u32]; 7] = [
    &[0, 1, 1, 2],
    &[0, 1, 3, 4, 4, 5, 6, 2],
    &[0, 1, 9, 9, 10, 4],
    &[0, 11, 12, 13, 9, 10],
    &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    &[7, 8, 0, 2],
    &[1, 1, 1, 2],
];

fn len_u32(len: usize) -> u32 {
    u32::try_from(len).expect("table length fits u32")
}

fn unit(value: u32) -> u16 {
    u16::try_from(value).expect("BMP code unit")
}

fn push_from_class(rng: &mut Mulberry32, class_index: u32, units: &mut Vec<u16>) {
    let class = &CLASSES[class_index as usize];
    let (lo, hi) = class.ranges[rng.below(len_u32(class.ranges.len())) as usize];
    let value = lo + rng.below(hi - lo + 1);
    if class.astral {
        let offset = value - 0x10000;
        units.push(unit(0xd800 + (offset >> 10)));
        units.push(unit(0xdc00 + (offset & 0x3ff)));
    } else {
        units.push(unit(value));
    }
}

fn generate_units(rng: &mut Mulberry32) -> Vec<u16> {
    let roll = rng.below(100);
    let length = if roll < 1 {
        0
    } else if roll < 40 {
        1 + rng.below(8)
    } else if roll < 85 {
        1 + rng.below(40)
    } else if roll < 98 {
        1 + rng.below(200)
    } else {
        1 + rng.below(2000)
    } as usize;

    let profile_index = rng.below(len_u32(PROFILES.len()) + 1) as usize;
    let single;
    let profile: &[u32] = if profile_index < PROFILES.len() {
        PROFILES[profile_index]
    } else {
        single = [rng.below(len_u32(CLASSES.len()))];
        &single
    };
    let mut units = Vec::with_capacity(length + 1);
    while units.len() < length {
        let class_index = profile[rng.below(len_u32(profile.len())) as usize];
        push_from_class(rng, class_index, &mut units);
    }
    units
}

// ---------------------------------------------------------------------------
// hashString

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HashFixture {
    format: String,
    generator: String,
    generator_seed: u32,
    count: u32,
    chunk_size: u32,
    edge_cases: Vec<HashCase>,
    samples: Vec<HashSample>,
    chunk_hash_digests: Vec<String>,
    chunk_units_digests: Vec<String>,
}

#[derive(Deserialize)]
struct HashCase {
    units: Vec<u16>,
    hash: u32,
}

#[derive(Deserialize)]
struct HashSample {
    index: u32,
    units: Vec<u16>,
    hash: u32,
}

/// Checks one code-unit string through both entry points: `hash_utf16`
/// always, and `hash_string` when the units are well-formed UTF-16.
fn hash_matches(units: &[u16], expected: u32) -> bool {
    if hash_utf16(units.iter().copied()) != expected {
        return false;
    }
    match String::from_utf16(units) {
        Ok(text) => hash_string(&text) == expected,
        Err(_) => true,
    }
}

#[test]
fn hash_string_matches_ts_on_edge_cases() {
    let fixture: HashFixture = load_fixture("rng-hash.json.gz");
    assert_eq!(fixture.format, "rng-hash/1");
    let mismatches: Vec<usize> = fixture
        .edge_cases
        .iter()
        .enumerate()
        .filter(|(_, case)| !hash_matches(&case.units, case.hash))
        .map(|(index, _)| index)
        .collect();
    println!(
        "edge cases: {}/{} match",
        fixture.edge_cases.len() - mismatches.len(),
        fixture.edge_cases.len()
    );
    assert!(
        mismatches.is_empty(),
        "edge-case mismatches at {mismatches:?}"
    );
}

#[test]
fn hash_string_matches_ts_on_one_million_strings() {
    let fixture: HashFixture = load_fixture("rng-hash.json.gz");
    assert_eq!(fixture.generator, "strgen-v1");
    assert_eq!(fixture.count % fixture.chunk_size, 0);
    let chunks = (fixture.count / fixture.chunk_size) as usize;
    assert_eq!(fixture.chunk_hash_digests.len(), chunks);
    assert_eq!(fixture.chunk_units_digests.len(), chunks);

    let mut generator = Mulberry32::new(fixture.generator_seed);
    let mut samples = fixture.samples.iter().peekable();
    let mut sample_checked = 0usize;
    let mut sample_failed = Vec::new();
    let mut units_chunk_failed = Vec::new();
    let mut hash_chunk_failed = Vec::new();

    for chunk in 0..chunks {
        let mut units_digest = Sha256::new();
        let mut hash_digest = Sha256::new();
        for offset in 0..fixture.chunk_size {
            let index = u32::try_from(chunk).expect("chunk index") * fixture.chunk_size + offset;
            let units = generate_units(&mut generator);
            let hash = hash_utf16(units.iter().copied());
            if let Ok(text) = String::from_utf16(&units) {
                assert_eq!(
                    hash_string(&text),
                    hash,
                    "str/utf16 paths disagree at {index}"
                );
            }
            units_digest.update(len_u32(units.len()).to_le_bytes());
            for &code_unit in &units {
                units_digest.update(code_unit.to_le_bytes());
            }
            hash_digest.update(hash.to_le_bytes());

            if let Some(sample) = samples.next_if(|sample| sample.index == index) {
                sample_checked += 1;
                if sample.units != units || !hash_matches(&sample.units, sample.hash) {
                    sample_failed.push(index);
                }
            }
        }
        if hex(&units_digest.finalize()) != fixture.chunk_units_digests[chunk] {
            units_chunk_failed.push(chunk);
        }
        if hex(&hash_digest.finalize()) != fixture.chunk_hash_digests[chunk] {
            hash_chunk_failed.push(chunk);
        }
    }

    assert_eq!(
        samples.next().map(|sample| sample.index),
        None,
        "unchecked samples"
    );
    let strings_ok = (chunks - hash_chunk_failed.len()) * fixture.chunk_size as usize;
    println!(
        "hashString: {strings_ok}/{} strings match ({}/{chunks} chunk digests); \
         generator {}/{chunks} chunks; explicit samples {}/{sample_checked}",
        fixture.count,
        chunks - hash_chunk_failed.len(),
        chunks - units_chunk_failed.len(),
        sample_checked - sample_failed.len(),
    );
    assert!(
        sample_failed.is_empty(),
        "sample mismatches at {sample_failed:?}"
    );
    assert!(
        units_chunk_failed.is_empty(),
        "strgen-v1 port diverges from TS in chunks {units_chunk_failed:?}"
    );
    assert!(
        hash_chunk_failed.is_empty(),
        "hashString mismatches in chunks {hash_chunk_failed:?}"
    );
}

// ---------------------------------------------------------------------------
// createRaceRng streams

#[derive(Deserialize)]
struct StreamFixture {
    format: String,
    count: usize,
    cases: Vec<StreamCase>,
    meta: Vec<StreamCase>,
}

#[derive(Deserialize)]
struct StreamCase {
    seed: String,
    stream: String,
    next: Vec<String>,
    ops: Vec<Op>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum Op {
    Range { a: String, b: String, out: String },
    Integer { a: i64, b: i64, out: i64 },
}

/// Replays one case; returns `(values checked, mismatch descriptions)`.
fn replay(case: &StreamCase) -> (usize, Vec<String>) {
    let mut rng = create_race_rng(&case.seed, &case.stream);
    let mut checked = 0;
    let mut failures = Vec::new();
    for (draw, expected) in case.next.iter().enumerate() {
        let actual = f64_hex(rng.next_f64());
        checked += 1;
        if &actual != expected {
            failures.push(format!("next[{draw}] {actual} != {expected}"));
        }
    }
    for (index, op) in case.ops.iter().enumerate() {
        checked += 1;
        match op {
            Op::Range { a, b, out } => {
                let actual = f64_hex(rng.range(f64_from_hex(a), f64_from_hex(b)));
                if &actual != out {
                    failures.push(format!("ops[{index}] range({a},{b}) {actual} != {out}"));
                }
            }
            Op::Integer { a, b, out } => {
                let actual = rng.integer(*a, *b);
                if actual != *out {
                    failures.push(format!("ops[{index}] integer({a},{b}) {actual} != {out}"));
                }
            }
        }
    }
    (checked, failures)
}

fn replay_all(name: &str, cases: &[StreamCase]) {
    let mut values = 0;
    let mut failed_cases = Vec::new();
    for (index, case) in cases.iter().enumerate() {
        let (checked, failures) = replay(case);
        values += checked;
        if !failures.is_empty() {
            failed_cases.push(format!(
                "#{index} {:?}:{:?}: {}",
                case.seed,
                case.stream,
                failures.join("; ")
            ));
        }
    }
    println!(
        "{name}: {}/{} cases match ({values} values)",
        cases.len() - failed_cases.len(),
        cases.len()
    );
    assert!(
        failed_cases.is_empty(),
        "{} mismatching cases, first: {}",
        failed_cases.len(),
        failed_cases[0]
    );
}

#[test]
fn create_race_rng_matches_ts_on_ten_thousand_streams() {
    let fixture: StreamFixture = load_fixture("rng-streams.json.gz");
    assert_eq!(fixture.format, "rng-streams/1");
    assert_eq!(fixture.cases.len(), fixture.count);
    assert!(fixture.count >= 10_000);
    replay_all("createRaceRng", &fixture.cases);
}

#[test]
fn meta_streams_match_ts() {
    let fixture: StreamFixture = load_fixture("rng-streams.json.gz");
    for label in ["chaos:week:3", "chaos:manual:", "auto-loadout:"] {
        assert!(
            fixture
                .meta
                .iter()
                .any(|case| case.stream.starts_with(label)),
            "meta fixture lacks {label}"
        );
    }
    replay_all("meta streams", &fixture.meta);
}

/// Values printed by the TS oracle (`createRaceRng(seed, stream)` then four
/// `nextUint32()`, `next()`, `integer(0, 9)`, `range(-1, 1)`), inlined so the
/// season meta streams are pinned even without the fixture files.
/// `(seed, stream, four nextUint32, next() bits, integer(0, 9), range(-1, 1) bits)`.
type InlineCase = (&'static str, &'static str, [u32; 4], u64, i64, u64);

#[test]
fn meta_streams_match_inline_ts_values() {
    let cases: [InlineCase; 4] = [
        (
            "cm3k9x2b40000qz8w1v7d5e6f",
            "chaos:week:3",
            [0x9b1a_47e1, 0xaf27_cc52, 0x8319_4784, 0xd6db_dc70],
            0x3f9f_9346_6800_0000,
            1,
            0x3f8c_e7b9_2000_0000,
        ),
        (
            "42",
            "chaos:week:3",
            [0xa492_d50b, 0x384a_8852, 0x415f_62b2, 0x0c27_f2f6],
            0x3fe7_aa06_5140_0000,
            8,
            0xbfe8_29ed_d100_0000,
        ),
        (
            "cm3k9x2b40000qz8w1v7d5e6f",
            "auto-loadout:cm3k9x2b40001qz8wabcdefgh",
            [0x6923_1740, 0x72a9_4605, 0x1750_ad11, 0x5ca3_0168],
            0x3fe5_a9bf_59e0_0000,
            3,
            0xbfe7_5572_5a00_0000,
        ),
        (
            "season-3",
            "chaos:manual:3:1731234567890",
            [0xe717_3a7f, 0x0b43_9033, 0x51fc_5eb1, 0x9f68_6724],
            0x3fec_432e_5440_0000,
            2,
            0xbfeb_9eec_ea40_0000,
        ),
    ];
    for (seed, stream, words, next, integer, range) in cases {
        let mut rng = create_race_rng(seed, stream);
        for word in words {
            assert_eq!(rng.next_u32(), word, "{seed}:{stream}");
        }
        assert_eq!(rng.next_f64().to_bits(), next, "{seed}:{stream} next");
        assert_eq!(rng.integer(0, 9), integer, "{seed}:{stream} integer");
        assert_eq!(
            rng.range(-1.0, 1.0).to_bits(),
            range,
            "{seed}:{stream} range"
        );
    }
}

#[test]
fn create_race_rng_keys_by_seed_colon_stream() {
    assert_eq!(create_race_rng("a:b", "c"), DeterministicRng::new("a:b:c"));
    assert_eq!(create_race_rng("a", "b:c"), create_race_rng("a:b", "c"));
    assert_eq!(create_race_rng("", ""), DeterministicRng::new(":"));
}
