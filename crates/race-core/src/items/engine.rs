//! The parts of `packages/race-core/src/items/engine.ts` the core step needs
//! even without loadouts: state creation, boosts and slows, the per-tick item
//! maintenance (`tickItemSystem`), `itemSpeedMultiplier`,
//! `itemActiveEffects` and `snapshotItemWorld`. Boost gates use the same
//! boost runtime as prep items, so these are exact ports, not stubs.
//!
//! Projectiles (`updateRockets` / `updateBananas`) are in
//! [`super::projectiles`] (M2).

use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{
    EventKind, GuardDefenseItem, GuardSurgeMeta, IncomingAttack, SpeedBoostEndedMeta,
    SpeedBoostStartedMeta,
};
use race_protocol::ids::{PlayerId, RaceItemId};
use race_protocol::snapshot::{ActiveEffect, BananaSnapshot, ProjectileKind, RocketSnapshot};

use super::classes::{LoadoutCombo, loadout_combo_label};
use super::config::item_balance;
use super::projectiles::{update_bananas, update_rockets};
use super::state::{DuckItemRuntime, ItemRaceState, ProjectileSource};
use crate::ghost::ghost_player_ids_from_config;
use crate::js_sort::v8_sort_by;
use crate::math::{cmp_f64_js, js_max, js_min, js_round};
use crate::sim::{DuckPhysicsState, Emitter, IdMap, id_cmp};

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
