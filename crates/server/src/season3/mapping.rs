//! `mapSeason3RaceRanking` (`lib/season3-race-mapping.ts`): engine standings → Season 3
//! ranking entries.
//!
//! **Deliberate change (plan Phase 3):** players are joined by `userId` (the engine's
//! `playerId` is `String(userId)`), never by display name. TS builds a `Map` keyed by
//! `user.name`, so two players sharing a name would be confused (the later one wins) and a
//! rename between lock and resolve would fail the race. With unique names both joins agree;
//! the parity fixture only uses unique names. Entry names come from the Season player row.

use std::collections::BTreeSet;
use std::fmt;

use super::resolve::Season3RankingEntry;

/// One raw standing (`result.standings`, ghosts already excluded by the engine).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawStanding<'a> {
    pub rank: i64,
    pub user_id: i64,
    /// Only used in the error message.
    pub name: &'a str,
}

/// `Season3RaceMappingPlayer`: an official (non-ghost) Season player in the race.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MappingPlayer<'a> {
    pub user_id: i64,
    pub name: &'a str,
    pub shields: i64,
    /// A `SeasonShieldChoice` exists for this week.
    pub shield_confirmed: bool,
}

/// Why the mapping throws. `Display` is the TS message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MappingError {
    /// A standing whose player is not in the Season roster.
    Foreign { name: String },
    /// Missing or duplicate players.
    Incomplete,
}

impl fmt::Display for MappingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Foreign { name } => write!(f, "Race trả về player không thuộc Season 3: {name}"),
            Self::Incomplete => f.write_str("Race không trả đủ ranking Season 3 players"),
        }
    }
}

impl std::error::Error for MappingError {}

/// `mapSeason3RaceRanking(rawRanking, players)`, joined by userId. A Shield counts only when
/// the player has one **and** confirmed it this week (no auto-use).
///
/// # Errors
/// [`MappingError::Foreign`] for the first standing outside `players`;
/// [`MappingError::Incomplete`] unless every player appears exactly once.
pub fn map_season3_race_ranking(
    raw: &[RawStanding<'_>],
    players: &[MappingPlayer<'_>],
) -> Result<Vec<Season3RankingEntry>, MappingError> {
    let mut ranking = Vec::with_capacity(raw.len());
    for entry in raw {
        // `new Map(...)` keeps the last player for a duplicated key.
        let player = players
            .iter()
            .rev()
            .find(|player| player.user_id == entry.user_id)
            .ok_or_else(|| MappingError::Foreign {
                name: entry.name.to_owned(),
            })?;
        ranking.push(Season3RankingEntry {
            user_id: player.user_id,
            name: player.name.to_owned(),
            rank: entry.rank,
            has_shield: player.shields > 0 && player.shield_confirmed,
        });
    }
    let unique: BTreeSet<i64> = ranking.iter().map(|entry| entry.user_id).collect();
    if ranking.len() != players.len() || unique.len() != players.len() {
        return Err(MappingError::Incomplete);
    }
    Ok(ranking)
}
