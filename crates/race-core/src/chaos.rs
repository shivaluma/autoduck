//! Chaos card rules: a faithful port of `packages/race-core/src/chaos/index.ts`
//! (S3.15).
//!
//! Boundary (`docs/racing-engine-plan.md`): Chaos takes raw standings and
//! returns a variable-length loser list. Scars and Season Shields are applied
//! by Season meta, never here.
//!
//! Port notes (Phase A, every TS quirk kept):
//! - `prepare` shuffles with `Math.floor(random() * (i + 1))` Fisher-Yates
//!   from the end, so a lobby of `n` consumes `n - 1` draws (none for `n <=
//!   1`). Only DUO, CONSTRUCTORS and BOUNTY_HUNT draw.
//! - `ordered()` sorts by `rank`, then `playerId.localeCompare` (the ICU model
//!   [`collate_compat::compare`] under `ts-compat`; byte order otherwise, the
//!   D6 Phase B order), and only then rejects fewer than 2 entries or a
//!   duplicate player.
//! - DUO scores sort with `right.average - left.average || worst || best ||
//!   tieOrder` through [`v8_sort_by`], so an empty custom group (average
//!   `0/0 = NaN`, worst `-Infinity`, best `+Infinity`) orders exactly as V8.
//! - CONSTRUCTORS: equal averages make **both** teams lose; a NaN average is
//!   never equal, and `a > NaN` is false, so team 1 loses.
//! - `reasonByPlayer` is `Object.fromEntries`: keys in JS own-property order
//!   (array-index keys ascending first, then insertion order), first
//!   insertion wins the position on duplicates ([`ReasonByPlayer`]).
//! - Errors are `Result`s whose `Display` is the TS message.

use alloc::collections::{BTreeMap, BTreeSet};
use alloc::string::String;
use alloc::vec::Vec;
use core::fmt;

pub use race_protocol::config::ChaosType;

use crate::js_sort::v8_sort_by;
use crate::math::{cmp_f64_js, floor, js_max_of, js_min_of};

/// `ChaosRuleId`: the same seven literals as the protocol's `ChaosType`.
pub type ChaosRuleId = ChaosType;

/// `CHAOS_RULE_IDS`, in TS order.
pub const CHAOS_RULE_IDS: &[ChaosRuleId] = ChaosType::ALL;

#[cfg(not(feature = "ts-compat"))]
use crate::collate_compat::byte_order as locale_compare;
#[cfg(feature = "ts-compat")]
use crate::collate_compat::compare as locale_compare;

/// `RawChaosEntry`: one raw standing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawChaosEntry<'a> {
    pub player_id: &'a str,
    pub rank: u32,
}

/// `ChaosPreparedState`. `None` stands for both `undefined` and `null`: the
/// rules only read `targetPlayerId ===` and `groups ?? []`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ChaosPreparedState {
    pub target_player_id: Option<String>,
    pub groups: Option<Vec<Vec<String>>>,
}

/// `metadata.reasonByPlayer`, in JS own-property order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReasonByPlayer {
    entries: Vec<(String, &'static str)>,
}

impl ReasonByPlayer {
    /// `Object.fromEntries(playerIds.map((id) => [id, reason]))`.
    fn new(player_ids: &[String], reason: &'static str) -> Self {
        let mut index_keys: Vec<(u32, &String)> = Vec::new();
        let mut string_keys: Vec<&String> = Vec::new();
        for id in player_ids {
            match array_index(id) {
                Some(value) => {
                    if !index_keys.iter().any(|(_, key)| *key == id) {
                        index_keys.push((value, id));
                    }
                }
                None => {
                    if !string_keys.contains(&id) {
                        string_keys.push(id);
                    }
                }
            }
        }
        index_keys.sort_by_key(|&(value, _)| value);
        let entries = index_keys
            .into_iter()
            .map(|(_, id)| id)
            .chain(string_keys)
            .map(|id| (id.clone(), reason))
            .collect();
        Self { entries }
    }

    /// `(playerId, reason)` pairs in JS property order (what `JSON.stringify`
    /// and `Object.entries` see).
    #[must_use]
    pub fn entries(&self) -> &[(String, &'static str)] {
        &self.entries
    }

    /// `reasonByPlayer[playerId]`.
    #[must_use]
    pub fn get(&self, player_id: &str) -> Option<&'static str> {
        self.entries
            .iter()
            .find(|(id, _)| id == player_id)
            .map(|&(_, reason)| reason)
    }
}

/// ECMAScript array index: the canonical decimal form of an integer in
/// `0..=2^32 - 2`. Such keys come first in an object's property order.
fn array_index(key: &str) -> Option<u32> {
    let bytes = key.as_bytes();
    if bytes.is_empty() || bytes.len() > 10 || !bytes.iter().all(u8::is_ascii_digit) {
        return None;
    }
    if bytes.len() > 1 && bytes[0] == b'0' {
        return None;
    }
    let value: u64 = key.parse().ok()?;
    if value <= 4_294_967_294 {
        u32::try_from(value).ok()
    } else {
        None
    }
}

/// One DUO entry of `metadata.scores` (key order `group, total, average,
/// worst, best, tieOrder`).
#[derive(Clone, Debug, PartialEq)]
pub struct DuoScore {
    pub group: Vec<String>,
    pub total: f64,
    pub average: f64,
    pub worst: f64,
    pub best: f64,
    pub tie_order: u32,
}

/// One CONSTRUCTORS entry of `metadata.scores` (key order `index, group,
/// total, average, worst, best`).
#[derive(Clone, Debug, PartialEq)]
pub struct ConstructorsScore {
    pub index: u32,
    pub group: Vec<String>,
    pub total: f64,
    pub average: f64,
    pub worst: f64,
    pub best: f64,
}

/// `ChaosResult.metadata`, one shape per rule family (TS key order noted).
#[derive(Clone, Debug, PartialEq)]
pub enum ChaosMetadata {
    /// NORMAL, REVERSE, TRIPLE_ELIMINATION, CUT_LINE: `{reasonByPlayer}`.
    Reasons { reason_by_player: ReasonByPlayer },
    /// DUO: `{scores, reasonByPlayer}`, scores sorted worst first.
    Duo {
        scores: Vec<DuoScore>,
        reason_by_player: ReasonByPlayer,
    },
    /// CONSTRUCTORS: `{totals, averages, tie, scores, reasonByPlayer}`.
    Constructors {
        totals: [f64; 2],
        averages: [f64; 2],
        tie: bool,
        scores: [ConstructorsScore; 2],
        reason_by_player: ReasonByPlayer,
    },
    /// BOUNTY_HUNT: `{wantedPlayerId, escaped, cutoff, reasonByPlayer}`.
    BountyHunt {
        wanted_player_id: String,
        escaped: bool,
        cutoff: u32,
        reason_by_player: ReasonByPlayer,
    },
}

impl ChaosMetadata {
    /// `metadata.reasonByPlayer`.
    #[must_use]
    pub fn reason_by_player(&self) -> &ReasonByPlayer {
        match self {
            Self::Reasons { reason_by_player }
            | Self::Duo {
                reason_by_player, ..
            }
            | Self::Constructors {
                reason_by_player, ..
            }
            | Self::BountyHunt {
                reason_by_player, ..
            } => reason_by_player,
        }
    }
}

/// `ChaosResult` (key order `finalStandings?, loserPlayerIds, metadata`).
#[derive(Clone, Debug, PartialEq)]
pub struct ChaosResult {
    /// Only REVERSE sets it.
    pub final_standings: Option<Vec<String>>,
    pub loser_player_ids: Vec<String>,
    pub metadata: ChaosMetadata,
}

/// Why a rule throws. `Display` is the TS error message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChaosError {
    /// Fewer than two entries, or a player twice.
    InvalidRanking,
    /// DUO without groups.
    DuoMissingPairs,
    /// A DUO group member is not in the ranking.
    DuoPlayerOutsideRanking,
    /// CONSTRUCTORS without exactly two groups.
    ConstructorsMissingTeams,
    /// A CONSTRUCTORS team member is not in the ranking.
    ConstructorsPlayerOutsideRanking,
    /// BOUNTY_HUNT target missing or not in the ranking.
    BountyMissingWanted,
}

impl fmt::Display for ChaosError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidRanking => "Chaos requires a valid unique ranking",
            Self::DuoMissingPairs => "Duo requires persisted pairs",
            Self::DuoPlayerOutsideRanking => "Duo contains a player outside the ranking",
            Self::ConstructorsMissingTeams => "Constructors requires two persisted teams",
            Self::ConstructorsPlayerOutsideRanking => {
                "Constructors contains a player outside the ranking"
            }
            Self::BountyMissingWanted => "Bounty Hunt requires a valid Wanted player",
        })
    }
}

impl core::error::Error for ChaosError {}

const REASON_NORMAL: &str = "Raw Bottom 2";
const REASON_REVERSE: &str = "Reverse made raw Top 2 lose";
const REASON_DUO: &str = "Duo had the worst placement average";
const REASON_TRIPLE: &str = "Raw Bottom 3";
const REASON_CUT_LINE: &str = "Finished below the Top 50% cut";
const REASON_CONSTRUCTORS: &str = "Constructors team had the worse placement average";
const REASON_BOUNTY_ESCAPED: &str = "Wanted escaped; raw Bottom 2 lose";
const REASON_BOUNTY_CAUGHT: &str = "Wanted failed; Wanted and everyone behind lose";

// ---------------------------------------------------------------------------
// Helpers

/// `shuffle(items, random)`: Fisher-Yates from the end with
/// `Math.floor(random() * (index + 1))`.
///
/// # Panics
/// If `random()` leaves `[0, 1)` (the TS code would index out of bounds).
fn shuffle(items: &[String], random: &mut impl FnMut() -> f64) -> Vec<String> {
    let mut result: Vec<String> = items.to_vec();
    for index in (1..result.len()).rev() {
        let bound = f64::from(u32::try_from(index + 1).expect("lobby size fits u32"));
        let swap = floor(random() * bound);
        assert!(
            (0.0..bound).contains(&swap),
            "chaos shuffle: random() outside [0, 1)"
        );
        // `swap` is an integer in [0, index].
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let swap = swap as usize;
        result.swap(index, swap);
    }
    result
}

/// `ordered(rawResult)`: sorted by rank then `localeCompare`, then validated.
fn ordered<'a>(raw: &[RawChaosEntry<'a>]) -> Result<Vec<RawChaosEntry<'a>>, ChaosError> {
    let mut ranking = raw.to_vec();
    v8_sort_by(&mut ranking, |left, right| {
        left.rank
            .cmp(&right.rank)
            .then_with(|| locale_compare(left.player_id, right.player_id))
    });
    let unique: BTreeSet<&str> = ranking.iter().map(|entry| entry.player_id).collect();
    if ranking.len() < 2 || unique.len() != ranking.len() {
        return Err(ChaosError::InvalidRanking);
    }
    Ok(ranking)
}

fn ids(entries: &[RawChaosEntry<'_>]) -> Vec<String> {
    entries
        .iter()
        .map(|entry| String::from(entry.player_id))
        .collect()
}

/// `array.slice(-count)`.
fn last<T>(items: &[T], count: usize) -> &[T] {
    &items[items.len().saturating_sub(count)..]
}

/// `Math.ceil(length / 2)`.
fn half_up(length: usize) -> usize {
    length.div_ceil(2)
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).expect("chaos sizes fit u32")
}

/// Shared DUO/CONSTRUCTORS group scoring: `(total, average, worst, best)`,
/// or `None` when a member is not ranked.
fn score_group(group: &[String], rank_by_player: &BTreeMap<&str, u32>) -> Option<[f64; 4]> {
    let mut ranks: Vec<f64> = Vec::with_capacity(group.len());
    for player_id in group {
        ranks.push(f64::from(*rank_by_player.get(player_id.as_str())?));
    }
    // `ranks.reduce((sum, rank) => sum + rank, 0)`: integer sums, exact.
    let total = ranks.iter().fold(0.0, |sum, &rank| sum + rank);
    let average = total / f64::from(to_u32(group.len()));
    Some([total, average, js_max_of(&ranks), js_min_of(&ranks)])
}

// ---------------------------------------------------------------------------
// Rules

/// `CHAOS_RULES[id].prepare(players, random)`.
///
/// `random` must return values in `[0, 1)` (`() => rng.next()`).
pub fn prepare_chaos_rule<S: AsRef<str>>(
    id: ChaosRuleId,
    players: &[S],
    random: &mut impl FnMut() -> f64,
) -> ChaosPreparedState {
    let player_ids = || -> Vec<String> {
        players
            .iter()
            .map(|player| String::from(player.as_ref()))
            .collect()
    };
    match id {
        ChaosType::Normal
        | ChaosType::Reverse
        | ChaosType::TripleElimination
        | ChaosType::CutLine => ChaosPreparedState::default(),
        ChaosType::Duo => {
            let shuffled = shuffle(&player_ids(), random);
            let mut groups: Vec<Vec<String>> = shuffled.chunks(2).map(<[String]>::to_vec).collect();
            if groups.len() > 1 && groups.last().is_some_and(|group| group.len() == 1) {
                let single = groups.pop().expect("checked non-empty");
                let previous = groups.len() - 1;
                groups[previous].extend(single);
            }
            ChaosPreparedState {
                target_player_id: None,
                groups: Some(groups),
            }
        }
        ChaosType::Constructors => {
            let shuffled = shuffle(&player_ids(), random);
            let split = half_up(shuffled.len());
            ChaosPreparedState {
                target_player_id: None,
                groups: Some(alloc::vec![
                    shuffled[..split].to_vec(),
                    shuffled[split..].to_vec()
                ]),
            }
        }
        ChaosType::BountyHunt => {
            let shuffled = shuffle(&player_ids(), random);
            ChaosPreparedState {
                target_player_id: shuffled.into_iter().next(),
                groups: None,
            }
        }
    }
}

/// `CHAOS_RULES[id].resolve(rawResult, prepared)`.
///
/// # Errors
/// The [`ChaosError`] whose message the TS rule throws.
pub fn resolve_chaos_rule(
    id: ChaosRuleId,
    raw: &[RawChaosEntry<'_>],
    prepared: &ChaosPreparedState,
) -> Result<ChaosResult, ChaosError> {
    match id {
        ChaosType::Normal => {
            let ranking = ordered(raw)?;
            let losers = ids(last(&ranking, 2));
            Ok(reasons_only(None, losers, REASON_NORMAL))
        }
        ChaosType::Reverse => {
            let ranking = ordered(raw)?;
            let final_standings: Vec<String> = ids(&ranking).into_iter().rev().collect();
            let losers = last(&final_standings, 2).to_vec();
            Ok(reasons_only(Some(final_standings), losers, REASON_REVERSE))
        }
        ChaosType::TripleElimination => {
            let ranking = ordered(raw)?;
            let losers = ids(last(&ranking, 3));
            Ok(reasons_only(None, losers, REASON_TRIPLE))
        }
        ChaosType::CutLine => {
            let ranking = ordered(raw)?;
            let losers = ids(&ranking[half_up(ranking.len())..]);
            Ok(reasons_only(None, losers, REASON_CUT_LINE))
        }
        ChaosType::Duo => resolve_duo(raw, prepared),
        ChaosType::Constructors => resolve_constructors(raw, prepared),
        ChaosType::BountyHunt => resolve_bounty(raw, prepared),
    }
}

fn reasons_only(
    final_standings: Option<Vec<String>>,
    losers: Vec<String>,
    reason: &'static str,
) -> ChaosResult {
    let reason_by_player = ReasonByPlayer::new(&losers, reason);
    ChaosResult {
        final_standings,
        loser_player_ids: losers,
        metadata: ChaosMetadata::Reasons { reason_by_player },
    }
}

fn rank_map<'a>(ranking: &[RawChaosEntry<'a>]) -> BTreeMap<&'a str, u32> {
    ranking
        .iter()
        .map(|entry| (entry.player_id, entry.rank))
        .collect()
}

fn resolve_duo(
    raw: &[RawChaosEntry<'_>],
    prepared: &ChaosPreparedState,
) -> Result<ChaosResult, ChaosError> {
    let ranking = ordered(raw)?;
    let groups: &[Vec<String>] = prepared.groups.as_deref().unwrap_or(&[]);
    if groups.is_empty() {
        return Err(ChaosError::DuoMissingPairs);
    }
    let rank_by_player = rank_map(&ranking);
    let mut scored: Vec<DuoScore> = Vec::with_capacity(groups.len());
    for (tie_order, group) in groups.iter().enumerate() {
        let [total, average, worst, best] =
            score_group(group, &rank_by_player).ok_or(ChaosError::DuoPlayerOutsideRanking)?;
        scored.push(DuoScore {
            group: group.clone(),
            total,
            average,
            worst,
            best,
            tie_order: to_u32(tie_order),
        });
    }
    v8_sort_by(&mut scored, |left, right| {
        cmp_f64_js(right.average, left.average)
            .then_with(|| cmp_f64_js(right.worst, left.worst))
            .then_with(|| cmp_f64_js(right.best, left.best))
            .then_with(|| left.tie_order.cmp(&right.tie_order))
    });
    let losers = scored[0].group.clone();
    let reason_by_player = ReasonByPlayer::new(&losers, REASON_DUO);
    Ok(ChaosResult {
        final_standings: None,
        loser_player_ids: losers,
        metadata: ChaosMetadata::Duo {
            scores: scored,
            reason_by_player,
        },
    })
}

fn resolve_constructors(
    raw: &[RawChaosEntry<'_>],
    prepared: &ChaosPreparedState,
) -> Result<ChaosResult, ChaosError> {
    let ranking = ordered(raw)?;
    let groups: &[Vec<String>] = prepared.groups.as_deref().unwrap_or(&[]);
    let [first, second] = groups else {
        return Err(ChaosError::ConstructorsMissingTeams);
    };
    let rank_by_player = rank_map(&ranking);
    let score = |index: u32, group: &Vec<String>| -> Result<ConstructorsScore, ChaosError> {
        let [total, average, worst, best] = score_group(group, &rank_by_player)
            .ok_or(ChaosError::ConstructorsPlayerOutsideRanking)?;
        Ok(ConstructorsScore {
            index,
            group: group.clone(),
            total,
            average,
            worst,
            best,
        })
    };
    let scores = [score(0, first)?, score(1, second)?];
    let totals = [scores[0].total, scores[1].total];
    let averages = [scores[0].average, scores[1].average];
    // `averages[0] === averages[1]`: NaN is never a tie.
    #[allow(clippy::float_cmp)]
    let tie = averages[0] == averages[1];
    let losing: &[usize] = if tie {
        &[0, 1]
    } else if averages[0] > averages[1] {
        &[0]
    } else {
        &[1]
    };
    let losers: Vec<String> = ranking
        .iter()
        .filter(|entry| {
            losing
                .iter()
                .any(|&index| groups[index].iter().any(|id| id == entry.player_id))
        })
        .map(|entry| String::from(entry.player_id))
        .collect();
    let reason_by_player = ReasonByPlayer::new(&losers, REASON_CONSTRUCTORS);
    Ok(ChaosResult {
        final_standings: None,
        loser_player_ids: losers,
        metadata: ChaosMetadata::Constructors {
            totals,
            averages,
            tie,
            scores,
            reason_by_player,
        },
    })
}

fn resolve_bounty(
    raw: &[RawChaosEntry<'_>],
    prepared: &ChaosPreparedState,
) -> Result<ChaosResult, ChaosError> {
    let ranking = ordered(raw)?;
    let wanted = prepared
        .target_player_id
        .as_deref()
        .and_then(|target| ranking.iter().find(|entry| entry.player_id == target))
        .copied()
        .ok_or(ChaosError::BountyMissingWanted)?;
    let cutoff = to_u32(half_up(ranking.len()));
    let escaped = wanted.rank <= cutoff;
    let losers = if escaped {
        ids(last(&ranking, 2))
    } else {
        ranking
            .iter()
            .filter(|entry| entry.rank >= wanted.rank)
            .map(|entry| String::from(entry.player_id))
            .collect()
    };
    let reason = if escaped {
        REASON_BOUNTY_ESCAPED
    } else {
        REASON_BOUNTY_CAUGHT
    };
    let reason_by_player = ReasonByPlayer::new(&losers, reason);
    Ok(ChaosResult {
        final_standings: None,
        loser_player_ids: losers,
        metadata: ChaosMetadata::BountyHunt {
            wanted_player_id: String::from(wanted.player_id),
            escaped,
            cutoff,
            reason_by_player,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::format;
    use alloc::vec;

    fn raw(count: u32) -> Vec<(String, u32)> {
        (1..=count).map(|rank| (format!("p{rank}"), rank)).collect()
    }

    fn entries(raw: &[(String, u32)]) -> Vec<RawChaosEntry<'_>> {
        raw.iter()
            .map(|(id, rank)| RawChaosEntry {
                player_id: id,
                rank: *rank,
            })
            .collect()
    }

    fn groups(spec: &[&[&str]]) -> ChaosPreparedState {
        ChaosPreparedState {
            target_player_id: None,
            groups: Some(
                spec.iter()
                    .map(|group| group.iter().map(|id| String::from(*id)).collect())
                    .collect(),
            ),
        }
    }

    fn losers(id: ChaosType, raw: &[(String, u32)], prepared: &ChaosPreparedState) -> Vec<String> {
        resolve_chaos_rule(id, &entries(raw), prepared)
            .unwrap()
            .loser_player_ids
    }

    // tests/race-chaos-plugins.test.ts
    #[test]
    fn simple_rules() {
        let r = raw(8);
        let none = ChaosPreparedState::default();
        assert_eq!(losers(ChaosType::Normal, &r, &none), ["p7", "p8"]);
        assert_eq!(losers(ChaosType::Reverse, &r, &none), ["p2", "p1"]);
        assert_eq!(
            losers(ChaosType::TripleElimination, &r, &none),
            ["p6", "p7", "p8"]
        );
        assert_eq!(
            losers(ChaosType::CutLine, &r, &none),
            ["p5", "p6", "p7", "p8"]
        );
    }

    #[test]
    fn duo_and_constructors() {
        let r = raw(8);
        let duo = groups(&[&["p1", "p8"], &["p3", "p6"], &["p2", "p4"], &["p5", "p7"]]);
        assert_eq!(losers(ChaosType::Duo, &r, &duo), ["p5", "p7"]);
        let tied = groups(&[&["p1", "p4"], &["p2", "p3"]]);
        assert_eq!(losers(ChaosType::Duo, &r[..4], &tied), ["p1", "p4"]);
        let tie = groups(&[&["p1", "p4"], &["p2", "p3"]]);
        assert_eq!(
            losers(ChaosType::Constructors, &r[..4], &tie),
            ["p1", "p2", "p3", "p4"]
        );
        assert_eq!(
            resolve_chaos_rule(ChaosType::Duo, &entries(&r), &groups(&[])),
            Err(ChaosError::DuoMissingPairs)
        );
        assert_eq!(
            resolve_chaos_rule(ChaosType::Constructors, &entries(&r), &groups(&[&["p1"]])),
            Err(ChaosError::ConstructorsMissingTeams)
        );
    }

    #[test]
    fn bounty() {
        let r = raw(8);
        let target = |id: &str| ChaosPreparedState {
            target_player_id: Some(String::from(id)),
            groups: None,
        };
        assert_eq!(
            losers(ChaosType::BountyHunt, &r, &target("p4")),
            ["p7", "p8"]
        );
        assert_eq!(
            losers(ChaosType::BountyHunt, &r, &target("p5")),
            ["p5", "p6", "p7", "p8"]
        );
        assert_eq!(
            resolve_chaos_rule(ChaosType::BountyHunt, &entries(&r), &target("zz")),
            Err(ChaosError::BountyMissingWanted)
        );
    }

    #[test]
    fn invalid_rankings() {
        let one = raw(1);
        assert_eq!(
            resolve_chaos_rule(
                ChaosType::Normal,
                &entries(&one),
                &ChaosPreparedState::default()
            ),
            Err(ChaosError::InvalidRanking)
        );
        let dup = vec![(String::from("a"), 1), (String::from("a"), 2)];
        assert_eq!(
            resolve_chaos_rule(
                ChaosType::Reverse,
                &entries(&dup),
                &ChaosPreparedState::default()
            ),
            Err(ChaosError::InvalidRanking)
        );
    }

    #[test]
    fn prepare_draw_counts_and_shapes() {
        let players: Vec<String> = (1..=5).map(|i| format!("p{i}")).collect();
        for id in CHAOS_RULE_IDS {
            let mut draws = 0;
            let prepared = prepare_chaos_rule(*id, &players, &mut || {
                draws += 1;
                0.4
            });
            let expected = match id {
                ChaosType::Duo | ChaosType::Constructors | ChaosType::BountyHunt => 4,
                _ => 0,
            };
            assert_eq!(draws, expected, "{id}");
            if *id == ChaosType::Duo {
                let sizes: Vec<usize> = prepared
                    .groups
                    .as_ref()
                    .unwrap()
                    .iter()
                    .map(Vec::len)
                    .collect();
                assert_eq!(sizes, [2, 3]);
            }
            if *id == ChaosType::Constructors {
                let sizes: Vec<usize> = prepared
                    .groups
                    .as_ref()
                    .unwrap()
                    .iter()
                    .map(Vec::len)
                    .collect();
                assert_eq!(sizes, [3, 2]);
            }
        }
        let empty: [&str; 0] = [];
        let bounty = prepare_chaos_rule(ChaosType::BountyHunt, &empty, &mut || 0.0);
        assert_eq!(bounty, ChaosPreparedState::default());
    }

    #[test]
    fn reason_keys_follow_js_property_order() {
        let ids: Vec<String> = ["b", "10", "a", "2", "007", "4294967295", "4294967294", "2"]
            .iter()
            .map(|id| String::from(*id))
            .collect();
        let reasons = ReasonByPlayer::new(&ids, "r");
        let keys: Vec<&str> = reasons
            .entries()
            .iter()
            .map(|(id, _)| id.as_str())
            .collect();
        assert_eq!(
            keys,
            ["2", "10", "4294967294", "b", "a", "007", "4294967295"]
        );
    }
}
