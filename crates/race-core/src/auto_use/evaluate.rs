//! Candidate evaluation: `packages/race-core/src/auto-use/evaluate.ts`
//! (S3.15), ported line by line.
//!
//! Every call into [`ChaosUtility`] and [`read_race`] is kept, including the
//! ones whose result is unused or short-circuited exactly as in TS: both are
//! memoised on a fingerprint (plain fields), so *when* they are consulted can
//! change what a later call returns.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::config::ChaosType;
use race_protocol::events::{AiIntent, AutoUseReason, HornSide};
use race_protocol::ids::{ItemKey, PlayerId, RaceItemId, WildItemId};

use super::Brains;
use super::brain::{DuckBrain, NEUTRAL_TRAITS, TemperamentTraits, grudge_weight};
use super::chaos_utility::ChaosUtility;
use super::config::auto_use_config;
use super::director::{DirectorCache, director_config, read_race};
use super::objective::RaceObjectiveContext;
use super::types::{AutoUseCandidate, CandidateAction, CandidateSource};
use crate::config::base_speed;
use crate::items::config::item_balance;
use crate::items::engine::ticks_f64;
use crate::items::{
    DuckItemRuntime, ItemRaceState, LoadoutCombo, default_horn_side, horn_side_targets,
    item_speed_multiplier, slipstream_ready,
};
use crate::js_sort::v8_sort_by;
use crate::math::{abs, ceil, cmp_f64_js, js_clamp, js_max, js_min, js_round};
use crate::pickups::config::pickup_balance;
use crate::pickups::{HazardSpawn, wild_horn_reach};
use crate::sim::{DuckPhysicsState, EngineMath, id_cmp, id_set_has};

/// `EvaluationContext` (`evaluate.ts:15-27`). `pickupState` is only read
/// for its hazards. `itemState.brains` is [`Self::brains`]; the `readRace`
/// memo for `ctx.ducks` is [`Self::director`].
pub struct EvalCtx<'a> {
    pub tick: u32,
    pub tick_rate: u32,
    pub objective: &'a mut RaceObjectiveContext,
    pub item_state: &'a ItemRaceState,
    pub hazards: &'a [HazardSpawn],
    pub ducks: &'a [DuckPhysicsState],
    pub player_id: &'a PlayerId,
    pub seconds_until_next_pickup_zone: f64,
    pub prep_auto_use_enabled: bool,
    pub wild_auto_use_enabled: bool,
    pub ghost_player_ids: &'a [PlayerId],
    pub brains: &'a mut Brains,
    pub director: &'a mut DirectorCache,
    pub math: EngineMath,
}

/// `endGameBurnScore(progress, kind)` (`evaluate.ts:29-35`).
fn end_game_burn_score(progress: f64, kind: CandidateSource) -> f64 {
    let (end_game, force_burn) = match kind {
        CandidateSource::Prep => (
            item_balance::auto_use::END_GAME_BURN_PROGRESS,
            item_balance::auto_use::FORCE_BURN_PROGRESS,
        ),
        CandidateSource::Wild => (
            pickup_balance::auto_use::END_GAME_BURN_PROGRESS,
            pickup_balance::auto_use::FORCE_BURN_PROGRESS,
        ),
    };
    let mut score = 0.0;
    if progress >= end_game {
        score += 28.0;
    }
    if progress >= force_burn {
        score += 22.0;
    }
    score
}

/// `duckById(ducks, playerId)!`.
fn duck_by_id<'d>(ducks: &'d [DuckPhysicsState], player_id: &str) -> &'d DuckPhysicsState {
    find_duck(ducks, player_id).expect("the evaluating duck is in the race")
}

fn find_duck<'d>(ducks: &'d [DuckPhysicsState], player_id: &str) -> Option<&'d DuckPhysicsState> {
    ducks
        .iter()
        .find(|duck| duck.player_id.as_str() == player_id)
}

/// `activeDucks(ducks)`.
fn active_ducks(ducks: &[DuckPhysicsState]) -> Vec<&DuckPhysicsState> {
    ducks.iter().filter(|duck| !duck.finished).collect()
}

/// `hasUnusedOffensiveMajor(runtime)`.
fn has_unused_offensive_major(runtime: &DuckItemRuntime) -> bool {
    runtime.has_unused(RaceItemId::HomingRocket) || runtime.has_unused(RaceItemId::Nitro)
}

/// `carriesSpeedMomentum(runtime, tick)`.
fn carries_speed_momentum(runtime: &DuckItemRuntime, tick: u32) -> bool {
    if runtime.active_speed_item_id.is_some() && i64::from(tick) < runtime.boost_until_tick {
        return true;
    }
    runtime.has_unused(RaceItemId::Nitro)
}

/// `predictLateral(duck, horizonSeconds)`.
pub(crate) fn predict_lateral(duck: &DuckPhysicsState, horizon_seconds: f64) -> f64 {
    duck.lateral_offset + duck.lateral_velocity * horizon_seconds
}

/// `isOffensiveAutoItem(itemId)` (`evaluate.ts:446-450`): the string test,
/// so the box Banana and Horn count too.
#[must_use]
pub fn is_offensive_auto_item(item_id: ItemKey) -> bool {
    matches!(
        item_id,
        ItemKey::HomingRocket | ItemKey::Banana | ItemKey::MiniRocket | ItemKey::QuackHorn
    )
}

/// `SPEED_PREP_ITEMS.has(String(itemId))` (`evaluate.ts:1078`).
fn is_speed_prep_item(item_id: ItemKey) -> bool {
    matches!(
        item_id,
        ItemKey::Nitro | ItemKey::DraftFin | ItemKey::PaddleBurst
    )
}

/// The prep item behind an [`ItemKey`] (`candidate.itemId as RaceItemId`).
fn race_item(item_id: ItemKey) -> Option<RaceItemId> {
    Some(match item_id {
        ItemKey::Nitro => RaceItemId::Nitro,
        ItemKey::DraftFin => RaceItemId::DraftFin,
        ItemKey::PaddleBurst => RaceItemId::PaddleBurst,
        ItemKey::BubbleShield => RaceItemId::BubbleShield,
        ItemKey::Feather => RaceItemId::Feather,
        ItemKey::ShockAbsorber => RaceItemId::ShockAbsorber,
        ItemKey::HomingRocket => RaceItemId::HomingRocket,
        ItemKey::Banana => RaceItemId::Banana,
        ItemKey::QuackHorn => RaceItemId::QuackHorn,
        _ => return None,
    })
}

/// `bananaIntersectionScore(source, target, horizonSeconds)` (`evaluate.ts:233-245`).
fn banana_intersection_score(
    source: &DuckPhysicsState,
    target: &DuckPhysicsState,
    horizon_seconds: f64,
) -> f64 {
    let trap_progress = js_max(
        0.0,
        source.progress - item_balance::banana::DROP_BEHIND_PROGRESS,
    );
    let trap_lateral = source.lateral_offset;
    let predicted_lateral = predict_lateral(target, horizon_seconds);
    let progress_gap = source.progress - target.progress;
    if progress_gap <= 0.0 || progress_gap > 0.12 {
        return 0.0;
    }
    let lateral_gap = abs(predicted_lateral - trap_lateral);
    let radius = item_balance::banana::HIT_LATERAL_RADIUS;
    if lateral_gap > radius * 1.25 {
        return 0.0;
    }
    let arrival_gap = abs(target.progress - trap_progress);
    let on_path = if arrival_gap < 0.08 { 1.0 } else { 0.4 };
    js_clamp(
        (1.0 - lateral_gap / (radius * 1.25)) * 100.0 * on_path,
        0.0,
        100.0,
    )
}

/// `slowCost(c)` (`evaluate.ts:281-282`).
fn slow_cost(
    stagger_multiplier: f64,
    stagger_duration_seconds: f64,
    recovery_slow_multiplier: f64,
    recovery_duration_seconds: f64,
) -> f64 {
    (1.0 - stagger_multiplier) * stagger_duration_seconds
        + (1.0 - recovery_slow_multiplier) * recovery_duration_seconds
}

fn shock_absorber_slow_cost() -> f64 {
    use item_balance::shock_absorber as s;
    slow_cost(
        s::STAGGER_MULTIPLIER,
        s::STAGGER_DURATION_SECONDS,
        s::RECOVERY_SLOW_MULTIPLIER,
        s::RECOVERY_DURATION_SECONDS,
    )
}

fn rocket_slow_cost(kind: CandidateSource) -> f64 {
    match kind {
        CandidateSource::Prep => {
            use item_balance::rocket as r;
            slow_cost(
                r::STAGGER_MULTIPLIER,
                r::STAGGER_DURATION_SECONDS,
                r::RECOVERY_SLOW_MULTIPLIER,
                r::RECOVERY_DURATION_SECONDS,
            )
        }
        CandidateSource::Wild => {
            use pickup_balance::mini_rocket as r;
            slow_cost(
                r::STAGGER_MULTIPLIER,
                r::STAGGER_DURATION_SECONDS,
                r::RECOVERY_SLOW_MULTIPLIER,
                r::RECOVERY_DURATION_SECONDS,
            )
        }
    }
}

/// `BananaAimPlan` (`evaluate.ts:160-169`).
#[derive(Clone, Debug, PartialEq)]
pub struct BananaAimPlan {
    pub aim_lateral: f64,
    pub intersection: f64,
    pub target_id: Option<PlayerId>,
    pub teammate_at_risk: bool,
}

/// One scored rocket target (`ScoredTarget`, `evaluate.ts:287`).
#[derive(Clone, Debug, PartialEq)]
struct ScoredTarget {
    target_id: PlayerId,
    score: f64,
    intent: Option<AiIntent>,
}

/// One horn side under evaluation.
struct HornPlan {
    side: HornSide,
    net_value: f64,
    intent: Option<AiIntent>,
    shove: bool,
}

#[allow(clippy::cast_precision_loss)] // lobby sizes are tiny
fn count_f64(count: usize) -> f64 {
    count as f64
}

impl EvalCtx<'_> {
    fn tick_f(&self) -> f64 {
        f64::from(self.tick)
    }

    fn tick_rate_f(&self) -> f64 {
        f64::from(self.tick_rate)
    }

    fn runtime(&self, player_id: &str) -> &DuckItemRuntime {
        self.item_state.runtime(player_id)
    }

    fn me(&self) -> &DuckPhysicsState {
        duck_by_id(self.ducks, self.player_id.as_str())
    }

    fn is_ghost(&self, player_id: &str) -> bool {
        id_set_has(self.ghost_player_ids, player_id)
    }

    /// `brainOf(ctx)`: the duck's brain unless it is ablated.
    fn brain_of(&self) -> Option<&DuckBrain> {
        self.brains
            .get(self.player_id.as_str())
            .filter(|brain| !brain.ablated)
    }

    /// `traitsOf(ctx)`.
    fn traits_of(&self) -> TemperamentTraits {
        self.brain_of().map_or(NEUTRAL_TRAITS, |brain| brain.traits)
    }

    /// `chaosOf(ctx)`: ablated brains read the naive (rank-cutoff) view.
    fn chaos_of(&mut self) -> &mut ChaosUtility {
        let ablated = self
            .brains
            .get(self.player_id.as_str())
            .is_some_and(|brain| brain.ablated);
        if ablated {
            &mut self.objective.naive_chaos
        } else {
            &mut self.objective.chaos
        }
    }

    /// `lossRisk(ctx)`.
    fn loss_risk(&mut self) -> f64 {
        let (ducks, player_id, math) = (self.ducks, self.player_id, self.math);
        self.chaos_of().loss_risk(player_id.as_str(), ducks, math)
    }

    /// `chaosTargetValue(ctx, target, drop, selfGain = 0)`.
    fn chaos_target_value(&mut self, target_id: &str, drop: f64, self_gain: f64) -> f64 {
        let (ducks, player_id, math) = (self.ducks, self.player_id, self.math);
        self.chaos_of().action_value(
            player_id.as_str(),
            ducks,
            self_gain,
            Some(target_id),
            drop,
            math,
        )
    }

    /// `readRace(ctx.ducks).runawayLeaderId === id`.
    fn is_runaway_leader(&mut self, player_id: &str) -> bool {
        read_race(self.director, self.ducks)
            .runaway_leader_id
            .as_ref()
            .is_some_and(|leader| leader.as_str() == player_id)
    }

    /// `readRace(ctx.ducks).duelIds.includes(ctx.playerId)`.
    fn in_duel(&mut self) -> bool {
        let player_id = self.player_id;
        read_race(self.director, self.ducks)
            .duel_ids
            .iter()
            .any(|id| id == player_id)
    }

    /// `dynamicThreshold(ctx)` (`evaluate.ts:65-77`).
    pub fn dynamic_threshold(&mut self) -> f64 {
        let progress = self.me().progress;
        let mut threshold = auto_use_config::thresholds::EARLY;
        if progress >= auto_use_config::PROGRESS_FINAL {
            threshold = auto_use_config::thresholds::FINAL_STRETCH;
        } else if progress >= auto_use_config::PROGRESS_LATE {
            threshold = auto_use_config::thresholds::LATE;
        } else if progress >= auto_use_config::PROGRESS_MID {
            threshold = auto_use_config::thresholds::MID;
        }
        threshold -= js_round(self.loss_risk() * 12.0);
        let holding = self.runtime(self.player_id.as_str()).wild_item.is_some();
        if holding && self.seconds_until_next_pickup_zone < 2.0 {
            threshold -= 15.0;
        }
        if holding && self.seconds_until_next_pickup_zone < 1.0 {
            threshold -= 10.0;
        }
        threshold
    }

    /// `inventoryPressure(ctx)` (`evaluate.ts:79-87`).
    fn inventory_pressure(&self) -> f64 {
        if self.runtime(self.player_id.as_str()).wild_item.is_none() {
            return 0.0;
        }
        let seconds = self.seconds_until_next_pickup_zone;
        if seconds < 1.0 {
            return auto_use_config::inventory_pressure::UNDER_1S;
        }
        if seconds < 2.0 {
            return auto_use_config::inventory_pressure::UNDER_2S;
        }
        if seconds < 3.5 {
            return auto_use_config::inventory_pressure::UNDER_3_5S;
        }
        0.0
    }

    /// `chaosIntent(ctx)` (`evaluate.ts:93-98`).
    fn chaos_intent(&mut self) -> AiIntent {
        match self.chaos_of().chaos_mode() {
            ChaosType::Duo | ChaosType::Constructors => AiIntent::TeamPlay,
            ChaosType::BountyHunt => AiIntent::Bounty,
            _ => AiIntent::Desperate,
        }
    }

    /// `dangerOf(ctx, duck)` (`evaluate.ts:119-130`).
    fn danger_of(&mut self, duck: &DuckPhysicsState) -> f64 {
        let risk = self.loss_risk();
        let mut gap_ahead = f64::INFINITY;
        let mut gap_behind = f64::INFINITY;
        for other in self.ducks {
            if other.finished || other.player_id == duck.player_id {
                continue;
            }
            if other.progress >= duck.progress {
                gap_ahead = js_min(gap_ahead, other.progress - duck.progress);
            } else {
                gap_behind = js_min(gap_behind, duck.progress - other.progress);
            }
        }
        let squeeze = if gap_ahead < 0.008 && gap_behind < 0.008 {
            15.0
        } else if gap_ahead < 0.015 {
            8.0
        } else {
            0.0
        };
        js_clamp(
            risk * 80.0 + squeeze + if duck.progress > 0.75 { 10.0 } else { 0.0 },
            0.0,
            100.0,
        )
    }

    /// `isDesperate(ctx, duck)` (`evaluate.ts:132-134`).
    fn is_desperate(&mut self, progress: f64) -> bool {
        progress >= director_config::DESPERATION_PROGRESS
            && self.loss_risk() >= director_config::DESPERATION_RISK
    }

    /// `estimateDrop(ctx, target, slowDistance)` (`evaluate.ts:137-144`).
    fn estimate_drop(&self, target: &DuckPhysicsState, slow_distance: f64) -> f64 {
        let mut drop = 0.0;
        for other in self.ducks {
            if other.finished || other.player_id == target.player_id {
                continue;
            }
            if other.progress < target.progress && target.progress - other.progress <= slow_distance
            {
                drop += 1.0;
            }
        }
        drop
    }

    /// `socialTargetBonus(ctx, target)` (`evaluate.ts:219-231`).
    fn social_target_bonus(&mut self, target_id: &PlayerId) -> (f64, Option<AiIntent>) {
        let traits = self.traits_of();
        let mut options: Vec<(f64, AiIntent)> = Vec::new();
        let grudge = grudge_weight(
            self.brain_of(),
            target_id.as_str(),
            self.tick,
            self.tick_rate,
            self.math,
        );
        if grudge > 0.2 {
            options.push((
                traits.vengeance * 10.0 * js_min(2.0, grudge),
                AiIntent::Retaliating,
            ));
        }
        if self
            .brain_of()
            .and_then(|brain| brain.rival_id.as_ref())
            .is_some_and(|rival| rival == target_id)
        {
            options.push((4.0 + traits.aggression * 4.0, AiIntent::Rivalry));
        }
        if self.is_runaway_leader(target_id.as_str()) {
            options.push((2.0 + traits.aggression * 5.0, AiIntent::Hunting));
        }
        if self
            .chaos_of()
            .wanted_player_id()
            .is_some_and(|wanted| wanted == target_id)
        {
            options.push((0.0, AiIntent::Bounty));
        }
        if options.is_empty() {
            return (0.0, None);
        }
        let mut bonus = 0.0;
        for (value, _) in &options {
            bonus += value;
        }
        v8_sort_by(&mut options, |left, right| cmp_f64_js(right.0, left.0));
        (bonus, Some(options[0].1))
    }

    /// `planBananaAim(ctx, duck, maxOffset, dropBehind, hitRadius,
    /// slowDistance)` (`evaluate.ts:171-207`).
    fn plan_banana_aim(
        &mut self,
        duck: &DuckPhysicsState,
        max_offset: f64,
        drop_behind: f64,
        hit_radius: f64,
        slow_distance: f64,
    ) -> BananaAimPlan {
        struct Chaser {
            target_id: PlayerId,
            predicted: f64,
            dodge: f64,
            teammate: bool,
            value: f64,
        }
        let trap = js_max(0.0, duck.progress - drop_behind);
        let ducks = self.ducks;
        let tick = self.tick;
        let tick_i = i64::from(tick);
        let mut chasers: Vec<Chaser> = Vec::new();
        for target in active_ducks(ducks) {
            if target.player_id == duck.player_id
                || self.is_ghost(target.player_id.as_str())
                || !in_trap_window(trap, target.progress)
            {
                continue;
            }
            let runtime = self.runtime(target.player_id.as_str());
            let seconds = js_max(
                0.05,
                (trap - target.progress)
                    / (base_speed() * js_max(0.3, item_speed_multiplier(runtime, tick))),
            );
            let dodge = if seconds < 0.55 {
                1.0
            } else if seconds < 1.1 {
                0.65
            } else {
                0.4
            };
            let teammate = self
                .objective
                .is_teammate(duck.player_id.as_str(), target.player_id.as_str());
            let defended = (runtime.bubble_available && tick_i < runtime.bubble_until_tick)
                || runtime.feather_available
                || (runtime.wild_bubble_available && tick_i < runtime.wild_bubble_until_tick)
                || (runtime.wild_feather_available && tick_i < runtime.wild_feather_until_tick);
            let value = if teammate {
                -2.0
            } else if defended {
                -0.3
            } else {
                let drop = self.estimate_drop(target, slow_distance);
                let chaos = self.chaos_target_value(target.player_id.as_str(), drop, 0.0);
                let social = self.social_target_bonus(&target.player_id).0;
                1.0 + js_clamp(chaos / 40.0, -0.5, 1.5) + social / 20.0
            };
            chasers.push(Chaser {
                target_id: target.player_id.clone(),
                predicted: predict_lateral(target, js_min(seconds, 1.0)),
                dodge,
                teammate,
                value,
            });
        }
        let hit_fraction =
            |lane: f64, predicted: f64| js_max(0.0, 1.0 - abs(lane - predicted) / hit_radius);
        let mut best_aim = duck.lateral_offset;
        let mut best_total = f64::NEG_INFINITY;
        for step in -4_i32..=4 {
            let lane = js_max(
                -0.95,
                js_min(
                    0.95,
                    duck.lateral_offset + (max_offset * f64::from(step)) / 4.0,
                ),
            );
            let mut total = 0.0;
            for chaser in &chasers {
                total += chaser.value * chaser.dodge * hit_fraction(lane, chaser.predicted);
            }
            if total > best_total + 1e-9
                || (abs(total - best_total) <= 1e-9
                    && abs(lane - duck.lateral_offset) < abs(best_aim - duck.lateral_offset))
            {
                best_aim = lane;
                best_total = total;
            }
        }
        let mut intersection = 0.0;
        let mut target_id = None;
        let mut teammate_at_risk = false;
        for chaser in &chasers {
            let chance = chaser.dodge * hit_fraction(best_aim, chaser.predicted);
            if chaser.teammate {
                if chance > 0.0 {
                    teammate_at_risk = true;
                }
                continue;
            }
            if chaser.value > 0.0 && chance * 100.0 > intersection {
                intersection = chance * 100.0;
                target_id = Some(chaser.target_id.clone());
            }
        }
        BananaAimPlan {
            aim_lateral: best_aim,
            intersection,
            target_id,
            teammate_at_risk,
        }
    }

    /// `shovesIntoTrap(ctx, target, side, distance)` (`evaluate.ts:210-222`).
    fn shoves_into_trap(&self, target: &DuckPhysicsState, side: HornSide, distance: f64) -> bool {
        let landing = js_max(
            -0.95,
            js_min(
                0.95,
                target.lateral_offset + f64::from(side.sign()) * distance,
            ),
        );
        let ahead = |progress: f64| progress > target.progress && progress - target.progress < 0.04;
        for banana in &self.item_state.bananas {
            if banana.source_player_id == target.player_id || !ahead(banana.progress) {
                continue;
            }
            if abs(landing - banana.lateral_offset) <= banana.hit_lateral_radius
                && abs(target.lateral_offset - banana.lateral_offset) > banana.hit_lateral_radius
            {
                return true;
            }
        }
        for hazard in self.hazards {
            if id_set_has(&hazard.hit_player_ids, target.player_id.as_str())
                || !ahead(hazard.progress)
            {
                continue;
            }
            if abs(landing - hazard.lateral_offset) <= hazard.radius
                && abs(target.lateral_offset - hazard.lateral_offset) > hazard.radius
            {
                return true;
            }
        }
        false
    }

    /// `rocketTargets(ctx, kind, preferredTargetId?)` (`evaluate.ts:253-440`),
    /// returning the single entry of the TS array.
    #[allow(clippy::too_many_lines)]
    fn rocket_targets(
        &mut self,
        kind: CandidateSource,
        preferred_target_id: Option<&PlayerId>,
    ) -> Option<ScoredTarget> {
        let ducks = self.ducks;
        let source = self.me();
        let source_id = source.player_id.clone();
        let source_progress = source.progress;
        let prep = kind == CandidateSource::Prep;
        let max_distance = if prep {
            if source_progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS {
                item_balance::rocket::MAXIMUM_TARGET_DISTANCE
                    * item_balance::rocket::END_GAME_TARGET_DISTANCE_MULTIPLIER
            } else {
                item_balance::rocket::MAXIMUM_TARGET_DISTANCE
            }
        } else if source_progress >= pickup_balance::auto_use::FORCE_BURN_PROGRESS {
            pickup_balance::mini_rocket::MAXIMUM_TARGET_DISTANCE
                * pickup_balance::mini_rocket::FORCE_BURN_TARGET_DISTANCE_MULTIPLIER
        } else if source_progress >= pickup_balance::auto_use::END_GAME_BURN_PROGRESS {
            pickup_balance::mini_rocket::MAXIMUM_TARGET_DISTANCE
                * pickup_balance::mini_rocket::END_GAME_TARGET_DISTANCE_MULTIPLIER
        } else {
            pickup_balance::mini_rocket::MAXIMUM_TARGET_DISTANCE
        };
        let projectile_speed = if prep {
            item_balance::rocket::PROJECTILE_SPEED
        } else {
            pickup_balance::mini_rocket::PROJECTILE_SPEED
        };
        let lifetime_seconds = if prep {
            item_balance::rocket::LIFETIME_SECONDS
        } else {
            pickup_balance::mini_rocket::LIFETIME_SECONDS
        };
        let max_acceptable_tti = if prep {
            if source_progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS {
                2.5
            } else {
                1.6
            }
        } else if source_progress >= pickup_balance::auto_use::FORCE_BURN_PROGRESS {
            2.2
        } else if source_progress >= pickup_balance::auto_use::END_GAME_BURN_PROGRESS {
            1.8
        } else {
            1.2
        };
        let impact_slow_cost = rocket_slow_cost(kind);
        let mitigated_cost_ratio = js_min(1.0, shock_absorber_slow_cost() / impact_slow_cost);

        let eligible: Vec<&DuckPhysicsState> = ducks
            .iter()
            .filter(|target| {
                !target.finished
                    && target.player_id != source_id
                    && target.progress > source_progress
                    && !self.is_ghost(target.player_id.as_str())
                    && !self
                        .objective
                        .is_teammate(source_id.as_str(), target.player_id.as_str())
            })
            .collect();
        let tick = self.tick_f();
        let tick_rate = self.tick_rate_f();
        let mut best: Option<ScoredTarget> = None;
        let mut preferred: Option<ScoredTarget> = None;
        for &target in &eligible {
            if target.progress - source_progress > max_distance {
                continue;
            }
            let target_runtime = self.runtime(target.player_id.as_str());
            let penalty = self
                .objective
                .offensive_target_penalty(source_id.as_str(), target.player_id.as_str());
            if !penalty.is_finite() {
                continue;
            }
            if tick < ticks_f64(target_runtime.rocket_protection_until_tick) {
                continue;
            }

            let gap = target.progress - source_progress;
            let target_estimated_speed =
                base_speed() * item_speed_multiplier(target_runtime, self.tick);
            let relative_speed = projectile_speed - target_estimated_speed;
            if relative_speed <= 0.0 {
                continue;
            }
            let hit_radius = if prep {
                item_balance::rocket::HIT_RADIUS
            } else {
                pickup_balance::mini_rocket::HIT_RADIUS
            };
            #[allow(clippy::cast_precision_loss)]
            let arming = item_balance::rocket::ARMING_TICKS as f64 / tick_rate;
            let tti = js_max(arming, (gap - hit_radius) / relative_speed);
            let impact_tick = tick + ceil(tti * tick_rate);
            if tti > lifetime_seconds || tti > max_acceptable_tti {
                continue;
            }
            let projected = target.progress + target_estimated_speed * tti;
            if projected >= 1.0 {
                continue;
            }
            let hit_confidence = js_clamp(1.0 - (tti / lifetime_seconds) * 0.6, 0.25, 1.0);

            let has_active_bubble = (target_runtime.bubble_available
                && impact_tick < ticks_f64(target_runtime.bubble_until_tick))
                || (target_runtime.wild_bubble_available
                    && impact_tick < ticks_f64(target_runtime.wild_bubble_until_tick));
            let reaction = ceil(auto_use_config::REACTION_DELAY_MAX_SECONDS * tick_rate);
            let has_prep_bubble = target_runtime.has_unused(RaceItemId::BubbleShield)
                && js_max(tick, ticks_f64(target_runtime.silenced_until_tick)) + reaction
                    < impact_tick;
            let has_bubble_protection = has_active_bubble || has_prep_bubble;

            let damage_probability = if has_bubble_protection
                || impact_tick < ticks_f64(target_runtime.item_immunity_until_tick)
            {
                0.0
            } else {
                1.0
            };
            let defense_mitigation = if target_runtime.shock_absorber_available {
                mitigated_cost_ratio
            } else {
                1.0
            };
            let raw_impact = 34.0;
            let expected_damage_value =
                raw_impact * hit_confidence * damage_probability * defense_mitigation;

            let boost_remaining_ticks = js_max(
                0.0,
                ticks_f64(target_runtime.boost_until_tick) - impact_tick,
            );
            let mut expected_boost_break_value = 0.0;
            if boost_remaining_ticks > 0.0 && target_runtime.boost_multiplier > 1.0 {
                let boost_seconds_remaining = boost_remaining_ticks / tick_rate;
                let break_efficiency = if prep { 1.0 } else { 0.5 };
                expected_boost_break_value = js_clamp(
                    boost_seconds_remaining
                        * 14.0
                        * (target_runtime.boost_multiplier - 1.0)
                        * 35.0
                        * break_efficiency,
                    0.0,
                    24.0,
                ) * damage_probability
                    * hit_confidence;
            }

            let momentum_steal_value = if carries_speed_momentum(target_runtime, self.tick) {
                auto_use_config::MOMENTUM_STEAL_VALUE * damage_probability * hit_confidence
            } else {
                0.0
            };

            let mut shield_strip_value = 0.0;
            if has_bubble_protection {
                let pressure = self.inventory_pressure();
                let is_end_game = source_progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS;
                let is_only_target_ahead = eligible.len() <= 1;
                let is_losing = self.loss_risk() >= 0.5;
                let mut raw_strip = 6.0;
                if pressure > 0.0 || is_end_game {
                    raw_strip = 24.0;
                } else if is_only_target_ahead && is_losing {
                    raw_strip = 26.0;
                } else if is_only_target_ahead {
                    raw_strip = 16.0;
                }
                shield_strip_value = raw_strip * hit_confidence;
            }

            let mut objective_value = 0.0;
            objective_value += self
                .objective
                .opponent_threat(source_id.as_str(), target.player_id.as_str())
                * 8.0;
            objective_value += js_clamp((max_distance - gap) / max_distance * 12.0, 0.0, 12.0);
            if gap > 0.02 && gap < max_distance * 0.75 {
                objective_value += 10.0;
            }

            let slow_distance = impact_slow_cost * defense_mitigation * base_speed();
            let drop = self.estimate_drop(target, slow_distance);
            let chaos_value = self.chaos_target_value(target.player_id.as_str(), drop, 0.0)
                * damage_probability
                * hit_confidence;
            objective_value += js_clamp(chaos_value * 0.6, -20.0, 40.0);
            let social = self.social_target_bonus(&target.player_id);
            objective_value += social.0 * js_max(0.25, damage_probability);

            if source_progress >= auto_use_config::PROGRESS_LATE {
                objective_value += 12.0;
            }

            let opportunism = 0.8 + self.traits_of().opportunism * 0.4;
            let mut total_score = objective_value
                + expected_damage_value
                + (expected_boost_break_value + momentum_steal_value) * opportunism
                + shield_strip_value
                - penalty;

            if source_progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS {
                total_score = js_max(
                    total_score,
                    20.0 + js_clamp((max_distance - gap) / max_distance * 10.0, 0.0, 10.0),
                );
            }

            let intent = match social.1 {
                Some(intent) => Some(intent),
                None => {
                    if chaos_value >= 15.0 && self.chaos_of().chaos_mode() != ChaosType::Normal {
                        Some(self.chaos_intent())
                    } else {
                        None
                    }
                }
            };
            let entry = ScoredTarget {
                target_id: target.player_id.clone(),
                score: total_score,
                intent,
            };
            if entry.score <= 0.0 {
                continue;
            }
            let replace = match &best {
                None => true,
                Some(best) => {
                    entry.score > best.score
                        || (entry.score == best.score
                            && id_cmp(entry.target_id.as_str(), best.target_id.as_str()).is_lt())
                }
            };
            if replace {
                best = Some(entry.clone());
            }
            if preferred_target_id.is_some_and(|id| *id == target.player_id) {
                preferred = Some(entry);
            }
        }
        // Hysteresis prevents pointless switching while allowing materially
        // better targets.
        if let (Some(preferred), Some(best)) = (&preferred, &best)
            && preferred.score >= best.score - 5.0
        {
            return Some(preferred.clone());
        }
        best
    }

    /// `resolveRocketTarget(ctx, kind, preferredTargetId?)` (`evaluate.ts:442-444`).
    pub fn resolve_rocket_target(
        &mut self,
        kind: CandidateSource,
        preferred_target_id: Option<&PlayerId>,
    ) -> Option<PlayerId> {
        self.rocket_targets(kind, preferred_target_id)
            .map(|entry| entry.target_id)
    }

    fn candidate(
        &self,
        item_key: String,
        item_id: ItemKey,
        source: CandidateSource,
        action: CandidateAction,
        score: f64,
        reason: AutoUseReason,
    ) -> AutoUseCandidate {
        AutoUseCandidate {
            player_id: self.player_id.clone(),
            item_key,
            item_id,
            source,
            action,
            score,
            target_player_id: None,
            reason,
            bypass_threshold: None,
            wild_item_instance_id: None,
            intent: None,
            aim_lateral: None,
            horn_side: None,
        }
    }

    /// `evaluateReactiveDefense(ctx)` (`evaluate.ts:459-504`).
    pub fn evaluate_reactive_defense(&self) -> Vec<AutoUseCandidate> {
        let runtime = self.runtime(self.player_id.as_str());
        if i64::from(self.tick) < runtime.silenced_until_tick {
            return Vec::new();
        }
        let duck = self.me();
        let incoming_rocket = self
            .item_state
            .rockets
            .iter()
            .any(|rocket| rocket.target_player_id == duck.player_id);
        let incoming_banana = incoming_banana_threat(self.item_state, duck);
        let mut reactive = Vec::new();
        if self.wild_auto_use_enabled
            && let Some(wild) = &runtime.wild_item
        {
            if incoming_rocket
                && wild.item_id == WildItemId::MiniBubble
                && !runtime.wild_bubble_available
            {
                let mut candidate = self.candidate(
                    format!("wild:{}", wild.instance_id),
                    ItemKey::MiniBubble,
                    CandidateSource::Wild,
                    CandidateAction::Use,
                    100.0,
                    AutoUseReason::ReactiveDefense,
                );
                candidate.bypass_threshold = Some(true);
                candidate.wild_item_instance_id = Some(wild.instance_id.clone());
                reactive.push(candidate);
            }
            if incoming_banana && wild.item_id == WildItemId::Feather {
                let mut candidate = self.candidate(
                    format!("wild:{}", wild.instance_id),
                    ItemKey::Feather,
                    CandidateSource::Wild,
                    CandidateAction::Use,
                    95.0,
                    AutoUseReason::ReactiveDefense,
                );
                candidate.bypass_threshold = Some(true);
                candidate.wild_item_instance_id = Some(wild.instance_id.clone());
                reactive.push(candidate);
            }
        }
        reactive
    }

    /// `evaluatePrepCandidates(ctx)` (`evaluate.ts:506-842`).
    #[allow(clippy::too_many_lines)]
    pub fn evaluate_prep_candidates(&mut self) -> Vec<AutoUseCandidate> {
        if !self.prep_auto_use_enabled {
            return Vec::new();
        }
        let ducks = self.ducks;
        let item_state = self.item_state;
        let tick = self.tick;
        let tick_i = i64::from(tick);
        let runtime = item_state.runtime(self.player_id.as_str());
        if tick_i < runtime.silenced_until_tick {
            return Vec::new();
        }
        let duck = duck_by_id(ducks, self.player_id.as_str());
        let mut candidates = Vec::new();
        let danger = self.danger_of(duck);
        let pressure = self.inventory_pressure();

        if runtime.has_unused(RaceItemId::Nitro)
            && duck.progress >= item_balance::nitro::ARM_PROGRESS
        {
            if self.objective.mode == ChaosType::Reverse {
                // In Reverse mode, Nitro gives negative utility.
            } else {
                let expected_gain = base_speed()
                    * (item_state.tuning.nitro_speed_multiplier - 1.0)
                    * item_balance::nitro::DURATION_SECONDS;
                let mut enemies_ahead: Vec<&DuckPhysicsState> = active_ducks(ducks)
                    .into_iter()
                    .filter(|candidate| {
                        candidate.player_id != duck.player_id && candidate.progress > duck.progress
                    })
                    .collect();
                v8_sort_by(&mut enemies_ahead, |left, right| {
                    cmp_f64_js(left.progress, right.progress)
                });

                let mut possible_overtakes = 0.0;
                let mut nearest_ahead_gap = 1.0;
                for ahead in &enemies_ahead {
                    let gap = ahead.progress - duck.progress;
                    if gap < nearest_ahead_gap {
                        nearest_ahead_gap = gap;
                    }
                    if gap <= expected_gain * 1.05 {
                        possible_overtakes += 1.0;
                    }
                }

                let mut score = 0.0;
                if possible_overtakes >= 2.0 {
                    score += 65.0;
                } else if possible_overtakes == 1.0 {
                    score += 42.0;
                } else if nearest_ahead_gap <= expected_gain * 1.5 {
                    score += 20.0;
                } else if nearest_ahead_gap > expected_gain * 2.2 && duck.progress < 0.82 {
                    score -= 25.0;
                }

                let player_id = self.player_id;
                let math = self.math;
                let is_losing = self.chaos_of().is_losing_now(player_id.as_str(), ducks);
                if is_losing {
                    let escapes = self.chaos_of().action_value(
                        player_id.as_str(),
                        ducks,
                        possible_overtakes,
                        None,
                        0.0,
                        math,
                    ) >= 50.0;
                    score += if escapes { 55.0 } else { 35.0 };
                } else if danger > 50.0 {
                    score += 18.0;
                }

                let is_late = duck.progress >= 0.82;
                if is_late {
                    if duck.current_rank == 2
                        && !enemies_ahead.is_empty()
                        && nearest_ahead_gap <= expected_gain * 1.25
                    {
                        score += 60.0;
                    } else if duck.current_rank <= 3 && nearest_ahead_gap <= expected_gain * 1.3 {
                        score += 40.0;
                    } else if duck.progress >= 0.90 {
                        score += 25.0;
                    }
                }

                let mut behind: Vec<&DuckPhysicsState> = active_ducks(ducks)
                    .into_iter()
                    .filter(|candidate| {
                        candidate.player_id != duck.player_id && candidate.progress <= duck.progress
                    })
                    .collect();
                v8_sort_by(&mut behind, |left, right| {
                    cmp_f64_js(right.progress, left.progress)
                });
                if let Some(closest_behind) = behind.first() {
                    let gap_behind = duck.progress - closest_behind.progress;
                    if gap_behind <= 0.025 {
                        score += 22.0;
                    }
                }

                let incoming: Vec<_> = item_state
                    .rockets
                    .iter()
                    .filter(|rocket| {
                        rocket.target_player_id == duck.player_id
                            && rocket.launch_at_tick <= tick_i
                            && tick_i < rocket.expires_at_tick
                    })
                    .collect();
                if !incoming.is_empty() {
                    let has_shield = runtime.bubble_available || runtime.wild_bubble_available;
                    if !has_shield {
                        let mut min_time_to_impact = f64::INFINITY;
                        for rocket in &incoming {
                            let distance = js_max(0.0, duck.progress - rocket.progress);
                            let rel_speed = rocket.speed_per_second - base_speed();
                            let tti = if rel_speed > 0.0 {
                                distance / rel_speed
                            } else {
                                2.0
                            };
                            if tti < min_time_to_impact {
                                min_time_to_impact = tti;
                            }
                        }
                        if min_time_to_impact < 1.0 && duck.progress < 0.96 {
                            score -= 80.0;
                        } else if min_time_to_impact >= 1.5 && possible_overtakes > 0.0 {
                            score -= 15.0;
                        }
                    }
                }

                if tick_i < runtime.boost_until_tick && runtime.boost_multiplier > 1.0 {
                    score -= 100.0;
                }

                score += end_game_burn_score(duck.progress, CandidateSource::Prep);
                score += pressure * 0.15;

                if score >= 30.0 {
                    let reason = if is_late {
                        AutoUseReason::EndGameBurn
                    } else if is_losing {
                        AutoUseReason::Objective
                    } else {
                        AutoUseReason::Opportunity
                    };
                    candidates.push(self.candidate(
                        String::from("prep:NITRO"),
                        ItemKey::Nitro,
                        CandidateSource::Prep,
                        CandidateAction::Use,
                        js_clamp(score, 0.0, 100.0),
                        reason,
                    ));
                }
            }
        }

        if runtime.has_unused(RaceItemId::DraftFin)
            && duck.progress >= item_balance::draft_fin::ARM_PROGRESS
            && slipstream_ready(runtime, self.tick_rate, Some(duck.progress))
        {
            let ahead = runtime
                .draft_target_player_id
                .as_ref()
                .and_then(|id| find_duck(ducks, id.as_str()));
            let mut score = 30.0;
            if ahead.is_some_and(|ahead| {
                i64::from(ahead.current_rank) == i64::from(duck.current_rank) - 1
            }) {
                score += 35.0;
            }
            if self.loss_risk() >= 0.5 {
                score += 20.0;
            }
            if duck.progress >= auto_use_config::PROGRESS_LATE {
                score += 12.0;
            }
            score += end_game_burn_score(duck.progress, CandidateSource::Prep);
            score += pressure * 0.1;
            candidates.push(self.candidate(
                String::from("prep:DRAFT_FIN"),
                ItemKey::DraftFin,
                CandidateSource::Prep,
                CandidateAction::Use,
                score,
                AutoUseReason::Opportunity,
            ));
        }

        if runtime.has_unused(RaceItemId::PaddleBurst)
            && duck.progress >= item_balance::paddle_burst::ARM_PROGRESS
        {
            let active_count = count_f64(active_ducks(ducks).len());
            let is_late_sprint = duck.progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS;
            let rank = f64::from(duck.current_rank);
            if rank > ceil(active_count / 2.0) || is_late_sprint {
                let mut score = 0.0;
                if rank >= active_count - 1.0 {
                    score += 28.0;
                }
                if rank >= ceil(active_count * 0.75) {
                    score += 18.0;
                }
                if self.loss_risk() >= 0.5 {
                    score += 22.0;
                }
                if is_late_sprint {
                    score += 30.0;
                }
                score += end_game_burn_score(duck.progress, CandidateSource::Prep);
                score += pressure * 0.12;
                if score >= 24.0 {
                    candidates.push(self.candidate(
                        String::from("prep:PADDLE_BURST"),
                        ItemKey::PaddleBurst,
                        CandidateSource::Prep,
                        CandidateAction::Use,
                        score,
                        if is_late_sprint {
                            AutoUseReason::EndGameBurn
                        } else {
                            AutoUseReason::LateRace
                        },
                    ));
                }
            }
        }

        let menace = runtime.loadout_combo == Some(LoadoutCombo::Menace);
        let rocket_arm_progress = if menace {
            js_max(0.15, item_balance::rocket::ARM_PROGRESS - 0.03)
        } else {
            item_balance::rocket::ARM_PROGRESS
        };
        if runtime.has_unused(RaceItemId::HomingRocket)
            && duck.progress >= rocket_arm_progress
            && duck.progress <= item_balance::rocket::DISABLE_PROGRESS
            && let Some(best) = self.rocket_targets(CandidateSource::Prep, None)
        {
            let mut candidate = self.candidate(
                String::from("prep:HOMING_ROCKET"),
                ItemKey::HomingRocket,
                CandidateSource::Prep,
                CandidateAction::Use,
                best.score + danger * 0.15 + pressure * 0.1,
                AutoUseReason::Objective,
            );
            candidate.target_player_id = Some(best.target_id);
            candidate.intent = best.intent;
            candidates.push(candidate);
        }

        let banana_arm_progress = if menace {
            js_max(0.15, item_balance::banana::ARM_PROGRESS - 0.03)
        } else {
            item_balance::banana::ARM_PROGRESS
        };
        if runtime.has_unused(RaceItemId::Banana) && duck.progress >= banana_arm_progress {
            let mut score = 0.0;
            let mut best_intersection = 0.0;
            let enemies: Vec<&DuckPhysicsState> = active_ducks(ducks)
                .into_iter()
                .filter(|target| {
                    target.player_id != duck.player_id
                        && !self
                            .objective
                            .is_teammate(duck.player_id.as_str(), target.player_id.as_str())
                        && !self.is_ghost(target.player_id.as_str())
                })
                .collect();
            let teammate_at_risk;
            let mut aim: Option<BananaAimPlan> = None;
            if self.brain_of().is_some() {
                use item_balance::banana as b;
                let banana_slow = ((1.0 - b::STAGGER_MULTIPLIER) * b::STAGGER_DURATION_SECONDS
                    + (1.0 - b::RECOVERY_SLOW_MULTIPLIER) * b::RECOVERY_DURATION_SECONDS)
                    * base_speed();
                let plan = self.plan_banana_aim(
                    duck,
                    b::AIM_MAX_OFFSET,
                    b::DROP_BEHIND_PROGRESS,
                    b::HIT_LATERAL_RADIUS,
                    banana_slow,
                );
                best_intersection = plan.intersection;
                teammate_at_risk = plan.teammate_at_risk;
                aim = Some(plan);
            } else {
                for target in &enemies {
                    if target.progress >= duck.progress {
                        continue;
                    }
                    best_intersection = js_max(
                        best_intersection,
                        banana_intersection_score(
                            duck,
                            target,
                            auto_use_config::BANANA_PREDICTION_HORIZON_SECONDS,
                        ),
                    );
                }
                teammate_at_risk =
                    self.teammate_behind_at_risk(duck, item_balance::banana::HIT_LATERAL_RADIUS);
            }

            if !teammate_at_risk {
                score += best_intersection * 0.55;
                if danger > 50.0 {
                    score += 20.0;
                }
                if best_intersection > 20.0 {
                    score += 18.0;
                }
                if best_intersection > 50.0 {
                    score += 20.0;
                }
                if duck.progress >= auto_use_config::PROGRESS_LATE {
                    score += 15.0;
                }
                score += end_game_burn_score(duck.progress, CandidateSource::Prep);
                score += pressure * 0.1;
                let mut chasers: Vec<&DuckPhysicsState> = enemies
                    .iter()
                    .copied()
                    .filter(|target| target.progress < duck.progress)
                    .collect();
                v8_sort_by(&mut chasers, |left, right| {
                    cmp_f64_js(right.progress, left.progress)
                });
                let chaser = chasers.first();
                if chaser.is_some_and(|chaser| {
                    duck.progress - chaser.progress <= item_balance::banana::CLOSE_BEHIND_DISTANCE
                }) {
                    score += 24.0;
                }
                if has_unused_offensive_major(runtime) && best_intersection > 12.0 {
                    score += 22.0;
                }
                if has_unused_offensive_major(runtime) && chaser.is_some() {
                    score += 28.0;
                }
                if has_unused_offensive_major(runtime) && duck.current_rank >= 4 && chaser.is_some()
                {
                    score += 20.0;
                }
                if best_intersection > 20.0 || score >= 24.0 {
                    let mut candidate = self.candidate(
                        String::from("prep:BANANA"),
                        ItemKey::Banana,
                        CandidateSource::Prep,
                        CandidateAction::Use,
                        score,
                        AutoUseReason::Opportunity,
                    );
                    candidate.aim_lateral = aim.as_ref().map(|plan| plan.aim_lateral);
                    let target_id = aim.as_ref().and_then(|plan| plan.target_id.clone());
                    candidate.intent = if target_id.is_some() && best_intersection >= 50.0 {
                        Some(AiIntent::TrapSet)
                    } else {
                        None
                    };
                    candidate.target_player_id = target_id;
                    candidates.push(candidate);
                }
            }
        }

        let horn_arm_progress = if menace {
            js_max(0.15, item_balance::horn::ARM_PROGRESS - 0.03)
        } else {
            item_balance::horn::ARM_PROGRESS
        };
        if runtime.has_unused(RaceItemId::QuackHorn) && duck.progress >= horn_arm_progress {
            use item_balance::horn as h;
            let active = active_ducks(ducks);
            let has_brain = self.brain_of().is_some();
            let sides: Vec<HornSide> = if has_brain {
                Vec::from([HornSide::Left, HornSide::Right])
            } else {
                let ghosts = self.ghost_player_ids;
                Vec::from([default_horn_side(
                    duck,
                    &active,
                    h::PROGRESS_RADIUS,
                    h::SIDE_REACH,
                    h::CENTER_BAND,
                    |target: &&DuckPhysicsState| id_set_has(ghosts, target.player_id.as_str()),
                )])
            };
            let mut best: Option<HornPlan> = None;
            for side in sides {
                let mut horn_intent: Option<AiIntent> = None;
                let mut net_value = 0.0;
                let mut targets_count = 0_u32;
                let mut has_teammate_in_radius = false;
                let ghosts = self.ghost_player_ids;
                let targets = horn_side_targets(
                    duck,
                    &active,
                    side,
                    h::PROGRESS_RADIUS,
                    h::SIDE_REACH,
                    h::CENTER_BAND,
                    |target: &&DuckPhysicsState| id_set_has(ghosts, target.player_id.as_str()),
                );
                for index in targets {
                    let target = active[index];
                    if self
                        .objective
                        .is_teammate(duck.player_id.as_str(), target.player_id.as_str())
                    {
                        has_teammate_in_radius = true;
                        break;
                    }
                    let target_runtime = item_state.runtime(target.player_id.as_str());
                    let bubble_ready = target_runtime.bubble_available
                        && tick_i < target_runtime.bubble_until_tick;
                    if bubble_ready || target_runtime.feather_available {
                        net_value -= 12.0;
                        continue;
                    }
                    targets_count += 1;
                    let impact = h::LATERAL_PUSH;
                    if target.current_rank < duck.current_rank {
                        net_value += impact * 18.0;
                    } else {
                        net_value += impact * 10.0;
                    }
                    let drop = self.estimate_drop(target, 0.006);
                    let horn_chaos = self.chaos_target_value(target.player_id.as_str(), drop, 0.0);
                    net_value += js_clamp(horn_chaos * 0.15, -4.0, 6.0);
                    let (social_bonus, social_intent) = self.social_target_bonus(&target.player_id);
                    net_value += social_bonus * 0.2;
                    if social_intent.is_some() && horn_intent.is_none() {
                        horn_intent = social_intent;
                    }
                    if self.brain_of().is_some()
                        && self.shoves_into_trap(
                            target,
                            side,
                            h::LATERAL_SHOVE + h::LATERAL_PUSH * 0.25,
                        )
                    {
                        net_value += auto_use_config::brain::SHOVE_INTO_TRAP_VALUE;
                        horn_intent = Some(AiIntent::Shove);
                    }
                    if !target_runtime.shock_absorber_available
                        && tick_i < target_runtime.boost_until_tick
                        && target_runtime.boost_multiplier > 1.0
                        && target_runtime.active_speed_item_id.is_some()
                    {
                        net_value += 20.0;
                    }
                    if carries_speed_momentum(target_runtime, tick) {
                        net_value += auto_use_config::MOMENTUM_STEAL_VALUE * 0.5;
                    }
                    if target_runtime.draft_slipstream_ticks > 10 {
                        net_value += 10.0;
                    }
                    if tick_i >= target_runtime.silence_immune_until_tick
                        && tick_i >= target_runtime.silenced_until_tick
                        && target_runtime
                            .item_ids
                            .iter()
                            .any(|id| !target_runtime.used(*id))
                    {
                        net_value += 8.0 * h::SILENCE_DURATION_SECONDS / 2.5;
                    }
                }
                if has_teammate_in_radius || targets_count == 0 {
                    continue;
                }
                if targets_count >= 2 {
                    net_value += 12.0 * (f64::from(targets_count) - 1.0);
                }
                if menace {
                    net_value += 14.0;
                    if duck.current_rank >= 2 {
                        net_value += 6.0;
                    }
                }
                if has_unused_offensive_major(runtime) && net_value > 0.0 {
                    net_value += 6.0;
                }
                if duck.current_rank >= 3 && net_value > 0.0 {
                    net_value += 3.0;
                }
                if best.as_ref().is_none_or(|best| net_value > best.net_value) {
                    best = Some(HornPlan {
                        side,
                        net_value,
                        intent: horn_intent,
                        shove: false,
                    });
                }
            }

            let is_late_sprint = duck.progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS;
            let min_threshold = if is_late_sprint {
                4.0
            } else if duck.progress >= h::FALLBACK_PROGRESS {
                5.0
            } else {
                7.0
            };
            if let Some(best) = best
                && best.net_value >= min_threshold
            {
                let mut candidate = self.candidate(
                    String::from("prep:QUACK_HORN"),
                    ItemKey::QuackHorn,
                    CandidateSource::Prep,
                    CandidateAction::Use,
                    js_clamp(best.net_value, 0.0, 100.0)
                        + end_game_burn_score(duck.progress, CandidateSource::Prep)
                        + pressure * 0.05,
                    AutoUseReason::Opportunity,
                );
                candidate.intent = best.intent;
                candidate.horn_side = has_brain.then_some(best.side);
                candidates.push(candidate);
            }
        }

        if runtime.has_unused(RaceItemId::BubbleShield) && !runtime.bubble_available {
            let is_late_sprint = duck.progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS;
            let mut score = 0.0;
            if duck.progress >= item_balance::bubble_shield::END_GAME_BURN_PROGRESS {
                score += 35.0;
            }
            if self.loss_risk() >= 0.5 && duck.progress >= 0.50 {
                score += 15.0;
            }
            if duck.progress >= auto_use_config::PROGRESS_FINAL {
                score += 30.0;
            }
            score += end_game_burn_score(duck.progress, CandidateSource::Prep);
            score += pressure * 0.1;
            if score >= 28.0 {
                let reason = if is_late_sprint {
                    AutoUseReason::EndGameBurn
                } else if duck.current_rank <= 2 {
                    AutoUseReason::Opportunity
                } else {
                    AutoUseReason::LateRace
                };
                candidates.push(self.candidate(
                    String::from("prep:BUBBLE_SHIELD"),
                    ItemKey::BubbleShield,
                    CandidateSource::Prep,
                    CandidateAction::Use,
                    score,
                    reason,
                ));
            }
        }

        candidates
    }

    /// The legacy-brain `teammateAtRisk` test of the banana evaluations.
    fn teammate_behind_at_risk(&self, duck: &DuckPhysicsState, hit_lateral_radius: f64) -> bool {
        active_ducks(self.ducks).into_iter().any(|target| {
            target.player_id != duck.player_id
                && self
                    .objective
                    .is_teammate(duck.player_id.as_str(), target.player_id.as_str())
                && target.progress < duck.progress
                && (banana_intersection_score(
                    duck,
                    target,
                    auto_use_config::BANANA_PREDICTION_HORIZON_SECONDS,
                ) > 0.0
                    || (duck.progress - target.progress < 0.08
                        && abs(target.lateral_offset - duck.lateral_offset)
                            <= hit_lateral_radius * 1.5))
        })
    }

    /// `evaluateWildCandidates(ctx)` (`evaluate.ts:844-1072`).
    #[allow(clippy::too_many_lines)]
    pub fn evaluate_wild_candidates(&mut self) -> Vec<AutoUseCandidate> {
        if !self.wild_auto_use_enabled {
            return Vec::new();
        }
        let ducks = self.ducks;
        let item_state = self.item_state;
        let tick = self.tick;
        let tick_i = i64::from(tick);
        let runtime = item_state.runtime(self.player_id.as_str());
        if tick_i < runtime.silenced_until_tick {
            return Vec::new();
        }
        let Some(wild) = &runtime.wild_item else {
            return Vec::new();
        };
        let duck = duck_by_id(ducks, self.player_id.as_str());
        let pressure = self.inventory_pressure();
        let danger = self.danger_of(duck);
        let mut candidates: Vec<AutoUseCandidate> = Vec::new();
        let item_id = wild.item_id;
        let item_key = ItemKey::from(item_id);
        let use_key = format!("wild:{}", wild.instance_id);
        let discard_key = format!("wild:{}:discard", wild.instance_id);
        let wild_candidate = |ctx: &Self,
                              key: &String,
                              action: CandidateAction,
                              score: f64,
                              reason: AutoUseReason| {
            let mut candidate = ctx.candidate(
                key.clone(),
                item_key,
                CandidateSource::Wild,
                action,
                score,
                reason,
            );
            candidate.wild_item_instance_id = Some(wild.instance_id.clone());
            candidate
        };

        if item_id == WildItemId::MiniRocket {
            if let Some(best) = self.rocket_targets(CandidateSource::Wild, None) {
                let mut candidate = wild_candidate(
                    self,
                    &use_key,
                    CandidateAction::Use,
                    best.score + danger * 0.2 + pressure * 0.35,
                    if pressure > 0.0 {
                        AutoUseReason::InventoryPressure
                    } else {
                        AutoUseReason::Objective
                    },
                );
                candidate.target_player_id = Some(best.target_id);
                candidate.intent = best.intent;
                candidates.push(candidate);
            } else if duck.progress >= pickup_balance::auto_use::FORCE_BURN_PROGRESS
                || pressure >= 20.0
                || duck.current_rank == 1
            {
                let mut candidate = wild_candidate(
                    self,
                    &use_key,
                    CandidateAction::Discard,
                    65.0 + pressure,
                    AutoUseReason::Discard,
                );
                candidate.bypass_threshold = Some(true);
                candidates.push(candidate);
            }
        }

        if item_id == WildItemId::Banana {
            let mut score = end_game_burn_score(duck.progress, CandidateSource::Wild);
            let mut best_intersection = 0.0;
            let teammate_at_risk;
            let mut aim: Option<BananaAimPlan> = None;
            if self.brain_of().is_some() {
                use pickup_balance::banana as b;
                let banana_slow = ((1.0 - b::STAGGER_MULTIPLIER) * b::STAGGER_DURATION_SECONDS
                    + (1.0 - b::RECOVERY_SLOW_MULTIPLIER) * b::RECOVERY_DURATION_SECONDS)
                    * base_speed();
                let plan = self.plan_banana_aim(
                    duck,
                    b::AIM_MAX_OFFSET,
                    b::DROP_BEHIND_PROGRESS,
                    b::HIT_LATERAL_RADIUS,
                    banana_slow,
                );
                best_intersection = plan.intersection;
                teammate_at_risk = plan.teammate_at_risk;
                aim = Some(plan);
            } else {
                for target in active_ducks(ducks) {
                    if target.player_id == duck.player_id
                        || self
                            .objective
                            .is_teammate(duck.player_id.as_str(), target.player_id.as_str())
                        || self.is_ghost(target.player_id.as_str())
                    {
                        continue;
                    }
                    if target.progress >= duck.progress {
                        continue;
                    }
                    best_intersection = js_max(
                        best_intersection,
                        banana_intersection_score(
                            duck,
                            target,
                            auto_use_config::BANANA_PREDICTION_HORIZON_SECONDS,
                        ),
                    );
                }
                teammate_at_risk =
                    self.teammate_behind_at_risk(duck, pickup_balance::banana::HIT_LATERAL_RADIUS);
            }

            if !teammate_at_risk
                && (best_intersection > 0.0
                    || duck.progress >= auto_use_config::PROGRESS_LATE
                    || danger > 45.0)
            {
                score += best_intersection * 0.4 + pressure * 0.35;
                if danger > 45.0 {
                    score += 15.0;
                }
                if duck.progress >= auto_use_config::PROGRESS_LATE {
                    score += 12.0;
                }
                if score >= 30.0 {
                    let mut candidate = wild_candidate(
                        self,
                        &use_key,
                        CandidateAction::Use,
                        score,
                        if pressure > 0.0 {
                            AutoUseReason::InventoryPressure
                        } else {
                            AutoUseReason::Opportunity
                        },
                    );
                    candidate.aim_lateral = aim.as_ref().map(|plan| plan.aim_lateral);
                    candidate.intent = if aim.as_ref().is_some_and(|plan| plan.target_id.is_some())
                        && best_intersection >= 50.0
                    {
                        Some(AiIntent::TrapSet)
                    } else {
                        None
                    };
                    candidates.push(candidate);
                }
            } else if teammate_at_risk
                && (pressure >= 20.0
                    || duck.progress >= pickup_balance::auto_use::FORCE_BURN_PROGRESS)
            {
                let mut candidate = wild_candidate(
                    self,
                    &discard_key,
                    CandidateAction::Discard,
                    60.0 + pressure,
                    AutoUseReason::Discard,
                );
                candidate.bypass_threshold = Some(true);
                candidates.push(candidate);
            }
        }

        if item_id == WildItemId::MiniBubble {
            let mut score = 0.0;
            let incoming = item_state
                .rockets
                .iter()
                .any(|rocket| rocket.target_player_id == duck.player_id);
            if incoming {
                score += 80.0;
            }
            if danger > 60.0 && duck.progress >= auto_use_config::PROGRESS_LATE {
                score += 25.0;
            }
            score += pressure * 0.4;
            if score >= 35.0 {
                candidates.push(wild_candidate(
                    self,
                    &use_key,
                    CandidateAction::Use,
                    score,
                    if incoming {
                        AutoUseReason::ReactiveDefense
                    } else {
                        AutoUseReason::InventoryPressure
                    },
                ));
            }
        }

        if item_id == WildItemId::Feather {
            let mut score = end_game_burn_score(duck.progress, CandidateSource::Wild);
            let hazard_soon = self.hazards.iter().any(|hazard| {
                hazard.progress > duck.progress
                    && hazard.progress - duck.progress < 0.035
                    && !id_set_has(&hazard.hit_player_ids, duck.player_id.as_str())
            });
            let banana_soon = item_state.bananas.iter().any(|banana| {
                banana.progress > duck.progress && banana.progress - duck.progress < 0.035
            });
            if hazard_soon || banana_soon {
                score += 70.0;
            }
            if danger > 45.0 {
                score += 20.0;
            }
            score += js_clamp(
                (f64::from(duck.current_rank)
                    / js_max(1.0, f64::from(self.objective.player_count)))
                    * 25.0,
                0.0,
                25.0,
            );
            score += pressure * 0.25;
            if duck.progress >= auto_use_config::PROGRESS_LATE {
                score += 10.0;
            }
            if score >= 35.0 {
                candidates.push(wild_candidate(
                    self,
                    &use_key,
                    CandidateAction::Use,
                    score,
                    AutoUseReason::Opportunity,
                ));
            }
        }

        if item_id == WildItemId::QuackHorn {
            use pickup_balance::horn as h;
            let reach = wild_horn_reach(duck.progress);
            let active = active_ducks(ducks);
            let has_brain = self.brain_of().is_some();
            let ghosts = self.ghost_player_ids;
            let sides: Vec<HornSide> = if has_brain {
                Vec::from([HornSide::Left, HornSide::Right])
            } else {
                Vec::from([default_horn_side(
                    duck,
                    &active,
                    reach.progress_radius,
                    reach.side_reach,
                    reach.center_band,
                    |target: &&DuckPhysicsState| id_set_has(ghosts, target.player_id.as_str()),
                )])
            };
            let mut best: Option<HornPlan> = None;
            let mut teammate_blocked = false;
            for side in sides {
                let mut net_value = 0.0;
                let mut targets_count = 0_u32;
                let mut has_teammate_in_radius = false;
                let mut shove = false;
                let targets = horn_side_targets(
                    duck,
                    &active,
                    side,
                    reach.progress_radius,
                    reach.side_reach,
                    reach.center_band,
                    |target: &&DuckPhysicsState| id_set_has(ghosts, target.player_id.as_str()),
                );
                for index in targets {
                    let target = active[index];
                    if self
                        .objective
                        .is_teammate(duck.player_id.as_str(), target.player_id.as_str())
                    {
                        has_teammate_in_radius = true;
                        break;
                    }
                    let target_runtime = item_state.runtime(target.player_id.as_str());
                    if (target_runtime.bubble_available
                        && tick_i < target_runtime.bubble_until_tick)
                        || (target_runtime.wild_bubble_available
                            && tick_i < target_runtime.wild_bubble_until_tick)
                    {
                        net_value -= 8.0;
                        continue;
                    }
                    targets_count += 1;
                    let impact = h::LATERAL_PUSH;
                    net_value += if target.current_rank < duck.current_rank {
                        impact * 18.0
                    } else {
                        impact * 8.0
                    };
                    let drop = self.estimate_drop(target, 0.005);
                    let chaos = self.chaos_target_value(target.player_id.as_str(), drop, 0.0);
                    net_value += js_clamp(chaos * 0.15, -4.0, 6.0);
                    net_value += self.social_target_bonus(&target.player_id).0 * 0.2;
                    if self.brain_of().is_some()
                        && self.shoves_into_trap(
                            target,
                            side,
                            h::LATERAL_SHOVE + h::LATERAL_PUSH * 0.25,
                        )
                    {
                        net_value += auto_use_config::brain::SHOVE_INTO_TRAP_VALUE;
                        shove = true;
                    }
                    if tick_i < target_runtime.boost_until_tick
                        && target_runtime.boost_multiplier > 1.0
                        && target_runtime.active_speed_item_id != Some(RaceItemId::Nitro)
                    {
                        net_value += 16.0;
                    }
                    if target_runtime.draft_slipstream_ticks > 10 {
                        net_value += 10.0;
                    }
                }
                if has_teammate_in_radius {
                    teammate_blocked = true;
                    continue;
                }
                if targets_count == 0 {
                    continue;
                }
                if targets_count >= 2 {
                    net_value += 10.0 * (f64::from(targets_count) - 1.0);
                }
                if best.as_ref().is_none_or(|best| net_value > best.net_value) {
                    best = Some(HornPlan {
                        side,
                        net_value,
                        intent: None,
                        shove,
                    });
                }
            }

            match best {
                Some(best) if best.net_value + pressure * 0.1 >= 8.0 => {
                    let mut candidate = wild_candidate(
                        self,
                        &use_key,
                        CandidateAction::Use,
                        js_clamp(best.net_value, 0.0, 100.0)
                            + end_game_burn_score(duck.progress, CandidateSource::Wild)
                            + pressure * 0.1,
                        AutoUseReason::Opportunity,
                    );
                    candidate.horn_side = has_brain.then_some(best.side);
                    candidate.intent = best.shove.then_some(AiIntent::Shove);
                    candidates.push(candidate);
                }
                None if teammate_blocked
                    && (pressure >= 20.0
                        || duck.progress >= pickup_balance::auto_use::FORCE_BURN_PROGRESS) =>
                {
                    let mut candidate = wild_candidate(
                        self,
                        &discard_key,
                        CandidateAction::Discard,
                        60.0 + pressure,
                        AutoUseReason::Discard,
                    );
                    candidate.bypass_threshold = Some(true);
                    candidates.push(candidate);
                }
                _ => {}
            }
        }

        let mut max_score = f64::NEG_INFINITY;
        for candidate in &candidates {
            max_score = js_max(max_score, candidate.score);
        }
        if max_score < 0.0 && pressure >= 20.0 {
            candidates.push(wild_candidate(
                self,
                &discard_key,
                CandidateAction::Discard,
                pressure,
                AutoUseReason::Discard,
            ));
        }

        candidates
    }

    /// `holdCost(ctx, candidate)` (`evaluate.ts:1084-1094`).
    pub fn hold_cost(&mut self, item_id: ItemKey, source: CandidateSource) -> f64 {
        if source != CandidateSource::Prep {
            return 0.0;
        }
        let progress = self.me().progress;
        let traits = self.traits_of();
        let window = race_item(item_id).and_then(|item| traits.planned_window(item));
        let Some(window) = window else {
            return 0.0;
        };
        if progress >= window || self.is_desperate(progress) {
            return 0.0;
        }
        let earliness = js_min(
            1.0,
            (window - progress) / auto_use_config::brain::HOLD_RAMP_PROGRESS,
        );
        traits.patience
            * auto_use_config::brain::HOLD_COST_SCALE
            * earliness
            * (1.0 - self.loss_risk())
    }

    /// `brainScore(ctx, candidate)` (`evaluate.ts:1097-1109`).
    pub fn brain_score(&mut self, candidate: &AutoUseCandidate) -> f64 {
        if candidate.bypass_threshold == Some(true) || candidate.action == CandidateAction::Discard
        {
            return candidate.score;
        }
        let progress = self.me().progress;
        let traits = self.traits_of();
        let offensive = is_offensive_auto_item(candidate.item_id);
        let mut score = candidate.score;
        if offensive {
            score += (traits.aggression - 0.5) * auto_use_config::brain::AGGRESSION_SCALE;
        }
        if (offensive || is_speed_prep_item(candidate.item_id)) && self.in_duel() {
            score += traits.clutch * auto_use_config::brain::CLUTCH_DUEL_BONUS;
        }
        if self.is_desperate(progress) {
            score += auto_use_config::brain::DESPERATION_BONUS;
        }
        score - self.hold_cost(candidate.item_id, candidate.source)
    }

    /// `candidateIntent(ctx, candidate)` (`evaluate.ts:1112-1119`).
    pub fn candidate_intent(&mut self, candidate: &AutoUseCandidate) -> Option<AiIntent> {
        if candidate.intent.is_some() {
            return candidate.intent;
        }
        let duck = self.me();
        let (progress, rank) = (duck.progress, duck.current_rank);
        if self.in_duel() {
            return Some(AiIntent::Clutch);
        }
        if self.is_desperate(progress) {
            return Some(AiIntent::Desperate);
        }
        if is_speed_prep_item(candidate.item_id) && rank == 1 {
            return Some(AiIntent::Breakaway);
        }
        None
    }

    /// `decideReactiveAutoItemAction(ctx)` (`evaluate.ts:1070-1075`).
    pub fn decide_reactive_auto_item_action(&self) -> Option<AutoUseCandidate> {
        let mut reactive = self.evaluate_reactive_defense();
        if reactive.is_empty() {
            return None;
        }
        v8_sort_by(&mut reactive, |left, right| {
            cmp_f64_js(right.score, left.score)
                .then_with(|| id_cmp(&left.item_key, &right.item_key))
        });
        Some(reactive.swap_remove(0))
    }

    /// `decideOffensiveAutoItemAction(ctx)` (`evaluate.ts:1121-1141`).
    pub fn decide_offensive_auto_item_action(&mut self) -> Option<AutoUseCandidate> {
        let mut candidates = self.evaluate_prep_candidates();
        candidates.extend(self.evaluate_wild_candidates());
        if candidates.is_empty() {
            return None;
        }
        let threshold = self.dynamic_threshold();
        let mut scored: Vec<(AutoUseCandidate, f64)> = Vec::with_capacity(candidates.len());
        for candidate in candidates {
            let score = self.brain_score(&candidate);
            scored.push((candidate, score));
        }
        v8_sort_by(&mut scored, |left, right| {
            cmp_f64_js(right.1, left.1).then_with(|| id_cmp(&left.0.item_key, &right.0.item_key))
        });
        let (best, best_score) = &scored[0];
        if best.bypass_threshold == Some(true) || *best_score >= threshold {
            let mut chosen = best.clone();
            chosen.score = *best_score;
            return Some(chosen);
        }
        if self.brain_of().is_some() {
            let mut held: Option<ItemKey> = None;
            for (candidate, _) in &scored {
                if candidate.score >= threshold
                    && self.hold_cost(candidate.item_id, candidate.source) > 0.0
                {
                    held = Some(candidate.item_id);
                    break;
                }
            }
            if let Some(held) = held {
                let held = race_item(held).expect("only prep items have a hold cost");
                if let Some(brain) = self.brains.get_mut(self.player_id.as_str()) {
                    brain.held_item_id = Some(held);
                }
            }
        }
        None
    }

    /// `revalidatePendingAction(ctx, pending)` (`evaluate.ts:1147-1170`).
    pub fn revalidate_pending_action(&mut self, pending: &mut AutoUseCandidate) -> bool {
        if let Some(runtime) = self.item_state.by_player.get(self.player_id.as_str())
            && i64::from(self.tick) < runtime.silenced_until_tick
        {
            return false;
        }
        if is_offensive_auto_item(pending.item_id)
            && offensive_cooldown_blocks(
                self.item_state,
                self.player_id.as_str(),
                self.tick,
                self.tick_rate,
            )
        {
            return false;
        }
        if pending.bypass_threshold == Some(true) {
            return true;
        }
        let mut fresh_all = self.evaluate_prep_candidates();
        fresh_all.extend(self.evaluate_wild_candidates());
        let Some(fresh) = fresh_all.into_iter().find(|candidate| {
            candidate.item_key == pending.item_key && candidate.action == pending.action
        }) else {
            return false;
        };
        pending.aim_lateral = fresh.aim_lateral;
        pending.horn_side = fresh.horn_side;
        if matches!(pending.item_id, ItemKey::HomingRocket | ItemKey::MiniRocket) {
            let kind = if pending.item_id == ItemKey::HomingRocket {
                CandidateSource::Prep
            } else {
                CandidateSource::Wild
            };
            let preferred = pending.target_player_id.clone();
            let Some(resolved) = self.resolve_rocket_target(kind, preferred.as_ref()) else {
                return false;
            };
            if self
                .objective
                .is_teammate(self.player_id.as_str(), resolved.as_str())
            {
                return false;
            }
            pending.target_player_id = Some(resolved);
        }
        let threshold = self.dynamic_threshold();
        self.brain_score(&fresh) >= threshold * 0.85
    }
}

/// `incomingBananaThreat(input, duck)` (`arbiter.ts:209-216`) and the same
/// test inside `evaluateReactiveDefense` (`evaluate.ts:466-471`).
pub(crate) fn incoming_banana_threat(item_state: &ItemRaceState, duck: &DuckPhysicsState) -> bool {
    item_state.bananas.iter().any(|banana| {
        if banana.source_player_id == duck.player_id {
            return false;
        }
        let eta_progress = js_max(0.0, banana.progress - duck.progress);
        (0.0..0.035).contains(&eta_progress)
            && abs(predict_lateral(duck, 0.45) - banana.lateral_offset)
                <= banana.hit_lateral_radius * 1.2
    })
}

/// `target.progress < trap && trap - target.progress <= 0.12` (`planBananaAim`).
fn in_trap_window(trap: f64, progress: f64) -> bool {
    progress < trap && trap - progress <= 0.12
}

/// `offensiveCooldownBlocks(ctx, playerId)` (`evaluate.ts:452-457`).
#[must_use]
pub fn offensive_cooldown_blocks(
    item_state: &ItemRaceState,
    player_id: &str,
    tick: u32,
    tick_rate: u32,
) -> bool {
    let runtime = item_state.runtime(player_id);
    if runtime.last_offensive_use_tick <= 0 {
        return false;
    }
    let cooldown = js_round(auto_use_config::COOLDOWN_MIN_SECONDS * f64::from(tick_rate));
    f64::from(tick) < ticks_f64(runtime.last_offensive_use_tick) + cooldown
}
