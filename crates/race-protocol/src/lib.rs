//! Season 3 race wire protocol: the types shared by `race-core`, the server
//! and the browser (via `race-wasm` and the ts-rs export).
//!
//! `#![no_std]` + `alloc` per D1. Float parsing goes through `serde_json` with
//! `float_roundtrip`, declared directly in this crate per D4(d).

// ts-rs derive output assumes the std prelude (`format!`, `ToString`, ...),
// so the `ts-export` build (which already requires std) is not no_std.
#![cfg_attr(not(feature = "ts-export"), no_std)]
// `forbid`, not `deny`: a local `#[allow]` can't switch the bans off.
#![forbid(clippy::disallowed_methods, clippy::disallowed_types)]

// The `std` feature only forwards `std` to dependencies (no `extern crate
// std`), so std-only float methods stay unresolvable in the no_std build.
extern crate alloc;

pub mod config;
pub mod events;
pub mod ids;
pub mod legacy;
pub mod replay_track;
pub mod result;
pub mod snapshot;
pub mod versions;
