//! `resolveSeason3Race`, `applyScarEconomy`, `resolvePredictions` and `selectChampion`
//! (`lib/season3.ts`).
//!
//! Boundary (`docs/racing-engine-plan.md`): the Chaos rule turns raw standings into a loser
//! list; only this layer turns losers into Scars and Season Shield use. Every loser gets one
//! Scar point unless their confirmed Shield protects them.

use std::collections::BTreeSet;
use std::fmt;

use race_core::chaos::{ChaosError, ChaosPreparedState, RawChaosEntry, resolve_chaos_rule};
use serde::Serialize;

use super::cards::{ChaosCard, chaos_label};

/// `Season3RankingEntry` (key order `userId, name, rank, hasShield`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Season3RankingEntry {
    pub user_id: i64,
    pub name: String,
    pub rank: i64,
    pub has_shield: bool,
}

/// `ScarOutcome`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScarOutcome {
    pub user_id: i64,
    pub name: String,
    pub rank: i64,
    pub scar_points: i64,
    pub protected_by_shield: bool,
    pub shield_consumed: bool,
    pub reason: String,
}

/// `Season3Resolution`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Season3Resolution {
    /// The input sorted by raw rank.
    pub ranking: Vec<Season3RankingEntry>,
    /// The raw Bottom 2 (predictions score against these, whatever the Chaos card).
    pub bottom_two: Vec<Season3RankingEntry>,
    /// One per Chaos loser, by rank.
    pub scar_outcomes: Vec<ScarOutcome>,
    pub scar_victims: Vec<Season3RankingEntry>,
    pub protected_players: Vec<Season3RankingEntry>,
    pub king_user_id: Option<i64>,
    pub king_streak: i64,
    pub king_changed: bool,
}

/// `PreviousKing`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PreviousKing {
    pub user_id: i64,
    pub streak: i64,
}

/// Why `resolveSeason3Race` throws. `Display` is the TS message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolveError {
    TooFewPlayers,
    RanksNotConsecutive,
    Duplicate,
    Chaos(ChaosError),
}

impl fmt::Display for ResolveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooFewPlayers => f.write_str("A Season 3 race needs at least two players"),
            Self::RanksNotConsecutive => {
                f.write_str("Ranking must contain consecutive ranks from 1 to N")
            }
            Self::Duplicate => f.write_str("Ranking cannot contain duplicate ranks or players"),
            Self::Chaos(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ResolveError {}

/// `assertRanking(ranking)`: at least two entries, ranks `1..=N`, no duplicate rank or player.
/// Checked entry by entry in input order, so the first offending entry decides the message.
///
/// # Errors
/// The [`ResolveError`] the TS function throws.
pub fn assert_ranking(ranking: &[Season3RankingEntry]) -> Result<(), ResolveError> {
    if ranking.len() < 2 {
        return Err(ResolveError::TooFewPlayers);
    }
    let len = i64::try_from(ranking.len()).unwrap_or(i64::MAX);
    let mut ranks = BTreeSet::new();
    let mut users = BTreeSet::new();
    for entry in ranking {
        if entry.rank < 1 || entry.rank > len {
            return Err(ResolveError::RanksNotConsecutive);
        }
        if !ranks.insert(entry.rank) || !users.insert(entry.user_id) {
            return Err(ResolveError::Duplicate);
        }
    }
    Ok(())
}

/// `resolveSeason3Race(inputRanking, chaos, previousKing)`.
///
/// # Errors
/// An invalid ranking, or the Chaos rule's error (missing groups, a Wanted player outside the
/// ranking, …).
///
/// # Panics
/// Never: a validated ranking has at least two entries and ranks that fit `u32`.
pub fn resolve_season3_race(
    input: &[Season3RankingEntry],
    chaos: &ChaosCard,
    previous_king: Option<PreviousKing>,
) -> Result<Season3Resolution, ResolveError> {
    assert_ranking(input)?;
    let mut ranking = input.to_vec();
    ranking.sort_by_key(|entry| entry.rank);
    let bottom_two = ranking[ranking.len() - 2..].to_vec();

    let player_ids: Vec<String> = ranking.iter().map(|e| e.user_id.to_string()).collect();
    let raw: Vec<RawChaosEntry<'_>> = ranking
        .iter()
        .zip(&player_ids)
        .map(|(entry, player_id)| RawChaosEntry {
            player_id,
            rank: u32::try_from(entry.rank).expect("validated rank fits u32"),
        })
        .collect();
    let prepared = ChaosPreparedState {
        target_player_id: chaos.target_user_id.map(|id| id.to_string()),
        groups: chaos.groups.clone(),
    };
    let result =
        resolve_chaos_rule(chaos.chaos_type, &raw, &prepared).map_err(ResolveError::Chaos)?;
    let reasons = result.metadata.reason_by_player();

    // `ranking.filter((entry) => affectedIds.has(entry.userId))`, already in rank order.
    let scar_outcomes: Vec<ScarOutcome> = ranking
        .iter()
        .zip(&player_ids)
        .filter(|(_, player_id)| result.loser_player_ids.contains(player_id))
        .map(|(entry, player_id)| {
            let protected = entry.has_shield;
            let reason = if protected {
                "Shield saved this duck".to_owned()
            } else {
                reasons.get(player_id).map_or_else(
                    || format!("{} làm dzịt", chaos_label(chaos.chaos_type)),
                    str::to_owned,
                )
            };
            ScarOutcome {
                user_id: entry.user_id,
                name: entry.name.clone(),
                rank: entry.rank,
                scar_points: 1,
                protected_by_shield: protected,
                shield_consumed: protected,
                reason,
            }
        })
        .collect();

    let winner = &ranking[0];
    let keeps_crown = previous_king.is_some_and(|king| {
        ranking
            .iter()
            .find(|entry| entry.user_id == king.user_id)
            .is_some_and(|entry| entry.rank <= 3)
    });
    let (king_user_id, king_streak) = match previous_king {
        Some(king) if keeps_crown => (king.user_id, king.streak + 1),
        _ => (winner.user_id, 1),
    };
    let entry_of = |user_id: i64| -> Season3RankingEntry {
        ranking
            .iter()
            .find(|entry| entry.user_id == user_id)
            .expect("Chaos losers come from the ranking")
            .clone()
    };
    let scar_victims = scar_outcomes
        .iter()
        .filter(|outcome| !outcome.protected_by_shield)
        .map(|outcome| entry_of(outcome.user_id))
        .collect();
    let protected_players = scar_outcomes
        .iter()
        .filter(|outcome| outcome.protected_by_shield)
        .map(|outcome| entry_of(outcome.user_id))
        .collect();
    Ok(Season3Resolution {
        king_changed: previous_king.map(|king| king.user_id) != Some(king_user_id),
        ranking,
        bottom_two,
        scar_outcomes,
        scar_victims,
        protected_players,
        king_user_id: Some(king_user_id),
        king_streak,
    })
}

/// `applyScarEconomy`'s result.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct ScarEconomy {
    pub scars: i64,
    pub shields: i64,
}

/// `applyScarEconomy(currentScars, currentShields, scarPoints, shieldConsumed)`: a consumed
/// Shield blocks the Scar and costs one Shield (never below zero); every two Scars become one
/// Shield.
#[must_use]
pub fn apply_scar_economy(
    current_scars: i64,
    current_shields: i64,
    scar_points: i64,
    shield_consumed: bool,
) -> ScarEconomy {
    let mut scars = current_scars + if shield_consumed { 0 } else { scar_points };
    let mut shields = (current_shields - i64::from(shield_consumed)).max(0);
    while scars >= 2 {
        scars -= 2;
        shields += 1;
    }
    ScarEconomy { scars, shields }
}

/// A `{ predictorUserId, targetUserId }` prediction.
pub use crate::cosmetics::economy::Prediction;

/// `PredictionOutcome`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredictionOutcome {
    pub predictor_user_id: i64,
    pub target_user_id: i64,
    pub target_name: String,
    pub correct: bool,
    pub points_awarded: i64,
}

/// `resolvePredictions(predictions, bottomTwo)`: one point for naming a raw Bottom 2 duck.
#[must_use]
pub fn resolve_predictions(
    predictions: &[Prediction],
    bottom_two: &[Season3RankingEntry],
) -> Vec<PredictionOutcome> {
    predictions
        .iter()
        .map(|prediction| {
            let target = bottom_two
                .iter()
                .find(|entry| entry.user_id == prediction.target_user_id);
            PredictionOutcome {
                predictor_user_id: prediction.predictor_user_id,
                target_user_id: prediction.target_user_id,
                target_name: target.map_or_else(
                    || format!("User {}", prediction.target_user_id),
                    |entry| entry.name.clone(),
                ),
                correct: target.is_some(),
                points_awarded: i64::from(target.is_some()),
            }
        })
        .collect()
}

/// A `selectChampion` input row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChampionCandidate {
    pub user_id: i64,
    pub championship_points: i64,
    pub race_wins: i64,
}

/// `selectChampion(players)`: most championship points, then most race wins, then the lowest
/// userId. Prediction points never count.
#[must_use]
pub fn select_champion(players: &[ChampionCandidate]) -> Option<i64> {
    let mut sorted = players.to_vec();
    sorted.sort_by(|left, right| {
        right
            .championship_points
            .cmp(&left.championship_points)
            .then(right.race_wins.cmp(&left.race_wins))
            .then(left.user_id.cmp(&right.user_id))
    });
    sorted.first().map(|player| player.user_id)
}
