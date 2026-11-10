//! Seeded RNG, bit-identical to `packages/race-core/src/rng.ts` (D5,
//! `RNG_VERSION xs32-v1`): FNV-1a over UTF-16 code units, splitmix32 seeding,
//! xorshift32. Meta streams (`chaos:week:N`, `chaos:manual:N:<ms>`,
//! `auto-loadout:<id>`) must stay identical.
//!
//! Every operation mirrors the TS source line for line:
//!
//! - `Math.imul` is `u32::wrapping_mul`, and `x >>> 0` / `x << n` on int32
//!   operands are plain `u32` shifts and wrapping adds.
//! - `next()` divides the `u32` by `2^32` in `f64`, which is exact.
//! - `range()` is `min + (max - min) * next()`, written as separate multiply
//!   and add (Rust never contracts these into an FMA).
//! - `integer()` evaluates `min + floor(next() * (max - min + 1))` in `f64`
//!   with soft-float `libm::floor`, as JS does.
//!
//! The fixtures in `tests/fixtures/rng-*.json.gz` are produced from the TS
//! module by `scripts/oracle/dump-rng-fixtures.ts`.

use alloc::string::String;

/// FNV-1a 32-bit offset basis.
const FNV_OFFSET: u32 = 2_166_136_261;
/// FNV-1a 32-bit prime.
const FNV_PRIME: u32 = 16_777_619;
/// splitmix32 increment (golden ratio).
const SPLITMIX_GAMMA: u32 = 0x9e37_79b9;
/// Fallback state when the first splitmix output is zero (xorshift32 must not
/// start at zero).
const ZERO_STATE_FALLBACK: u32 = 0x6d2b_79f5;
/// `2^32` as `f64`, the divisor in `next()`.
const TWO_POW_32: f64 = 4_294_967_296.0;

/// `hashString` from `rng.ts` over UTF-16 code units.
///
/// Accepts any code-unit sequence, including lone surrogates, exactly as
/// `String.prototype.charCodeAt` sees them.
#[must_use]
pub fn hash_utf16<I>(units: I) -> u32
where
    I: IntoIterator<Item = u16>,
{
    let mut hash = FNV_OFFSET;
    for unit in units {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    // Avalanche. JS `hash += hash << 13` can leave a value above 2^32, but
    // every following step goes through ToInt32/ToUint32, so wrapping `u32`
    // arithmetic is exact.
    hash = hash.wrapping_add(hash << 13);
    hash ^= hash >> 7;
    hash = hash.wrapping_add(hash << 3);
    hash ^= hash >> 17;
    hash = hash.wrapping_add(hash << 5);
    hash
}

/// `hashString` from `rng.ts`: FNV-1a over the UTF-16 encoding of `value`.
#[must_use]
pub fn hash_string(value: &str) -> u32 {
    hash_utf16(value.encode_utf16())
}

/// First output of `splitMix32(seed)` from `rng.ts` (the only one used).
fn splitmix32_first(seed: u32) -> u32 {
    let state = seed.wrapping_add(SPLITMIX_GAMMA);
    let mut value = state;
    value = (value ^ (value >> 16)).wrapping_mul(0x21f0_aaad);
    value = (value ^ (value >> 15)).wrapping_mul(0x735a_2d97);
    value ^ (value >> 15)
}

/// `DeterministicRng` from `rng.ts`: xorshift32 (13, 17, 5) seeded through
/// splitmix32 from the FNV-1a hash of the seed string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeterministicRng {
    state: u32,
}

impl DeterministicRng {
    /// `new DeterministicRng(seed)`.
    #[must_use]
    pub fn new(seed: &str) -> Self {
        Self::from_hash(hash_string(seed))
    }

    /// `new DeterministicRng(seed)` for a seed given as UTF-16 code units
    /// (allows lone surrogates, which a Rust `str` cannot hold).
    #[must_use]
    pub fn from_utf16<I>(seed: I) -> Self
    where
        I: IntoIterator<Item = u16>,
    {
        Self::from_hash(hash_utf16(seed))
    }

    fn from_hash(hash: u32) -> Self {
        let first = splitmix32_first(hash);
        let state = if first == 0 {
            ZERO_STATE_FALLBACK
        } else {
            first
        };
        Self { state }
    }

    /// Current xorshift state (for diagnostics and state hashing).
    #[must_use]
    pub const fn state(&self) -> u32 {
        self.state
    }

    /// `nextUint32()`: one xorshift32 step.
    pub fn next_u32(&mut self) -> u32 {
        let mut value = self.state;
        value ^= value << 13;
        value ^= value >> 17;
        value ^= value << 5;
        self.state = value;
        value
    }

    /// `next()`: uniform in `[0, 1)`, `nextUint32() / 2^32` (exact in `f64`).
    pub fn next_f64(&mut self) -> f64 {
        f64::from(self.next_u32()) / TWO_POW_32
    }

    /// `range(minimum, maximum)`: `minimum + (maximum - minimum) * next()`.
    pub fn range(&mut self, minimum: f64, maximum: f64) -> f64 {
        let unit = self.next_f64();
        let scaled = (maximum - minimum) * unit;
        minimum + scaled
    }

    /// `integer(minimum, maximumInclusive)` with the exact JS `f64`
    /// semantics: `minimum + Math.floor(next() * (maximumInclusive - minimum + 1))`.
    pub fn integer_f64(&mut self, minimum: f64, maximum_inclusive: f64) -> f64 {
        let unit = self.next_f64();
        let count = maximum_inclusive - minimum + 1.0;
        minimum + libm::floor(unit * count)
    }

    /// `integer(minimum, maximumInclusive)` for integer bounds.
    ///
    /// Computed in `f64` exactly like [`Self::integer_f64`], so it matches TS
    /// for every bound with magnitude at most `2^53` (callers pass small
    /// values: array lengths, swap indices).
    pub fn integer(&mut self, minimum: i64, maximum_inclusive: i64) -> i64 {
        assert!(minimum.unsigned_abs() <= 1 << 53);
        assert!(maximum_inclusive.unsigned_abs() <= 1 << 53);
        #[allow(clippy::cast_precision_loss)]
        let value = self.integer_f64(minimum as f64, maximum_inclusive as f64);
        // `value` is integral and within +-2^55, so the cast is exact.
        #[allow(clippy::cast_possible_truncation)]
        let result = value as i64;
        result
    }

    /// `integer(0, len - 1)` as an index into a non-empty slice of `len`
    /// elements (the `items[rng.integer(0, items.length - 1)]` form).
    ///
    /// # Panics
    ///
    /// Panics if `len` is zero or does not fit in `u32` (TS would index out
    /// of bounds and get `undefined`).
    pub fn index(&mut self, len: usize) -> usize {
        assert!(len > 0, "DeterministicRng::index on an empty slice");
        let len = u32::try_from(len).expect("DeterministicRng::index length above u32");
        let value = self.integer(0, i64::from(len) - 1);
        usize::try_from(value).expect("integer(0, len - 1) lies in [0, len)")
    }
}

/// `createRaceRng(seed, stream)`: a generator keyed by `"{seed}:{stream}"`.
#[must_use]
pub fn create_race_rng(seed: &str, stream: &str) -> DeterministicRng {
    let mut key = String::with_capacity(seed.len() + 1 + stream.len());
    key.push_str(seed);
    key.push(':');
    key.push_str(stream);
    DeterministicRng::new(&key)
}

/// The label of an **engine** RNG stream.
///
/// **F2 (S3.16):** `<kind>` or `<kind>:<rest>`, without the race id, so a
/// race's outcome is fixed by its seed and config alone (renaming a race, or
/// re-running a week as a new `Race` row with the same seed, changes
/// nothing). With `ts-compat` it is the S3.15 label `<kind>:<raceId>` or
/// `<kind>:<raceId>:<rest>`. The Season meta streams (`chaos:week:N`,
/// `chaos:manual:N:<ms>`, `auto-loadout:<id>`) never carried a race id and
/// do not use this helper (D5).
#[must_use]
pub fn engine_stream(kind: &str, race_id: &str, rest: &str) -> String {
    let mut label = String::with_capacity(kind.len() + race_id.len() + rest.len() + 2);
    label.push_str(kind);
    if crate::TS_COMPAT {
        label.push(':');
        label.push_str(race_id);
    }
    if !rest.is_empty() {
        label.push(':');
        label.push_str(rest);
    }
    label
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec::Vec;

    #[test]
    fn empty_string_hash_is_avalanched_offset_basis() {
        let mut hash = FNV_OFFSET;
        hash = hash.wrapping_add(hash << 13);
        hash ^= hash >> 7;
        hash = hash.wrapping_add(hash << 3);
        hash ^= hash >> 17;
        hash = hash.wrapping_add(hash << 5);
        assert_eq!(hash_string(""), hash);
        assert_eq!(hash_utf16([]), hash);
    }

    #[test]
    fn str_and_utf16_paths_agree() {
        let value = "Đua dzịt 🦆:chaos:week:3";
        let units: Vec<u16> = value.encode_utf16().collect();
        assert_eq!(hash_string(value), hash_utf16(units.iter().copied()));
        assert_eq!(
            DeterministicRng::new(value),
            DeterministicRng::from_utf16(units)
        );
    }

    #[test]
    fn next_is_in_unit_interval() {
        let mut rng = create_race_rng("seed", "stream");
        for _ in 0..1000 {
            let value = rng.next_f64();
            assert!((0.0..1.0).contains(&value));
        }
    }
}
