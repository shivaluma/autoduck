//! Chaos cards on the meta side (`lib/season3.ts`).
//!
//! The draws themselves (`selectChaosCard`, `prepareChaosCard`, the admin `open-week`,
//! `set-chaos` and `toggle-skip` flows on `chaos:week:N` / `chaos:manual:N:<ms>`) live in
//! [`race_core::meta`] and are re-exported here; their parity is covered by race-core's
//! meta-parity fixture.

pub use race_core::chaos::ChaosType;
pub use race_core::meta::{
    CHAOS_CARDS, ChaosCardError, Season3Player, draw_chaos_card_type, manual_chaos_stream,
    open_week_chaos_card, prepare_chaos_card, select_chaos_card, set_chaos_card,
    toggle_skip_chaos_card, toggle_skip_chaos_card_with_rng, weekly_chaos_stream,
};

/// `chaosLabel(type)`.
#[must_use]
pub fn chaos_label(chaos_type: ChaosType) -> &'static str {
    match chaos_type {
        ChaosType::Normal => "🏁 NORMAL",
        ChaosType::Reverse => "🔄 REVERSE",
        ChaosType::Duo => "🤝 DUO",
        ChaosType::TripleElimination => "💀 TRIPLE ELIMINATION",
        ChaosType::CutLine => "🚧 CUT LINE",
        ChaosType::Constructors => "🏎️ CONSTRUCTORS",
        ChaosType::BountyHunt => "🎯 BOUNTY HUNT",
    }
}

/// `CHAOS_CARDS.includes(value as ChaosType)`: the exact wire literal, case-sensitive.
#[must_use]
pub fn parse_chaos_type(value: &str) -> Option<ChaosType> {
    ChaosType::from_wire(value)
}

/// `ChaosCard` as `resolveSeason3Race` consumes it.
///
/// `groups` holds each member as `String(member)`, which is what `resolveSeason3Race` hands
/// the Chaos rule (`group.map(String)`). Cards drawn by the server have numeric ids
/// (`From<race_core::meta::ChaosCard>`); cards read back from `SeasonWeek.chaosPayload` keep
/// whatever JSON the admin stored (see [`super::payload::chaos_groups_for_resolution`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChaosCard {
    pub chaos_type: ChaosType,
    pub target_user_id: Option<i64>,
    pub target_user_id2: Option<i64>,
    pub groups: Option<Vec<Vec<String>>>,
}

impl ChaosCard {
    /// A card without target or groups.
    #[must_use]
    pub fn plain(chaos_type: ChaosType) -> Self {
        Self {
            chaos_type,
            target_user_id: None,
            target_user_id2: None,
            groups: None,
        }
    }
}

impl From<race_core::meta::ChaosCard> for ChaosCard {
    fn from(card: race_core::meta::ChaosCard) -> Self {
        Self {
            chaos_type: card.chaos_type,
            target_user_id: card.target_user_id,
            target_user_id2: card.target_user_id2,
            groups: card.groups.map(|groups| {
                groups
                    .iter()
                    .map(|group| group.iter().map(ToString::to_string).collect())
                    .collect()
            }),
        }
    }
}
