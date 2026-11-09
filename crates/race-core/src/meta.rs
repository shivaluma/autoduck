//! Season 3 meta-layer Chaos card draws (D5): the RNG-relevant parts of
//! `lib/season3.ts` (`selectChaosCard`, `prepareChaosCard`) and of the admin
//! route `app/api/admin/season3/route.ts` (`create-season`, `open-week`,
//! `set-chaos`, `toggle-skip`).
//!
//! The streams `chaos:week:N` and `chaos:manual:N:<ms>` must stay identical
//! mid-season, so every draw happens in the TS order:
//! - `selectChaosCard` draws **one** `random()` for the card type
//!   (`CHAOS_CARDS[min(6, floor(r * 7))]`), then `prepareChaosCard` continues
//!   the shuffle on the same stream.
//! - `prepareChaosCard` throws on an empty lobby *after* the type draw, and
//!   filters ghost ducks (`name === 'Thomas'`) before preparing, so ghosts
//!   never consume shuffle draws or land in groups/targets.
//! - `toggle-skip` re-creates `chaos:week:N` from the persisted seed, discards
//!   one draw (the persisted card draw), then re-prepares the persisted type.
//!
//! Manual overrides (an admin-chosen Wanted player or groups) draw nothing and
//! are validated by the server, not here.

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::fmt;

use crate::chaos::{ChaosPreparedState, ChaosType, prepare_chaos_rule};
use crate::math::{floor, js_min};
use crate::rng::{DeterministicRng, create_race_rng};

/// `CHAOS_CARDS` (`lib/season3.ts`), in draw order.
pub const CHAOS_CARDS: [ChaosType; 7] = [
    ChaosType::Normal,
    ChaosType::Reverse,
    ChaosType::Duo,
    ChaosType::TripleElimination,
    ChaosType::CutLine,
    ChaosType::Constructors,
    ChaosType::BountyHunt,
];

/// The ghost duck's display name (`lib/ghost-duck.ts`). Exact match: no
/// trimming, case-sensitive.
pub const GHOST_DUCK_NAME: &str = "Thomas";

/// `isGhostDuck({ name })`.
#[must_use]
pub fn is_ghost_duck(name: &str) -> bool {
    name == GHOST_DUCK_NAME
}

/// `Season3Player` (`{ userId, name }`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Season3Player<'a> {
    pub user_id: i64,
    pub name: &'a str,
}

/// `ChaosCard` (`{ type, targetUserId, targetUserId2, groups? }`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChaosCard {
    pub chaos_type: ChaosType,
    pub target_user_id: Option<i64>,
    /// Always `null` in S3.15.
    pub target_user_id2: Option<i64>,
    /// `undefined` (`None`) unless the rule prepared groups.
    pub groups: Option<Vec<Vec<i64>>>,
}

impl ChaosCard {
    /// The `prepared` argument `resolveSeason3Race` passes to
    /// `resolveChaosRule`: ids as `String(userId)`.
    #[must_use]
    pub fn prepared_state(&self) -> ChaosPreparedState {
        ChaosPreparedState {
            target_player_id: self.target_user_id.map(|id| id.to_string()),
            groups: self.groups.as_ref().map(|groups| {
                groups
                    .iter()
                    .map(|group| group.iter().map(ToString::to_string).collect())
                    .collect()
            }),
        }
    }
}

/// Why a card draw throws. `Display` is the TS message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChaosCardError {
    /// `prepareChaosCard` with an empty player list.
    NoPlayers,
}

impl fmt::Display for ChaosCardError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoPlayers => f.write_str("Cannot select a chaos card without players"),
        }
    }
}

impl core::error::Error for ChaosCardError {}

/// `chaos:week:<weekNumber>` (create-season, open-week, toggle-skip).
#[must_use]
pub fn weekly_chaos_stream(week_number: u32) -> String {
    format!("chaos:week:{week_number}")
}

/// `chaos:manual:<weekNumber>:<Date.now()>` (set-chaos).
#[must_use]
pub fn manual_chaos_stream(week_number: u32, epoch_ms: i64) -> String {
    format!("chaos:manual:{week_number}:{epoch_ms}")
}

/// The card-type draw of `selectChaosCard`:
/// `CHAOS_CARDS[Math.min(6, Math.floor(random() * 7))]`.
///
/// # Panics
/// If `random()` returns a negative number or NaN.
pub fn draw_chaos_card_type(random: &mut impl FnMut() -> f64) -> ChaosType {
    let slot = js_min(6.0, floor(random() * 7.0));
    assert!(slot >= 0.0, "draw_chaos_card_type: random() below 0");
    // `slot` is an integer in [0, 6].
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let slot = slot as usize;
    CHAOS_CARDS[slot]
}

/// `prepareChaosCard(type, players, random)`.
///
/// # Errors
/// [`ChaosCardError::NoPlayers`] for an empty `players` (checked before the
/// ghost filter).
///
/// # Panics
/// If a prepared id does not parse back as a user id (it always does: the ids
/// are `String(userId)`).
pub fn prepare_chaos_card(
    chaos_type: ChaosType,
    players: &[Season3Player<'_>],
    random: &mut impl FnMut() -> f64,
) -> Result<ChaosCard, ChaosCardError> {
    if players.is_empty() {
        return Err(ChaosCardError::NoPlayers);
    }
    let official: Vec<String> = players
        .iter()
        .filter(|player| !is_ghost_duck(player.name))
        .map(|player| player.user_id.to_string())
        .collect();
    let prepared = prepare_chaos_rule(chaos_type, &official, random);
    let number = |id: &String| -> i64 { id.parse().expect("prepared ids are String(userId)") };
    Ok(ChaosCard {
        chaos_type,
        // `prepared.targetPlayerId ? Number(...) : null`; ids are never "".
        target_user_id: prepared
            .target_player_id
            .as_ref()
            .filter(|id| !id.is_empty())
            .map(number),
        target_user_id2: None,
        groups: prepared.groups.map(|groups| {
            groups
                .iter()
                .map(|group| group.iter().map(number).collect())
                .collect()
        }),
    })
}

/// `selectChaosCard(players, random)`: one draw for the type, then
/// [`prepare_chaos_card`] on the same stream.
///
/// # Errors
/// [`ChaosCardError::NoPlayers`] (after the type draw, as in TS).
pub fn select_chaos_card(
    players: &[Season3Player<'_>],
    random: &mut impl FnMut() -> f64,
) -> Result<ChaosCard, ChaosCardError> {
    let chaos_type = draw_chaos_card_type(random);
    prepare_chaos_card(chaos_type, players, random)
}

/// Admin `create-season` / `open-week` without manual overrides, on
/// `chaos:week:N`: `RANDOM` (`None`) selects a card; an explicit type is
/// prepared (`prepareChaosCard`, which draws nothing for the four
/// group-less rules).
///
/// # Errors
/// [`ChaosCardError::NoPlayers`].
pub fn open_week_chaos_card(
    requested: Option<ChaosType>,
    players: &[Season3Player<'_>],
    random: &mut impl FnMut() -> f64,
) -> Result<ChaosCard, ChaosCardError> {
    match requested {
        None => select_chaos_card(players, random),
        Some(chaos_type) => prepare_chaos_card(chaos_type, players, random),
    }
}

/// Admin `set-chaos` without manual overrides, on `chaos:manual:N:<ms>`:
/// `RANDOM` selects a card; BOUNTY_HUNT keeps only the prepared target,
/// DUO/CONSTRUCTORS only the prepared groups; every other explicit type
/// draws nothing and has no target or groups.
///
/// # Errors
/// [`ChaosCardError::NoPlayers`].
pub fn set_chaos_card(
    requested: Option<ChaosType>,
    players: &[Season3Player<'_>],
    random: &mut impl FnMut() -> f64,
) -> Result<ChaosCard, ChaosCardError> {
    let Some(chaos_type) = requested else {
        return select_chaos_card(players, random);
    };
    let mut card = ChaosCard {
        chaos_type,
        target_user_id: None,
        target_user_id2: None,
        groups: None,
    };
    match chaos_type {
        ChaosType::BountyHunt => {
            card.target_user_id =
                prepare_chaos_card(ChaosType::BountyHunt, players, random)?.target_user_id;
        }
        ChaosType::Duo | ChaosType::Constructors => {
            card.groups = prepare_chaos_card(chaos_type, players, random)?.groups;
        }
        _ => {}
    }
    Ok(card)
}

/// Admin `toggle-skip` on an existing generator for `chaos:week:N`: discard
/// one draw ("keep the preparation stream aligned after the persisted card
/// draw"), then re-prepare the persisted type for the active players.
///
/// # Errors
/// [`ChaosCardError::NoPlayers`].
pub fn toggle_skip_chaos_card_with_rng(
    rng: &mut DeterministicRng,
    chaos_type: ChaosType,
    active_players: &[Season3Player<'_>],
) -> Result<ChaosCard, ChaosCardError> {
    let _discarded = rng.next_f64();
    prepare_chaos_card(chaos_type, active_players, &mut || rng.next_f64())
}

/// Admin `toggle-skip`: [`toggle_skip_chaos_card_with_rng`] on
/// `createRaceRng(chaosSeed, 'chaos:week:' + weekNumber)`.
///
/// # Errors
/// [`ChaosCardError::NoPlayers`].
pub fn toggle_skip_chaos_card(
    chaos_seed: &str,
    week_number: u32,
    chaos_type: ChaosType,
    active_players: &[Season3Player<'_>],
) -> Result<ChaosCard, ChaosCardError> {
    let mut rng = create_race_rng(chaos_seed, &weekly_chaos_stream(week_number));
    toggle_skip_chaos_card_with_rng(&mut rng, chaos_type, active_players)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn players(ids: &[(i64, &'static str)]) -> Vec<Season3Player<'static>> {
        ids.iter()
            .map(|&(user_id, name)| Season3Player { user_id, name })
            .collect()
    }

    // tests/season3.test.ts: `selectChaosCard(ranking.slice(0, 3), () => 0.3)`.
    #[test]
    fn select_uses_one_draw_then_prepares() {
        let lobby = players(&[(1, "A"), (2, "B"), (3, "C")]);
        let card = select_chaos_card(&lobby, &mut || 0.3).unwrap();
        // floor(0.3 * 7) = 2: DUO, and the three ducks form one trio.
        assert_eq!(card.chaos_type, ChaosType::Duo);
        assert_eq!(card.target_user_id, None);
        let grouped: usize = card.groups.unwrap().iter().map(Vec::len).sum();
        assert_eq!(grouped, 3);
    }

    #[test]
    fn ghosts_are_filtered_and_empty_lobby_fails_after_draw() {
        let lobby = players(&[(1, "Thomas"), (2, "B")]);
        let card = prepare_chaos_card(ChaosType::BountyHunt, &lobby, &mut || 0.9).unwrap();
        assert_eq!(card.target_user_id, Some(2));
        let mut draws = 0;
        let error = select_chaos_card(&[], &mut || {
            draws += 1;
            0.5
        });
        assert_eq!(error, Err(ChaosCardError::NoPlayers));
        assert_eq!(draws, 1);
    }

    #[test]
    fn streams() {
        assert_eq!(weekly_chaos_stream(3), "chaos:week:3");
        assert_eq!(
            manual_chaos_stream(3, 1_731_000_000_123),
            "chaos:manual:3:1731000000123"
        );
    }
}
