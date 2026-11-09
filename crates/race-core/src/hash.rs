//! `state_hash` (D4, D16): explicit little-endian state encoding.
//!
//! Lengths are `u32`, integer fields `u32`/`i32`, floats `f64::to_bits` with
//! every NaN mapped to `0x7ff8000000000000` and `-0.0` mapped to `+0.0`; the
//! hash is sha256 (`sha2`, no_std). [`StateHasher`] and [`ByteSink`] implement
//! the typed `write_*` methods (the [`StateWrite`] trait); [`write_state`],
//! [`state_bytes`] and [`state_hash`] encode a `sim::Simulation` with them.
//!
//! The field list Phase 2 must mirror is the `sh1` encoding in
//! `scripts/oracle/README.md` (the TS side is `visitState` in
//! `scripts/oracle/dump-trace.ts`). [`HashFold`] implements the
//! `stateChainSha256` / `motionSha256` folds defined there.

use sha2::{Digest, Sha256};

use crate::digest::Sha256Bytes;

/// Version tag of the state encoding (`scripts/oracle/README.md`).
pub const STATE_HASH_VERSION: &str = "sh1";

/// Canonical NaN bit pattern written for every NaN (D4).
pub const CANONICAL_NAN_BITS: u64 = 0x7ff8_0000_0000_0000;

/// Bits written for `value`: every NaN becomes [`CANONICAL_NAN_BITS`] and
/// `-0.0` becomes `+0.0`; everything else is `to_bits()`.
#[inline]
pub fn canonical_f64_bits(value: f64) -> u64 {
    if value.is_nan() {
        CANONICAL_NAN_BITS
    } else if value == 0.0 {
        0
    } else {
        value.to_bits()
    }
}

/// Typed writers for the `state_hash` encoding. Implementors only provide
/// [`StateWrite::write_bytes`].
pub trait StateWrite {
    fn write_bytes(&mut self, bytes: &[u8]);

    #[inline]
    fn write_u8(&mut self, value: u8) {
        self.write_bytes(&[value]);
    }

    #[inline]
    fn write_bool(&mut self, value: bool) {
        self.write_u8(u8::from(value));
    }

    #[inline]
    fn write_u32(&mut self, value: u32) {
        self.write_bytes(&value.to_le_bytes());
    }

    #[inline]
    fn write_i32(&mut self, value: i32) {
        self.write_bytes(&value.to_le_bytes());
    }

    #[inline]
    fn write_f64(&mut self, value: f64) {
        self.write_bytes(&canonical_f64_bits(value).to_le_bytes());
    }

    /// A length or element count. Panics if it does not fit in `u32` (D4(b):
    /// `usize` never reaches the encoding).
    #[inline]
    fn write_len(&mut self, len: usize) {
        let len = u32::try_from(len).expect("state_hash length exceeds u32");
        self.write_u32(len);
    }

    /// `u32` UTF-8 byte length, then the bytes.
    #[inline]
    fn write_str(&mut self, value: &str) {
        self.write_len(value.len());
        self.write_bytes(value.as_bytes());
    }

    /// `u8` presence flag (`0`/`1`), then the value only when present.
    #[inline]
    fn write_opt_f64(&mut self, value: Option<f64>) {
        match value {
            None => self.write_u8(0),
            Some(v) => {
                self.write_u8(1);
                self.write_f64(v);
            }
        }
    }

    /// `u32` element count, then each element.
    fn write_f64_slice(&mut self, values: &[f64]) {
        self.write_len(values.len());
        for &v in values {
            self.write_f64(v);
        }
    }

    /// `u32` element count, then each string.
    fn write_str_slice<S: AsRef<str>>(&mut self, values: &[S]) {
        self.write_len(values.len());
        for v in values {
            self.write_str(v.as_ref());
        }
    }
}

/// Forwards the encoding to any byte sink (`state_bytes`, `--full-at` dumps).
pub struct ByteSink<F: FnMut(&[u8])>(pub F);

impl<F: FnMut(&[u8])> StateWrite for ByteSink<F> {
    #[inline]
    fn write_bytes(&mut self, bytes: &[u8]) {
        (self.0)(bytes);
    }
}

/// sha256 over the `state_hash` encoding.
#[derive(Clone, Default)]
pub struct StateHasher {
    sha: Sha256,
}

impl StateHasher {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn finish(self) -> Sha256Bytes {
        let mut out = [0u8; 32];
        out.copy_from_slice(&self.sha.finalize());
        out
    }
}

impl StateWrite for StateHasher {
    #[inline]
    fn write_bytes(&mut self, bytes: &[u8]) {
        self.sha.update(bytes);
    }
}

/// The `motionSha256` sampling stride in ticks (D9: "every 60th tick"). It is
/// fixed by the digest definition and must match `MOTION_STRIDE` in
/// `scripts/oracle/dump-trace.ts`; it is deliberately not the config's
/// `tick_rate`, so a tick-rate change can't silently move the samples.
pub const MOTION_STRIDE: u32 = 60;

/// `acc = sha256(acc ‖ u32le(tick) ‖ state_hash)`, starting from 32 zero
/// bytes. Used for `stateChainSha256` (every tick) and `motionSha256` (ticks
/// `t > 0` with `t % MOTION_STRIDE == 0`, then the final tick if not already
/// folded).
#[derive(Clone, Debug, Default)]
pub struct HashFold {
    acc: Sha256Bytes,
    last_tick: Option<u32>,
}

impl HashFold {
    pub const fn new() -> Self {
        Self {
            acc: [0u8; 32],
            last_tick: None,
        }
    }

    pub fn push(&mut self, tick: u32, state_hash: &Sha256Bytes) {
        let mut sha = Sha256::new();
        sha.update(self.acc);
        sha.update(tick.to_le_bytes());
        sha.update(state_hash);
        self.acc.copy_from_slice(&sha.finalize());
        self.last_tick = Some(tick);
    }

    /// The `motionSha256` sampling rule for a non-final tick.
    pub const fn is_motion_tick(tick: u32) -> bool {
        tick > 0 && tick.is_multiple_of(MOTION_STRIDE)
    }

    /// Folds the final tick unless it was the last tick folded.
    pub fn push_final(&mut self, tick: u32, state_hash: &Sha256Bytes) {
        if self.last_tick != Some(tick) {
            self.push(tick, state_hash);
        }
    }

    pub const fn value(&self) -> &Sha256Bytes {
        &self.acc
    }
}

/// Writes the `sh1` encoding of `sim` (`scripts/oracle/README.md`,
/// `visitState` in `scripts/oracle/dump-trace.ts`): tick, finished, then per
/// duck in `state.ducks` order its id, 8 physics floats, rank, next impulse,
/// finished, optional finish time, pacing segments, RNG state and active
/// effects (wire names).
pub fn write_state(sim: &crate::sim::Simulation, w: &mut impl StateWrite) {
    w.write_u32(sim.tick);
    w.write_bool(sim.finished);
    w.write_len(sim.ducks.len());
    for (index, duck) in sim.ducks.iter().enumerate() {
        w.write_str(duck.player_id.as_str());
        w.write_f64(duck.progress);
        w.write_f64(duck.previous_progress);
        w.write_f64(duck.lateral_offset);
        w.write_f64(duck.speed);
        w.write_f64(duck.acceleration);
        w.write_f64(duck.lateral_velocity);
        w.write_f64(duck.desired_speed);
        w.write_f64(duck.desired_lateral_offset);
        w.write_u32(duck.current_rank);
        w.write_u32(duck.next_impulse_tick);
        w.write_bool(duck.finished);
        w.write_opt_f64(duck.finish_time_ms);
        w.write_f64_slice(&duck.pacing_segments);
        w.write_u32(sim.rng_state(index));
        w.write_len(duck.active_effects.len());
        for effect in &duck.active_effects {
            w.write_str(effect.as_str());
        }
    }
}

/// `state_bytes(&Simulation, sink)` (D4/D16): streams the `sh1` encoding.
pub fn state_bytes(sim: &crate::sim::Simulation, sink: &mut impl FnMut(&[u8])) {
    write_state(sim, &mut ByteSink(|bytes: &[u8]| sink(bytes)));
}

/// `state_hash = sha256(state_bytes)`.
#[must_use]
pub fn state_hash(sim: &crate::sim::Simulation) -> Sha256Bytes {
    let mut hasher = StateHasher::new();
    write_state(sim, &mut hasher);
    hasher.finish()
}

/// A fixed `sh1`-shaped state used by the native-vs-wasm check (plan Phase 1
/// gate: "`state_hash` on a fixed state is identical natively and under
/// `wasm32-wasip1`"). It exercises NaN payloads, `-0`, subnormals, `u32::MAX`,
/// optional fields, empty arrays and non-ASCII strings.
#[doc(hidden)]
pub fn write_fixed_test_state(w: &mut impl StateWrite) {
    w.write_u32(1234); // tick
    w.write_bool(false); // finished
    w.write_len(2); // ducks.length
    // duck 0
    w.write_str("duck-1");
    w.write_f64(1520.25);
    w.write_f64(1_519.000_000_000_000_2);
    w.write_f64(-0.0);
    w.write_f64(0.1 + 0.2);
    w.write_f64(f64::from_bits(1));
    w.write_f64(-3.5e-7);
    w.write_f64(12.0);
    w.write_f64(f64::NAN);
    w.write_u32(1);
    w.write_u32(1300);
    w.write_bool(false);
    w.write_opt_f64(None);
    w.write_f64_slice(&[0.95, 1.05, 1.0]);
    w.write_u32(0xdead_beef);
    w.write_str_slice(&["shielded", "boosted"]);
    // duck 1
    w.write_str("vịt_Đ:2");
    w.write_f64(2000.0);
    w.write_f64(1999.5);
    w.write_f64(0.0);
    w.write_f64(f64::MAX);
    w.write_f64(f64::from_bits(0xfff8_0000_0000_0001));
    w.write_f64(-1e300);
    w.write_f64(f64::INFINITY);
    w.write_f64(1e21);
    w.write_u32(2);
    w.write_u32(u32::MAX);
    w.write_bool(true);
    w.write_opt_f64(Some(33_333.333_333_333_336));
    w.write_f64_slice(&[]);
    w.write_u32(1);
    w.write_str_slice::<&str>(&[]);
    w.write_i32(-7);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::digest::{sha256, to_hex};
    use alloc::vec::Vec;

    /// sha256 of the fixed state, computed independently (Python `struct` +
    /// `hashlib`) from the same field list. Also asserted under wasm32-wasip1.
    pub(super) const FIXED_STATE_SHA256: &str =
        "4ea499aa7bc9bc9cf3ed9009696fe244f91f2f602d07e3d854dfd24bb8310ceb";

    #[test]
    fn canonical_bits() {
        assert_eq!(canonical_f64_bits(-0.0), 0);
        assert_eq!(canonical_f64_bits(0.0), 0);
        assert_eq!(canonical_f64_bits(f64::NAN), CANONICAL_NAN_BITS);
        assert_eq!(canonical_f64_bits(-f64::NAN), CANONICAL_NAN_BITS);
        assert_eq!(
            canonical_f64_bits(f64::from_bits(0x7ff0_0000_0000_0001)),
            CANONICAL_NAN_BITS
        );
        assert_eq!(canonical_f64_bits(f64::INFINITY), 0x7ff0_0000_0000_0000);
        assert_eq!(canonical_f64_bits(1.5), 1.5f64.to_bits());
    }

    #[test]
    fn fixed_state_hash() {
        let mut bytes = Vec::new();
        write_fixed_test_state(&mut ByteSink(|b: &[u8]| bytes.extend_from_slice(b)));
        let mut hasher = StateHasher::new();
        write_fixed_test_state(&mut hasher);
        let streamed = hasher.finish();
        assert_eq!(bytes.len(), 264);
        assert_eq!(streamed, sha256(&bytes));
        assert_eq!(to_hex(&streamed), FIXED_STATE_SHA256);
    }

    #[test]
    fn fold_rules() {
        let h = [7u8; 32];
        let mut motion = HashFold::new();
        for tick in 0..=125u32 {
            if HashFold::is_motion_tick(tick) {
                motion.push(tick, &h);
            }
        }
        motion.push_final(125, &h);
        let mut manual = HashFold::new();
        manual.push(60, &h);
        manual.push(120, &h);
        manual.push(125, &h);
        assert_eq!(motion.value(), manual.value());
        let mut again = manual.clone();
        again.push_final(125, &h);
        assert_eq!(again.value(), manual.value());
    }
}
