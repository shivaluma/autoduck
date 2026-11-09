//! `PICKUP_BALANCE` and `POSITION_CATEGORY_WEIGHTS`
//! (`packages/race-core/src/pickups/config.ts`, S3.15), verbatim. Nested TS
//! objects are nested modules.

pub mod pickup_balance {
    use race_protocol::ids::HazardType;

    pub const PROGRESS_RADIUS: f64 = 0.010;
    pub const LATERAL_RADIUS: f64 = 0.20;
    pub const REGULAR_PICKUP_CAP: u32 = 3;
    /// The engine default; `resolve_ts_compat` applies Zod's 0.12 before the
    /// engine ever sees a config (see `race_protocol::config`).
    pub const GOLDEN_BOX_PROBABILITY: f64 = 0.18;
    pub const GOLDEN_PROGRESS_MINIMUM: f64 = 0.35;
    pub const GOLDEN_PROGRESS_MAXIMUM: f64 = 0.75;
    pub const ITEM_HIT_IMMUNITY_SECONDS: f64 = 0.8;
    pub const ROCKET_TARGET_PROTECTION_SECONDS: f64 = 1.5;
    pub const POSITIVE_SPEED_CAP: f64 = 1.60;
    pub const NEGATIVE_SPEED_CAP: f64 = 0.05;

    pub mod mini_nitro {
        pub const MULTIPLIER: f64 = 1.09;
        pub const DURATION_SECONDS: f64 = 1.15;
    }

    pub mod tailwind {
        pub const MULTIPLIER: f64 = 1.07;
        pub const DURATION_SECONDS: f64 = 1.9;
        pub const LATERAL_STABILITY: f64 = 0.75;
    }

    pub mod mini_bubble {
        pub const DURATION_SECONDS: f64 = 6.0;
    }

    pub mod auto_use {
        pub const END_GAME_BURN_PROGRESS: f64 = 0.78;
        pub const FORCE_BURN_PROGRESS: f64 = 0.92;
        pub const IDEAL_MANUAL_DELAY_PROGRESS: f64 = 0.05;
    }

    pub mod mini_rocket {
        pub const MAXIMUM_TARGET_DISTANCE: f64 = 0.22;
        pub const END_GAME_TARGET_DISTANCE_MULTIPLIER: f64 = 1.5;
        pub const FORCE_BURN_TARGET_DISTANCE_MULTIPLIER: f64 = 2.2;
        pub const PROJECTILE_SPEED: f64 = 0.20;
        pub const LIFETIME_SECONDS: f64 = 2.5;
        pub const HIT_RADIUS: f64 = 0.015;
        pub const ARMING_TICKS: i64 = 2;
        pub const STAGGER_MULTIPLIER: f64 = 0.25;
        pub const STAGGER_DURATION_SECONDS: f64 = 0.55;
        pub const RECOVERY_SLOW_MULTIPLIER: f64 = 0.65;
        pub const RECOVERY_DURATION_SECONDS: f64 = 0.45;
        pub const SLOW_MULTIPLIER: f64 = 0.35;
        pub const SLOW_DURATION_SECONDS: f64 = 0.75;
        pub const AUTO_ARM_PROGRESS: f64 = 0.25;
        pub const AUTO_FALLBACK_PROGRESS: f64 = 0.70;
    }

    pub mod banana {
        pub const AIM_MAX_OFFSET: f64 = 0.18;
        pub const LIFETIME_SECONDS: f64 = 8.0;
        pub const DROP_BEHIND_PROGRESS: f64 = 0.012;
        pub const ARMING_SECONDS: f64 = 0.2;
        pub const HIT_PROGRESS_RADIUS: f64 = 0.014;
        pub const HIT_LATERAL_RADIUS: f64 = 0.18;
        pub const MINIMUM_TRAP_SPACING: f64 = 0.015;
        pub const LATERAL_SLIP: f64 = 0.50;
        pub const STAGGER_MULTIPLIER: f64 = 0.22;
        pub const STAGGER_DURATION_SECONDS: f64 = 0.60;
        pub const RECOVERY_SLOW_MULTIPLIER: f64 = 0.60;
        pub const RECOVERY_DURATION_SECONDS: f64 = 0.50;
        pub const SLOW_MULTIPLIER: f64 = 0.30;
        pub const SLOW_DURATION_SECONDS: f64 = 0.95;
        pub const AUTO_FALLBACK_PROGRESS: f64 = 0.60;
        pub const END_GAME_DROP_PROGRESS: f64 = 0.70;
        pub const CLOSE_BEHIND_DISTANCE: f64 = 0.075;
    }

    pub mod horn {
        pub const PROGRESS_RADIUS: f64 = 0.030;
        pub const LATERAL_RADIUS: f64 = 0.42;
        pub const LATERAL_PUSH: f64 = 0.80;
        pub const LATERAL_SHOVE: f64 = 0.22;
        pub const SIDE_REACH: f64 = 0.5;
        pub const CENTER_BAND: f64 = 0.07;
        pub const END_GAME_PROGRESS_RADIUS_MULTIPLIER: f64 = 1.6;
    }

    pub mod feather {
        pub const DURATION_SECONDS: f64 = 5.0;
        pub const AUTO_FALLBACK_PROGRESS: f64 = 0.70;
        pub const END_GAME_PROGRESS: f64 = 0.75;
    }

    pub mod counter {
        pub const MOMENTUM_STEAL_MULTIPLIER: f64 = 1.20;
        pub const MOMENTUM_STEAL_SECONDS: f64 = 1.2;
        pub const GUARD_SURGE_MULTIPLIER: f64 = 1.12;
        pub const GUARD_SURGE_DURATION_SECONDS: f64 = 1.2;
        pub const EXPIRY_BOOST_MULTIPLIER: f64 = 1.08;
        pub const EXPIRY_BOOST_DURATION_SECONDS: f64 = 1.2;
        pub const MINI_BUBBLE_EXPIRY_BOOST_MULTIPLIER: f64 = 1.13;
        pub const MINI_BUBBLE_EXPIRY_BOOST_DURATION_SECONDS: f64 = 1.8;
        pub const HORN_SILENCE_SECONDS: f64 = 0.7;
    }

    pub mod magnet {
        pub const DURATION_SECONDS: f64 = 1.6;
        pub const MULTIPLIER: f64 = 1.12;
        pub const MAXIMUM_TARGET_DISTANCE: f64 = 0.24;
    }

    /// `PICKUP_BALANCE.hazards[type]`.
    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct HazardTuning {
        pub slow_multiplier: f64,
        pub duration_seconds: f64,
        pub wobble: f64,
    }

    /// `PICKUP_BALANCE.hazards[type]`.
    #[must_use]
    pub const fn hazard(hazard_type: HazardType) -> HazardTuning {
        match hazard_type {
            HazardType::Anchor => HazardTuning {
                slow_multiplier: 0.82,
                duration_seconds: 1.5,
                wobble: 0.065,
            },
            HazardType::Whirlpool => HazardTuning {
                slow_multiplier: 0.85,
                duration_seconds: 1.6,
                wobble: 0.12,
            },
            HazardType::IcePatch => HazardTuning {
                slow_multiplier: 0.88,
                duration_seconds: 1.6,
                wobble: 0.15,
            },
            HazardType::StickyGoo => HazardTuning {
                slow_multiplier: 0.80,
                duration_seconds: 1.4,
                wobble: 0.045,
            },
        }
    }
}

/// `POSITION_CATEGORY_WEIGHTS` (`pickups/config.ts:85-89`): per rank bucket,
/// `(category, weight)` in TS object-literal order (which is the iteration
/// order `Object.entries` gives, and so the order `weightedCategory` walks).
pub mod position_category_weights {
    use crate::pickups::catalog::WildItemCategory;
    use crate::pickups::catalog::WildItemCategory::{Attack, Defense, Mobility, Utility};

    pub const FRONT: [(WildItemCategory, u32); 4] =
        [(Defense, 34), (Attack, 26), (Utility, 22), (Mobility, 18)];
    pub const MIDDLE: [(WildItemCategory, u32); 4] =
        [(Attack, 34), (Mobility, 28), (Defense, 20), (Utility, 18)];
    pub const BACK: [(WildItemCategory, u32); 4] =
        [(Mobility, 44), (Attack, 30), (Defense, 16), (Utility, 10)];
}
