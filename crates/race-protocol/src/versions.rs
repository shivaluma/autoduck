//! Version constants (D2).
//!
//! Any change that alters simulation output bumps `RACE_BALANCE_VERSION` or
//! `RACE_ENGINE_VERSION`. `ENGINE_BUILD_ID` lives in `race_core::build_id`
//! because it is computed by `race-core/build.rs`.

/// Engine version (D2): a new major, no TS parity.
pub const RACE_ENGINE_VERSION: &str = "2.0.0";
/// Balance label (D2). Becomes the cutover season's label if that lands in a new season (Q1).
pub const RACE_BALANCE_VERSION: &str = "S3.17";
/// Wire protocol version (D2, D16 `hello` frame).
pub const RACE_PROTOCOL_VERSION: &str = "2.0.0";
/// RNG algorithm version (D2, D5): FNV-1a over UTF-16, splitmix32 seeding, xorshift32.
pub const RNG_VERSION: &str = "xs32-v1";
/// Digest scheme version (D2, D9): JCS + sha256.
pub const DIGEST_VERSION: &str = "jcs-sha256-v2";
/// Replay track container format (D2, D10).
pub const TRACK_FORMAT: &str = "dtrk/1";
/// Track version (D2). Geometry is content-addressed separately (D10).
pub const TRACK_VERSION: &str = "river-01-v2";
/// Wild pickup spawn version (D2).
pub const PICKUP_SPAWN_VERSION: &str = "pickups-v2";
/// Hazard balance version (D2).
pub const HAZARD_BALANCE_VERSION: &str = "hazards-v2";
/// Fixed simulation tick rate in Hz. Matches `RACE_TICK_RATE` in
/// `packages/race-protocol/src/index.ts`.
pub const RACE_TICK_RATE: u32 = 60;

/// Balance labels [`crate::config::RaceConfigInput::resolve`] accepts. A
/// label stays here only while this engine still produces its output.
pub const SUPPORTED_BALANCE_VERSIONS: [&str; 1] = [RACE_BALANCE_VERSION];

/// The TS S3.15 constants (`packages/race-protocol/src/index.ts:3-9`), used
/// only as defaults by `RaceConfigInput::resolve_ts_compat` (oracle diff).
#[cfg(feature = "ts-compat")]
pub mod ts_compat {
    pub const RACE_PROTOCOL_VERSION: &str = "1.0.0";
    pub const RACE_ENGINE_VERSION: &str = "1.2.0";
    pub const RACE_BALANCE_VERSION: &str = "S3.15";
    pub const TRACK_VERSION: &str = "river-01-v2";
    pub const PICKUP_SPAWN_VERSION: &str = "pickups-v1";
    pub const WILD_ITEM_BALANCE_VERSION: &str = "wild-items-v6";
    pub const HAZARD_BALANCE_VERSION: &str = "hazards-v1";
}
