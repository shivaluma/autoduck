//! `AUTO_USE_CONFIG` (`packages/race-core/src/auto-use/config.ts`, S3.15),
//! verbatim.

pub mod auto_use_config {
    pub const DECISION_INTERVAL_TICKS: i64 = 15;
    pub const REACTION_DELAY_MIN_SECONDS: f64 = 0.12;
    pub const REACTION_DELAY_MAX_SECONDS: f64 = 0.28;
    pub const REACTIVE_THREAT_MIN_VISIBLE_SECONDS: f64 = 0.15;
    pub const COOLDOWN_MIN_SECONDS: f64 = 0.35;
    pub const COOLDOWN_MAX_SECONDS: f64 = 0.55;
    pub const BANANA_PREDICTION_HORIZON_SECONDS: f64 = 1.0;
    pub const MOMENTUM_STEAL_VALUE: f64 = 8.0;

    pub mod brain {
        pub const HOLD_COST_SCALE: f64 = 60.0;
        pub const HOLD_RAMP_PROGRESS: f64 = 0.15;
        pub const AGGRESSION_SCALE: f64 = 8.0;
        pub const CLUTCH_DUEL_BONUS: f64 = 20.0;
        pub const DESPERATION_BONUS: f64 = 10.0;
        pub const INTENT_COOLDOWN_TICKS: f64 = 60.0;
        pub const SHOVE_INTO_TRAP_VALUE: f64 = 24.0;
    }

    pub mod thresholds {
        pub const EARLY: f64 = 72.0;
        pub const MID: f64 = 64.0;
        pub const LATE: f64 = 54.0;
        pub const FINAL_STRETCH: f64 = 42.0;
    }

    pub const PROGRESS_MID: f64 = 0.45;
    pub const PROGRESS_LATE: f64 = 0.75;
    pub const PROGRESS_FINAL: f64 = 0.92;

    pub mod inventory_pressure {
        pub const UNDER_1S: f64 = 30.0;
        pub const UNDER_2S: f64 = 20.0;
        pub const UNDER_3_5S: f64 = 10.0;
    }
}
