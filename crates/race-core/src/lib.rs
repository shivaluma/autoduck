//! Deterministic Season 3 race simulation.
//!
//! `#![no_std]` + `alloc` per D1: no platform libm, no `HashMap`, no clock.
//! Native and wasm builds must be bit-identical (D4); the clippy bans in the
//! workspace `clippy.toml` are denied here.

#![no_std]
// `forbid`, not `deny`: a local `#[allow]` can't switch the bans off.
#![forbid(clippy::disallowed_methods, clippy::disallowed_types)]

// The `std` feature only forwards `std` to dependencies. There is
// deliberately no `extern crate std`, so std's float methods (`sin`, `powi`,
// `hypot`, ...) stay unresolvable in engine code in every build.
extern crate alloc;

pub mod build_id;
pub mod canonical;
pub mod digest;
pub mod hash;
pub mod math;
pub mod rng;

/// D6 id order/validation; the ICU comparator inside is gated on `ts-compat`.
pub mod collate_compat;
#[cfg(feature = "ts-compat")]
pub mod js_math;

pub use build_id::ENGINE_BUILD_ID;
