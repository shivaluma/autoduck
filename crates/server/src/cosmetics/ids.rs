//! Row ids and request UUIDs (D13), plus the randomness source shared by the economy routes.
//!
//! - [`cuid`] has the shape Prisma's `@default(cuid())` writes (cuid v1: `c` + 8 base-36 timestamp
//!   chars + 4 counter + 4 fingerprint + 8 random = 25 chars), so Rust rows sort and look like
//!   the TS ones.
//! - [`uuid_v4`] is `crypto.randomUUID()`.
//! - [`random_unit`] is `randomInt(1_000_000) / 1_000_000`, the gacha roll.
//!
//! Randomness comes from `rand`'s thread RNG (OS-seeded ChaCha). Builds with the `test-rng`
//! feature honour `AUTODUCK_TEST_RNG_SEED` (a u32; plan Phase 3, mutation diff) with two
//! independent streams, so ids never shift the rolls:
//! - **rolls** ([`random_unit`]): mulberry32 seeded with the value, `randomInt(n) = next() % n`.
//!   This is deliberately trivial so the TS side (`lib/test-ids.ts`, or a harness patching
//!   `crypto.randomInt`) can reproduce the exact roll sequence;
//! - **ids** ([`cuid`], [`uuid_v4`]): a `StdRng` seeded with the same value.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rand::{Rng, RngExt};

const BASE36: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
const BLOCK: u32 = 36 * 36 * 36 * 36;

/// mulberry32, the `test-rng` roll stream.
#[cfg(any(test, feature = "test-rng"))]
#[derive(Debug)]
pub struct Mulberry32(u32);

#[cfg(any(test, feature = "test-rng"))]
impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Mulberry32(seed)
    }

    pub fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
}

#[cfg(feature = "test-rng")]
struct Seeded {
    rolls: std::sync::Mutex<Mulberry32>,
    ids: std::sync::Mutex<rand::rngs::StdRng>,
}

#[cfg(feature = "test-rng")]
fn seeded() -> Option<&'static Seeded> {
    use rand::SeedableRng;
    static SEEDED: OnceLock<Option<Seeded>> = OnceLock::new();
    SEEDED
        .get_or_init(|| {
            // Config already refuses a test-rng build outside dev; checked again here so the
            // seed can't be honoured on any other path.
            let env = std::env::var("AUTODUCK_ENV").unwrap_or_default();
            if !matches!(env.trim(), "dev" | "development" | "test") {
                return None;
            }
            let seed = std::env::var("AUTODUCK_TEST_RNG_SEED").ok()?;
            let seed = seed.trim().parse::<u32>().ok()?;
            tracing::warn!(
                seed,
                "AUTODUCK_TEST_RNG_SEED is set: ids and gacha rolls are deterministic"
            );
            Some(Seeded {
                rolls: std::sync::Mutex::new(Mulberry32::new(seed)),
                ids: std::sync::Mutex::new(rand::rngs::StdRng::seed_from_u64(u64::from(seed))),
            })
        })
        .as_ref()
}

/// Runs `draw` with the id RNG.
fn with_rng<T>(draw: impl FnOnce(&mut dyn Rng) -> T) -> T {
    #[cfg(feature = "test-rng")]
    if let Some(seeded) = seeded() {
        let mut guard = seeded
            .ids
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        return draw(&mut *guard);
    }
    draw(&mut rand::rng())
}

/// A uniform integer in `0..bound` (`crypto.randomInt(bound)`).
pub fn random_below(bound: u32) -> u32 {
    with_rng(|rng| rng.random_range(0..bound))
}

/// `randomInt(1_000_000) / 1_000_000`: the default gacha `rng()` in `lib/cosmetics/gacha.ts`.
pub fn random_unit() -> f64 {
    #[cfg(feature = "test-rng")]
    if let Some(seeded) = seeded() {
        let mut rolls = seeded
            .rolls
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        return f64::from(rolls.next_u32() % 1_000_000) / 1_000_000.0;
    }
    f64::from(random_below(1_000_000)) / 1_000_000.0
}

fn base36(mut value: u64, width: usize) -> String {
    let mut digits = Vec::with_capacity(width);
    while value > 0 {
        digits.push(BASE36[(value % 36) as usize]);
        value /= 36;
    }
    while digits.len() < width {
        digits.push(b'0');
    }
    digits.reverse();
    // Keep the low-order `width` digits (cuid slices from the end).
    let start = digits.len() - width;
    String::from_utf8(digits[start..].to_vec()).unwrap_or_default()
}

fn fingerprint() -> &'static str {
    static FINGERPRINT: OnceLock<String> = OnceLock::new();
    FINGERPRINT.get_or_init(|| {
        let pid = u64::from(std::process::id());
        let host = u64::from(random_below(BLOCK));
        format!("{}{}", base36(pid, 2), base36(host, 2))
    })
}

/// A cuid v1-shaped id, e.g. `cmw90tonu0000m4bv0h8epk3i`.
pub fn cuid() -> String {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        });
    let count = COUNTER.fetch_add(1, Ordering::Relaxed) % BLOCK;
    let (first, second) = with_rng(|rng| (rng.random_range(0..BLOCK), rng.random_range(0..BLOCK)));
    format!(
        "c{}{}{}{}{}",
        base36(millis, 8),
        base36(u64::from(count), 4),
        fingerprint(),
        base36(u64::from(first), 4),
        base36(u64::from(second), 4),
    )
}

/// `crypto.randomUUID()`: a lowercase RFC 9562 version 4 UUID.
pub fn uuid_v4() -> String {
    let mut bytes = [0u8; 16];
    with_rng(|rng| rng.fill_bytes(&mut bytes));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuid_shape() {
        let a = cuid();
        let b = cuid();
        assert_eq!(a.len(), 25);
        assert!(a.starts_with('c'));
        assert!(a.bytes().all(|byte| BASE36.contains(&byte)));
        assert_ne!(a, b);
    }

    #[test]
    fn uuid_shape() {
        let id = uuid_v4();
        assert_eq!(id.len(), 36);
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(
            parts.iter().map(|part| part.len()).collect::<Vec<_>>(),
            [8, 4, 4, 4, 12]
        );
        assert!(parts[2].starts_with('4'));
        assert!(matches!(parts[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b'));
    }

    #[test]
    fn random_unit_range() {
        for _ in 0..1000 {
            let value = random_unit();
            assert!((0.0..1.0).contains(&value));
            let scaled = value * 1_000_000.0;
            assert_eq!(f64::from((scaled + 0.5) as u32) / 1_000_000.0, value);
        }
    }

    #[test]
    fn mulberry32_matches_the_js_reference() {
        // scripts/oracle/dump-rng-fixtures.ts `Mulberry32(1)`: first outputs.
        let mut rng = Mulberry32::new(1);
        let first: Vec<u32> = (0..3).map(|_| rng.next_u32()).collect();
        assert_eq!(first, [2_693_262_067, 11_749_833, 2_265_367_787]);
    }

    #[test]
    fn base36_pads_and_slices() {
        assert_eq!(base36(0, 4), "0000");
        assert_eq!(base36(35, 2), "0z");
        assert_eq!(base36(36 * 36 + 1, 2), "01");
    }
}
