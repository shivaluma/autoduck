//! The meta half of `executeSeason3Race` (`lib/season3-race.ts`, from the standings onward):
//! a pure [`plan_resolution`] that computes everything the resolve transaction writes.
//!
//! Phase 5 (D23) applies the plan in T2, in this order (the TS `$transaction` order, which the
//! parity fixture records call by call):
//!
//! 1. `RaceParticipant` result columns: official ducks by rank, then ghosts
//!    ([`ResolutionPlan::participant_updates`]).
//! 2. Official races only ([`ResolutionPlan::season`]): clear every King of the season, update
//!    each official Season player (Scars, Shields, prediction points, race count and wins,
//!    championship points, King), store `pointsAwarded` on predictions, grant race QP
//!    (idempotent ledger keys), then the Golden Quack Box QP plus its
//!    `QP_TRACK_REWARD_GRANTED` event.
//! 3. `Race` → `finished`/`RESOLVED` with [`ResolutionPlan::final_verdict`], and the week →
//!    `resolved` with [`ResolutionPlan::recap`] (official only).
//!
//! The `CHAOS_RESOLVED` event ([`ResolutionPlan::chaos_resolved`]) is persisted before that
//! transaction in TS; D23 moves it inside T2.
//!
//! Inputs mirror what TS loads: the week's Season players **filtered to the race config's
//! players** (ghosts included), confirmed Shield choices, every prediction of the week, and the
//! engine result (standings without ghosts, events).

use std::fmt;

use race_core::js_sort::v8_sort_by;
use race_core::math::{ceil, cmp_f64_js};
use serde_json::json;

use crate::cosmetics::economy::{
    Prediction, QuackInput, QuackReason, QuackReward, official_race_quack_rewards,
};
use crate::cosmetics::js::stringify;

use super::cards::{ChaosCard, ChaosType, parse_chaos_type};
use super::is_ghost_duck;
use super::mapping::{MappingError, MappingPlayer, RawStanding, map_season3_race_ranking};
use super::news::{
    DuckNewsInput, final_verdict, generate_duck_news, golden_box_line, quack_reward_line,
};
use super::payload::{GroupsError, chaos_groups_for_resolution};
use super::resolve::{
    PredictionOutcome, PreviousKing, ResolveError, Season3Resolution, apply_scar_economy,
    assert_ranking, resolve_predictions, resolve_season3_race,
};

/// `GOLDEN_TRACK_QP_REWARD` (`lib/racing/golden-reward.ts`).
pub const GOLDEN_TRACK_QP_REWARD: i64 = 1;
/// The golden ledger reason.
pub const TRACK_GOLDEN_BOX: &str = "TRACK_GOLDEN_BOX";

/// A Season player of the week's season, as loaded with `user`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MetaPlayer<'a> {
    /// `SeasonPlayer.id`.
    pub season_player_id: i64,
    pub user_id: i64,
    pub name: &'a str,
    pub scars: i64,
    pub shields: i64,
    pub is_king: bool,
    pub king_streak: i64,
}

/// A `SeasonPrediction` of the week.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WeekPrediction {
    pub id: i64,
    pub predictor_user_id: i64,
    pub target_user_id: i64,
}

/// The fields of an engine event the meta layer reads.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MetaEvent<'a> {
    /// `type`.
    pub kind: &'a str,
    pub tick: i64,
    pub timestamp_within_race_ms: f64,
    pub source_player_id: Option<&'a str>,
    /// `metadata.finishTimeMs` when it is a number (`DUCK_FINISHED`).
    pub finish_time_ms: Option<f64>,
    /// `metadata.pickupId` when it is a string (`GOLDEN_BOX_COLLECTED`).
    pub pickup_id: Option<&'a str>,
}

/// Everything `executeSeason3Race` reads after the simulation.
#[derive(Clone, Copy, Debug)]
pub struct ResolutionInput<'a> {
    pub race_id: i64,
    /// `Race.isTest`.
    pub is_test: bool,
    pub season_id: i64,
    pub week_id: i64,
    pub week_number: i64,
    /// `SeasonWeek.chaosType`, as stored.
    pub chaos_type: &'a str,
    pub chaos_target_user_id: Option<i64>,
    pub chaos_target_user_id2: Option<i64>,
    /// `SeasonWeek.chaosPayload`, as stored.
    pub chaos_payload: Option<&'a str>,
    /// Every prediction of the week, in load order.
    pub predictions: &'a [WeekPrediction],
    /// The season's players, in load order (all of them; filtered here).
    pub season_players: &'a [MetaPlayer<'a>],
    /// `SeasonPlayer.id`s with a `SeasonShieldChoice` this week.
    pub shield_choice_player_ids: &'a [i64],
    /// `Number(config.players[].playerId)`.
    pub configured_user_ids: &'a [i64],
    /// `result.standings` (ghosts excluded by the engine).
    pub standings: &'a [RawStanding<'a>],
    /// `result.events`, in order.
    pub events: &'a [MetaEvent<'a>],
    pub duration_ms: f64,
    pub tick_rate: f64,
}

/// The `CHAOS_RESOLVED` server meta event (excluded from `eventsSha256`, D7).
#[derive(Clone, Debug, PartialEq)]
pub struct ChaosResolvedEvent {
    /// `Math.ceil(durationMs / (1000 / tickRate))`.
    pub tick: f64,
    pub timestamp_within_race_ms: f64,
    pub chaos_type: ChaosType,
    /// Every Chaos loser, Shield-protected ones included, by rank.
    pub loser_player_ids: Vec<String>,
}

impl ChaosResolvedEvent {
    /// `metadataJson` as `persistRaceEvents` stores it.
    #[must_use]
    pub fn metadata_json(&self) -> String {
        stringify(&json!({
            "chaosType": self.chaos_type.as_str(),
            "loserPlayerIds": self.loser_player_ids,
        }))
    }
}

/// `raceParticipant.updateMany({ where: { raceId, userId, cloneIndex: null }, data })`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ParticipantUpdate {
    pub user_id: i64,
    /// Ghosts get their finish order among every finisher, or `null`.
    pub initial_rank: Option<i64>,
    pub got_scar: bool,
    pub used_shield: bool,
}

/// `seasonPlayer.update({ where: { id }, data })` for an official player. Increments are
/// omitted from the TS `data` when zero (except `raceCount` and `championshipPoints`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SeasonPlayerUpdate {
    pub season_player_id: i64,
    pub scars: i64,
    pub shields: i64,
    pub shields_used_increment: i64,
    pub prediction_points_increment: i64,
    pub race_count_increment: i64,
    pub race_wins_increment: i64,
    pub championship_points_increment: i64,
    pub is_king: bool,
    pub king_streak: i64,
}

/// `seasonPrediction.update({ where: { id }, data: { pointsAwarded } })`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PredictionUpdate {
    pub prediction_id: i64,
    pub points_awarded: i64,
}

/// One `applyQuackTransaction` call.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuackGrant {
    pub season_player_id: i64,
    pub amount: i64,
    pub reason: &'static str,
    pub race_id: i64,
    pub idempotency_key: String,
    /// `JSON.stringify(metadata)`.
    pub metadata_json: String,
}

impl QuackGrant {
    /// The ledger input for [`crate::cosmetics::economy::apply_quack_transaction`].
    #[must_use]
    pub fn as_input(&self) -> QuackInput<'_> {
        QuackInput {
            season_player_id: self.season_player_id,
            amount: self.amount,
            reason: self.reason,
            idempotency_key: &self.idempotency_key,
            race_id: Some(self.race_id),
            metadata_json: Some(self.metadata_json.clone()),
            ..QuackInput::default()
        }
    }
}

/// The Golden Quack Box grant (`buildGoldenTrackReward`) and its `QP_TRACK_REWARD_GRANTED`
/// event row.
#[derive(Clone, Debug, PartialEq)]
pub struct GoldenGrant {
    pub grant: QuackGrant,
    pub tick: i64,
    pub timestamp_within_race_ms: f64,
    /// `String(goldenPlayer.userId)`.
    pub source_player_id: String,
    pub pickup_id: String,
}

impl GoldenGrant {
    /// The event's `metadataJson`.
    #[must_use]
    pub fn event_metadata_json(&self) -> String {
        stringify(&json!({
            "pickupId": self.pickup_id,
            "amount": GOLDEN_TRACK_QP_REWARD,
            "reason": TRACK_GOLDEN_BOX,
        }))
    }
}

/// The Season writes of an official race.
#[derive(Clone, Debug, PartialEq)]
pub struct SeasonWrites {
    /// `seasonPlayer.updateMany({ where: { seasonId, isKing: true }, data: { isKing: false,
    /// kingStreak: 0 } })` first: also dethrones a King who sat this race out.
    pub clear_kings_season_id: i64,
    pub player_updates: Vec<SeasonPlayerUpdate>,
    pub prediction_updates: Vec<PredictionUpdate>,
    pub quack_grants: Vec<QuackGrant>,
    pub golden: Option<GoldenGrant>,
}

/// Everything the resolve step writes and returns.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolutionPlan {
    pub resolution: Season3Resolution,
    pub chaos_resolved: ChaosResolvedEvent,
    pub prediction_outcomes: Vec<PredictionOutcome>,
    /// Computed for test races too (they appear in the recap), but never granted.
    pub quack_rewards: Vec<QuackReward>,
    /// `SeasonWeek.recap`: Duck News, a blank line, then one line per QP reward.
    pub recap: String,
    pub final_verdict: String,
    pub participant_updates: Vec<ParticipantUpdate>,
    /// `None` for test races.
    pub season: Option<SeasonWrites>,
}

impl ResolutionPlan {
    /// `quackRewards` in `executeSeason3Race`'s return value (`[]` for a test race).
    #[must_use]
    pub fn reported_quack_rewards(&self) -> &[QuackReward] {
        if self.season.is_some() {
            &self.quack_rewards
        } else {
            &[]
        }
    }
}

/// Why the resolve step fails (TS throws; the race becomes `failed` and the week goes back to
/// `locked`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResolutionError {
    Mapping(MappingError),
    Groups(GroupsError),
    /// `SeasonWeek.chaosType` is not a Chaos card (TS throws a `TypeError` from
    /// `CHAOS_RULES[id]`).
    UnknownChaosType(String),
    Resolve(ResolveError),
}

impl fmt::Display for ResolutionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Mapping(error) => error.fmt(f),
            Self::Groups(error) => error.fmt(f),
            Self::UnknownChaosType(value) => write!(f, "Unknown Chaos card {value:?}"),
            Self::Resolve(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ResolutionError {}

/// A race player: a Season player in the race config, with this week's Shield confirmation.
#[derive(Clone, Copy, Debug)]
struct RacePlayer<'a> {
    meta: MetaPlayer<'a>,
    shield_confirmed: bool,
}

impl RacePlayer<'_> {
    fn is_ghost(&self) -> bool {
        is_ghost_duck(self.meta.name)
    }

    /// `player.shieldConfirmed === true && player.shields > 0`.
    fn shield_used(&self) -> bool {
        self.shield_confirmed && self.meta.shields > 0
    }
}

/// The ghosts' `initialRank`: finish order among every `DUCK_FINISHED` with a source.
fn ghost_rank(events: &[MetaEvent<'_>], user_id: i64) -> Option<i64> {
    let mut finish_times: Vec<(&str, f64)> = events
        .iter()
        .filter(|event| event.kind == "DUCK_FINISHED")
        .filter_map(|event| {
            let player_id = event.source_player_id.filter(|id| !id.is_empty())?;
            Some((
                player_id,
                event
                    .finish_time_ms
                    .unwrap_or(event.timestamp_within_race_ms),
            ))
        })
        .collect();
    // `left.finishTimeMs - right.finishTimeMs || left.playerId.localeCompare(right.playerId)`.
    // Player ids are `String(userId)` (ASCII digits), where ICU root collation and byte order
    // agree.
    v8_sort_by(&mut finish_times, |left, right| {
        cmp_f64_js(left.1, right.1).then_with(|| left.0.cmp(right.0))
    });
    let wanted = user_id.to_string();
    finish_times
        .iter()
        .position(|(player_id, _)| *player_id == wanted)
        .map(|index| i64::try_from(index).unwrap_or(i64::MAX) + 1)
}

/// The meta half of `executeSeason3Race`.
///
/// # Errors
/// [`ResolutionError`] where TS throws, in the same precedence (mapping, ranking, groups,
/// Chaos type, Chaos rule).
///
/// # Panics
/// Never for inputs that passed the mapping (a validated ranking is non-empty).
pub fn plan_resolution(input: &ResolutionInput<'_>) -> Result<ResolutionPlan, ResolutionError> {
    let players: Vec<RacePlayer<'_>> = input
        .season_players
        .iter()
        .filter(|player| input.configured_user_ids.contains(&player.user_id))
        .map(|&meta| RacePlayer {
            meta,
            shield_confirmed: input
                .shield_choice_player_ids
                .contains(&meta.season_player_id),
        })
        .collect();
    let find_player = |user_id: i64| players.iter().find(|player| player.meta.user_id == user_id);
    let player_name = |user_id: Option<i64>| -> Option<&str> {
        user_id.and_then(|id| find_player(id).map(|player| player.meta.name))
    };

    // mapSeason3RaceRanking over the official (non-ghost) players.
    let official: Vec<MappingPlayer<'_>> = players
        .iter()
        .filter(|player| !player.is_ghost())
        .map(|player| MappingPlayer {
            user_id: player.meta.user_id,
            name: player.meta.name,
            shields: player.meta.shields,
            shield_confirmed: player.shield_confirmed,
        })
        .collect();
    let ranking =
        map_season3_race_ranking(input.standings, &official).map_err(ResolutionError::Mapping)?;

    let previous_king = players
        .iter()
        .find(|player| player.meta.is_king)
        .map(|player| PreviousKing {
            user_id: player.meta.user_id,
            streak: player.meta.king_streak,
        });

    // resolveSeason3Race: the ranking check, then its arguments (groups, then the rule).
    assert_ranking(&ranking).map_err(ResolutionError::Resolve)?;
    let groups =
        chaos_groups_for_resolution(input.chaos_payload).map_err(ResolutionError::Groups)?;
    let chaos_type = parse_chaos_type(input.chaos_type)
        .ok_or_else(|| ResolutionError::UnknownChaosType(input.chaos_type.to_owned()))?;
    let chaos = ChaosCard {
        chaos_type,
        target_user_id: input.chaos_target_user_id,
        target_user_id2: input.chaos_target_user_id2,
        groups,
    };
    let resolved =
        resolve_season3_race(&ranking, &chaos, previous_king).map_err(ResolutionError::Resolve)?;

    let chaos_resolved = ChaosResolvedEvent {
        tick: ceil(input.duration_ms / (1000.0 / input.tick_rate)),
        timestamp_within_race_ms: input.duration_ms,
        chaos_type,
        loser_player_ids: resolved
            .scar_outcomes
            .iter()
            .map(|outcome| outcome.user_id.to_string())
            .collect(),
    };

    // Predictions count only when predictor and target both raced (ghosts included).
    let active_predictions: Vec<Prediction> = input
        .predictions
        .iter()
        .filter(|prediction| {
            find_player(prediction.predictor_user_id).is_some()
                && find_player(prediction.target_user_id).is_some()
        })
        .map(|prediction| Prediction {
            predictor_user_id: prediction.predictor_user_id,
            target_user_id: prediction.target_user_id,
        })
        .collect();
    let prediction_outcomes = resolve_predictions(&active_predictions, &resolved.bottom_two);
    let loser_ids: Vec<i64> = resolved
        .scar_outcomes
        .iter()
        .map(|outcome| outcome.user_id)
        .collect();
    let quack_rewards = official_race_quack_rewards(
        resolved.ranking[0].user_id,
        &loser_ids,
        &active_predictions,
        None,
    );

    let golden_collection = input.events.iter().find(|event| {
        event.kind == "GOLDEN_BOX_COLLECTED"
            && event.source_player_id.is_some_and(|id| !id.is_empty())
    });
    let golden_player = golden_collection.and_then(|event| {
        let source = event.source_player_id?;
        players
            .iter()
            .find(|player| player.meta.user_id.to_string() == source)
    });
    // `if (goldenPlayer && goldenPickupId)`: an empty pickup id grants nothing.
    let golden_pickup_id = golden_collection
        .and_then(|event| event.pickup_id)
        .filter(|id| !id.is_empty());

    let prediction_winners: Vec<String> = prediction_outcomes
        .iter()
        .filter(|outcome| outcome.correct)
        .map(|outcome| {
            player_name(Some(outcome.predictor_user_id)).map_or_else(
                || format!("User {}", outcome.predictor_user_id),
                str::to_owned,
            )
        })
        .collect();
    let names = |entries: &[super::resolve::Season3RankingEntry]| -> Vec<String> {
        entries.iter().map(|entry| entry.name.clone()).collect()
    };
    let victims = names(&resolved.scar_victims);
    let protected = names(&resolved.protected_players);
    let duck_news = generate_duck_news(&DuckNewsInput {
        week_number: input.week_number,
        scar_victims: &as_refs(&victims),
        protected_players: &as_refs(&protected),
        chaos_type,
        chaos_target_name: player_name(chaos.target_user_id),
        king_name: player_name(resolved.king_user_id),
        prediction_winners: &as_refs(&prediction_winners),
    });
    let mut qp_lines: Vec<String> = quack_rewards
        .iter()
        .map(|reward| quack_reward_line(reward, player_name(Some(reward.player_id))))
        .collect();
    if let Some(player) = golden_player {
        qp_lines.push(golden_box_line(player.meta.name, input.is_test));
    }
    let recap = format!("{duck_news}\n\n{}", qp_lines.join("\n"));

    let mut participant_updates: Vec<ParticipantUpdate> = resolved
        .ranking
        .iter()
        .filter_map(|entry| {
            let player = find_player(entry.user_id).filter(|player| !player.is_ghost())?;
            Some(ParticipantUpdate {
                user_id: entry.user_id,
                initial_rank: Some(entry.rank),
                got_scar: resolved
                    .scar_victims
                    .iter()
                    .any(|victim| victim.user_id == entry.user_id),
                used_shield: player.shield_used(),
            })
        })
        .collect();
    participant_updates.extend(
        players
            .iter()
            .filter(|player| player.is_ghost())
            .map(|player| ParticipantUpdate {
                user_id: player.meta.user_id,
                initial_rank: ghost_rank(input.events, player.meta.user_id),
                got_scar: false,
                used_shield: false,
            }),
    );

    let season = (!input.is_test).then(|| {
        let ranked = i64::try_from(resolved.ranking.len()).unwrap_or(i64::MAX);
        let player_updates = players
            .iter()
            .filter(|player| !player.is_ghost())
            .map(|player| {
                let user_id = player.meta.user_id;
                let outcome = resolved
                    .scar_outcomes
                    .iter()
                    .find(|outcome| outcome.user_id == user_id);
                let entry = resolved
                    .ranking
                    .iter()
                    .find(|entry| entry.user_id == user_id)
                    .expect("the mapping put every official player in the ranking");
                let shield_used = player.shield_used();
                let economy = apply_scar_economy(
                    player.meta.scars,
                    player.meta.shields,
                    outcome.map_or(0, |outcome| outcome.scar_points),
                    shield_used,
                );
                let prediction_points = prediction_outcomes
                    .iter()
                    .filter(|prediction| {
                        prediction.predictor_user_id == user_id && prediction.correct
                    })
                    .count();
                let is_king = resolved.king_user_id == Some(user_id);
                SeasonPlayerUpdate {
                    season_player_id: player.meta.season_player_id,
                    scars: economy.scars,
                    shields: economy.shields,
                    shields_used_increment: i64::from(shield_used),
                    prediction_points_increment: i64::try_from(prediction_points)
                        .unwrap_or(i64::MAX),
                    race_count_increment: 1,
                    race_wins_increment: i64::from(entry.rank == 1),
                    championship_points_increment: ranked - entry.rank + 1,
                    is_king,
                    king_streak: if is_king { resolved.king_streak } else { 0 },
                }
            })
            .collect();
        let prediction_updates = prediction_outcomes
            .iter()
            .filter_map(|outcome| {
                let prediction = input
                    .predictions
                    .iter()
                    .find(|prediction| prediction.predictor_user_id == outcome.predictor_user_id)?;
                Some(PredictionUpdate {
                    prediction_id: prediction.id,
                    points_awarded: outcome.points_awarded,
                })
            })
            .collect();
        let week_metadata = stringify(&json!({
            "weekId": input.week_id,
            "weekNumber": input.week_number,
        }));
        let quack_grants = quack_rewards
            .iter()
            .filter_map(|reward| {
                let player = find_player(reward.player_id)?;
                let reason = quack_reason_str(reward.reason);
                Some(QuackGrant {
                    season_player_id: player.meta.season_player_id,
                    amount: reward.amount,
                    reason,
                    race_id: input.race_id,
                    idempotency_key: format!(
                        "race:{}:player:{}:{reason}",
                        input.race_id, player.meta.season_player_id
                    ),
                    metadata_json: week_metadata.clone(),
                })
            })
            .collect();
        let golden = match (golden_player, golden_pickup_id, golden_collection) {
            (Some(player), Some(pickup_id), Some(event)) => Some(GoldenGrant {
                grant: QuackGrant {
                    season_player_id: player.meta.season_player_id,
                    amount: GOLDEN_TRACK_QP_REWARD,
                    reason: TRACK_GOLDEN_BOX,
                    race_id: input.race_id,
                    idempotency_key: format!("race:{}:golden-box:{pickup_id}", input.race_id),
                    metadata_json: stringify(&json!({
                        "weekId": input.week_id,
                        "weekNumber": input.week_number,
                        "pickupId": pickup_id,
                    })),
                },
                tick: event.tick,
                timestamp_within_race_ms: event.timestamp_within_race_ms,
                source_player_id: player.meta.user_id.to_string(),
                pickup_id: pickup_id.to_owned(),
            }),
            _ => None,
        };
        SeasonWrites {
            clear_kings_season_id: input.season_id,
            player_updates,
            prediction_updates,
            quack_grants,
            golden,
        }
    });

    let victim_names = as_refs(&victims);
    Ok(ResolutionPlan {
        final_verdict: final_verdict(&victim_names),
        resolution: resolved,
        chaos_resolved,
        prediction_outcomes,
        quack_rewards,
        recap,
        participant_updates,
        season,
    })
}

fn as_refs(values: &[String]) -> Vec<&str> {
    values.iter().map(String::as_str).collect()
}

/// The ledger reason literal.
#[must_use]
pub fn quack_reason_str(reason: QuackReason) -> &'static str {
    match reason {
        QuackReason::RaceWin => "RACE_WIN",
        QuackReason::PredictionWin => "PREDICTION_WIN",
        QuackReason::PerfectWeek => "PERFECT_WEEK",
    }
}
