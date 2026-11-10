//! The two non-deterministic inputs of the Season 3 admin actions:
//!
//! - [`create_race_seed`]: `createRaceSeed()` (`lib/racing/audit.ts`), 32 bytes from the OS as
//!   lowercase hex. Chaos seeds and race seeds both come from it.
//! - [`chaos_clock_ms`]: the `Date.now()` in `set-chaos`'s `chaos:manual:<week>:<ms>` stream,
//!   wall-clock milliseconds as in TS.
//!
//! Builds with the `test-rng` feature (dev only, see `cosmetics/ids.rs`) make both deterministic
//! when `AUTODUCK_TEST_RNG_SEED` is set, for the TS-vs-Rust mutation diff. The TS side does the
//! same in `lib/test-ids.ts` (`randomSeedHex`, `chaosClockMs`) under `NODE_ENV=test`:
//! - seeds: a third mulberry32 stream seeded with `seed ^ 0x5eed5eed`, eight `next()` values
//!   each printed as 8 hex digits;
//! - clock: the fixed instant [`TEST_CLOCK_MS`] (2026-01-01T00:00:00.000Z).

use std::fmt::Write as _;

use rand::TryRng as _;

/// The fixed `Date.now()` of `test-rng` builds.
pub const TEST_CLOCK_MS: i64 = 1_767_225_600_000;

#[cfg(feature = "test-rng")]
fn seeded_stream() -> Option<&'static std::sync::Mutex<crate::cosmetics::ids::Mulberry32>> {
    use std::sync::{Mutex, OnceLock};
    static STREAM: OnceLock<Option<Mutex<crate::cosmetics::ids::Mulberry32>>> = OnceLock::new();
    STREAM
        .get_or_init(|| {
            // Same guard as cosmetics/ids.rs: the seed is honoured in dev only.
            let env = std::env::var("AUTODUCK_ENV").unwrap_or_default();
            if !matches!(env.trim(), "dev" | "development" | "test") {
                return None;
            }
            let seed = std::env::var("AUTODUCK_TEST_RNG_SEED").ok()?;
            let seed = seed.trim().parse::<u32>().ok()?;
            Some(Mutex::new(crate::cosmetics::ids::Mulberry32::new(
                seed ^ 0x5eed_5eed,
            )))
        })
        .as_ref()
}

/// `createRaceSeed()`: `randomBytes(32).toString('hex')`.
///
/// # Panics
/// If the OS random source fails (`randomBytes` throws in TS too).
#[must_use]
pub fn create_race_seed() -> String {
    #[cfg(feature = "test-rng")]
    if let Some(stream) = seeded_stream() {
        let mut stream = stream
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut out = String::with_capacity(64);
        for _ in 0..8 {
            let _ = write!(out, "{:08x}", stream.next_u32());
        }
        return out;
    }
    let mut bytes = [0u8; 32];
    rand::rngs::SysRng
        .try_fill_bytes(&mut bytes)
        .expect("the OS random source failed");
    let mut out = String::with_capacity(64);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// `Date.now()` for the `chaos:manual:<week>:<ms>` stream.
#[must_use]
pub fn chaos_clock_ms() -> i64 {
    #[cfg(feature = "test-rng")]
    if seeded_stream().is_some() {
        return TEST_CLOCK_MS;
    }
    crate::season3::schedule::now_ms()
}

/// `sha256(seed)` as hex: the commitment logged instead of a seed (D17: seeds are never logged
/// or sent before the race reveals them).
#[must_use]
pub fn seed_commit(seed: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(seed.as_bytes());
    let mut out = String::with_capacity(64);
    for byte in digest {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_are_64_hex_chars_and_differ() {
        let a = create_race_seed();
        let b = create_race_seed();
        assert_eq!(a.len(), 64);
        assert!(
            a.bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        );
        assert_ne!(a, b);
    }

    #[test]
    fn commit_is_sha256_hex() {
        assert_eq!(
            seed_commit("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
