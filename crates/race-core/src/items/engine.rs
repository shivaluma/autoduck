//! The parts of `packages/race-core/src/items/engine.ts` the core step needs
//! even without loadouts: state creation, boosts and slows, the per-tick item
//! maintenance (`tickItemSystem`), `itemSpeedMultiplier`,
//! `itemActiveEffects` and `snapshotItemWorld`. Boost gates use the same
//! boost runtime as prep items, so these are exact ports, not stubs.
//!
//! M2 adds the item actions the auto-use executor and the box items call:
//! `breakActiveSpeedBoost`, `grantMomentumSteal`, `tryActivateBubbleShield`,
//! `armBubbleReflex`, `triggerMenacePredatorRush`, `tryApplyPrepSpeedBoost`,
//! `slipstreamReady` and `firePrepRocket`. Projectiles in flight
//! (`updateRockets` / `updateBananas`) are in [`super::projectiles`].

use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{
    AutoUseReason, BoostBreakSource, BoostBrokenMeta, BubbleShieldActivatedMeta, EventKind,
    GuardDefenseItem, GuardSurgeMeta, IncomingAttack, MomentumStolenMeta, PredatorRushStartedMeta,
    PredatorRushTrigger, ReflexThreat, RocketFiredMeta, SpeedBoostEndedMeta, SpeedBoostQueuedMeta,
    SpeedBoostStartedMeta,
};
use race_protocol::ids::{PlayerId, RaceItemId};
use race_protocol::snapshot::{ActiveEffect, BananaSnapshot, ProjectileKind, RocketSnapshot};

use super::classes::{LoadoutCombo, loadout_combo_label};
use super::config::item_balance;
use super::projectiles::{update_bananas, update_rockets};
use super::state::{
    DuckItemRuntime, ItemRaceState, ProjectileSource, QueuedSpeedBoost, RocketRuntime,
};
use crate::ghost::ghost_player_ids_from_config;
use crate::js_sort::v8_sort_by;
use crate::math::{cmp_f64_js, js_max, js_min, js_round};
use crate::sim::{DuckPhysicsState, Emitter, IdMap, id_cmp, id_set_has};

/// `Math.round(seconds * tickRate)` as a tick count.
#[must_use]
pub fn seconds_to_ticks(seconds: f64, tick_rate: u32) -> i64 {
    let rounded = js_round(seconds * f64::from(tick_rate));
    assert!(
        rounded.is_finite() && rounded.abs() < 9.0e15,
        "tick count out of range"
    );
    // Integral and well inside i64 (checked above).
    #[allow(clippy::cast_possible_truncation)]
    let ticks = rounded as i64;
    ticks
}

/// A runtime tick (`i64`) as the `u32` an event carries.
///
/// # Panics
/// If the tick is negative or above `u32::MAX` (TS ticks are neither).
#[must_use]
pub fn tick_u32(tick: i64) -> u32 {
    u32::try_from(tick).expect("event tick fits in u32")
}

/// `createItemRaceState(config)` (`items/engine.ts:120-184`), without
/// `brains` (see `crate::auto_use::create_duck_brains`).
#[must_use]
pub fn create_item_race_state(config: &ResolvedRaceConfig) -> ItemRaceState {
    let mut teammates_by_player: IdMap<Vec<PlayerId>> = IdMap::new();
    for group in &config.chaos_config.groups {
        for player_id in group {
            let mut mates: Vec<PlayerId> = Vec::new();
            for member in group {
                if member != player_id && !mates.contains(member) {
                    mates.push(member.clone());
                }
            }
            teammates_by_player.insert(player_id.clone(), mates);
        }
    }
    let by_player = config
        .players
        .iter()
        .map(|player| {
            // `new Map(config.loadouts.map(...))`: the last loadout of a player wins.
            let item_ids: Vec<RaceItemId> = config
                .loadouts
                .iter()
                .rev()
                .find(|loadout| loadout.player_id == player.player_id)
                .map(|loadout| loadout.item_ids.clone())
                .unwrap_or_default();
            let runtime = DuckItemRuntime {
                loadout_combo: loadout_combo_label(&item_ids),
                used_items: Vec::new(),
                bubble_available: false,
                bubble_until_tick: 0,
                silenced_until_tick: 0,
                silence_immune_until_tick: 0,
                feather_available: item_ids.contains(&RaceItemId::Feather),
                shock_absorber_available: item_ids.contains(&RaceItemId::ShockAbsorber),
                item_immunity_until_tick: 0,
                rocket_protection_until_tick: 0,
                slow_multiplier: 1.0,
                slow_until_tick: 0,
                recovery_slow_multiplier: None,
                recovery_slow_until_tick: None,
                boost_multiplier: 1.0,
                boost_until_tick: 0,
                wild_item: None,
                regular_pickup_count: 0,
                wild_bubble_available: false,
                wild_bubble_until_tick: 0,
                wild_feather_available: false,
                wild_feather_until_tick: 0,
                tailwind_until_tick: 0,
                magnet_until_tick: 0,
                last_item_use_tick: 0,
                next_auto_decision_tick: 0,
                next_auto_action_tick: 0,
                pending_auto_action: None,
                pending_auto_action_execute_tick: 0,
                last_offensive_use_tick: 0,
                draft_slipstream_ticks: 0,
                draft_target_player_id: None,
                active_speed_item_id: None,
                queued_speed_boost: None,
                boost_started_at_tick: 0,
                continuous_boost_started_at_tick: None,
                nitro_ignition_ticks: None,
                nitro_overdrive_ticks: None,
                nitro_decay_ticks: None,
                nitro_start_progress: None,
                nitro_start_rank: None,
                reactive_rocket_visible_since_tick: None,
                reactive_banana_visible_since_tick: None,
                queued_guard_surge_tick: None,
                queued_guard_surge_source: None,
                queued_guard_surge_blocked: None,
                speed_drained: false,
                item_ids,
            };
            (player.player_id.clone(), runtime)
        })
        .collect();
    ItemRaceState {
        by_player,
        rockets: Vec::new(),
        bananas: Vec::new(),
        next_object_id: 1,
        tuning: config.item_tuning.clone(),
        ghost_player_ids: ghost_player_ids_from_config(config),
        teammates_by_player,
    }
}

/// `applyStagedSlow` (`items/engine.ts:186-201`).
pub fn apply_staged_slow(
    runtime: &mut DuckItemRuntime,
    stagger_multiplier: f64,
    stagger_duration_seconds: f64,
    recovery_multiplier: f64,
    recovery_duration_seconds: f64,
    tick: u32,
    tick_rate: u32,
) {
    let stagger_ticks = seconds_to_ticks(stagger_duration_seconds, tick_rate);
    let recovery_ticks = seconds_to_ticks(recovery_duration_seconds, tick_rate);
    let tick = i64::from(tick);
    runtime.slow_multiplier = js_max(item_balance::MINIMUM_SPEED_MULTIPLIER, stagger_multiplier);
    runtime.slow_until_tick = tick + stagger_ticks;
    runtime.recovery_slow_multiplier = Some(js_max(
        item_balance::MINIMUM_SPEED_MULTIPLIER,
        recovery_multiplier,
    ));
    runtime.recovery_slow_until_tick = Some(tick + stagger_ticks + recovery_ticks);
}

/// `applyItemSlow` (`items/engine.ts:203-210`).
pub fn apply_item_slow(
    runtime: &mut DuckItemRuntime,
    multiplier: f64,
    duration_seconds: f64,
    tick: u32,
    tick_rate: u32,
) {
    let tick = i64::from(tick);
    if tick >= runtime.slow_until_tick || multiplier < runtime.slow_multiplier {
        runtime.slow_multiplier = js_max(item_balance::MINIMUM_SPEED_MULTIPLIER, multiplier);
        runtime.slow_until_tick = tick + seconds_to_ticks(duration_seconds, tick_rate);
        runtime.recovery_slow_multiplier = None;
        runtime.recovery_slow_until_tick = None;
    }
}

/// `applyItemBoost` (`items/engine.ts:212-222`). Boost gates call it too.
pub fn apply_item_boost(
    runtime: &mut DuckItemRuntime,
    multiplier: f64,
    duration_seconds: f64,
    tick: u32,
    tick_rate: u32,
) {
    let target_multiplier = js_min(item_balance::MAXIMUM_SPEED_MULTIPLIER, multiplier);
    let tick = i64::from(tick);
    let target_until_tick = tick + seconds_to_ticks(duration_seconds, tick_rate);
    if tick < runtime.boost_until_tick && runtime.boost_multiplier >= target_multiplier {
        runtime.boost_until_tick = runtime.boost_until_tick.max(target_until_tick);
        return;
    }
    runtime.boost_multiplier = target_multiplier;
    runtime.boost_started_at_tick = tick;
    runtime.boost_until_tick = target_until_tick;
}

/// `SPEED_START_EVENT[itemId]` (`items/engine.ts:224-228`).
#[must_use]
pub fn speed_start_event(item_id: RaceItemId, meta: SpeedBoostStartedMeta) -> Option<EventKind> {
    match item_id {
        RaceItemId::Nitro => Some(EventKind::NitroStarted(meta)),
        RaceItemId::DraftFin => Some(EventKind::DraftFinStarted(meta)),
        RaceItemId::PaddleBurst => Some(EventKind::PaddleBurstStarted(meta)),
        _ => None,
    }
}

/// `SPEED_END_EVENT[itemId]` (`items/engine.ts:230-234`).
#[must_use]
pub fn speed_end_event(item_id: RaceItemId, meta: SpeedBoostEndedMeta) -> Option<EventKind> {
    match item_id {
        RaceItemId::Nitro => Some(EventKind::NitroEnded(meta)),
        RaceItemId::DraftFin => Some(EventKind::DraftFinEnded(meta)),
        RaceItemId::PaddleBurst => Some(EventKind::PaddleBurstEnded(meta)),
        _ => None,
    }
}

/// `SPEED_BOOST_PRIORITY[itemId]` (`items/engine.ts:68-72`): `None` is the
/// TS `undefined` (every non-speed item).
#[must_use]
pub const fn speed_boost_priority(item_id: RaceItemId) -> Option<u32> {
    match item_id {
        RaceItemId::Nitro => Some(3),
        RaceItemId::DraftFin => Some(2),
        RaceItemId::PaddleBurst => Some(1),
        _ => None,
    }
}

/// `Math.round(x)` of a value that is always an integer-valued tick count
/// in range (`Math.round(remainingBoostTicks * breakRatio)`).
fn js_round_ticks(x: f64) -> i64 {
    let rounded = js_round(x);
    assert!(
        rounded.is_finite() && rounded.abs() < 9.0e15,
        "tick count out of range"
    );
    // Integral and well inside i64 (checked above).
    #[allow(clippy::cast_possible_truncation)]
    let ticks = rounded as i64;
    ticks
}

/// Resets the speed boost after a break (`items/engine.ts:262-267,283-288`).
fn clear_speed_boost(runtime: &mut DuckItemRuntime, tick: i64) {
    runtime.boost_multiplier = 1.0;
    runtime.boost_until_tick = tick;
    runtime.boost_started_at_tick = tick;
    runtime.active_speed_item_id = None;
    runtime.queued_speed_boost = None;
    runtime.continuous_boost_started_at_tick = None;
}

/// `breakActiveSpeedBoost(runtime, tick, tickRate, emit, sourcePlayerId,
/// targetPlayerId, breakSource)` (`items/engine.ts:236-300`).
///
/// `source_player_id` is the attacker and `target_player_id` the victim; the
/// events go out the other way round (source = victim, target = attacker),
/// as in TS. Returns the broken speed item (only on a full break).
///
/// Quirks kept: a partial break (`MINI_ROCKET` / `WILD_BANANA`) that happens
/// to end the boost still returns `null`; the broken `*_ENDED` event's
/// `consumedSeconds` is the *remaining* time.
#[allow(clippy::too_many_arguments)]
pub fn break_active_speed_boost(
    runtime: &mut DuckItemRuntime,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    source_player_id: &PlayerId,
    target_player_id: &PlayerId,
    break_source: BoostBreakSource,
) -> Option<RaceItemId> {
    let tick_i = i64::from(tick);
    if tick_i >= runtime.boost_until_tick || runtime.boost_multiplier <= 1.0 {
        return None;
    }
    // Wild horns cannot break Nitro; the prep Horn can (ATTACK > SPEED).
    if break_source == BoostBreakSource::WildHorn
        && runtime.active_speed_item_id == Some(RaceItemId::Nitro)
    {
        return None;
    }
    let ended = runtime.active_speed_item_id;
    let boost_multiplier = runtime.boost_multiplier;
    let remaining_boost_ticks = (runtime.boost_until_tick - tick_i).max(0);
    let original_boost_ticks = (runtime.boost_until_tick - runtime.boost_started_at_tick).max(1);

    if matches!(
        break_source,
        BoostBreakSource::MiniRocket | BoostBreakSource::WildBanana
    ) {
        let break_ratio = if break_source == BoostBreakSource::MiniRocket {
            0.50
        } else {
            0.30
        };
        let lost_ticks = js_round_ticks(ticks_f64(remaining_boost_ticks) * break_ratio);
        runtime.boost_until_tick -= lost_ticks;
        let fraction_denied = ticks_f64(lost_ticks) / ticks_f64(original_boost_ticks);
        let fully_ended = runtime.boost_until_tick <= tick_i;
        if fully_ended {
            clear_speed_boost(runtime, tick_i);
            if let Some(ended) = ended {
                emit_broken_speed_end(
                    ended,
                    remaining_boost_ticks,
                    tick_rate,
                    target_player_id,
                    source_player_id,
                    emit,
                );
            }
        }
        emit.emit(
            EventKind::BoostBroken(BoostBrokenMeta {
                ended_item: if fully_ended { ended } else { None },
                remaining_boost_ticks: tick_u32(lost_ticks),
                original_boost_ticks: tick_u32(original_boost_ticks),
                boost_multiplier,
                fraction_denied,
                break_source,
                partial: !fully_ended,
                auto_reason: None,
            }),
            Some(target_player_id),
            Some(source_player_id),
        );
        return None;
    }

    let fraction_denied = ticks_f64(remaining_boost_ticks) / ticks_f64(original_boost_ticks);
    clear_speed_boost(runtime, tick_i);
    if let Some(ended) = ended {
        emit_broken_speed_end(
            ended,
            remaining_boost_ticks,
            tick_rate,
            target_player_id,
            source_player_id,
            emit,
        );
    }
    emit.emit(
        EventKind::BoostBroken(BoostBrokenMeta {
            ended_item: ended,
            remaining_boost_ticks: tick_u32(remaining_boost_ticks),
            original_boost_ticks: tick_u32(original_boost_ticks),
            boost_multiplier,
            fraction_denied,
            break_source,
            partial: false,
            auto_reason: None,
        }),
        Some(target_player_id),
        Some(source_player_id),
    );
    // `ended && SPEED_BOOST_PRIORITY[ended] ? ended : null`.
    ended.filter(|&item| speed_boost_priority(item).is_some())
}

/// `if (ended && SPEED_END_EVENT[ended]) emit(SPEED_END_EVENT[ended], victim,
/// attacker, {broken: true, consumedSeconds: remainingBoostTicks / tickRate})`.
fn emit_broken_speed_end(
    ended: RaceItemId,
    remaining_boost_ticks: i64,
    tick_rate: u32,
    victim: &PlayerId,
    attacker: &PlayerId,
    emit: &mut Emitter<'_>,
) {
    let meta = SpeedBoostEndedMeta {
        broken: Some(true),
        consumed_seconds: ticks_f64(remaining_boost_ticks) / f64::from(tick_rate),
        natural: None,
        start_progress: None,
        start_rank: None,
        auto_reason: None,
    };
    if let Some(kind) = speed_end_event(ended, meta) {
        emit.emit(kind, Some(victim), Some(attacker));
    }
}

/// `grantMomentumSteal(itemState, attackerPlayerId, victimPlayerId,
/// brokenItemId, tick, tickRate, emit, stealSeconds, stealMultiplier)`
/// (`items/engine.ts:303-324`). ATTACK > SPEED.
///
/// The TS defaults are `ITEM_BALANCE.counter.momentumStealSeconds` /
/// `momentumStealMultiplier` (see [`MOMENTUM_STEAL_DEFAULTS`]); callers pass
/// them explicitly.
#[allow(clippy::too_many_arguments)]
pub fn grant_momentum_steal(
    item_state: &mut ItemRaceState,
    attacker_player_id: &PlayerId,
    victim_player_id: &PlayerId,
    broken_item_id: Option<RaceItemId>,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    steal_seconds: f64,
    steal_multiplier: f64,
) -> bool {
    // Momentum carriers: any duck whose speed boost was just broken, or a
    // SPEED-class duck still holding its Nitro.
    let victim_holds_nitro = item_state
        .by_player
        .get(victim_player_id.as_str())
        .is_some_and(|victim| victim.has_unused(RaceItemId::Nitro));
    let stolen_item_id = match broken_item_id {
        Some(item) => item,
        None if victim_holds_nitro => RaceItemId::Nitro,
        None => return false,
    };
    if !item_state
        .by_player
        .contains_key(attacker_player_id.as_str())
    {
        return false;
    }
    if broken_item_id.is_none()
        && let Some(victim) = item_state.by_player.get_mut(victim_player_id.as_str())
    {
        victim.speed_drained = true;
    }
    let attacker = item_state.runtime_mut(attacker_player_id.as_str());
    apply_item_boost(attacker, steal_multiplier, steal_seconds, tick, tick_rate);
    emit.emit(
        EventKind::MomentumStolen(MomentumStolenMeta {
            stolen_item_id,
            broke_boost: broken_item_id.is_some(),
            multiplier: steal_multiplier,
            duration_seconds: steal_seconds,
            auto_reason: None,
        }),
        Some(attacker_player_id),
        Some(victim_player_id),
    );
    true
}

/// The default `(stealSeconds, stealMultiplier)` of `grantMomentumSteal`.
pub const MOMENTUM_STEAL_DEFAULTS: (f64, f64) = (
    item_balance::counter::MOMENTUM_STEAL_SECONDS,
    item_balance::counter::MOMENTUM_STEAL_MULTIPLIER,
);

/// `tryActivateBubbleShield(runtime, playerId, tick, tickRate, emit,
/// metadata)` (`items/engine.ts:344-362`). Every TS caller passes
/// `{autoReason}` (plus `reflex` from [`arm_bubble_reflex`]).
pub fn try_activate_bubble_shield(
    runtime: &mut DuckItemRuntime,
    player_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    auto_reason: AutoUseReason,
    reflex: Option<ReflexThreat>,
) -> bool {
    if !runtime.item_ids.contains(&RaceItemId::BubbleShield)
        || runtime.used(RaceItemId::BubbleShield)
    {
        return false;
    }
    runtime.mark_used(RaceItemId::BubbleShield);
    runtime.bubble_available = true;
    runtime.bubble_until_tick = i64::from(tick)
        + seconds_to_ticks(item_balance::bubble_shield::DURATION_SECONDS, tick_rate);
    emit.emit(
        EventKind::BubbleShieldActivated(BubbleShieldActivatedMeta {
            duration_seconds: item_balance::bubble_shield::DURATION_SECONDS,
            until_tick: tick_u32(runtime.bubble_until_tick),
            auto_reason,
            reflex,
        }),
        Some(player_id),
        None,
    );
    true
}

/// `armBubbleReflex` (`items/engine.ts:365-369`): a packed Bubble Shield
/// snaps up on the first incoming prep rocket/banana unless its owner is
/// silenced (or item-immune). Box attacks only meet a raised bubble.
pub fn arm_bubble_reflex(
    runtime: &mut DuckItemRuntime,
    player_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    threat: ReflexThreat,
) {
    let tick_i = i64::from(tick);
    if tick_i < runtime.item_immunity_until_tick || tick_i < runtime.silenced_until_tick {
        return;
    }
    if runtime.bubble_available && tick_i < runtime.bubble_until_tick {
        return;
    }
    try_activate_bubble_shield(
        runtime,
        player_id,
        tick,
        tick_rate,
        emit,
        AutoUseReason::ReactiveDefense,
        Some(threat),
    );
}

/// `triggerMenacePredatorRush(itemState, attackerPlayerId, tick, tickRate,
/// emit, trigger)` (`items/engine.ts:371-388`).
pub fn trigger_menace_predator_rush(
    item_state: &mut ItemRaceState,
    attacker_player_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    trigger: PredatorRushTrigger,
) {
    let Some(runtime) = item_state.by_player.get_mut(attacker_player_id.as_str()) else {
        return;
    };
    if runtime.loadout_combo != Some(LoadoutCombo::Menace) {
        return;
    }
    apply_item_boost(
        runtime,
        item_balance::menace::PREDATOR_RUSH_MULTIPLIER,
        item_balance::menace::PREDATOR_RUSH_DURATION_SECONDS,
        tick,
        tick_rate,
    );
    emit.emit(
        EventKind::PredatorRushStarted(PredatorRushStartedMeta {
            trigger,
            multiplier: item_balance::menace::PREDATOR_RUSH_MULTIPLIER,
            duration_seconds: item_balance::menace::PREDATOR_RUSH_DURATION_SECONDS,
            until_tick: tick_u32(runtime.boost_until_tick),
        }),
        Some(attacker_player_id),
        None,
    );
}

/// The caller `metadata` of `tryApplyPrepSpeedBoost`, spread into the
/// `*_STARTED` event (`auto-use/execute.ts:38-63`): Nitro passes
/// `{autoReason, startRank, startProgress}`, Draft Fin `{draftTarget,
/// autoReason}` (`draftTarget` may be `null`), Paddle Burst `{autoReason}`.
/// `None` keys are absent (TS: not in the object).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SpeedStartExtras {
    pub auto_reason: Option<AutoUseReason>,
    pub draft_target: Option<Option<PlayerId>>,
    pub start_rank: Option<u32>,
    pub start_progress: Option<f64>,
}

/// `'applied' | 'queued' | 'ignored'`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrepSpeedOutcome {
    Applied,
    Queued,
    Ignored,
}

/// `tryApplyPrepSpeedBoost(runtime, duckId, itemId, multiplier,
/// durationSeconds, tick, tickRate, emit, metadata)`
/// (`items/engine.ts:390-437`).
///
/// Quirks kept: a non-speed item returns `Applied` without doing anything;
/// a pending speed drain is consumed (and halves the duration) even when the
/// boost is only queued or ignored, but `drained: true` reaches only the
/// direct `*_STARTED` event; the queued boost keeps the shortened duration.
#[allow(clippy::too_many_arguments)]
pub fn try_apply_prep_speed_boost(
    runtime: &mut DuckItemRuntime,
    duck_id: &PlayerId,
    item_id: RaceItemId,
    multiplier: f64,
    duration_seconds: f64,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    extras: SpeedStartExtras,
) -> PrepSpeedOutcome {
    if speed_boost_priority(item_id).is_none() {
        // `SPEED_START_EVENT[itemId]` is undefined.
        return PrepSpeedOutcome::Applied;
    }
    let mut duration_seconds = duration_seconds;
    let mut drained = None;
    if runtime.speed_drained {
        runtime.speed_drained = false;
        duration_seconds *= item_balance::counter::SPEED_DRAIN_DURATION_RATIO;
        drained = Some(true);
    }
    let tick_i = i64::from(tick);
    if tick_i < runtime.boost_until_tick && runtime.boost_multiplier > 1.0 {
        let incoming = QueuedSpeedBoost {
            multiplier,
            duration_seconds,
            item_id,
        };
        let incoming_priority = speed_boost_priority(item_id).unwrap_or(0);
        let Some(existing) = runtime.queued_speed_boost else {
            runtime.queued_speed_boost = Some(incoming);
            emit.emit(
                EventKind::SpeedBoostQueued(SpeedBoostQueuedMeta {
                    item_id,
                    duration_seconds,
                    multiplier,
                    replaced_previous: false,
                    replaced_item_id: None,
                }),
                Some(duck_id),
                None,
            );
            return PrepSpeedOutcome::Queued;
        };
        let existing_priority = speed_boost_priority(existing.item_id).unwrap_or(0);
        if incoming_priority > existing_priority {
            runtime.queued_speed_boost = Some(incoming);
            emit.emit(
                EventKind::SpeedBoostQueued(SpeedBoostQueuedMeta {
                    item_id,
                    duration_seconds,
                    multiplier,
                    replaced_previous: true,
                    replaced_item_id: Some(existing.item_id),
                }),
                Some(duck_id),
                None,
            );
            return PrepSpeedOutcome::Queued;
        }
        return PrepSpeedOutcome::Ignored;
    }
    runtime.continuous_boost_started_at_tick = Some(tick_i);
    if item_id == RaceItemId::Nitro {
        set_nitro_phases(runtime, tick_rate);
    }
    record_boost_start(runtime, item_id, &extras);
    apply_item_boost(runtime, multiplier, duration_seconds, tick, tick_rate);
    runtime.active_speed_item_id = Some(item_id);
    let meta = SpeedBoostStartedMeta {
        until_tick: tick_u32(runtime.boost_until_tick),
        duration_seconds,
        multiplier,
        queued: None,
        draft_target: extras.draft_target,
        auto_reason: extras.auto_reason,
        start_rank: extras.start_rank,
        start_progress: extras.start_progress,
        drained,
    };
    if let Some(kind) = speed_start_event(item_id, meta) {
        emit.emit(kind, Some(duck_id), None);
    }
    PrepSpeedOutcome::Applied
}

/// `slipstreamReady(runtime, tickRate, progress?)` (`items/engine.ts:509-518`).
#[must_use]
pub fn slipstream_ready(runtime: &DuckItemRuntime, tick_rate: u32, progress: Option<f64>) -> bool {
    let mut hold_seconds = item_balance::draft_fin::HOLD_SECONDS;
    if runtime.loadout_combo == Some(LoadoutCombo::SpeedDemon) {
        hold_seconds *= 0.8;
    }
    if let Some(progress) = progress
        && progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS
    {
        hold_seconds = js_min(hold_seconds, 0.4);
    }
    runtime.draft_slipstream_ticks >= seconds_to_ticks(hold_seconds, tick_rate)
}

/// `firePrepRocket(itemState, source, targetPlayerId, tick, tickRate, emit,
/// autoReason, metadata)` (`items/engine.ts:528-561`). `meta` is the whole
/// `ROCKET_FIRED` metadata (`{autoReason, ...executeMetadata}`).
///
/// # Panics
/// If the source duck has no item runtime (the TS `!`).
#[allow(clippy::too_many_arguments)]
pub fn fire_prep_rocket(
    item_state: &mut ItemRaceState,
    source_player_id: &PlayerId,
    source_progress: f64,
    target_player_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    meta: RocketFiredMeta,
) -> bool {
    if item_state
        .runtime(source_player_id.as_str())
        .used(RaceItemId::HomingRocket)
    {
        return false;
    }
    if id_set_has(&item_state.ghost_player_ids, target_player_id.as_str()) {
        return false;
    }
    if !item_state.by_player.contains_key(target_player_id.as_str()) {
        return false;
    }
    let tick_i = i64::from(tick);
    let id = next_object_id(item_state);
    item_state.rockets.push(RocketRuntime {
        id,
        source_player_id: source_player_id.clone(),
        target_player_id: target_player_id.clone(),
        progress: source_progress,
        spawned_at_tick: tick_i,
        launch_at_tick: tick_i,
        expires_at_tick: tick_i
            + seconds_to_ticks(item_balance::rocket::LIFETIME_SECONDS, tick_rate),
        kind: ProjectileSource::Prep,
        speed_per_second: item_balance::rocket::PROJECTILE_SPEED,
        hit_radius: item_balance::rocket::HIT_RADIUS,
        retargeted: false,
    });
    item_state
        .runtime_mut(source_player_id.as_str())
        .mark_used(RaceItemId::HomingRocket);
    emit.emit(
        EventKind::RocketFired(meta),
        Some(source_player_id),
        Some(target_player_id),
    );
    true
}

/// `itemState.nextObjectId++`.
///
/// # Panics
/// If the id counter overflows `u32`.
pub fn next_object_id(item_state: &mut ItemRaceState) -> u32 {
    let id = item_state.next_object_id;
    item_state.next_object_id = id.checked_add(1).expect("object id fits in u32");
    id
}

/// `ITEM_BALANCE.counter.guardSurge[defenseItemId]`.
#[must_use]
pub const fn guard_surge_tuning(defense: GuardDefenseItem) -> (f64, f64) {
    use item_balance::counter::guard_surge as g;
    match defense {
        GuardDefenseItem::BubbleShield => (
            g::BUBBLE_SHIELD_MULTIPLIER,
            g::BUBBLE_SHIELD_DURATION_SECONDS,
        ),
        GuardDefenseItem::Feather => (g::FEATHER_MULTIPLIER, g::FEATHER_DURATION_SECONDS),
        GuardDefenseItem::ShockAbsorber => (
            g::SHOCK_ABSORBER_MULTIPLIER,
            g::SHOCK_ABSORBER_DURATION_SECONDS,
        ),
    }
}

/// `grantGuardSurge` (`items/engine.ts:326-340`): DEFENSE > ATTACK.
#[allow(clippy::too_many_arguments)]
pub fn grant_guard_surge(
    defense: &mut DuckItemRuntime,
    defender_player_id: &PlayerId,
    attacker_player_id: Option<&PlayerId>,
    defense_item_id: GuardDefenseItem,
    blocked: IncomingAttack,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let (multiplier, duration_seconds) = guard_surge_tuning(defense_item_id);
    apply_item_boost(defense, multiplier, duration_seconds, tick, tick_rate);
    emit.emit(
        EventKind::GuardSurge(GuardSurgeMeta {
            defense_item_id,
            blocked: Some(blocked),
            glide: None,
            multiplier,
            duration_seconds,
        }),
        Some(defender_player_id),
        attacker_player_id,
    );
}

/// `finishSpeedBoost` (`items/engine.ts:439-483`).
///
/// Quirk kept: the natural `*_ENDED` event carries the duck's last Nitro
/// `startProgress`/`startRank`, whatever item just ended.
pub fn finish_speed_boost(
    runtime: &mut DuckItemRuntime,
    duck_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let ended = runtime.active_speed_item_id;
    let tick_i = i64::from(tick);
    let consumed_ticks = (tick_i - runtime.boost_started_at_tick).max(0);
    runtime.boost_multiplier = 1.0;
    runtime.active_speed_item_id = None;
    if let Some(ended) = ended {
        let meta = SpeedBoostEndedMeta {
            broken: None,
            consumed_seconds: ticks_f64(consumed_ticks) / f64::from(tick_rate),
            natural: Some(true),
            start_progress: runtime.nitro_start_progress,
            start_rank: runtime.nitro_start_rank,
            auto_reason: None,
        };
        if let Some(kind) = speed_end_event(ended, meta) {
            emit.emit(kind, Some(duck_id), None);
        }
    }
    let Some(queued) = runtime.queued_speed_boost.take() else {
        runtime.continuous_boost_started_at_tick = None;
        return;
    };

    // Cap the continuous boost window (no infinite boost trains).
    let continuous_elapsed_seconds = match runtime.continuous_boost_started_at_tick {
        Some(started) => ticks_f64(tick_i - started) / f64::from(tick_rate),
        None => 0.0,
    };
    let max_allowed_seconds = js_max(
        0.3,
        item_balance::MAX_CONTINUOUS_BOOST_SECONDS - continuous_elapsed_seconds,
    );
    let effective_duration_seconds = js_min(queued.duration_seconds, max_allowed_seconds);

    if queued.item_id == RaceItemId::Nitro {
        set_nitro_phases(runtime, tick_rate);
    }
    // F10: a queued boost starts without start metadata.
    record_boost_start(runtime, queued.item_id, &SpeedStartExtras::default());

    apply_item_boost(
        runtime,
        queued.multiplier,
        effective_duration_seconds,
        tick,
        tick_rate,
    );
    runtime.active_speed_item_id = Some(queued.item_id);
    let meta = SpeedBoostStartedMeta {
        until_tick: tick_u32(runtime.boost_until_tick),
        duration_seconds: effective_duration_seconds,
        multiplier: queued.multiplier,
        queued: Some(true),
        draft_target: None,
        auto_reason: None,
        start_rank: None,
        start_progress: None,
        drained: None,
    };
    if let Some(kind) = speed_start_event(queued.item_id, meta) {
        emit.emit(kind, Some(duck_id), None);
    }
}

/// Records the start of the speed boost `item_id` that is being applied: the
/// `startProgress`/`startRank` its natural `*_ENDED` event reports.
///
/// S3.15 (`ts-compat`) read them back from the start event's untyped
/// metadata with `Number(...)`, only for NITRO and only when present, so a
/// later boost (Draft Fin, Paddle Burst, a queued Nitro) ended with the
/// *previous* Nitro's start. **F10 (S3.16):** the typed
/// [`SpeedStartExtras`] of this boost replace them every time (absent for
/// any boost but a direct Nitro), so an `*_ENDED` event only ever carries
/// its own boost's start.
fn record_boost_start(
    runtime: &mut DuckItemRuntime,
    item_id: RaceItemId,
    extras: &SpeedStartExtras,
) {
    if crate::TS_COMPAT {
        if item_id == RaceItemId::Nitro {
            // `Number(metadata.startProgress)` of a number is the number.
            if let Some(progress) = extras.start_progress {
                runtime.nitro_start_progress = Some(progress);
            }
            if let Some(rank) = extras.start_rank {
                runtime.nitro_start_rank = Some(rank);
            }
        }
    } else if item_id == RaceItemId::Nitro {
        runtime.nitro_start_progress = extras.start_progress;
        runtime.nitro_start_rank = extras.start_rank;
    } else {
        runtime.nitro_start_progress = None;
        runtime.nitro_start_rank = None;
    }
}

/// Sets the three Nitro phase lengths (`items/engine.ts:427-429,467-469`).
pub fn set_nitro_phases(runtime: &mut DuckItemRuntime, tick_rate: u32) {
    runtime.nitro_ignition_ticks = Some(seconds_to_ticks(
        item_balance::nitro::IGNITION_SECONDS,
        tick_rate,
    ));
    runtime.nitro_overdrive_ticks = Some(seconds_to_ticks(
        item_balance::nitro::OVERDRIVE_SECONDS,
        tick_rate,
    ));
    runtime.nitro_decay_ticks = Some(seconds_to_ticks(
        item_balance::nitro::DECAY_SECONDS,
        tick_rate,
    ));
}

/// An `i64` tick count as a JS number (exact below 2^53).
#[must_use]
pub fn ticks_f64(ticks: i64) -> f64 {
    assert!(ticks.unsigned_abs() <= 1 << 53, "tick count above 2^53");
    // Exact (checked above).
    #[allow(clippy::cast_precision_loss)]
    let value = ticks as f64;
    value
}

/// Duck indices sorted by `playerId.localeCompare` (the TS `stableDucks` /
/// `sortedDucks` copies).
#[must_use]
pub fn ducks_by_player_id(ducks: &[DuckPhysicsState]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..ducks.len()).collect();
    v8_sort_by(&mut order, |&a, &b| {
        id_cmp(ducks[a].player_id.as_str(), ducks[b].player_id.as_str())
    });
    order
}

/// `updateSlipstreamTracking(itemState, stableDucks)` (`items/engine.ts:485-507`).
fn update_slipstream_tracking(
    item_state: &mut ItemRaceState,
    ducks: &[DuckPhysicsState],
    stable: &[usize], // usize-ok: function parameter, never stored
) {
    for &index in stable {
        let duck = &ducks[index];
        if duck.finished {
            continue;
        }
        let mut candidates: Vec<usize> = stable
            .iter()
            .copied()
            .filter(|&other| !ducks[other].finished && ducks[other].progress > duck.progress)
            .collect();
        v8_sort_by(&mut candidates, |&a, &b| {
            cmp_f64_js(ducks[a].progress, ducks[b].progress)
                .then_with(|| id_cmp(ducks[a].player_id.as_str(), ducks[b].player_id.as_str()))
        });
        let runtime = item_state.runtime_mut(duck.player_id.as_str());
        let Some(&ahead) = candidates.first() else {
            runtime.draft_slipstream_ticks = 0;
            runtime.draft_target_player_id = None;
            continue;
        };
        let ahead = &ducks[ahead];
        let gap = ahead.progress - duck.progress;
        let lateral = crate::math::abs(ahead.lateral_offset - duck.lateral_offset);
        if gap <= item_balance::draft_fin::MAX_GAP
            && lateral <= item_balance::draft_fin::LATERAL_RADIUS
        {
            runtime.draft_slipstream_ticks += 1;
            runtime.draft_target_player_id = Some(ahead.player_id.clone());
        } else {
            runtime.draft_slipstream_ticks = 0;
            runtime.draft_target_player_id = None;
        }
    }
}

/// `tickItemSystem` (`items/engine.ts:799-849`).
pub fn tick_item_system(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let stable = ducks_by_player_id(ducks);
    let tick_i = i64::from(tick);
    for &index in &stable {
        let duck = &ducks[index];
        if duck.finished {
            continue;
        }
        let player_id = duck.player_id.clone();
        let progress = duck.progress;
        let runtime = item_state.runtime_mut(player_id.as_str());
        if runtime.boost_multiplier > 1.0 && tick_i >= runtime.boost_until_tick {
            finish_speed_boost(runtime, &player_id, tick, tick_rate, emit);
        }
        if tick_i >= runtime.slow_until_tick {
            match runtime.recovery_slow_until_tick {
                Some(until) if until != 0 && tick_i < until => {
                    runtime.slow_multiplier = runtime.recovery_slow_multiplier.unwrap_or(1.0);
                    runtime.slow_until_tick = until;
                    runtime.recovery_slow_multiplier = None;
                    runtime.recovery_slow_until_tick = None;
                }
                _ => {
                    runtime.slow_multiplier = 1.0;
                    runtime.recovery_slow_multiplier = None;
                    runtime.recovery_slow_until_tick = None;
                }
            }
        }
        if let Some(surge_tick) = runtime.queued_guard_surge_tick
            && tick_i >= surge_tick
        {
            let source = runtime.queued_guard_surge_source.take();
            let blocked = runtime
                .queued_guard_surge_blocked
                .take()
                .unwrap_or(IncomingAttack::Rocket);
            runtime.queued_guard_surge_tick = None;
            grant_guard_surge(
                runtime,
                &player_id,
                source.as_ref(),
                GuardDefenseItem::ShockAbsorber,
                blocked,
                tick,
                tick_rate,
                emit,
            );
        }
        if runtime.feather_available && progress >= item_balance::feather::GLIDE_PROGRESS {
            runtime.feather_available = false;
            apply_item_boost(
                runtime,
                item_balance::feather::GLIDE_MULTIPLIER,
                item_balance::feather::GLIDE_DURATION_SECONDS,
                tick,
                tick_rate,
            );
            emit.emit(
                EventKind::GuardSurge(GuardSurgeMeta {
                    defense_item_id: GuardDefenseItem::Feather,
                    blocked: None,
                    glide: Some(true),
                    multiplier: item_balance::feather::GLIDE_MULTIPLIER,
                    duration_seconds: item_balance::feather::GLIDE_DURATION_SECONDS,
                }),
                Some(&player_id),
                None,
            );
        }
        if runtime.bubble_available && tick_i >= runtime.bubble_until_tick {
            runtime.bubble_available = false;
            let fortress = runtime.loadout_combo == Some(LoadoutCombo::Fortress);
            let expire_mult = if fortress { 1.07 } else { 1.03 };
            let expire_dur = if fortress { 1.4 } else { 1.0 };
            apply_item_boost(runtime, expire_mult, expire_dur, tick, tick_rate);
            emit.emit(
                EventKind::BubbleShieldExpired(race_protocol::events::EmptyMeta {}),
                Some(&player_id),
                None,
            );
        }
    }
    update_slipstream_tracking(item_state, ducks, &stable);
    update_rockets(item_state, ducks, tick, tick_rate, emit);
    update_bananas(item_state, ducks, tick, tick_rate, emit);
}

/// `itemSpeedMultiplier(runtime, tick)` (`items/engine.ts:851-887`).
#[must_use]
pub fn item_speed_multiplier(runtime: &DuckItemRuntime, tick: u32) -> f64 {
    let tick = i64::from(tick);
    let mut boost = 1.0;
    if tick < runtime.boost_until_tick && runtime.boost_multiplier > 1.0 {
        if runtime.active_speed_item_id == Some(RaceItemId::Nitro) {
            let elapsed = (tick - runtime.boost_started_at_tick).max(0);
            // `?? Math.round(seconds * 60)`: the 60 is literal in TS.
            let ignition = runtime
                .nitro_ignition_ticks
                .unwrap_or_else(|| seconds_to_ticks(item_balance::nitro::IGNITION_SECONDS, 60));
            let overdrive = runtime
                .nitro_overdrive_ticks
                .unwrap_or_else(|| seconds_to_ticks(item_balance::nitro::OVERDRIVE_SECONDS, 60));
            let decay = runtime
                .nitro_decay_ticks
                .unwrap_or_else(|| seconds_to_ticks(item_balance::nitro::DECAY_SECONDS, 60));
            let peak = runtime.boost_multiplier;
            if elapsed < ignition && ignition > 0 {
                let ratio = ticks_f64(elapsed) / ticks_f64(ignition);
                boost = 1.0 + (peak - 1.0) * ratio;
            } else if elapsed < ignition + overdrive {
                boost = peak;
            } else {
                let decay_elapsed = elapsed - (ignition + overdrive);
                let ratio = if decay > 0 {
                    js_min(
                        1.0,
                        js_max(0.0, ticks_f64(decay_elapsed) / ticks_f64(decay)),
                    )
                } else {
                    1.0
                };
                boost = 1.0 + (peak - 1.0) * (1.0 - ratio);
            }
        } else {
            boost = runtime.boost_multiplier;
        }
    }

    let mut slow = 1.0;
    if tick < runtime.slow_until_tick {
        slow = runtime.slow_multiplier;
    } else if let Some(until) = runtime.recovery_slow_until_tick
        && until != 0
        && tick < until
    {
        slow = runtime.recovery_slow_multiplier.unwrap_or(1.0);
    }
    let drag = if runtime.has_unused(RaceItemId::BubbleShield) {
        item_balance::bubble_shield::PACKED_DRAG_MULTIPLIER
    } else {
        1.0
    };
    js_min(item_balance::MAXIMUM_SPEED_MULTIPLIER, boost)
        * js_max(item_balance::MINIMUM_SPEED_MULTIPLIER, slow)
        * drag
}

/// The visible effect of an active speed item.
fn speed_item_effect(item_id: RaceItemId) -> ActiveEffect {
    match item_id {
        RaceItemId::Nitro => ActiveEffect::Nitro,
        RaceItemId::DraftFin => ActiveEffect::DraftFin,
        RaceItemId::PaddleBurst => ActiveEffect::PaddleBurst,
        // `activeSpeedItemId` is only ever set to a speed item
        // (`tryApplyPrepSpeedBoost` returns early for anything else).
        other => panic!("activeSpeedItemId {other} is not a speed item"),
    }
}

/// `itemActiveEffects(runtime, tick)` (`items/engine.ts:889-904`), in TS push
/// order.
#[must_use]
pub fn item_active_effects(runtime: &DuckItemRuntime, tick: u32) -> Vec<ActiveEffect> {
    let tick = i64::from(tick);
    let mut effects = Vec::new();
    if runtime.bubble_available && tick < runtime.bubble_until_tick {
        effects.push(ActiveEffect::BubbleShield);
    }
    if runtime.feather_available {
        effects.push(ActiveEffect::Feather);
    }
    if runtime.shock_absorber_available {
        effects.push(ActiveEffect::ShockAbsorber);
    }
    if tick < runtime.silenced_until_tick {
        effects.push(ActiveEffect::Silenced);
    }
    if tick < runtime.boost_until_tick {
        if let Some(item_id) = runtime.active_speed_item_id {
            effects.push(speed_item_effect(item_id));
        } else if runtime.loadout_combo == Some(LoadoutCombo::Menace) {
            effects.push(ActiveEffect::PredatorRush);
        } else {
            effects.push(ActiveEffect::Nitro);
        }
    }
    let recovering =
        matches!(runtime.recovery_slow_until_tick, Some(until) if until != 0 && tick < until);
    if tick < runtime.slow_until_tick || recovering {
        effects.push(ActiveEffect::Slowed);
    }
    if runtime.wild_bubble_available && tick < runtime.wild_bubble_until_tick {
        effects.push(ActiveEffect::MiniBubble);
    }
    if runtime.wild_feather_available && tick < runtime.wild_feather_until_tick {
        effects.push(ActiveEffect::WildFeather);
    }
    if tick < runtime.tailwind_until_tick {
        effects.push(ActiveEffect::Tailwind);
    }
    if tick < runtime.magnet_until_tick {
        effects.push(ActiveEffect::SlipstreamMagnet);
    }
    effects
}

const fn projectile_kind(kind: ProjectileSource) -> ProjectileKind {
    match kind {
        ProjectileSource::Prep => ProjectileKind::Prep,
        ProjectileSource::Wild => ProjectileKind::Wild,
    }
}

/// `snapshotItemWorld(itemState)` (`items/engine.ts:780-797`).
#[must_use]
pub fn snapshot_item_world(
    item_state: &ItemRaceState,
) -> (Vec<RocketSnapshot>, Vec<BananaSnapshot>) {
    let rockets = item_state
        .rockets
        .iter()
        .map(|rocket| RocketSnapshot {
            id: rocket.id,
            source_player_id: rocket.source_player_id.clone(),
            target_player_id: rocket.target_player_id.clone(),
            progress: rocket.progress,
            kind: projectile_kind(rocket.kind),
        })
        .collect();
    let bananas = item_state
        .bananas
        .iter()
        .map(|banana| BananaSnapshot {
            id: banana.id,
            source_player_id: banana.source_player_id.clone(),
            progress: banana.progress,
            lateral_offset: banana.lateral_offset,
            kind: projectile_kind(banana.kind),
        })
        .collect();
    (rockets, bananas)
}
