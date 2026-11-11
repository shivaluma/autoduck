//! How a duck's defenses meet an incoming effect:
//! `resolveIncomingRaceEffect` and `ITEM_INTERACTION_MATRIX`
//! (`packages/race-core/src/items/interactions.ts`, S3.15).
//!
//! `ItemDefenseState` is the defensive slice of [`DuckItemRuntime`]; every
//! TS caller passes the full runtime, whose `bubbleUntilTick`,
//! `wildBubbleUntilTick` and `wildFeatherUntilTick` are always numbers, so the
//! interface's `undefined` / `?? 0` fallbacks never apply.

use race_protocol::events::IncomingAttack;

use super::config::item_balance;
use super::engine::seconds_to_ticks;
use super::state::DuckItemRuntime;

/// `IncomingRaceEffect` (`interactions.ts:3`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IncomingRaceEffect {
    Rocket,
    MiniRocket,
    Banana,
    WildBanana,
    MinorHazard,
    QuackHorn,
    NaturalObstacle,
    DuckCollision,
}

impl IncomingRaceEffect {
    /// The wire literal.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Rocket => "ROCKET",
            Self::MiniRocket => "MINI_ROCKET",
            Self::Banana => "BANANA",
            Self::WildBanana => "WILD_BANANA",
            Self::MinorHazard => "MINOR_HAZARD",
            Self::QuackHorn => "QUACK_HORN",
            Self::NaturalObstacle => "NATURAL_OBSTACLE",
            Self::DuckCollision => "DUCK_COLLISION",
        }
    }

    /// The same literal as an event-metadata [`IncomingAttack`], when it is
    /// one of the five attacks.
    #[must_use]
    pub const fn as_attack(self) -> Option<IncomingAttack> {
        match self {
            Self::Rocket => Some(IncomingAttack::Rocket),
            Self::MiniRocket => Some(IncomingAttack::MiniRocket),
            Self::Banana => Some(IncomingAttack::Banana),
            Self::WildBanana => Some(IncomingAttack::WildBanana),
            Self::QuackHorn => Some(IncomingAttack::QuackHorn),
            Self::MinorHazard | Self::NaturalObstacle | Self::DuckCollision => None,
        }
    }
}

/// `DefenseOutcome` (`interactions.ts:4`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DefenseOutcome {
    Hit,
    BlockedBubble,
    BlockedMiniBubble,
    DodgedFeather,
    DodgedWildFeather,
    Immune,
}

/// A cell of `ITEM_INTERACTION_MATRIX`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InteractionRule {
    Block,
    Dodge,
    Mitigate,
    No,
}

/// One row of `ITEM_INTERACTION_MATRIX`: `{bubbleShield, feather, shockAbsorber}`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InteractionRow {
    pub bubble_shield: InteractionRule,
    pub feather: InteractionRule,
    pub shock_absorber: InteractionRule,
}

/// `ITEM_INTERACTION_MATRIX[incoming]` (`interactions.ts:6-16`). Display
/// data only; [`resolve_incoming_race_effect`] does not read it.
///
/// The `feather` column is the loadout Feather. S3.15 (`ts-compat`) marked
/// it `Dodge` for `MINOR_HAZARD`, but only the wild Feather Hop dodges
/// hazards; **F13 (S3.16)** marks it `No`, as the code behaves.
#[must_use]
pub const fn item_interaction_matrix(incoming: IncomingRaceEffect) -> InteractionRow {
    use InteractionRule::{Block, Dodge, Mitigate, No};
    let (bubble_shield, feather, shock_absorber) = match incoming {
        IncomingRaceEffect::Rocket | IncomingRaceEffect::MiniRocket => (Block, No, Mitigate),
        IncomingRaceEffect::Banana | IncomingRaceEffect::WildBanana => (Block, Dodge, No),
        IncomingRaceEffect::QuackHorn => (Block, Dodge, Mitigate),
        IncomingRaceEffect::NaturalObstacle | IncomingRaceEffect::DuckCollision => (No, No, No),
        IncomingRaceEffect::MinorHazard => (No, if crate::TS_COMPAT { Dodge } else { No }, No),
    };
    InteractionRow {
        bubble_shield,
        feather,
        shock_absorber,
    }
}

/// `resolveIncomingRaceEffect(defense, incoming, tick, tickRate)`
/// (`interactions.ts:31-70`). Mutates the defense like TS: a pop/dodge
/// spends the defense, and an offensive hit grants hit immunity (and rocket
/// target protection for rockets).
pub fn resolve_incoming_race_effect(
    defense: &mut DuckItemRuntime,
    incoming: IncomingRaceEffect,
    tick: u32,
    tick_rate: u32,
) -> DefenseOutcome {
    use IncomingRaceEffect as E;
    let offensive = matches!(
        incoming,
        E::Rocket | E::MiniRocket | E::Banana | E::WildBanana
    );
    let rocket = matches!(incoming, E::Rocket | E::MiniRocket);
    let banana = matches!(incoming, E::Banana | E::WildBanana);
    let tick_i = i64::from(tick);
    if offensive && tick_i < defense.item_immunity_until_tick {
        return DefenseOutcome::Immune;
    }

    if offensive && defense.wild_bubble_available && tick_i < defense.wild_bubble_until_tick {
        defense.wild_bubble_available = false;
        defense.item_immunity_until_tick =
            tick_i + seconds_to_ticks(item_balance::BUBBLE_POP_IMMUNITY_SECONDS, tick_rate);
        return DefenseOutcome::BlockedMiniBubble;
    }

    // `defense.bubbleUntilTick === undefined || tick < bubbleUntilTick`: the
    // runtime always holds a number.
    if offensive && defense.bubble_available && tick_i < defense.bubble_until_tick {
        defense.bubble_available = false;
        defense.bubble_until_tick = 0;
        defense.item_immunity_until_tick =
            tick_i + seconds_to_ticks(item_balance::BUBBLE_POP_IMMUNITY_SECONDS, tick_rate);
        return DefenseOutcome::BlockedBubble;
    }

    if (banana || incoming == E::MinorHazard)
        && defense.wild_feather_available
        && tick_i < defense.wild_feather_until_tick
    {
        defense.wild_feather_available = false;
        return DefenseOutcome::DodgedWildFeather;
    }

    if banana && defense.feather_available {
        defense.feather_available = false;
        return DefenseOutcome::DodgedFeather;
    }

    if offensive {
        defense.item_immunity_until_tick =
            tick_i + seconds_to_ticks(item_balance::HIT_IMMUNITY_SECONDS, tick_rate);
        if rocket {
            defense.rocket_protection_until_tick = tick_i
                + seconds_to_ticks(item_balance::ROCKET_TARGET_PROTECTION_SECONDS, tick_rate);
        }
    }
    DefenseOutcome::Hit
}
