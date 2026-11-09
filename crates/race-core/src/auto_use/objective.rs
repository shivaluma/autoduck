//! `buildRaceObjectiveContext` (`packages/race-core/src/auto-use/objective.ts`)
//! and `RaceObjectiveContext` (`auto-use/types.ts:36-52`).
//!
//! The TS context is an object of closures; here it is a struct with the same
//! methods. `chaos`/`naiveChaos` are [`ChaosUtility`] values whose caches are
//! plain fields, so the objective is passed `&mut` to the auto-use hooks.

use alloc::vec::Vec;

use race_protocol::config::{ChaosType, RaceChaosConfig, ResolvedRaceConfig};
use race_protocol::ids::PlayerId;

use super::chaos_utility::ChaosUtility;
use crate::math::{js_max, js_min};
use crate::sim::{DuckPhysicsState, IdMap};

/// `RaceObjectiveContext` (`types.ts:36-52`).
#[derive(Clone, Debug, PartialEq)]
pub struct RaceObjectiveContext {
    pub mode: ChaosType,
    pub player_count: u32,
    pub loser_cutoff: i64,
    /// `teammateMap` (each grouped player to its other group members).
    pub teammates: IdMap<Vec<PlayerId>>,
    /// Chaos-accurate loss risk and action values.
    pub chaos: ChaosUtility,
    /// Rank-cutoff view without team/bounty scoring (ablated brains).
    pub naive_chaos: ChaosUtility,
}

/// `loserCutoffForMode` (`objective.ts:6-18`).
fn loser_cutoff_for_mode(mode: ChaosType, player_count: u32) -> i64 {
    let count = i64::from(player_count);
    match mode {
        ChaosType::TripleElimination => count - 2,
        ChaosType::CutLine => i64::from(player_count.div_ceil(2)),
        _ => count - 1,
    }
}

/// `buildRaceObjectiveContext(config)` (`objective.ts:20-83`).
#[must_use]
pub fn build_race_objective_context(config: &ResolvedRaceConfig) -> RaceObjectiveContext {
    let mode = config.chaos_config.chaos_type;
    let player_count = u32::try_from(config.players.len()).expect("lobby size fits in u32");
    let mut teammates: IdMap<Vec<PlayerId>> = IdMap::new();
    for group in &config.chaos_config.groups {
        for player_id in group {
            let mut mates: Vec<PlayerId> = Vec::new();
            for member in group {
                if member != player_id && !mates.contains(member) {
                    mates.push(member.clone());
                }
            }
            teammates.insert(player_id.clone(), mates);
        }
    }
    // `{ ...config, chaosConfig: undefined }` for team/bounty modes.
    let naive = if matches!(
        mode,
        ChaosType::BountyHunt | ChaosType::Duo | ChaosType::Constructors
    ) {
        ChaosUtility::new(&RaceChaosConfig::default())
    } else {
        ChaosUtility::new(&config.chaos_config)
    };
    RaceObjectiveContext {
        mode,
        player_count,
        loser_cutoff: loser_cutoff_for_mode(mode, player_count),
        teammates,
        chaos: ChaosUtility::new(&config.chaos_config),
        naive_chaos: naive,
    }
}

impl RaceObjectiveContext {
    /// `teammateIds(playerId)` (`objective.ts:37`).
    #[must_use]
    pub fn teammate_ids(&self, player_id: &str) -> &[PlayerId] {
        self.teammates.get(player_id).map_or(&[], Vec::as_slice)
    }

    /// `isTeammate(left, right)` (`objective.ts:38`).
    #[must_use]
    pub fn is_teammate(&self, left: &str, right: &str) -> bool {
        self.teammate_ids(left)
            .iter()
            .any(|mate| mate.as_str() == right)
    }

    /// `isCurrentlyLosing(playerId, rank)` (`objective.ts:39-44`).
    #[must_use]
    pub fn is_currently_losing(&self, _player_id: &str, rank: u32) -> bool {
        let rank = i64::from(rank);
        let count = i64::from(self.player_count);
        match self.mode {
            ChaosType::Reverse => rank <= 2,
            ChaosType::CutLine => rank > i64::from(self.player_count.div_ceil(2)),
            ChaosType::TripleElimination => rank >= count - 2,
            _ => rank >= count - 1,
        }
    }

    /// `dangerScore(playerId, rank, progress, ducks)` (`objective.ts:45-59`).
    #[must_use]
    pub fn danger_score(
        &self,
        _player_id: &str,
        rank: u32,
        progress: f64,
        ducks: &[DuckPhysicsState],
    ) -> f64 {
        let span = js_max(1.0, f64::from(self.player_count) - 1.0);
        let relative = (f64::from(rank) - 1.0) / span * 100.0;
        let base = if self.mode == ChaosType::Reverse {
            js_max(0.0, 100.0 - relative)
        } else {
            relative
        };
        let mut gap_ahead = f64::INFINITY;
        let mut gap_behind = f64::INFINITY;
        for candidate in ducks {
            if candidate.finished {
                continue;
            }
            if candidate.current_rank < rank {
                gap_ahead = js_min(gap_ahead, js_max(0.0, candidate.progress - progress));
            }
            if candidate.current_rank > rank {
                gap_behind = js_min(gap_behind, js_max(0.0, progress - candidate.progress));
            }
        }
        let squeeze = if gap_ahead < 0.008 && gap_behind < 0.008 {
            25.0
        } else if gap_ahead < 0.015 {
            12.0
        } else {
            0.0
        };
        let late = if progress > 0.75 { 10.0 } else { 0.0 };
        js_min(100.0, base + squeeze + late)
    }

    /// `opponentThreat(sourceId, targetId)` (`objective.ts:60-63`).
    #[must_use]
    pub fn opponent_threat(&self, source_id: &str, target_id: &str) -> f64 {
        if self.is_teammate(source_id, target_id) {
            0.0
        } else {
            1.0
        }
    }

    /// `positionImprovementValue(playerId, fromRank, toRank)` (`objective.ts:64-67`).
    #[must_use]
    pub fn position_improvement_value(
        &self,
        _player_id: &str,
        from_rank: f64,
        to_rank: f64,
    ) -> f64 {
        if self.mode == ChaosType::Reverse {
            js_max(0.0, to_rank - from_rank) * 12.0
        } else {
            js_max(0.0, from_rank - to_rank) * 12.0
        }
    }

    /// `offensiveTargetRankBonus(sourceId, targetRank)` (`objective.ts:68-77`).
    #[must_use]
    pub fn offensive_target_rank_bonus(&self, _source_id: &str, target_rank: u32) -> f64 {
        let rank = i64::from(target_rank);
        let count = i64::from(self.player_count);
        if self.mode == ChaosType::Reverse {
            if rank <= 2 {
                return -30.0;
            }
            if rank >= count - 1 {
                return 10.0;
            }
            return -10.0;
        }
        if rank <= 2 {
            return 8.0;
        }
        if rank >= count - 1 {
            return -8.0;
        }
        0.0
    }

    /// `offensiveTargetPenalty(sourceId, targetId)` (`objective.ts:78-81`).
    #[must_use]
    pub fn offensive_target_penalty(&self, source_id: &str, target_id: &str) -> f64 {
        if self.is_teammate(source_id, target_id) {
            f64::INFINITY
        } else {
            0.0
        }
    }
}
