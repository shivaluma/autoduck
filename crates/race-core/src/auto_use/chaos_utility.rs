//! `ChaosUtility` (`packages/race-core/src/auto-use/chaos-utility.ts`).
//!
//! Instead of hand-coding tactics per Chaos card, the AI asks the real Chaos
//! rule "who loses if the ranking looks like this?" and compares the current
//! ranking with the projected one.
//!
//! Phase A keeps both memos as **plain fields** with the TS hit/miss
//! conditions:
//!
//! - `observe` reuses `snapshot` while the ranking fingerprint
//!   (`ducks.length + Σ progress·(index + 1.618) + (finished ? 7 : 0)`, over
//!   `ducks` in array order) compares `===` equal, so a NaN fingerprint never
//!   hits. The fingerprint ignores `currentRank`, so a hit can return an
//!   order built from older ranks (ranks are recomputed after the auto-use
//!   decide phase, so the reuse lags by one phase); that staleness is TS
//!   behaviour.
//! - `outcomeCache` is keyed by `order.join('|')` (two orders can share a key
//!   when an id contains `|`; the first one's outcome is then reused, as in
//!   TS). It is cleared on every snapshot rebuild and, when it already holds
//!   more than 512 entries, right before an insert.
//!
//! `Math.exp` (`:107,131`) goes through [`EngineMath::exp`].

use alloc::collections::BTreeMap;
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

/// The cap above which `outcomeCache` is cleared before an insert (`:82`).
const OUTCOME_CACHE_LIMIT: usize = 512;

/// One `outcome(order)` value (`:64-89`).
#[derive(Clone, Debug, PartialEq)]
struct Outcome {
    /// `losers` (a `Set`; only membership is read).
    losers: Vec<String>,
    /// `finalOrder`: `result.finalStandings` when the rule returned them,
    /// otherwise the order the outcome was computed for. `finalIndex` is
    /// `new Map(finalOrder.map((id, index) => [id, index]))`, so a lookup
    /// takes the last occurrence.
    final_order: Vec<String>,
}

impl Outcome {
    fn is_loser(&self, player_id: &str) -> bool {
        self.losers.iter().any(|id| id == player_id)
    }

    /// `finalIndex.get(playerId)`.
    fn final_index(&self, player_id: &str) -> Option<usize> {
        self.final_order.iter().rposition(|id| id == player_id)
    }
}

/// `order.join('|')`, the `outcomeCache` key.
fn outcome_key(order: &[PlayerId]) -> String {
    let mut key = String::new();
    for (index, id) in order.iter().enumerate() {
        if index > 0 {
            key.push('|');
        }
        key.push_str(id.as_str());
    }
    key
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
    /// `private outcomeCache` (a `Map`; only lookups and `size` are used).
    outcome_cache: BTreeMap<String, Outcome>,
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
            outcome_cache: BTreeMap::new(),
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
        self.outcome_cache.clear();
        snapshot
    }

    /// `outcome(order)` (`:62-85`), memoised in `outcomeCache`.
    fn outcome(&mut self, order: &[PlayerId]) -> &Outcome {
        let key = outcome_key(order);
        if !self.outcome_cache.contains_key(&key) {
            let value = self.compute_outcome(order);
            if self.outcome_cache.len() > OUTCOME_CACHE_LIMIT {
                self.outcome_cache.clear();
            }
            self.outcome_cache.insert(key.clone(), value);
        }
        self.outcome_cache.get(&key).expect("inserted above")
    }

    /// The uncached body of `outcome(order)`.
    fn compute_outcome(&self, order: &[PlayerId]) -> Outcome {
        let order_ids =
            || -> Vec<String> { order.iter().map(|id| String::from(id.as_str())).collect() };
        let last_two = || -> Vec<String> {
            order[order.len().saturating_sub(2)..]
                .iter()
                .map(|id| String::from(id.as_str()))
                .collect()
        };
        if self.mode == ChaosType::BountyHunt && self.target_player_id.is_none() {
            return Outcome {
                losers: last_two(),
                final_order: order_ids(),
            };
        }
        if matches!(self.mode, ChaosType::Duo | ChaosType::Constructors) && self.groups.is_empty() {
            return Outcome {
                losers: last_two(),
                final_order: order_ids(),
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
                // `if (result.finalStandings) finalOrder = result.finalStandings`
                final_order: result.final_standings.unwrap_or_else(order_ids),
            },
            // `catch { losers = new Set(order.slice(-2)) }`
            Err(_) => Outcome {
                losers: last_two(),
                final_order: order_ids(),
            },
        }
    }

    /// `utility(order, playerId)` (`:91-96`).
    fn utility(&mut self, order: &[PlayerId], player_id: &str) -> f64 {
        let n = js_max(1.0, index_f64(order.len()) - 1.0);
        let outcome = self.outcome(order);
        // `finalIndex.get(playerId) ?? order.length - 1`
        let index = outcome
            .final_index(player_id)
            .map_or(index_f64(order.len()) - 1.0, index_f64);
        let place = 1.0 - index / n;
        -(if outcome.is_loser(player_id) {
            LOSS_WEIGHT
        } else {
            0.0
        }) + PLACE_WEIGHT * place
    }

    /// `softUtility(order, playerId, snapshot)` (`:99-118`).
    fn soft_utility(
        &mut self,
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
