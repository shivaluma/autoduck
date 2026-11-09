//! `ChaosUtility` (`packages/race-core/src/auto-use/chaos-utility.ts`).
//!
//! Instead of hand-coding tactics per Chaos card, the AI asks the real Chaos
//! rule "who loses if the ranking looks like this?" and compares the current
//! ranking with the projected one.
//!
//! Phase A keeps the ranking memo as a **plain field** with the TS hit/miss
//! condition: `observe` reuses `snapshot` while the ranking fingerprint
//! (`ducks.length + Σ progress·(index + 1.618) + (finished ? 7 : 0)`)
//! compares `===` equal (so a NaN fingerprint never hits). A hit can return a
//! ranking built from older `currentRank`s; that staleness is TS behaviour.
//! The TS `outcomeCache` memoises a pure function of the order, so it is not
//! modelled. `Math.exp` (`:107,131`) goes through [`EngineMath::exp`].

use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::config::{ChaosType, RaceChaosConfig};
use race_protocol::ids::PlayerId;

use crate::chaos::{ChaosPreparedState, RawChaosEntry, resolve_chaos_rule};
use crate::js_sort::v8_sort_by;
use crate::math::{abs, cmp_f64_js, js_max, js_min};
use crate::sim::{DuckPhysicsState, EngineMath, id_cmp};

/// Utility of one outcome: avoiding the loser set dominates (`:27`).
const LOSS_WEIGHT: f64 = 1.0;
/// A better finishing slot is a tiebreaker (`:28`).
const PLACE_WEIGHT: f64 = 0.15;
/// Gap at which a neighbouring swap is ~37% likely (`:30`).
const SWAP_GAP_SCALE: f64 = 0.02;
/// The fingerprint step `1.618` (`:47`).
const FINGERPRINT_STEP: f64 = 1.618;

/// `RankingSnapshot` (`:19-24`).
#[derive(Clone, Debug, PartialEq)]
struct RankingSnapshot {
    fingerprint: f64,
    order: Vec<PlayerId>,
    /// `progressById`, in `ducks` order.
    progress_by_id: Vec<(PlayerId, f64)>,
}

impl RankingSnapshot {
    fn progress(&self, player_id: &str) -> Option<f64> {
        // `new Map(entries)`: a later duplicate wins.
        self.progress_by_id
            .iter()
            .rev()
            .find(|(id, _)| id.as_str() == player_id)
            .map(|&(_, progress)| progress)
    }

    fn index(&self, player_id: &str) -> Option<usize> {
        // `new Map(order.map((id, index) => [id, index]))`: the last wins.
        self.order.iter().rposition(|id| id.as_str() == player_id)
    }
}

/// One `outcome(order)` (`:64-89`).
struct Outcome {
    losers: Vec<String>,
    /// `finalOrder` when the rule returned `finalStandings`.
    final_order: Option<Vec<String>>,
}

impl Outcome {
    fn is_loser(&self, player_id: &str) -> bool {
        self.losers.iter().any(|id| id == player_id)
    }
}

/// `ChaosUtility` (`chaos-utility.ts:32-171`).
#[derive(Clone, Debug, PartialEq)]
pub struct ChaosUtility {
    /// `config.chaosConfig?.type ?? 'NORMAL'`.
    pub mode: ChaosType,
    /// `prepared.targetPlayerId`.
    pub target_player_id: Option<PlayerId>,
    /// `prepared.groups`.
    pub groups: Vec<Vec<PlayerId>>,
    /// The ranking memo (`private snapshot`).
    snapshot: Option<RankingSnapshot>,
}

/// `moved(order, from, to)` (`:174-179`).
fn moved<T: Clone>(order: &[T], from: usize, to: usize) -> Vec<T> {
    let mut next = order.to_vec();
    let item = next.remove(from);
    next.insert(to, item);
    next
}

#[allow(clippy::cast_precision_loss)] // lobby sizes and indices are tiny
fn index_f64(index: usize) -> f64 {
    index as f64
}

/// A non-negative integral `f64` index as `usize` (the callers only pass
/// integers).
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn to_index(value: f64) -> usize {
    value as usize
}

/// The `±1, ±2` neighbour indices of `index`, in the TS loop order, stopping
/// at the ends of `len` (`for direction of [-1, 1] { for step 1..=2 }`).
fn neighbour(index: usize, direction: i8, step: usize, len: usize) -> Option<usize> {
    let neighbour = if direction < 0 {
        index.checked_sub(step)?
    } else {
        index + step
    };
    (neighbour < len).then_some(neighbour)
}

impl ChaosUtility {
    /// `new ChaosUtility(config)` (`chaos-utility.ts:37-43`). An absent
    /// `chaosConfig` is the resolved default (`NORMAL`, no target, no groups).
    #[must_use]
    pub fn new(chaos: &RaceChaosConfig) -> Self {
        Self {
            mode: chaos.chaos_type,
            target_player_id: chaos.target_player_id.clone(),
            groups: chaos.groups.clone(),
            snapshot: None,
        }
    }

    /// `get chaosMode`.
    #[must_use]
    pub const fn chaos_mode(&self) -> ChaosType {
        self.mode
    }

    /// `get wantedPlayerId`.
    #[must_use]
    pub fn wanted_player_id(&self) -> Option<&PlayerId> {
        if self.mode == ChaosType::BountyHunt {
            self.target_player_id.as_ref()
        } else {
            None
        }
    }

    /// `observe(ducks)` (`:46-62`): the current ranking, memoised on the
    /// fingerprint. Returns a copy of the (possibly reused) snapshot.
    fn observe(&mut self, ducks: &[DuckPhysicsState]) -> RankingSnapshot {
        let mut fingerprint = index_f64(ducks.len());
        for (index, duck) in ducks.iter().enumerate() {
            fingerprint += duck.progress * (index_f64(index) + FINGERPRINT_STEP)
                + if duck.finished { 7.0 } else { 0.0 };
        }
        if let Some(snapshot) = &self.snapshot
            && snapshot.fingerprint == fingerprint
        {
            return snapshot.clone();
        }
        let mut sorted: Vec<&DuckPhysicsState> = ducks.iter().collect();
        v8_sort_by(&mut sorted, |left, right| {
            // `left.currentRank - right.currentRank || right.progress -
            // left.progress || left.playerId.localeCompare(right.playerId)`
            left.current_rank
                .cmp(&right.current_rank)
                .then_with(|| cmp_f64_js(right.progress, left.progress))
                .then_with(|| id_cmp(left.player_id.as_str(), right.player_id.as_str()))
        });
        let snapshot = RankingSnapshot {
            fingerprint,
            order: sorted.iter().map(|duck| duck.player_id.clone()).collect(),
            progress_by_id: ducks
                .iter()
                .map(|duck| (duck.player_id.clone(), duck.progress))
                .collect(),
        };
        self.snapshot = Some(snapshot.clone());
        snapshot
    }

    /// `outcome(order)` (`:64-89`).
    fn outcome(&self, order: &[PlayerId]) -> Outcome {
        let last_two = || -> Vec<String> {
            order[order.len().saturating_sub(2)..]
                .iter()
                .map(|id| String::from(id.as_str()))
                .collect()
        };
        if self.mode == ChaosType::BountyHunt && self.target_player_id.is_none() {
            return Outcome {
                losers: last_two(),
                final_order: None,
            };
        }
        if matches!(self.mode, ChaosType::Duo | ChaosType::Constructors) && self.groups.is_empty() {
            return Outcome {
                losers: last_two(),
                final_order: None,
            };
        }
        let raw: Vec<RawChaosEntry<'_>> = order
            .iter()
            .enumerate()
            .map(|(index, id)| RawChaosEntry {
                player_id: id.as_str(),
                rank: u32::try_from(index + 1).expect("lobby size fits in u32"),
            })
            .collect();
        let prepared = ChaosPreparedState {
            target_player_id: self
                .target_player_id
                .as_ref()
                .map(|id| String::from(id.as_str())),
            groups: Some(
                self.groups
                    .iter()
                    .map(|group| group.iter().map(|id| String::from(id.as_str())).collect())
                    .collect(),
            ),
        };
        match resolve_chaos_rule(self.mode, &raw, &prepared) {
            Ok(result) => Outcome {
                losers: result.loser_player_ids,
                final_order: result.final_standings,
            },
            // `catch { losers = new Set(order.slice(-2)) }`
            Err(_) => Outcome {
                losers: last_two(),
                final_order: None,
            },
        }
    }

    /// `utility(order, playerId)` (`:91-96`).
    fn utility(&self, order: &[PlayerId], player_id: &str) -> f64 {
        let outcome = self.outcome(order);
        let n = js_max(1.0, index_f64(order.len()) - 1.0);
        // `finalIndex = new Map(finalOrder.map((id, index) => [id, index]))`
        let final_index = match &outcome.final_order {
            Some(final_order) => final_order.iter().rposition(|id| id == player_id),
            None => order.iter().rposition(|id| id.as_str() == player_id),
        };
        let index = final_index.map_or(index_f64(order.len()) - 1.0, index_f64);
        let place = 1.0 - index / n;
        -(if outcome.is_loser(player_id) {
            LOSS_WEIGHT
        } else {
            0.0
        }) + PLACE_WEIGHT * place
    }

    /// `softUtility(order, playerId, snapshot)` (`:99-118`).
    fn soft_utility(
        &self,
        order: &[PlayerId],
        player_id: &str,
        snapshot: &RankingSnapshot,
        math: EngineMath,
    ) -> f64 {
        let Some(index) = order.iter().position(|id| id.as_str() == player_id) else {
            return 0.0;
        };
        let me = snapshot.progress(player_id).unwrap_or(0.0);
        let mut total = self.utility(order, player_id);
        let mut weight = 1.0;
        for direction in [-1_i8, 1] {
            let mut chain = 1.0;
            for step in 1..=2 {
                let Some(other) = neighbour(index, direction, step, order.len()) else {
                    break;
                };
                let gap = abs(snapshot.progress(order[other].as_str()).unwrap_or(me) - me);
                chain *= math.exp(-gap / SWAP_GAP_SCALE);
                if chain < 0.02 {
                    break;
                }
                total += chain * self.utility(&moved(order, index, other), player_id);
                weight += chain;
            }
        }
        total / weight
    }

    /// `lossRisk(playerId, ducks)` (`:121-141`): probability-like loss risk
    /// in `[0, 1]` at the current ranking.
    pub fn loss_risk(
        &mut self,
        player_id: &str,
        ducks: &[DuckPhysicsState],
        math: EngineMath,
    ) -> f64 {
        let snapshot = self.observe(ducks);
        let order = &snapshot.order;
        let Some(index) = snapshot.index(player_id) else {
            return 0.0;
        };
        let me = snapshot.progress(player_id).unwrap_or(0.0);
        let mut total = if self.outcome(order).is_loser(player_id) {
            1.0
        } else {
            0.0
        };
        let mut weight = 1.0;
        for direction in [-1_i8, 1] {
            let mut chain = 1.0;
            for step in 1..=2 {
                let Some(other) = neighbour(index, direction, step, order.len()) else {
                    break;
                };
                let gap = abs(snapshot.progress(order[other].as_str()).unwrap_or(me) - me);
                chain *= math.exp(-gap / SWAP_GAP_SCALE);
                if chain < 0.02 {
                    break;
                }
                let loses = self
                    .outcome(&moved(order, index, other))
                    .is_loser(player_id);
                total += chain * if loses { 1.0 } else { 0.0 };
                weight += chain;
            }
        }
        total / weight
    }

    /// `isLosingNow(playerId, ducks)` (`:144-147`).
    pub fn is_losing_now(&mut self, player_id: &str, ducks: &[DuckPhysicsState]) -> bool {
        let snapshot = self.observe(ducks);
        self.outcome(&snapshot.order).is_loser(player_id)
    }

    /// `actionValue(playerId, ducks, selfGain, targetId?, targetDrop = 0)`
    /// (`:153-166`): utility gain (about 0..100) if `player_id` climbs
    /// `self_gain` places and/or `target_id` drops `target_drop` places.
    pub fn action_value(
        &mut self,
        player_id: &str,
        ducks: &[DuckPhysicsState],
        self_gain: f64,
        target_id: Option<&str>,
        target_drop: f64,
        math: EngineMath,
    ) -> f64 {
        let snapshot = self.observe(ducks);
        let before = self.soft_utility(&snapshot.order, player_id, &snapshot, math);
        // `None` while `order === snapshot.order`.
        let mut order: Option<Vec<PlayerId>> = None;
        if let Some(target_id) = target_id
            && target_drop > 0.0
        {
            let current = order.as_deref().unwrap_or(&snapshot.order);
            if let Some(from) = current.iter().position(|id| id.as_str() == target_id) {
                let last = index_f64(current.len()) - 1.0;
                let to = to_index(js_min(last, index_f64(from) + target_drop));
                order = Some(moved(current, from, to));
            }
        }
        if self_gain > 0.0 {
            let current = order.as_deref().unwrap_or(&snapshot.order);
            if let Some(from) = current.iter().position(|id| id.as_str() == player_id) {
                let to = to_index(js_max(0.0, index_f64(from) - self_gain));
                order = Some(moved(current, from, to));
            }
        }
        let Some(order) = order else {
            return 0.0;
        };
        (self.soft_utility(&order, player_id, &snapshot, math) - before) * 100.0
    }
}
