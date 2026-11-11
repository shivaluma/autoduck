//! Post-race stats (`PostRaceStats`, plan Phase 5): a port of
//! `aggregatePostRaceStats` / `aggregateMotion` (`src/race/post-race-stats.ts`)
//! and of the engine half (`collectPostRaceMotion`,
//! `collectPostRaceBaselineRank`, `src/race/post-race-engine.ts`), so the
//! Rust server can freeze `RaceReplayTrack.statsJson` and the browser can
//! compute it through `race-wasm`.
//!
//! The JSON shape (camelCase) is the TS one, so the viewer reads blobs from
//! either implementation. Floating-point sums are accumulated in the TS order,
//! so the same events and motion give bit-identical numbers.

use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{EventKind, RaceEvent, RecordedWildItemInput, WildItemAction};
use race_protocol::ids::{PlayerId, RaceId, RaceItemId};
use serde::{Deserialize, Deserializer, Serialize};

use crate::catalog::get_race_item;
use crate::config::maximum_ticks;
use crate::items::{item_activation_for_event, item_success_for_event};
use crate::math::{cmp_f64_js, js_max};
use crate::sim::{
    SimOptions, Simulation, create_simulation, id_cmp, simulate_race, step_simulation,
};

const ROCKET_SLOW_SECONDS: f64 = 0.65;
const ROCKET_MITIGATED_SLOW_SECONDS: f64 = 0.4;

const ATTACK_HIT_TYPES: [&str; 5] = [
    "ROCKET_HIT",
    "MINI_ROCKET_HIT",
    "BANANA_HIT",
    "WILD_BANANA_HIT",
    "HAZARD_HIT",
];

const ATTACK_BLOCKED_TYPES: [&str; 9] = [
    "ROCKET_BLOCKED",
    "MINI_ROCKET_BLOCKED",
    "BANANA_BLOCKED",
    "WILD_BANANA_BLOCKED",
    "BUBBLE_POPPED",
    "MINI_BUBBLE_BLOCKED",
    "FEATHER_DODGED",
    "WILD_FEATHER_DODGED",
    "HAZARD_DODGED",
];

/// `undefined` (absent) vs `null` vs a value, as JSON.
fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// `PostRacePlayerInput`: a participant as the race page lists it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostRacePlayerInput {
    pub player_id: String,
    pub name: String,
    /// Absent, `null` or a URL (copied through as given).
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub avatar_url: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_ids: Option<Vec<RaceItemId>>,
}

/// `PostRaceItemStat`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostRaceItemStat {
    pub item_id: RaceItemId,
    pub name: String,
    pub icon: String,
    pub activations: u32,
    pub successes: u32,
}

/// `PostRacePlayerStats`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostRacePlayerStats {
    pub player_id: String,
    pub name: String,
    #[serde(
        default,
        deserialize_with = "double_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub avatar_url: Option<Option<String>>,
    pub item_ids: Vec<RaceItemId>,
    pub final_rank: u32,
    pub baseline_rank: u32,
    pub rank_delta: i32,
    pub finish_time_ms: Option<f64>,
    pub average_speed: f64,
    pub peak_speed: f64,
    pub attacks_dealt: u32,
    pub attacks_received: u32,
    pub attacks_blocked: u32,
    pub collisions: u32,
    pub pickups_collected: u32,
    pub wild_items_used: u32,
    pub boost_breaks: u32,
    pub time_lost_from_attacks_seconds: f64,
    pub item_stats: Vec<PostRaceItemStat>,
    pub efficiency_score: f64,
}

/// One highlight: the player and the stat that earned it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight<T> {
    pub player_id: String,
    pub name: String,
    #[serde(flatten)]
    pub value: T,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankDeltaValue {
    pub rank_delta: i32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttacksReceivedValue {
    pub attacks_received: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttacksDealtValue {
    pub attacks_dealt: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AverageSpeedValue {
    pub average_speed: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeLostValue {
    pub time_lost_from_attacks_seconds: f64,
}

/// `PostRaceHighlights`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostRaceHighlights {
    pub best_item_user: Option<Highlight<RankDeltaValue>>,
    pub most_attacked: Option<Highlight<AttacksReceivedValue>>,
    pub best_attacker: Option<Highlight<AttacksDealtValue>>,
    pub fastest_average: Option<Highlight<AverageSpeedValue>>,
    pub most_time_lost: Option<Highlight<TimeLostValue>>,
}

/// `PostRaceStats`, the frozen `statsJson` blob.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostRaceStats {
    pub has_baseline: bool,
    pub players: Vec<PostRacePlayerStats>,
    pub highlights: PostRaceHighlights,
    pub race_duration_ms: f64,
    pub total_events: u32,
}

/// Average and peak speed of one duck.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionSample {
    pub average_speed: f64,
    pub peak_speed: f64,
}

/// `PostRaceMotion`, in first-sample order.
pub type PostRaceMotion = Vec<(String, MotionSample)>;

/// Accumulates motion sampled after every step (`aggregateMotion`): a duck
/// that has finished and stopped (`speed <= 0`) is skipped.
#[derive(Clone, Debug, Default)]
pub struct MotionAccumulator {
    // (playerId, sum, peak, samples) in first-sample order.
    buckets: Vec<(String, f64, f64, u32)>,
}

impl MotionAccumulator {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// One duck's sample.
    pub fn push(&mut self, player_id: &str, speed: f64, finished: bool) {
        if finished && speed <= 0.0 {
            return;
        }
        if let Some(bucket) = self.buckets.iter_mut().find(|b| b.0 == player_id) {
            bucket.1 += speed;
            bucket.2 = js_max(bucket.2, speed);
            bucket.3 += 1;
        } else {
            self.buckets
                .push((String::from(player_id), 0.0 + speed, js_max(0.0, speed), 1));
        }
    }

    /// Samples every duck of `sim` (call after each step).
    pub fn push_simulation(&mut self, sim: &Simulation) {
        for duck in &sim.ducks {
            self.push(duck.player_id.as_str(), duck.speed, duck.finished);
        }
    }

    /// The averages.
    #[must_use]
    pub fn finish(&self) -> PostRaceMotion {
        self.buckets
            .iter()
            .map(|(id, sum, peak, samples)| {
                let average_speed = if *samples > 0 {
                    sum / f64::from(*samples)
                } else {
                    0.0
                };
                (
                    id.clone(),
                    MotionSample {
                        average_speed,
                        peak_speed: *peak,
                    },
                )
            })
            .collect()
    }
}

/// `manualInputsFromEvents` / `recordedWildInputsFromEvents`: every
/// `WILD_ITEM_MANUAL_INPUT` as a recorded input at its tick, sorted by tick
/// then `clientActionId`.
#[must_use]
pub fn manual_inputs_from_events(events: &[RaceEvent]) -> Vec<RecordedWildItemInput> {
    let mut inputs: Vec<RecordedWildItemInput> = events
        .iter()
        .filter_map(|event| match (&event.kind, &event.source_player_id) {
            (EventKind::WildItemManualInput(meta), Some(player_id)) => {
                Some(RecordedWildItemInput {
                    race_id: event.race_id.clone(),
                    player_id: player_id.clone(),
                    wild_item_instance_id: meta.instance_id.clone(),
                    action: WildItemAction::Use,
                    client_action_id: meta.client_action_id.clone(),
                    authoritative_tick: event.tick,
                })
            }
            _ => None,
        })
        .collect();
    inputs.sort_by(|left, right| {
        left.authoritative_tick
            .cmp(&right.authoritative_tick)
            .then_with(|| {
                id_cmp(
                    left.client_action_id.as_str(),
                    right.client_action_id.as_str(),
                )
            })
    });
    inputs
}

/// `collectPostRaceMotion`: re-simulates `config` with `manual_inputs`
/// (events off) for at most 180 s and samples after every step.
#[must_use]
pub fn collect_motion(
    config: &ResolvedRaceConfig,
    manual_inputs: Vec<RecordedWildItemInput>,
) -> PostRaceMotion {
    let options = SimOptions {
        record_events: false,
        manual_inputs,
        ..SimOptions::default()
    };
    let maximum = 180u32.saturating_mul(config.tick_rate);
    let mut sim = create_simulation(config.clone(), options, None);
    let mut motion = MotionAccumulator::new();
    while !sim.finished && sim.tick < maximum {
        step_simulation(&mut sim, None);
        motion.push_simulation(&sim);
    }
    motion.finish()
}

/// `collectPostRaceBaselineRank`: ranks of the same race without loadouts
/// (race id `<raceId>-post-race-baseline`), or `None` when it can't run.
#[must_use]
pub fn baseline_rank(config: &ResolvedRaceConfig) -> Option<Vec<(PlayerId, u32)>> {
    let mut baseline = config.clone();
    baseline.race_id = RaceId::new(format!("{}-post-race-baseline", config.race_id)).ok()?;
    baseline.loadouts = Vec::new();
    let options = SimOptions {
        record_events: false,
        max_ticks: Some(maximum_ticks(config.tick_rate)),
        ..SimOptions::default()
    };
    let result = simulate_race(baseline, options, None).ok()?;
    Some(
        result
            .standings
            .into_iter()
            .map(|entry| (entry.player_id, entry.rank))
            .collect(),
    )
}

fn empty_player(player: &PostRacePlayerInput) -> PostRacePlayerStats {
    PostRacePlayerStats {
        player_id: player.player_id.clone(),
        name: player.name.clone(),
        avatar_url: player.avatar_url.clone(),
        item_ids: player.item_ids.clone().unwrap_or_default(),
        final_rank: 99,
        baseline_rank: 99,
        rank_delta: 0,
        finish_time_ms: None,
        average_speed: 0.0,
        peak_speed: 0.0,
        attacks_dealt: 0,
        attacks_received: 0,
        attacks_blocked: 0,
        collisions: 0,
        pickups_collected: 0,
        wild_items_used: 0,
        boost_breaks: 0,
        time_lost_from_attacks_seconds: 0.0,
        item_stats: Vec::new(),
        efficiency_score: 0.0,
    }
}

fn bump_item(stats: &mut PostRacePlayerStats, item_id: RaceItemId, success: bool) {
    let index = if let Some(index) = stats
        .item_stats
        .iter()
        .position(|row| row.item_id == item_id)
    {
        index
    } else {
        let definition = get_race_item(item_id);
        stats.item_stats.push(PostRaceItemStat {
            item_id,
            name: definition.name.to_string(),
            icon: definition.icon.to_string(),
            activations: 0,
            successes: 0,
        });
        stats.item_stats.len() - 1
    };
    let row = &mut stats.item_stats[index];
    if success {
        row.successes += 1;
    } else {
        row.activations += 1;
    }
}

/// `hornTargets`: the `targets` list of a horn event.
fn horn_targets(event: &RaceEvent) -> &[PlayerId] {
    match &event.kind {
        EventKind::HornUsed(meta) => &meta.targets,
        EventKind::WildHornUsed(meta) => &meta.targets,
        _ => &[],
    }
}

fn efficiency(stats: &PostRacePlayerStats) -> f64 {
    let successes: u32 = stats.item_stats.iter().map(|item| item.successes).sum();
    let activations: u32 = stats.item_stats.iter().map(|item| item.activations).sum();
    let success_rate = if activations > 0 {
        f64::from(successes) / f64::from(activations)
    } else {
        0.0
    };
    f64::from(stats.rank_delta) * 4.0
        + f64::from(successes) * 2.0
        + f64::from(stats.attacks_dealt) * 1.5
        + f64::from(stats.attacks_blocked) * 1.2
        - f64::from(stats.attacks_received) * 0.8
        - stats.time_lost_from_attacks_seconds * 0.6
        + success_rate * 2.0
}

/// `topPlayer`: the first player with the largest positive value.
fn top<T: Copy>(
    players: &[PostRacePlayerStats],
    selector: impl Fn(&PostRacePlayerStats) -> T,
    as_f64: impl Fn(T) -> f64,
) -> Option<(&PostRacePlayerStats, T)> {
    let mut best: Option<(&PostRacePlayerStats, T)> = None;
    for player in players {
        let value = selector(player);
        if best.is_none_or(|(_, current)| as_f64(value) > as_f64(current)) {
            best = Some((player, value));
        }
    }
    best.filter(|(_, value)| as_f64(*value) > 0.0)
}

/// What the engine contributes (`PostRaceEngineInputs`).
#[derive(Clone, Debug, Default)]
pub struct EngineInputs {
    /// `None`: no baseline (`hasBaseline` false, rankDelta 0).
    pub baseline_rank: Option<Vec<(PlayerId, u32)>>,
    /// `None`: speeds stay 0.
    pub motion: Option<PostRaceMotion>,
}

fn highlight<T>(player: &PostRacePlayerStats, value: T) -> Highlight<T> {
    Highlight {
        player_id: player.player_id.clone(),
        name: player.name.clone(),
        value,
    }
}

/// `aggregatePostRaceStats(config, events, players, engine)`.
#[allow(clippy::too_many_lines)]
#[must_use]
pub fn aggregate(
    tick_rate: u32,
    events: &[RaceEvent],
    players: &[PostRacePlayerInput],
    engine: &EngineInputs,
) -> PostRaceStats {
    let mut by_player: Vec<PostRacePlayerStats> = Vec::new();
    for player in players {
        if let Some(existing) = by_player
            .iter_mut()
            .find(|p| p.player_id == player.player_id)
        {
            // `new Map(...)` keeps the first position and the last value.
            *existing = empty_player(player);
        } else {
            by_player.push(empty_player(player));
        }
    }
    let index_of = |by_player: &[PostRacePlayerStats], id: Option<&PlayerId>| {
        id.and_then(|id| by_player.iter().position(|p| p.player_id == id.as_str()))
    };

    // Insertion-ordered finish times (a later DUCK_FINISHED overwrites).
    let mut finish_times: Vec<(String, f64)> = Vec::new();
    for event in events {
        if let (EventKind::DuckFinished(meta), Some(source)) =
            (&event.kind, &event.source_player_id)
        {
            if let Some(entry) = finish_times.iter_mut().find(|e| e.0 == source.as_str()) {
                entry.1 = meta.finish_time_ms;
            } else {
                finish_times.push((source.as_str().into(), meta.finish_time_ms));
            }
        }
    }
    let mut ordered: Vec<&(String, f64)> = finish_times.iter().collect();
    ordered
        .sort_by(|left, right| cmp_f64_js(left.1, right.1).then_with(|| id_cmp(&left.0, &right.0)));
    let final_rank: BTreeMap<&str, u32> = ordered
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            (
                entry.0.as_str(),
                u32::try_from(index + 1).unwrap_or(u32::MAX),
            )
        })
        .collect();
    let player_count = u32::try_from(players.len()).unwrap_or(u32::MAX);
    for stats in &mut by_player {
        stats.final_rank = final_rank
            .get(stats.player_id.as_str())
            .copied()
            .unwrap_or(player_count);
        stats.baseline_rank = engine
            .baseline_rank
            .as_ref()
            .and_then(|ranks| ranks.iter().find(|(id, _)| *id == stats.player_id.as_str()))
            .map_or(stats.final_rank, |(_, rank)| *rank);
        stats.rank_delta =
            i32::try_from(i64::from(stats.baseline_rank) - i64::from(stats.final_rank))
                .unwrap_or(0);
        stats.finish_time_ms = finish_times
            .iter()
            .find(|e| e.0 == stats.player_id)
            .map(|e| e.1);
    }

    for event in events {
        let type_name = event.type_name();
        if let Some(credit) = item_activation_for_event(event)
            && let Some(index) = index_of(&by_player, Some(&credit.player_id))
        {
            bump_item(&mut by_player[index], credit.item_id, false);
        }
        if let Some(credit) = item_success_for_event(event)
            && let Some(index) = index_of(&by_player, Some(&credit.player_id))
        {
            bump_item(&mut by_player[index], credit.item_id, true);
        }
        let source = index_of(&by_player, event.source_player_id.as_ref());
        let target = index_of(&by_player, event.target_player_id.as_ref());
        match &event.kind {
            EventKind::PickupCollected(_) => {
                if let Some(index) = source {
                    by_player[index].pickups_collected += 1;
                }
            }
            EventKind::WildItemUsed(_) | EventKind::WildItemAutoUsed(_) => {
                if let Some(index) = source {
                    by_player[index].wild_items_used += 1;
                }
            }
            EventKind::DuckCollision(_) => {
                for index in [source, target].into_iter().flatten() {
                    by_player[index].collisions += 1;
                }
            }
            _ => {}
        }
        if ATTACK_HIT_TYPES.contains(&type_name) {
            if let Some(index) = source {
                by_player[index].attacks_dealt += 1;
            }
            if let Some(index) = target {
                by_player[index].attacks_received += 1;
                if matches!(
                    event.kind,
                    EventKind::RocketHit(_) | EventKind::MiniRocketHit(_)
                ) {
                    let mitigated = matches!(event.kind, EventKind::RocketHit(_))
                        && events.iter().any(|candidate| {
                            matches!(candidate.kind, EventKind::ShockAbsorberProc(_))
                                && candidate.target_player_id == event.target_player_id
                                && candidate.tick == event.tick
                        });
                    by_player[index].time_lost_from_attacks_seconds += if mitigated {
                        ROCKET_MITIGATED_SLOW_SECONDS
                    } else {
                        ROCKET_SLOW_SECONDS
                    };
                }
            }
        }
        if ATTACK_BLOCKED_TYPES.contains(&type_name) {
            let defender = event
                .source_player_id
                .as_ref()
                .or(event.target_player_id.as_ref());
            if let Some(index) = index_of(&by_player, defender) {
                by_player[index].attacks_blocked += 1;
            }
        }
        if matches!(
            event.kind,
            EventKind::HornUsed(_) | EventKind::WildHornUsed(_)
        ) && let Some(index) = source
        {
            let targets = horn_targets(event);
            by_player[index].attacks_dealt += u32::try_from(targets.len()).unwrap_or(0);
            for target_id in targets {
                if let Some(victim) = index_of(&by_player, Some(target_id)) {
                    by_player[victim].attacks_received += 1;
                }
            }
        }
        if let (EventKind::BoostBroken(meta), Some(index)) = (&event.kind, source) {
            let seconds = f64::from(meta.remaining_boost_ticks) / f64::from(tick_rate);
            by_player[index].boost_breaks += 1;
            by_player[index].time_lost_from_attacks_seconds += seconds;
        }
    }

    for stats in &mut by_player {
        if let Some(sample) = engine
            .motion
            .as_ref()
            .and_then(|motion| motion.iter().find(|(id, _)| *id == stats.player_id))
        {
            stats.average_speed = sample.1.average_speed;
            stats.peak_speed = sample.1.peak_speed;
        }
        stats.efficiency_score = efficiency(stats);
    }

    // Stable sort by final rank.
    by_player.sort_by_key(|stats| stats.final_rank);
    let race_duration_ms = finish_times
        .iter()
        .map(|e| e.1)
        .reduce(js_max)
        .unwrap_or(0.0);

    let highlights = PostRaceHighlights {
        best_item_user: top(&by_player, |p| p.rank_delta, f64::from)
            .map(|(p, rank_delta)| highlight(p, RankDeltaValue { rank_delta })),
        most_attacked: top(&by_player, |p| p.attacks_received, f64::from)
            .map(|(p, attacks_received)| highlight(p, AttacksReceivedValue { attacks_received })),
        best_attacker: top(&by_player, |p| p.attacks_dealt, f64::from)
            .map(|(p, attacks_dealt)| highlight(p, AttacksDealtValue { attacks_dealt })),
        fastest_average: top(&by_player, |p| p.average_speed, |v| v)
            .map(|(p, average_speed)| highlight(p, AverageSpeedValue { average_speed })),
        most_time_lost: top(&by_player, |p| p.time_lost_from_attacks_seconds, |v| v).map(
            |(p, time_lost_from_attacks_seconds)| {
                highlight(
                    p,
                    TimeLostValue {
                        time_lost_from_attacks_seconds,
                    },
                )
            },
        ),
    };

    PostRaceStats {
        has_baseline: engine.baseline_rank.is_some(),
        players: by_player,
        highlights,
        race_duration_ms,
        total_events: u32::try_from(events.len()).unwrap_or(u32::MAX),
    }
}

/// `buildPostRaceStats(config, events, players)`: baseline ranks and motion
/// from re-simulations (about two extra races), then the aggregation. The
/// server passes the DB-ordered events, meta events included.
#[must_use]
pub fn build(
    config: &ResolvedRaceConfig,
    events: &[RaceEvent],
    players: &[PostRacePlayerInput],
) -> PostRaceStats {
    let engine = EngineInputs {
        baseline_rank: baseline_rank(config),
        motion: Some(collect_motion(config, manual_inputs_from_events(events))),
    };
    aggregate(config.tick_rate, events, players, &engine)
}
