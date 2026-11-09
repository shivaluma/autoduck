//! `race-cli corpus gen`: deterministic oracle corpus (Phase 1, D26 / G1).
//!
//! Each output line is one race config in the **TS input shape** accepted by
//! `raceConfigSchema` (`packages/race-protocol/src/index.ts`). Case `i` is
//! derived only from `(root seed, i)`, so a longer corpus is a strict
//! extension of a shorter one and any single case can be regenerated.
//!
//! Coverage (see `docs/rewrite/phase1-notes.md` § tooling):
//! - case `i` uses chaos slot `i % 8` (no `chaosConfig`, then the 7 Chaos
//!   types) and lobby size `2 + (i / 8) % 15`, so the first 120 cases cover
//!   every (chaos, lobby 2..=16) pair;
//! - pickups: omitted (engine default = off), `enabled: false`, the official
//!   production block, or a randomised block;
//! - ghost ducks (`isGhost: true`) on/off, loadouts, item tuning;
//! - float knobs written as awkward decimal text: shortest-repr values that
//!   need 17 significant digits, range boundaries and their neighbours, long
//!   non-shortest decimals in exponent form, and exact binary midpoints that
//!   only a correctly rounding parser resolves (ties-to-even).
//!
//! JSON is written by a tiny local writer so number text is emitted exactly
//! as generated (serde_json would re-format it).

use std::fmt::Write as _;
use std::io::Write as _;

use anyhow::{Context, Result};

/// Fixed root seed ("DUCKRACE"). Changing it changes every case.
pub const DEFAULT_ROOT_SEED: u64 = 0x4455_434B_5241_4345;
/// Bump when the generator's output for a given (seed, index) changes.
pub const CORPUS_GENERATOR_VERSION: &str = "corpus-v1";

const CHAOS_TYPES: [&str; 7] = [
    "NORMAL",
    "REVERSE",
    "DUO",
    "TRIPLE_ELIMINATION",
    "CUT_LINE",
    "CONSTRUCTORS",
    "BOUNTY_HUNT",
];
const RACE_ITEMS: [&str; 9] = [
    "NITRO",
    "DRAFT_FIN",
    "PADDLE_BURST",
    "BUBBLE_SHIELD",
    "FEATHER",
    "SHOCK_ABSORBER",
    "HOMING_ROCKET",
    "BANANA",
    "QUACK_HORN",
];
const WILD_ITEMS: [&str; 8] = [
    "MINI_NITRO",
    "TAILWIND",
    "MINI_BUBBLE",
    "MINI_ROCKET",
    "BANANA",
    "QUACK_HORN",
    "FEATHER",
    "SLIPSTREAM_MAGNET",
];
const NAMES: [&str; 16] = [
    "Vịt Bầu",
    "Đức Anh",
    "Quack",
    "Nguyễn Văn A",
    "Lan 🦆",
    "Minh",
    "O'Brien",
    "\"Quote\" Duck",
    "back\\slash",
    "Ünïcödé",
    "李雷",
    "Trần Thị Bích Ngọc",
    "tab\there",
    "a",
    "ZZ Top",
    "Phở Bò",
];
const ID_ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_:-";

// ---------------------------------------------------------------------------
// RNG (tooling only; not the engine RNG)

/// splitmix64. Tooling-only randomness: the engine never sees this stream,
/// only the configs it produces.
#[derive(Clone)]
pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `0..n` (multiply-shift; the tiny bias is irrelevant here).
    pub fn below(&mut self, n: u64) -> u64 {
        assert!(n > 0);
        ((u128::from(self.next_u64()) * u128::from(n)) >> 64) as u64
    }

    pub fn range_inclusive(&mut self, lo: u64, hi: u64) -> u64 {
        lo + self.below(hi - lo + 1)
    }

    /// `true` with probability `percent / 100`.
    pub fn percent(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }

    /// Uniform in `[0, 1)` with 53 random bits.
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
    }

    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len() as u64) as usize]
    }

    pub fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i as u64 + 1) as usize;
            items.swap(i, j);
        }
    }
}

/// Independent stream for case `index`.
pub fn case_rng(root_seed: u64, index: u64) -> SplitMix64 {
    let mut mixer = SplitMix64::new(root_seed ^ index.wrapping_mul(0xD1B5_4A32_D192_ED03));
    SplitMix64::new(mixer.next_u64())
}

// ---------------------------------------------------------------------------
// Minimal JSON writer that keeps number text verbatim

#[derive(Debug, Clone)]
pub enum Json {
    Null,
    Bool(bool),
    /// Number text emitted verbatim (must be valid JSON number syntax).
    Num(String),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(&'static str, Json)>),
}

impl Json {
    fn int(value: u64) -> Self {
        Json::Num(value.to_string())
    }

    fn str(value: impl Into<String>) -> Self {
        Json::Str(value.into())
    }

    pub fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Json::Num(text) => out.push_str(text),
            Json::Str(s) => write_json_string(s, out),
            Json::Arr(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Json::Obj(fields) => {
                out.push('{');
                for (i, (key, value)) in fields.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_json_string(key, out);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_json_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

// ---------------------------------------------------------------------------
// Awkward float text

/// Which awkward form a float knob was written in (for coverage stats).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FloatKind {
    /// Shortest round-trip text with exactly 17 significant digits.
    Shortest17,
    /// `lo`, `hi`, or the adjacent double just inside the range.
    Boundary,
    /// 18–25 significant digits in exponent form (not the shortest repr).
    LongExponent,
    /// The exact decimal expansion of the midpoint between two adjacent
    /// doubles; a correct parser rounds it to the even neighbour.
    ExactMidpoint,
    /// Short "nice" values (`0.15`, `1.25`, `1e0`, `125e-2`, ...).
    Nice,
}

/// A generated float knob: its JSON text and the f64 a correctly rounding
/// parser must produce from it.
#[derive(Debug, Clone)]
pub struct FloatText {
    pub text: String,
    #[cfg_attr(not(test), allow(dead_code))]
    pub value: f64,
    pub kind: FloatKind,
}

/// Number of significant digits in Rust's shortest round-trip `Display`.
pub fn shortest_significant_digits(x: f64) -> usize {
    let s = format!("{}", x.abs());
    let digits: String = s.chars().filter(char::is_ascii_digit).collect();
    let trimmed = digits.trim_start_matches('0').trim_end_matches('0');
    trimmed.len().max(1)
}

fn next_up(x: f64) -> f64 {
    debug_assert!(x >= 0.0 && x.is_finite());
    f64::from_bits(x.to_bits() + 1)
}

fn next_down(x: f64) -> f64 {
    debug_assert!(x > 0.0 && x.is_finite());
    f64::from_bits(x.to_bits() - 1)
}

/// `(mantissa, exponent)` with `x == mantissa * 2^exponent` (x finite, >= 0).
fn decompose(x: f64) -> (u64, i32) {
    let bits = x.to_bits();
    let exp_bits = ((bits >> 52) & 0x7ff) as i32;
    let frac = bits & ((1u64 << 52) - 1);
    if exp_bits == 0 {
        (frac, -1074)
    } else {
        (frac | (1u64 << 52), exp_bits - 1075)
    }
}

/// Exact decimal text of `n * 2^exp` for `n > 0`, `exp < 0`.
fn exact_decimal(n: u64, exp: i32) -> String {
    debug_assert!(exp < 0);
    let k = (-exp) as usize;
    // n * 5^k as base-1e9 little-endian limbs.
    let mut limbs: Vec<u64> = Vec::new();
    let mut v = n;
    while v > 0 {
        limbs.push(v % 1_000_000_000);
        v /= 1_000_000_000;
    }
    for _ in 0..k {
        let mut carry = 0u64;
        for limb in &mut limbs {
            let t = *limb * 5 + carry;
            *limb = t % 1_000_000_000;
            carry = t / 1_000_000_000;
        }
        if carry > 0 {
            limbs.push(carry);
        }
    }
    let mut digits = String::new();
    for (i, limb) in limbs.iter().rev().enumerate() {
        if i == 0 {
            let _ = write!(digits, "{limb}");
        } else {
            let _ = write!(digits, "{limb:09}");
        }
    }
    // Value is digits / 10^k.
    if digits.len() <= k {
        let zeros = "0".repeat(k - digits.len());
        let frac = format!("{zeros}{digits}");
        format!("0.{}", frac.trim_end_matches('0'))
    } else {
        let (int_part, frac) = digits.split_at(digits.len() - k);
        let frac = frac.trim_end_matches('0');
        if frac.is_empty() {
            int_part.to_string()
        } else {
            format!("{int_part}.{frac}")
        }
    }
}

/// Generate an awkward float in `[lo, hi]` (`0 <= lo < hi`, finite).
pub fn awkward_float(rng: &mut SplitMix64, lo: f64, hi: f64) -> FloatText {
    let roll = rng.below(100);
    if roll < 45 {
        // Shortest text needs 17 significant digits.
        for _ in 0..256 {
            let x = lo + (hi - lo) * rng.unit();
            if x >= lo && x <= hi && shortest_significant_digits(x) == 17 {
                return FloatText {
                    text: format!("{x}"),
                    value: x,
                    kind: FloatKind::Shortest17,
                };
            }
        }
    }
    if roll < 60 {
        let candidates = [lo, hi, next_up(lo), next_down(hi)];
        let x = *rng.pick(&candidates);
        return FloatText {
            text: format!("{x}"),
            value: x,
            kind: FloatKind::Boundary,
        };
    }
    if roll < 75 {
        let x = lo + (hi - lo) * rng.unit();
        let precision = rng.range_inclusive(17, 24) as usize; // 18..=25 sig digits
        let text = format!("{x:.precision$e}");
        let value: f64 = text.parse().expect("rust parses its own exponent text");
        if value >= lo && value <= hi {
            return FloatText {
                text,
                value,
                kind: FloatKind::LongExponent,
            };
        }
    }
    if roll < 90 {
        let floor = if lo > 0.01 { lo } else { 0.01 };
        let x = floor + (hi - floor) * rng.unit();
        let up = next_up(x);
        if x >= lo && up <= hi {
            let (m, e) = decompose(x);
            // x = m*2^e, next = (m+1)*2^e, midpoint = (2m+1)*2^(e-1).
            let text = exact_decimal(2 * m + 1, e - 1);
            let value = if m % 2 == 0 { x } else { up };
            return FloatText {
                text,
                value,
                kind: FloatKind::ExactMidpoint,
            };
        }
    }
    // Nice values, some in unusual-but-valid JSON number forms.
    let nice: [(&str, f64); 10] = [
        ("0.15", 0.15),
        ("0.12", 0.12),
        ("1.25", 1.25),
        ("1", 1.0),
        ("1.0", 1.0),
        ("1e0", 1.0),
        ("125e-2", 1.25),
        ("0.1", 0.1),
        ("0.3333333333333333", 0.333_333_333_333_333_3),
        ("1E-1", 0.1),
    ];
    let in_range: Vec<&(&str, f64)> = nice.iter().filter(|(_, v)| *v >= lo && *v <= hi).collect();
    if in_range.is_empty() {
        let x = lo + (hi - lo) * 0.5;
        return FloatText {
            text: format!("{x}"),
            value: x,
            kind: FloatKind::Nice,
        };
    }
    let (text, value) = **rng.pick(&in_range);
    FloatText {
        text: text.to_string(),
        value,
        kind: FloatKind::Nice,
    }
}

// ---------------------------------------------------------------------------
// Case generation

/// Pickup block variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickupMode {
    /// `pickupConfig` omitted: the TS engine treats pickups as off.
    Omitted,
    /// `pickupConfig: { enabled: false, ... }`.
    Disabled,
    /// The block `lib/season3-race.ts` writes for official races.
    Production,
    /// Each field present or defaulted at random.
    Randomized,
}

/// Coverage facts about one generated case.
#[derive(Debug, Clone)]
pub struct CaseInfo {
    pub lobby: usize,
    pub chaos: Option<&'static str>,
    pub pickups: PickupMode,
    pub ghosts: usize,
    pub floats: Vec<FloatKind>,
}

fn hex_seed(rng: &mut SplitMix64) -> String {
    let mut s = String::with_capacity(64);
    for _ in 0..4 {
        let _ = write!(s, "{:016x}", rng.next_u64());
    }
    match rng.below(20) {
        0 => s.to_ascii_uppercase(),
        1 => s
            .chars()
            .enumerate()
            .map(|(i, c)| {
                if i % 2 == 0 {
                    c.to_ascii_uppercase()
                } else {
                    c
                }
            })
            .collect(),
        _ => s,
    }
}

fn race_id(rng: &mut SplitMix64, index: u64) -> String {
    match rng.below(4) {
        0 | 1 => format!("{}", 1 + rng.below(5000)),
        2 => format!("test-{index}-{:x}", rng.next_u64() & 0xffff),
        _ => format!(
            "c{:016x}{:08x}",
            rng.next_u64(),
            rng.next_u64() & 0xffff_ffff
        ),
    }
}

fn player_ids(rng: &mut SplitMix64, count: usize) -> Vec<String> {
    let style = rng.below(100);
    let mut ids: Vec<String> = Vec::with_capacity(count);
    while ids.len() < count {
        let id = if style < 60 {
            // Realistic: numeric user ids of mixed digit counts ("10" < "9").
            format!("{}", 1 + rng.below(2000))
        } else if style < 85 {
            // Mixed alphabet: exercises ICU collation (`:`/`_` before digits,
            // case differences at tertiary strength).
            let len = rng.range_inclusive(1, 12) as usize;
            (0..len).map(|_| *rng.pick(ID_ALPHABET) as char).collect()
        } else {
            let prefix = *rng.pick(&["p:", "u_", "user-", "P-", "_", ":"]);
            format!("{prefix}{}", rng.below(300))
        };
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

fn pick_distinct<'a>(rng: &mut SplitMix64, items: &[&'a str], count: usize) -> Vec<&'a str> {
    let mut pool: Vec<&'a str> = items.to_vec();
    rng.shuffle(&mut pool);
    pool.truncate(count);
    pool
}

/// Generate case `index` as a JSON object plus its coverage facts.
pub fn generate_case(root_seed: u64, index: u64) -> (Json, CaseInfo) {
    let mut rng = case_rng(root_seed, index);
    let chaos_slot = (index % 8) as usize;
    let lobby = 2 + ((index / 8) % 15) as usize;
    let chaos = if chaos_slot == 0 {
        None
    } else {
        Some(CHAOS_TYPES[chaos_slot - 1])
    };
    let mut floats = Vec::new();

    let ids = player_ids(&mut rng, lobby);
    let ghosts = if rng.percent(30) {
        if lobby >= 4 && rng.percent(15) { 2 } else { 1 }
    } else {
        0
    };
    // Ghosts are the last `ghosts` entries of a shuffled index list.
    let mut order: Vec<usize> = (0..lobby).collect();
    rng.shuffle(&mut order);
    let ghost_set: Vec<usize> = order[lobby - ghosts..].to_vec();
    let official: Vec<&String> = (0..lobby)
        .filter(|i| !ghost_set.contains(i))
        .map(|i| &ids[i])
        .collect();

    let mut players = Vec::with_capacity(lobby);
    for (i, id) in ids.iter().enumerate() {
        let is_ghost = ghost_set.contains(&i);
        let name = if is_ghost {
            "Vịt Ma 👻".to_string()
        } else {
            format!("{} {}", rng.pick(&NAMES), i)
        };
        let mut fields: Vec<(&'static str, Json)> = vec![
            ("playerId", Json::str(id.clone())),
            ("name", Json::str(name)),
        ];
        if rng.percent(20) {
            let key = format!(
                "{{\"hat\":\"hat-{}\",\"body\":\"body-{}\"}}",
                rng.below(40),
                rng.below(40)
            );
            fields.push(("cosmeticKey", Json::str(key)));
        }
        if is_ghost {
            fields.push(("isGhost", Json::Bool(true)));
        } else if rng.percent(10) {
            fields.push(("isGhost", Json::Bool(false)));
        }
        players.push(Json::Obj(fields));
    }

    let mut loadouts = Vec::new();
    for id in &ids {
        if !rng.percent(70) {
            continue;
        }
        let count = rng.below(3) as usize;
        let items = pick_distinct(&mut rng, &RACE_ITEMS, count);
        let source = if rng.percent(30) { "AUTO" } else { "PLAYER" };
        loadouts.push(Json::Obj(vec![
            ("playerId", Json::str(id.clone())),
            (
                "itemIds",
                Json::Arr(items.into_iter().map(Json::str).collect()),
            ),
            ("source", Json::str(source)),
        ]));
    }

    let mut config: Vec<(&'static str, Json)> = vec![
        ("raceId", Json::str(race_id(&mut rng, index))),
        ("seed", Json::str(hex_seed(&mut rng))),
    ];
    if rng.percent(30) {
        // Explicit copies of the TS defaults (packages/race-protocol).
        config.push(("protocolVersion", Json::str("1.0.0")));
        config.push(("engineVersion", Json::str("1.2.0")));
        config.push(("balanceVersion", Json::str("S3.15")));
        config.push(("trackVersion", Json::str("river-01-v2")));
        config.push(("pickupSpawnVersion", Json::str("pickups-v1")));
        config.push(("wildItemBalanceVersion", Json::str("wild-items-v6")));
        config.push(("hazardBalanceVersion", Json::str("hazards-v1")));
    }
    if rng.percent(50) {
        config.push(("tickRate", Json::int(60)));
    }
    config.push(("players", Json::Arr(players)));
    if !loadouts.is_empty() || rng.percent(50) {
        config.push(("loadouts", Json::Arr(loadouts)));
    }

    if let Some(kind) = chaos {
        let mut chaos_fields: Vec<(&'static str, Json)> = vec![("type", Json::str(kind))];
        let mut members: Vec<String> = official.iter().map(|s| (*s).clone()).collect();
        if members.is_empty() {
            members = ids.clone();
        }
        rng.shuffle(&mut members);
        match kind {
            "DUO" => {
                let mut groups: Vec<Vec<String>> =
                    members.chunks(2).map(<[String]>::to_vec).collect();
                if groups.len() > 1 && groups.last().is_some_and(|g| g.len() == 1) {
                    let last = groups.pop().expect("non-empty");
                    groups.last_mut().expect("non-empty").extend(last);
                }
                chaos_fields.push(("groups", groups_json(groups)));
                if rng.percent(50) {
                    chaos_fields.push(("targetPlayerId", Json::Null));
                }
            }
            "CONSTRUCTORS" => {
                let split = members.len().div_ceil(2);
                let groups = vec![members[..split].to_vec(), members[split..].to_vec()];
                chaos_fields.push(("groups", groups_json(groups)));
            }
            "BOUNTY_HUNT" => {
                chaos_fields.push(("targetPlayerId", Json::str(members[0].clone())));
            }
            _ => {
                if rng.percent(40) {
                    chaos_fields.push(("targetPlayerId", Json::Null));
                }
            }
        }
        config.push(("chaosConfig", Json::Obj(chaos_fields)));
    }

    if rng.percent(35) {
        let knobs: [(&'static str, f64, f64); 4] = [
            ("nitroSpeedMultiplier", 1.0, 1.35),
            ("rocketSlowMultiplier", 0.1, 1.0),
            ("bananaKnockbackMultiplier", 0.5, 2.0),
            ("bananaSlowMultiplier", 0.75, 1.0),
        ];
        let mut tuning = Vec::new();
        for (key, lo, hi) in knobs {
            if rng.percent(60) {
                let f = awkward_float(&mut rng, lo, hi);
                floats.push(f.kind);
                tuning.push((key, Json::Num(f.text)));
            }
        }
        config.push(("itemTuning", Json::Obj(tuning)));
    }

    let pickups = match rng.below(100) {
        0..25 => PickupMode::Omitted,
        25..35 => PickupMode::Disabled,
        35..60 => PickupMode::Production,
        _ => PickupMode::Randomized,
    };
    match pickups {
        PickupMode::Omitted => {}
        PickupMode::Disabled => {
            let mut block: Vec<(&'static str, Json)> = vec![("enabled", Json::Bool(false))];
            if rng.percent(50) {
                block.push(("hazardsEnabled", Json::Bool(rng.percent(50))));
            }
            config.push(("pickupConfig", Json::Obj(block)));
        }
        PickupMode::Production => {
            config.push(("pickupConfig", production_pickups()));
        }
        PickupMode::Randomized => {
            let mut block: Vec<(&'static str, Json)> = vec![("enabled", Json::Bool(true))];
            maybe_bool(&mut rng, &mut block, "goldenBoxEnabled");
            if rng.percent(70) {
                let f = awkward_float(&mut rng, 0.0, 1.0);
                floats.push(f.kind);
                block.push(("goldenBoxProbability", Json::Num(f.text)));
            }
            maybe_bool(&mut rng, &mut block, "hazardsEnabled");
            maybe_bool(&mut rng, &mut block, "positionAwareLoot");
            if rng.percent(70) {
                let f = awkward_float(&mut rng, 0.0, 3.0);
                floats.push(f.kind);
                block.push(("spawnMultiplier", Json::Num(f.text)));
            }
            if rng.percent(60) {
                block.push(("regularPickupCap", Json::int(rng.range_inclusive(1, 3))));
            }
            maybe_bool(&mut rng, &mut block, "manualItemsEnabled");
            maybe_bool(&mut rng, &mut block, "autoItemsEnabled");
            maybe_bool(&mut rng, &mut block, "chaosBoxEnabled");
            if rng.percent(15) {
                block.push(("forceItem", Json::str(*rng.pick(&WILD_ITEMS))));
            }
            if rng.percent(40) {
                // At most 4 of 8 so the loot table is never empty
                // (`rollWildItem` throws when every item is disabled).
                let count = rng.range_inclusive(0, 4) as usize;
                let disabled = pick_distinct(&mut rng, &WILD_ITEMS, count);
                block.push((
                    "disabledItems",
                    Json::Arr(disabled.into_iter().map(Json::str).collect()),
                ));
            }
            if rng.percent(25) {
                let count = rng.below(ids.len() as u64 + 1) as usize;
                let mut pool = ids.clone();
                rng.shuffle(&mut pool);
                pool.truncate(count);
                block.push((
                    "idealManualPlayerIds",
                    Json::Arr(pool.into_iter().map(Json::Str).collect()),
                ));
            }
            if rng.percent(10) {
                block.push(("forceGoldenBox", Json::Bool(true)));
            }
            config.push(("pickupConfig", Json::Obj(block)));
        }
    }

    (
        Json::Obj(config),
        CaseInfo {
            lobby,
            chaos,
            pickups,
            ghosts,
            floats,
        },
    )
}

fn maybe_bool(rng: &mut SplitMix64, block: &mut Vec<(&'static str, Json)>, key: &'static str) {
    if rng.percent(60) {
        block.push((key, Json::Bool(rng.percent(65))));
    }
}

fn groups_json(groups: Vec<Vec<String>>) -> Json {
    Json::Arr(
        groups
            .into_iter()
            .map(|g| Json::Arr(g.into_iter().map(Json::Str).collect()))
            .collect(),
    )
}

fn production_pickups() -> Json {
    // Mirrors lib/season3-race.ts (official races).
    Json::Obj(vec![
        ("enabled", Json::Bool(true)),
        ("goldenBoxEnabled", Json::Bool(true)),
        ("goldenBoxProbability", Json::Num("0.15".into())),
        ("hazardsEnabled", Json::Bool(true)),
        ("positionAwareLoot", Json::Bool(true)),
        ("spawnMultiplier", Json::Num("1.25".into())),
        ("regularPickupCap", Json::int(3)),
        ("manualItemsEnabled", Json::Bool(true)),
        ("autoItemsEnabled", Json::Bool(true)),
        ("chaosBoxEnabled", Json::Bool(false)),
        ("forceGoldenBox", Json::Bool(false)),
        ("disabledItems", Json::Arr(vec![])),
        ("idealManualPlayerIds", Json::Arr(vec![])),
    ])
}

/// One corpus line (no trailing newline).
#[cfg(test)]
pub fn case_line(root_seed: u64, index: u64) -> String {
    let (json, _) = generate_case(root_seed, index);
    let mut line = String::new();
    json.write(&mut line);
    line
}

/// Parse `--seed` as decimal or `0x`-prefixed hex.
pub fn parse_seed(text: &str) -> Result<u64, String> {
    let parsed = if let Some(hex) = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X")) {
        u64::from_str_radix(hex, 16)
    } else {
        text.parse::<u64>()
    };
    parsed.map_err(|e| format!("invalid seed {text:?}: {e}"))
}

/// `race-cli corpus gen`: write `count` lines to `out` (`-` = stdout) and a
/// coverage summary to stderr.
pub fn run_gen(count: u64, out: &str, root_seed: u64) -> Result<()> {
    let mut sink: Box<dyn std::io::Write> = if out == "-" {
        Box::new(std::io::BufWriter::new(std::io::stdout().lock()))
    } else {
        let file = std::fs::File::create(out).with_context(|| format!("create {out}"))?;
        Box::new(std::io::BufWriter::new(file))
    };
    let mut lobby_seen = [0u64; 17];
    let mut chaos_seen = [0u64; 8];
    let mut pickup_seen = [0u64; 4];
    let mut ghost_cases = 0u64;
    let mut float_kinds = [0u64; 5];
    let mut line = String::new();
    for index in 0..count {
        let (json, info) = generate_case(root_seed, index);
        line.clear();
        json.write(&mut line);
        line.push('\n');
        sink.write_all(line.as_bytes())?;
        lobby_seen[info.lobby] += 1;
        let chaos_slot = info.chaos.map_or(0, |c| {
            1 + CHAOS_TYPES.iter().position(|t| *t == c).unwrap_or(0)
        });
        chaos_seen[chaos_slot] += 1;
        pickup_seen[info.pickups as usize] += 1;
        if info.ghosts > 0 {
            ghost_cases += 1;
        }
        for kind in info.floats {
            float_kinds[kind as usize] += 1;
        }
    }
    sink.flush()?;
    eprintln!(
        "corpus gen: {count} cases ({CORPUS_GENERATOR_VERSION}, root seed {root_seed:#018x}) -> {out}"
    );
    eprintln!("  lobby 2..=16: {:?}", &lobby_seen[2..]);
    eprintln!("  chaos [none, {}]: {chaos_seen:?}", CHAOS_TYPES.join(", "));
    eprintln!("  pickups [omitted, disabled, production, randomized]: {pickup_seen:?}");
    eprintln!("  ghost cases: {ghost_cases}");
    eprintln!(
        "  float knobs [shortest17, boundary, long-exp, exact-midpoint, nice]: {float_kinds:?}"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn deterministic_and_prefix_stable() {
        for index in [0, 1, 7, 119, 500, 1999] {
            assert_eq!(
                case_line(DEFAULT_ROOT_SEED, index),
                case_line(DEFAULT_ROOT_SEED, index)
            );
        }
        assert_ne!(
            case_line(DEFAULT_ROOT_SEED, 3),
            case_line(DEFAULT_ROOT_SEED + 1, 3)
        );
    }

    #[test]
    fn first_120_cases_cover_every_chaos_and_lobby() {
        let mut seen = std::collections::BTreeSet::new();
        for index in 0..120 {
            let (_, info) = generate_case(DEFAULT_ROOT_SEED, index);
            seen.insert((info.chaos, info.lobby));
        }
        assert_eq!(seen.len(), 8 * 15);
    }

    #[test]
    fn lines_are_valid_and_respect_schema_bounds() {
        let mut pickup_modes = [false; 4];
        let mut ghost = (false, false);
        for index in 0..600 {
            let line = case_line(DEFAULT_ROOT_SEED, index);
            let v: Value = serde_json::from_str(&line).expect("valid JSON");
            let players = v["players"].as_array().expect("players");
            assert!((2..=16).contains(&players.len()));
            let mut ids: Vec<&str> = players
                .iter()
                .map(|p| p["playerId"].as_str().expect("id"))
                .collect();
            for id in &ids {
                assert!(!id.is_empty() && id.len() <= 64);
                assert!(id.bytes().all(|b| ID_ALPHABET.contains(&b)));
            }
            ids.sort();
            ids.dedup();
            assert_eq!(ids.len(), players.len(), "unique ids in case {index}");
            let seed = v["seed"].as_str().expect("seed");
            assert_eq!(seed.len(), 64);
            assert!(seed.bytes().all(|b| b.is_ascii_hexdigit()));
            let has_ghost = players.iter().any(|p| p["isGhost"] == Value::Bool(true));
            if has_ghost {
                ghost.0 = true;
            } else {
                ghost.1 = true;
            }
            if let Some(t) = v.get("itemTuning") {
                for (key, lo, hi) in [
                    ("nitroSpeedMultiplier", 1.0, 1.35),
                    ("rocketSlowMultiplier", 0.1, 1.0),
                    ("bananaKnockbackMultiplier", 0.5, 2.0),
                    ("bananaSlowMultiplier", 0.75, 1.0),
                ] {
                    if let Some(x) = t.get(key) {
                        let x = x.as_f64().expect("number");
                        assert!(x >= lo && x <= hi, "{key}={x}");
                    }
                }
            }
            let (_, info) = generate_case(DEFAULT_ROOT_SEED, index);
            pickup_modes[info.pickups as usize] = true;
            if let Some(p) = v.get("pickupConfig") {
                if let Some(x) = p.get("goldenBoxProbability") {
                    let x = x.as_f64().expect("number");
                    assert!((0.0..=1.0).contains(&x));
                }
                if let Some(x) = p.get("spawnMultiplier") {
                    let x = x.as_f64().expect("number");
                    assert!((0.0..=3.0).contains(&x));
                }
                if let Some(d) = p.get("disabledItems") {
                    assert!(d.as_array().expect("array").len() <= 4);
                }
            }
        }
        assert!(pickup_modes.iter().all(|m| *m));
        assert!(ghost.0 && ghost.1);
    }

    #[test]
    fn awkward_floats_parse_to_their_intended_value() {
        let mut rng = SplitMix64::new(42);
        let mut kinds = [0u32; 5];
        for _ in 0..20_000 {
            let (lo, hi) =
                *rng.pick(&[(0.0, 1.0), (0.0, 3.0), (1.0, 1.35), (0.1, 1.0), (0.75, 1.0)]);
            let f = awkward_float(&mut rng, lo, hi);
            kinds[f.kind as usize] += 1;
            let parsed: f64 = serde_json::from_str(&f.text).expect("JSON number");
            assert_eq!(
                parsed.to_bits(),
                f.value.to_bits(),
                "{} ({:?})",
                f.text,
                f.kind
            );
            let std_parsed: f64 = f.text.parse().expect("std parse");
            assert_eq!(std_parsed.to_bits(), f.value.to_bits(), "{}", f.text);
            assert!(f.value >= lo && f.value <= hi);
            if f.kind == FloatKind::Shortest17 {
                assert_eq!(shortest_significant_digits(f.value), 17);
            }
        }
        assert!(kinds.iter().all(|k| *k > 0), "{kinds:?}");
    }

    #[test]
    fn exact_midpoint_text_is_exact() {
        // 1 + 2^-53 is the midpoint between 1.0 and 1.0000000000000002.
        let (m, e) = decompose(1.0);
        assert_eq!(
            exact_decimal(2 * m + 1, e - 1),
            "1.00000000000000011102230246251565404236316680908203125"
        );
        assert_eq!(exact_decimal(1, -1), "0.5");
        assert_eq!(exact_decimal(3, -2), "0.75");
    }

    #[test]
    fn seed_parsing() {
        assert_eq!(parse_seed("0x10"), Ok(16));
        assert_eq!(parse_seed("16"), Ok(16));
        assert!(parse_seed("zz").is_err());
    }
}
