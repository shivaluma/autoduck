//! The auto-use arbiter: `tickAutoUseExecute` / `tickAutoUseDecide`
//! (`packages/race-core/src/auto-use/arbiter.ts`, S3.15).
//!
//! RNG streams carry the race id (Phase A):
//! `auto-use-delay:<raceId>:<playerId>:<tick>` and
//! `auto-use-cooldown:<raceId>:<playerId>:<tick>`. Ducks are visited in
//! `localeCompare` order (`sortedDucks`). `readRace` is
//! [`super::director::read_race`] with `Simulation::director` as its memo.
//! Every event emitted while an auto-used wild item activates gets
//! `autoReason` appended (`auto-use/execute.ts:256`, see
//! `pickups::with_auto_reason`).

use alloc::format;
use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{AiIntent, AiIntentMeta, AutoUseReason, EventKind};
use race_protocol::ids::{ItemKey, PlayerId, WildItemId};

use super::config::auto_use_config;
use super::director::DirectorCache;
use super::evaluate::{
    EvalCtx, incoming_banana_threat, is_offensive_auto_item, offensive_cooldown_blocks,
};
use super::execute::{ExecuteEnv, RocketExecuteMeta, execute_auto_item_action};
use super::note_neighbours;
use super::objective::RaceObjectiveContext;
use super::types::AutoUseCandidate;
use crate::items::ItemRaceState;
use crate::js_sort::v8_sort_by;
use crate::math::{cmp_f64_js, js_max, js_round};
use crate::pickups::PickupRaceState;
use crate::rng::create_race_rng;
use crate::sim::{DuckPhysicsState, Emitter, id_cmp};
use crate::track::RaceTrack;
use race_protocol::ids::RaceItemId;

/// `AutoUseTickInput` (`arbiter.ts:61-73`). `emitItem` and `emitPickup` are
/// the same `emitEvent` wrapper in TS, so one [`Emitter`] serves both; the
/// duck brains are `emit.brains`.
pub struct AutoUseTickInput<'a, 'e> {
    pub config: &'a ResolvedRaceConfig,
    pub track: &'a RaceTrack,
    pub item_state: &'a mut ItemRaceState,
    pub pickup_state: &'a mut PickupRaceState,
    pub ducks: &'a mut [DuckPhysicsState],
    pub tick: u32,
    pub tick_rate: u32,
    /// Always `true` in the engine (`simulation.ts:528`).
    pub prep_auto_use_enabled: bool,
    /// `pickupConfig.enabled && pickupConfig.autoItemsEnabled`.
    pub wild_auto_use_enabled: bool,
    /// The `readRace` memo for `state.ducks`.
    pub director: &'a mut DirectorCache,
    pub emit: &'a mut Emitter<'e>,
}

/// `secondsUntilNextPickupZone(duck, track)` (`arbiter.ts:24-31`).
fn seconds_until_next_pickup_zone(progress: f64, track: &RaceTrack) -> f64 {
    let mut centers: Vec<f64> = track
        .pickup_zones
        .iter()
        .map(|zone| (zone.start_progress + zone.end_progress) / 2.0)
        .filter(|&center| center > progress + 0.001)
        .collect();
    v8_sort_by(&mut centers, |left, right| cmp_f64_js(*left, *right));
    match centers.first() {
        None => 999.0,
        Some(&upcoming) => js_max(0.0, (upcoming - progress) * 60.0),
    }
}

/// `reactionDelayTicks(config, playerId, tick, tickRate, reactionScale)`
/// (`arbiter.ts:33-36`).
fn reaction_delay_ticks(
    config: &ResolvedRaceConfig,
    player_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
    reaction_scale: f64,
) -> f64 {
    let mut rng = create_race_rng(
        config.seed.as_str(),
        &format!("auto-use-delay:{}:{player_id}:{tick}", config.race_id),
    );
    js_round(
        rng.range(
            auto_use_config::REACTION_DELAY_MIN_SECONDS,
            auto_use_config::REACTION_DELAY_MAX_SECONDS,
        ) * reaction_scale
            * f64::from(tick_rate),
    )
}

/// `cooldownTicks(config, playerId, tick, tickRate)` (`arbiter.ts:52-55`).
fn cooldown_ticks(
    config: &ResolvedRaceConfig,
    player_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
) -> f64 {
    let mut rng = create_race_rng(
        config.seed.as_str(),
        &format!("auto-use-cooldown:{}:{player_id}:{tick}", config.race_id),
    );
    js_round(
        rng.range(
            auto_use_config::COOLDOWN_MIN_SECONDS,
            auto_use_config::COOLDOWN_MAX_SECONDS,
        ) * f64::from(tick_rate),
    )
}

/// `reactiveMinVisibleTicks(tickRate)` (`arbiter.ts:57-59`).
fn reactive_min_visible_ticks(tick_rate: u32) -> f64 {
    js_round(auto_use_config::REACTIVE_THREAT_MIN_VISIBLE_SECONDS * f64::from(tick_rate))
}

/// An integral tick computed in `f64` as the runtime's `i64`.
#[allow(clippy::cast_possible_truncation)]
fn tick_i64(value: f64) -> i64 {
    assert!(
        value.is_finite() && value.abs() < 9.0e15,
        "tick out of range"
    );
    value as i64
}

#[allow(clippy::cast_precision_loss)]
fn tick_f(value: i64) -> f64 {
    value as f64
}

impl AutoUseTickInput<'_, '_> {
    /// `announceIntent(input, playerId, intent, itemId, targetPlayerId, force)`
    /// (`arbiter.ts:39-50`).
    fn announce_intent(
        &mut self,
        player_id: &PlayerId,
        intent: AiIntent,
        item_id: ItemKey,
        target_player_id: Option<PlayerId>,
        force: bool,
    ) {
        let tick = f64::from(self.tick);
        let Some(brain) = self.emit.brains.get_mut(player_id.as_str()) else {
            return;
        };
        let same = brain.intent == Some(intent)
            && brain.intent_target_id == target_player_id
            && brain.intent_item_id == Some(item_id);
        if same {
            return;
        }
        if !force && tick - brain.last_intent_tick < auto_use_config::brain::INTENT_COOLDOWN_TICKS {
            return;
        }
        brain.intent = Some(intent);
        brain.intent_target_id.clone_from(&target_player_id);
        brain.intent_item_id = Some(item_id);
        brain.last_intent_tick = tick;
        let temperament = brain.temperament;
        self.emit.emit(
            EventKind::AiIntent(AiIntentMeta {
                intent,
                item_id,
                temperament,
            }),
            Some(player_id),
            target_player_id.as_ref(),
        );
    }

    /// `finishAction(input, playerId, offensive)` (`arbiter.ts:75-80`).
    fn finish_action(&mut self, player_id: &PlayerId, offensive: bool) {
        let tick = self.tick;
        let cooldown = cooldown_ticks(self.config, player_id, tick, self.tick_rate);
        let runtime = self.item_state.runtime_mut(player_id.as_str());
        runtime.last_item_use_tick = i64::from(tick);
        if offensive {
            runtime.last_offensive_use_tick = i64::from(tick);
        }
        runtime.next_auto_action_tick = tick_i64(f64::from(tick) + cooldown);
    }

    /// `buildEvalContext(input, duck, objective)` (`arbiter.ts:82-96`) for
    /// the duck at `index`.
    fn eval_ctx<'c>(
        &'c mut self,
        player_id: &'c PlayerId,
        seconds: f64,
        objective: &'c mut RaceObjectiveContext,
    ) -> EvalCtx<'c> {
        EvalCtx {
            tick: self.tick,
            tick_rate: self.tick_rate,
            objective,
            item_state: &*self.item_state,
            hazards: &self.pickup_state.hazards,
            ducks: &*self.ducks,
            player_id,
            seconds_until_next_pickup_zone: seconds,
            prep_auto_use_enabled: self.prep_auto_use_enabled,
            wild_auto_use_enabled: self.wild_auto_use_enabled,
            ghost_player_ids: &self.item_state.ghost_player_ids,
            brains: &mut *self.emit.brains,
            director: &mut *self.director,
            math: self.emit.math,
        }
    }

    fn seconds_for(&self, index: usize) -> f64 {
        seconds_until_next_pickup_zone(self.ducks[index].progress, self.track)
    }

    /// `queueDecision(input, duck, decision)` (`arbiter.ts:98-104`).
    fn queue_decision(&mut self, player_id: &PlayerId, decision: AutoUseCandidate) {
        let reaction_scale = self
            .emit
            .brains
            .get(player_id.as_str())
            .filter(|brain| !brain.ablated)
            .map_or(1.0, |brain| brain.traits.reaction_scale);
        let delay = reaction_delay_ticks(
            self.config,
            player_id,
            self.tick,
            self.tick_rate,
            reaction_scale,
        );
        let tick = self.tick;
        let runtime = self.item_state.runtime_mut(player_id.as_str());
        runtime.pending_auto_action = Some(decision);
        runtime.pending_auto_action_execute_tick = tick_i64(f64::from(tick) + delay);
    }

    /// `processPendingAction(input, duck, evalCtx)` (`arbiter.ts:106-142`).
    fn process_pending_action(
        &mut self,
        player_id: &PlayerId,
        seconds: f64,
        objective: &mut RaceObjectiveContext,
    ) -> bool {
        let tick_i = i64::from(self.tick);
        {
            let runtime = self.item_state.runtime(player_id.as_str());
            if runtime.pending_auto_action.is_none()
                || tick_i < runtime.pending_auto_action_execute_tick
            {
                return false;
            }
        }
        let runtime = self.item_state.runtime_mut(player_id.as_str());
        let mut pending = runtime.pending_auto_action.take().expect("checked above");
        runtime.pending_auto_action_execute_tick = 0;

        let decision_target_id = pending.target_player_id.clone();
        if !self
            .eval_ctx(player_id, seconds, objective)
            .revalidate_pending_action(&mut pending)
        {
            return true;
        }

        let execute_metadata =
            matches!(pending.item_id, ItemKey::HomingRocket | ItemKey::MiniRocket).then(|| {
                RocketExecuteMeta {
                    decision_target_id: decision_target_id.clone(),
                    execute_target_id: pending.target_player_id.clone(),
                    retargeted_at_execute: decision_target_id.is_some()
                        && decision_target_id != pending.target_player_id,
                }
            });

        let executed = execute_auto_item_action(
            &mut pending,
            self.item_state,
            self.ducks,
            self.tick,
            self.tick_rate,
            self.emit,
            execute_metadata,
            &mut ExecuteEnv {
                config: self.config,
                director: self.director,
            },
        );
        if executed {
            self.finish_action(player_id, is_offensive_auto_item(pending.item_id));
            if let Some(brain) = self.emit.brains.get_mut(player_id.as_str())
                && brain.held_item_id.map(ItemKey::from) == Some(pending.item_id)
            {
                brain.held_item_id = None;
            }
            let intent = if pending.reason == AutoUseReason::ReactiveDefense {
                None
            } else {
                self.eval_ctx(player_id, seconds, objective)
                    .candidate_intent(&pending)
            };
            if let Some(intent) = intent {
                self.announce_intent(
                    player_id,
                    intent,
                    pending.item_id,
                    pending.target_player_id.clone(),
                    true,
                );
            }
        }
        true
    }

    /// `processDuckExecute(input, duck, objective)` (`arbiter.ts:144-160`).
    fn process_duck_execute(&mut self, index: usize, objective: &mut RaceObjectiveContext) {
        if self.ducks[index].finished {
            return;
        }
        if !self.prep_auto_use_enabled && !self.wild_auto_use_enabled {
            return;
        }
        let player_id = self.ducks[index].player_id.clone();
        let seconds = self.seconds_for(index);

        self.update_reactive_threat_visibility(index);

        if self.process_pending_action(&player_id, seconds, objective) {
            return;
        }
        {
            let runtime = self.item_state.runtime(player_id.as_str());
            if runtime.pending_auto_action.is_some()
                || i64::from(self.tick) < runtime.next_auto_action_tick
            {
                return;
            }
        }
        if offensive_cooldown_blocks(
            self.item_state,
            player_id.as_str(),
            self.tick,
            self.tick_rate,
        ) {
            return;
        }

        let reactive = self
            .eval_ctx(&player_id, seconds, objective)
            .decide_reactive_auto_item_action();
        let Some(reactive) = reactive else {
            return;
        };
        if !self.reactive_threat_ready(index) {
            return;
        }
        self.queue_decision(&player_id, reactive);
    }

    /// `processDuckDecide(input, duck, objective)` (`arbiter.ts:162-183`).
    fn process_duck_decide(&mut self, index: usize, objective: &mut RaceObjectiveContext) {
        if self.ducks[index].finished {
            return;
        }
        if !self.prep_auto_use_enabled && !self.wild_auto_use_enabled {
            return;
        }
        let player_id = self.ducks[index].player_id.clone();
        let tick_i = i64::from(self.tick);
        {
            let runtime = self.item_state.runtime(player_id.as_str());
            if runtime.pending_auto_action.is_some() || tick_i < runtime.next_auto_action_tick {
                return;
            }
        }
        // `buildEvalContext` is pure; `offensiveCooldownBlocks` reads the item state.
        if offensive_cooldown_blocks(
            self.item_state,
            player_id.as_str(),
            self.tick,
            self.tick_rate,
        ) {
            return;
        }

        let on_decision_tick = tick_i
            >= self
                .item_state
                .runtime(player_id.as_str())
                .next_auto_decision_tick;
        let seconds = self.seconds_for(index);
        if on_decision_tick && let Some(brain) = self.emit.brains.get_mut(player_id.as_str()) {
            note_neighbours(brain, self.ducks, self.ducks[index].progress);
        }
        let decision = self
            .eval_ctx(&player_id, seconds, objective)
            .decide_offensive_auto_item_action();
        let Some(decision) = decision else {
            if on_decision_tick {
                self.item_state
                    .runtime_mut(player_id.as_str())
                    .next_auto_decision_tick = tick_i + auto_use_config::DECISION_INTERVAL_TICKS;
            }
            let held = self.emit.brains.get(player_id.as_str()).and_then(|brain| {
                let held = brain.held_item_id.map(ItemKey::from)?;
                (brain.intent_item_id != Some(held)).then_some(held)
            });
            if let Some(held) = held {
                self.announce_intent(&player_id, AiIntent::Holding, held, None, false);
            }
            return;
        };

        if on_decision_tick {
            self.item_state
                .runtime_mut(player_id.as_str())
                .next_auto_decision_tick = tick_i + auto_use_config::DECISION_INTERVAL_TICKS;
        }
        self.queue_decision(&player_id, decision);
    }

    /// `updateReactiveThreatVisibility(input, duck)` (`arbiter.ts:218-235`).
    fn update_reactive_threat_visibility(&mut self, index: usize) {
        let duck = &self.ducks[index];
        let rocket_visible = self
            .item_state
            .rockets
            .iter()
            .any(|rocket| rocket.target_player_id == duck.player_id);
        let banana_visible = incoming_banana_threat(self.item_state, duck);
        let tick_i = i64::from(self.tick);
        let runtime = self.item_state.runtime_mut(duck.player_id.as_str());
        if rocket_visible {
            if runtime.reactive_rocket_visible_since_tick.is_none() {
                runtime.reactive_rocket_visible_since_tick = Some(tick_i);
            }
        } else {
            runtime.reactive_rocket_visible_since_tick = None;
        }
        if banana_visible {
            if runtime.reactive_banana_visible_since_tick.is_none() {
                runtime.reactive_banana_visible_since_tick = Some(tick_i);
            }
        } else {
            runtime.reactive_banana_visible_since_tick = None;
        }
    }

    /// `reactiveThreatReady(input, duck)` (`arbiter.ts:237-266`).
    fn reactive_threat_ready(&self, index: usize) -> bool {
        let duck = &self.ducks[index];
        let runtime = self.item_state.runtime(duck.player_id.as_str());
        let min_visible = reactive_min_visible_ticks(self.tick_rate);
        let tick = f64::from(self.tick);
        let incoming_rocket = self
            .item_state
            .rockets
            .iter()
            .any(|rocket| rocket.target_player_id == duck.player_id);
        let incoming_banana = incoming_banana_threat(self.item_state, duck);
        let seen_for =
            |since: Option<i64>| since.is_some_and(|since| tick - tick_f(since) >= min_visible);

        if self.prep_auto_use_enabled
            && runtime.item_ids.contains(&RaceItemId::BubbleShield)
            && !runtime.used(RaceItemId::BubbleShield)
            && !runtime.bubble_available
        {
            if incoming_rocket && seen_for(runtime.reactive_rocket_visible_since_tick) {
                return true;
            }
            if incoming_banana && seen_for(runtime.reactive_banana_visible_since_tick) {
                return true;
            }
        }

        if self.wild_auto_use_enabled
            && let Some(wild) = &runtime.wild_item
        {
            if incoming_rocket && wild.item_id == WildItemId::MiniBubble {
                return seen_for(runtime.reactive_rocket_visible_since_tick);
            }
            if wild.item_id == WildItemId::Feather && incoming_banana {
                return seen_for(runtime.reactive_banana_visible_since_tick);
            }
        }
        false
    }

    /// `hasReactiveThreat(input, duck)` (`arbiter.ts:268-272`).
    fn has_reactive_threat(&mut self, index: usize) -> bool {
        if !self.prep_auto_use_enabled && !self.wild_auto_use_enabled {
            return false;
        }
        self.update_reactive_threat_visibility(index);
        self.reactive_threat_ready(index)
    }

    /// `duckNeedsExecute(input, duck)` (`arbiter.ts:274-282`).
    fn duck_needs_execute(&mut self, index: usize) -> bool {
        if self.ducks[index].finished
            || (!self.prep_auto_use_enabled && !self.wild_auto_use_enabled)
        {
            return false;
        }
        let tick_i = i64::from(self.tick);
        let runtime = self
            .item_state
            .runtime(self.ducks[index].player_id.as_str());
        if tick_i < runtime.silenced_until_tick {
            return false;
        }
        if runtime.pending_auto_action.is_some()
            && tick_i >= runtime.pending_auto_action_execute_tick
        {
            return true;
        }
        if runtime.pending_auto_action.is_some() || tick_i < runtime.next_auto_action_tick {
            return false;
        }
        self.has_reactive_threat(index)
    }

    /// `duckNeedsDecide(input, duck)` (`arbiter.ts:284-291`).
    fn duck_needs_decide(&self, index: usize) -> bool {
        if self.ducks[index].finished
            || (!self.prep_auto_use_enabled && !self.wild_auto_use_enabled)
        {
            return false;
        }
        let tick_i = i64::from(self.tick);
        let runtime = self
            .item_state
            .runtime(self.ducks[index].player_id.as_str());
        if tick_i < runtime.silenced_until_tick {
            return false;
        }
        if runtime.pending_auto_action.is_some() || tick_i < runtime.next_auto_action_tick {
            return false;
        }
        tick_i >= runtime.next_auto_decision_tick
    }

    /// `sortedDucks(input.ducks)`: indices in `localeCompare` order.
    fn sorted_ducks(&self) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.ducks.len()).collect();
        v8_sort_by(&mut order, |&left, &right| {
            id_cmp(
                self.ducks[left].player_id.as_str(),
                self.ducks[right].player_id.as_str(),
            )
        });
        order
    }
}

/// `tickAutoUseExecute(input, objective)` (`arbiter.ts:293-298`).
pub fn tick_auto_use_execute(
    input: &mut AutoUseTickInput<'_, '_>,
    objective: &mut RaceObjectiveContext,
) {
    let ducks = input.sorted_ducks();
    let mut active = Vec::new();
    for index in ducks {
        if input.duck_needs_execute(index) {
            active.push(index);
        }
    }
    if active.is_empty() {
        return;
    }
    for index in active {
        input.process_duck_execute(index, objective);
    }
}

/// `tickAutoUseDecide(input, objective)` (`arbiter.ts:300-306`).
pub fn tick_auto_use_decide(
    input: &mut AutoUseTickInput<'_, '_>,
    objective: &mut RaceObjectiveContext,
) {
    let ducks = input.sorted_ducks();
    if !ducks.iter().any(|&index| input.duck_needs_decide(index)) {
        return;
    }
    for index in ducks {
        if input.duck_needs_decide(index) {
            input.process_duck_decide(index, objective);
        }
    }
}
