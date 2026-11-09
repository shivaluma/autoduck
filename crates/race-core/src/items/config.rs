//! `ITEM_BALANCE` (`packages/race-core/src/items/config.ts`, S3.15), verbatim.
//! Nested TS objects are nested modules: `ITEM_BALANCE.banana.hitLateralRadius`
//! is `item_balance::banana::HIT_LATERAL_RADIUS`.

#![allow(clippy::doc_markdown)]

pub mod item_balance {
    pub const HIT_IMMUNITY_SECONDS: f64 = 1.0;
    pub const ROCKET_TARGET_PROTECTION_SECONDS: f64 = 2.0;
    pub const BUBBLE_POP_IMMUNITY_SECONDS: f64 = 0.5;
    pub const MINIMUM_SPEED_MULTIPLIER: f64 = 0.05;
    pub const MAXIMUM_SPEED_MULTIPLIER: f64 = 1.60;
    pub const MAX_CONTINUOUS_BOOST_SECONDS: f64 = 2.6;

    pub mod nitro {
        pub const ARM_PROGRESS: f64 = 0.28;
        pub const FALLBACK_PROGRESS: f64 = 0.68;
        pub const TRIGGER_RANK: u32 = 4;
        pub const GAP_THRESHOLD: f64 = 0.045;
        pub const SPEED_MULTIPLIER: f64 = 1.25;
        pub const DURATION_SECONDS: f64 = 1.80;
        pub const IGNITION_SECONDS: f64 = 0.18;
        pub const OVERDRIVE_SECONDS: f64 = 1.37;
        pub const DECAY_SECONDS: f64 = 0.25;
    }

    pub mod draft_fin {
        pub const ARM_PROGRESS: f64 = 0.20;
        pub const MAX_GAP: f64 = 0.045;
        pub const LATERAL_RADIUS: f64 = 0.20;
        pub const HOLD_SECONDS: f64 = 0.75;
        pub const SPEED_MULTIPLIER: f64 = 1.21;
        pub const DURATION_SECONDS: f64 = 1.6;
    }

    pub mod paddle_burst {
        pub const ARM_PROGRESS: f64 = 0.65;
        pub const SPEED_MULTIPLIER: f64 = 1.15;
        pub const DURATION_SECONDS: f64 = 1.8;
    }

    pub mod rocket {
        pub const ARM_PROGRESS: f64 = 0.25;
        pub const DISABLE_PROGRESS: f64 = 0.98;
        pub const MAXIMUM_TARGET_DISTANCE: f64 = 0.32;
        pub const END_GAME_TARGET_DISTANCE_MULTIPLIER: f64 = 1.8;
        pub const PROJECTILE_SPEED: f64 = 0.26;
        pub const LIFETIME_SECONDS: f64 = 3.5;
        pub const HIT_RADIUS: f64 = 0.018;
        pub const ARMING_TICKS: i64 = 2;
        pub const STAGGER_MULTIPLIER: f64 = 0.12;
        pub const STAGGER_DURATION_SECONDS: f64 = 0.95;
        pub const RECOVERY_SLOW_MULTIPLIER: f64 = 0.50;
        pub const RECOVERY_DURATION_SECONDS: f64 = 0.65;
        pub const SLOW_MULTIPLIER: f64 = 0.15;
        pub const SLOW_DURATION_SECONDS: f64 = 1.50;
    }

    pub mod shock_absorber {
        pub const STAGGER_MULTIPLIER: f64 = 0.40;
        pub const STAGGER_DURATION_SECONDS: f64 = 0.30;
        pub const RECOVERY_SLOW_MULTIPLIER: f64 = 0.80;
        pub const RECOVERY_DURATION_SECONDS: f64 = 0.30;
        pub const SLOW_MULTIPLIER: f64 = 0.50;
        pub const SLOW_DURATION_SECONDS: f64 = 0.55;
        pub const HORN_PUSH_MULTIPLIER: f64 = 0.4;
        pub const HORN_SHOVE_MULTIPLIER: f64 = 0.4;
    }

    pub mod banana {
        pub const ARM_PROGRESS: f64 = 0.2;
        pub const FALLBACK_PROGRESS: f64 = 0.55;
        pub const AIM_MAX_OFFSET: f64 = 0.22;
        pub const END_GAME_DROP_PROGRESS: f64 = 0.72;
        pub const CLOSE_BEHIND_DISTANCE: f64 = 0.085;
        pub const LIFETIME_SECONDS: f64 = 14.0;
        pub const DROP_BEHIND_PROGRESS: f64 = 0.012;
        pub const ARMING_SECONDS: f64 = 0.2;
        pub const HIT_PROGRESS_RADIUS: f64 = 0.02;
        pub const HIT_LATERAL_RADIUS: f64 = 0.32;
        pub const MINIMUM_TRAP_SPACING: f64 = 0.015;
        pub const LATERAL_SLIP: f64 = 0.65;
        pub const STAGGER_MULTIPLIER: f64 = 0.15;
        pub const STAGGER_DURATION_SECONDS: f64 = 0.85;
        pub const RECOVERY_SLOW_MULTIPLIER: f64 = 0.60;
        pub const RECOVERY_DURATION_SECONDS: f64 = 0.70;
        pub const SLOW_MULTIPLIER: f64 = 0.25;
        pub const SLOW_DURATION_SECONDS: f64 = 1.20;
    }

    pub mod horn {
        pub const ARM_PROGRESS: f64 = 0.22;
        pub const PROGRESS_RADIUS: f64 = 0.055;
        pub const LATERAL_RADIUS: f64 = 0.40;
        pub const SIDE_REACH: f64 = 0.55;
        pub const CENTER_BAND: f64 = 0.08;
        pub const LATERAL_PUSH: f64 = 1.20;
        pub const LATERAL_SHOVE: f64 = 0.25;
        pub const FALLBACK_PROGRESS: f64 = 0.76;
        pub const SILENCE_DURATION_SECONDS: f64 = 0.5;
        pub const SILENCE_RECOVERY_SECONDS: f64 = 2.0;
    }

    pub mod feather {
        pub const GLIDE_PROGRESS: f64 = 0.88;
        pub const GLIDE_MULTIPLIER: f64 = 1.04;
        pub const GLIDE_DURATION_SECONDS: f64 = 1.0;
    }

    pub mod bubble_shield {
        pub const DURATION_SECONDS: f64 = 4.5;
        pub const END_GAME_BURN_PROGRESS: f64 = 0.90;
        pub const PACKED_DRAG_MULTIPLIER: f64 = 0.995;
        pub const BURST_MULTIPLIER: f64 = 1.08;
        pub const BURST_DURATION_SECONDS: f64 = 1.2;
    }

    pub mod menace {
        pub const PREDATOR_RUSH_MULTIPLIER: f64 = 1.10;
        pub const PREDATOR_RUSH_DURATION_SECONDS: f64 = 1.0;
    }

    pub mod fortress {
        pub const SURGE_MULTIPLIER: f64 = 1.08;
        pub const SURGE_DURATION_SECONDS: f64 = 1.2;
        pub const COLLISION_PUSH_MULTIPLIER: f64 = 0.8;
        pub const COLLISION_SPEED_LOSS_MULTIPLIER: f64 = 0.8;
    }

    pub mod counter {
        pub const MOMENTUM_STEAL_MULTIPLIER: f64 = 1.20;
        pub const MOMENTUM_STEAL_SECONDS: f64 = 2.3;
        pub const HORN_MOMENTUM_STEAL_SECONDS: f64 = 1.5;
        pub const SPEED_DRAIN_DURATION_RATIO: f64 = 0.5;

        /// `counter.guardSurge[defenseItemId]`.
        pub mod guard_surge {
            pub const BUBBLE_SHIELD_MULTIPLIER: f64 = 1.08;
            pub const BUBBLE_SHIELD_DURATION_SECONDS: f64 = 1.0;
            pub const FEATHER_MULTIPLIER: f64 = 1.15;
            pub const FEATHER_DURATION_SECONDS: f64 = 1.8;
            pub const SHOCK_ABSORBER_MULTIPLIER: f64 = 1.06;
            pub const SHOCK_ABSORBER_DURATION_SECONDS: f64 = 0.8;
        }
    }

    pub mod auto_use {
        pub const END_GAME_BURN_PROGRESS: f64 = 0.78;
        pub const FORCE_BURN_PROGRESS: f64 = 0.92;
    }
}
