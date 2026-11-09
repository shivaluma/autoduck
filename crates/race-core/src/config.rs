//! Core simulation balance: `CORE_BALANCE` from
//! `packages/race-core/src/config.ts` (S3.15), verbatim.

/// `CORE_BALANCE` (`config.ts:1-18`).
pub mod core_balance {
    /// `tickRate`: the default tick rate (the config carries the real one).
    pub const TICK_RATE: u32 = 60;
    /// `targetDurationSeconds`: `baseSpeed = 1 / targetDurationSeconds`.
    pub const TARGET_DURATION_SECONDS: f64 = 56.0;
    /// `maximumDurationSeconds`: `simulateRace` gives up after this.
    pub const MAXIMUM_DURATION_SECONDS: u32 = 90;
    pub const SPEED_VARIATION: f64 = 0.03;
    pub const ACCELERATION_VARIATION: f64 = 0.03;
    pub const IMPULSE_MIN_SECONDS: f64 = 0.5;
    pub const IMPULSE_MAX_SECONDS: f64 = 1.1;
    pub const SPEED_RESPONSE: f64 = 1.65;
    pub const LATERAL_RESPONSE: f64 = 2.5;
    pub const MAXIMUM_LATERAL_VELOCITY: f64 = 0.85;
    pub const COLLISION_PROGRESS_RADIUS: f64 = 0.009;
    pub const COLLISION_LATERAL_RADIUS: f64 = 0.18;
    pub const COLLISION_PUSH: f64 = 0.040;
    pub const COLLISION_SPEED_LOSS: f64 = 0.008;
    pub const PACING_SEGMENT_COUNT: u32 = 4;
    pub const PACING_VARIATION: f64 = 0.18;
}

/// `1 / CORE_BALANCE.targetDurationSeconds` (`simulation.ts:165,440`).
#[inline]
#[must_use]
pub fn base_speed() -> f64 {
    1.0 / core_balance::TARGET_DURATION_SECONDS
}

/// `CORE_BALANCE.maximumDurationSeconds * tickRate` (`simulation.ts:681`).
#[must_use]
pub fn maximum_ticks(tick_rate: u32) -> u32 {
    core_balance::MAXIMUM_DURATION_SECONDS
        .checked_mul(tick_rate)
        .expect("maximum tick count fits in u32")
}
