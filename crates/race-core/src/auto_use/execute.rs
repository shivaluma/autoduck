//! Executing an auto-use decision: `packages/race-core/src/auto-use/execute.ts`
//! (S3.15).

use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{
    BananaDroppedMeta, BoostBreakSource, BubblePoppedMeta, EventKind, FeatherDodgedMeta,
    GuardDefenseItem, HornUsedMeta, IncomingAttack, ItemSilencedMeta, PredatorRushTrigger,
    RocketFiredMeta, ShockAbsorberProcMeta, SilenceSource, WildItemAutoUsedMeta,
};
use race_protocol::ids::{ItemKey, PlayerId, RaceItemId, WildItemId};

use super::director::DirectorCache;
use super::evaluate::EvalCtx;
use super::objective::build_race_objective_context;
use super::types::{AutoUseCandidate, CandidateAction, CandidateSource};
use crate::items::config::item_balance;
use crate::items::engine::{seconds_to_ticks, tick_u32};
use crate::items::{
    BananaRuntime, ItemRaceState, LoadoutCombo, PrepSpeedOutcome, ProjectileSource,
    SpeedStartExtras, aimed_banana_lateral, break_active_speed_boost, default_horn_side,
    fire_prep_rocket, grant_guard_surge, grant_momentum_steal, horn_side_targets, next_object_id,
    slipstream_ready, trigger_menace_predator_rush, try_activate_bubble_shield,
    try_apply_prep_speed_boost,
};
use crate::js_sort::v8_sort_by;
use crate::math::{abs, ceil, js_max, js_min};
use crate::pickups::{WildUseInput, WildUseMode, activate_wild_item};
use crate::sim::{DuckPhysicsState, Emitter, id_cmp, id_set_has};

/// The `executeMetadata` of a rocket (`arbiter.ts:113-117`): spread into
/// `ROCKET_FIRED` for prep rockets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RocketExecuteMeta {
    pub decision_target_id: Option<PlayerId>,
    pub execute_target_id: Option<PlayerId>,
    pub retargeted_at_execute: bool,
}

/// Shared state an execution needs besides the item and duck state.
pub struct ExecuteEnv<'a> {
    pub config: &'a ResolvedRaceConfig,
    pub director: &'a mut DirectorCache,
}

/// `executeAutoItemAction(candidate, itemState, ducks, tick, tickRate,
/// emitItem, emitPickup, executeMetadata, raceConfig)` (`execute.ts:262-276`).
#[allow(clippy::too_many_arguments)]
pub fn execute_auto_item_action(
    candidate: &mut AutoUseCandidate,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    execute_metadata: Option<RocketExecuteMeta>,
    env: &mut ExecuteEnv<'_>,
) -> bool {
    let Some(duck_index) = ducks
        .iter()
        .position(|duck| duck.player_id == candidate.player_id)
    else {
        return false;
    };
    if candidate.source == CandidateSource::Prep {
        return execute_prep_action(
            candidate,
            item_state,
            duck_index,
            ducks,
            tick,
            tick_rate,
            emit,
            execute_metadata,
            env,
        );
    }
    execute_wild_action(candidate, item_state, ducks, tick, tick_rate, emit)
}

/// `executePrepAction(...)` (`execute.ts:21-219`).
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn execute_prep_action(
    candidate: &mut AutoUseCandidate,
    item_state: &mut ItemRaceState,
    duck_index: usize,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
    execute_metadata: Option<RocketExecuteMeta>,
    env: &mut ExecuteEnv<'_>,
) -> bool {
    let tick_i = i64::from(tick);
    let duck_id = ducks[duck_index].player_id.clone();
    if tick_i < item_state.runtime(duck_id.as_str()).silenced_until_tick {
        return false;
    }
    let reason = candidate.reason;
    match candidate.item_id {
        ItemKey::Nitro => {
            let multiplier = item_state.tuning.nitro_speed_multiplier;
            let runtime = item_state.runtime_mut(duck_id.as_str());
            if !runtime.has_unused(RaceItemId::Nitro) {
                return false;
            }
            let duck = &ducks[duck_index];
            let outcome = try_apply_prep_speed_boost(
                runtime,
                &duck_id,
                RaceItemId::Nitro,
                multiplier,
                item_balance::nitro::DURATION_SECONDS,
                tick,
                tick_rate,
                emit,
                SpeedStartExtras {
                    auto_reason: Some(reason),
                    draft_target: None,
                    start_rank: Some(duck.current_rank),
                    start_progress: Some(duck.progress),
                },
            );
            if outcome == PrepSpeedOutcome::Ignored {
                return false;
            }
            runtime.mark_used(RaceItemId::Nitro);
            true
        }
        ItemKey::DraftFin => {
            let progress = ducks[duck_index].progress;
            let runtime = item_state.runtime_mut(duck_id.as_str());
            if !runtime.has_unused(RaceItemId::DraftFin)
                || !slipstream_ready(runtime, tick_rate, Some(progress))
            {
                return false;
            }
            let draft_target = runtime.draft_target_player_id.clone();
            let outcome = try_apply_prep_speed_boost(
                runtime,
                &duck_id,
                RaceItemId::DraftFin,
                item_balance::draft_fin::SPEED_MULTIPLIER,
                item_balance::draft_fin::DURATION_SECONDS,
                tick,
                tick_rate,
                emit,
                SpeedStartExtras {
                    auto_reason: Some(reason),
                    draft_target: Some(draft_target),
                    start_rank: None,
                    start_progress: None,
                },
            );
            if outcome == PrepSpeedOutcome::Ignored {
                return false;
            }
            runtime.mark_used(RaceItemId::DraftFin);
            true
        }
        ItemKey::PaddleBurst => {
            let runtime = item_state.runtime_mut(duck_id.as_str());
            if !runtime.has_unused(RaceItemId::PaddleBurst) {
                return false;
            }
            let duck = &ducks[duck_index];
            if duck.progress < item_balance::paddle_burst::ARM_PROGRESS {
                return false;
            }
            #[allow(clippy::cast_precision_loss)] // lobby sizes are tiny
            let active_count = ducks.iter().filter(|entry| !entry.finished).count() as f64;
            let is_late_sprint = duck.progress >= item_balance::auto_use::END_GAME_BURN_PROGRESS;
            if !is_late_sprint && f64::from(duck.current_rank) <= ceil(active_count / 2.0) {
                return false;
            }
            let outcome = try_apply_prep_speed_boost(
                runtime,
                &duck_id,
                RaceItemId::PaddleBurst,
                item_balance::paddle_burst::SPEED_MULTIPLIER,
                item_balance::paddle_burst::DURATION_SECONDS,
                tick,
                tick_rate,
                emit,
                SpeedStartExtras {
                    auto_reason: Some(reason),
                    ..SpeedStartExtras::default()
                },
            );
            if outcome == PrepSpeedOutcome::Ignored {
                return false;
            }
            runtime.mark_used(RaceItemId::PaddleBurst);
            true
        }
        ItemKey::BubbleShield => {
            let runtime = item_state.runtime_mut(duck_id.as_str());
            if !runtime.has_unused(RaceItemId::BubbleShield) {
                return false;
            }
            try_activate_bubble_shield(runtime, &duck_id, tick, tick_rate, emit, reason, None)
        }
        ItemKey::HomingRocket => {
            if !item_state
                .runtime(duck_id.as_str())
                .has_unused(RaceItemId::HomingRocket)
            {
                return false;
            }
            // `raceConfig` is always passed: a fresh objective (empty Chaos
            // memos), no hazards, wild auto-use off, next zone in 999 s.
            let resolved = {
                let mut objective = build_race_objective_context(env.config);
                let mut ctx = EvalCtx {
                    tick,
                    tick_rate,
                    objective: &mut objective,
                    item_state: &*item_state,
                    hazards: &[],
                    ducks: &*ducks,
                    player_id: &duck_id,
                    seconds_until_next_pickup_zone: 999.0,
                    prep_auto_use_enabled: true,
                    wild_auto_use_enabled: false,
                    ghost_player_ids: &item_state.ghost_player_ids,
                    brains: &mut *emit.brains,
                    director: &mut *env.director,
                    math: emit.math,
                };
                let preferred = candidate.target_player_id.clone();
                let Some(resolved) =
                    ctx.resolve_rocket_target(CandidateSource::Prep, preferred.as_ref())
                else {
                    return false;
                };
                if objective.is_teammate(duck_id.as_str(), resolved.as_str()) {
                    return false;
                }
                resolved
            };
            candidate.target_player_id = Some(resolved.clone());
            if item_state.are_teammates(duck_id.as_str(), resolved.as_str()) {
                return false;
            }
            let Some(target) = ducks.iter().find(|entry| entry.player_id == resolved) else {
                return false;
            };
            if target.finished {
                return false;
            }
            let meta = execute_metadata.unwrap_or(RocketExecuteMeta {
                decision_target_id: None,
                execute_target_id: None,
                retargeted_at_execute: false,
            });
            fire_prep_rocket(
                item_state,
                &duck_id,
                ducks[duck_index].progress,
                &resolved,
                tick,
                tick_rate,
                emit,
                RocketFiredMeta {
                    auto_reason: reason,
                    decision_target_id: meta.decision_target_id,
                    execute_target_id: meta.execute_target_id,
                    retargeted_at_execute: meta.retargeted_at_execute,
                },
            )
        }
        ItemKey::Banana => {
            if !item_state
                .runtime(duck_id.as_str())
                .has_unused(RaceItemId::Banana)
            {
                return false;
            }
            let duck = &ducks[duck_index];
            if let Some(teammates) = item_state.teammates_by_player.get(duck_id.as_str())
                && !teammates.is_empty()
            {
                let teammate_at_risk = ducks.iter().any(|other| {
                    !other.finished
                        && other.player_id != duck_id
                        && id_set_has(teammates, other.player_id.as_str())
                        && other.progress < duck.progress
                        && (duck.progress - other.progress < 0.08
                            && abs(other.lateral_offset - duck.lateral_offset)
                                <= item_balance::banana::HIT_LATERAL_RADIUS * 1.5)
                });
                if teammate_at_risk {
                    return false;
                }
            }
            let progress = js_max(
                0.0,
                duck.progress - item_balance::banana::DROP_BEHIND_PROGRESS,
            );
            let lateral_offset = aimed_banana_lateral(
                duck.lateral_offset,
                candidate.aim_lateral,
                item_balance::banana::AIM_MAX_OFFSET,
            );
            if item_state.bananas.iter().any(|banana| {
                abs(banana.progress - progress) < item_balance::banana::MINIMUM_TRAP_SPACING
                    && abs(banana.lateral_offset - lateral_offset)
                        < item_balance::banana::HIT_LATERAL_RADIUS
            }) {
                return false;
            }
            let aim_offset = lateral_offset - duck.lateral_offset;
            item_state
                .runtime_mut(duck_id.as_str())
                .mark_used(RaceItemId::Banana);
            let id = next_object_id(item_state);
            item_state.bananas.push(BananaRuntime {
                id,
                source_player_id: duck_id.clone(),
                progress,
                lateral_offset,
                armed_at_tick: tick_i
                    + seconds_to_ticks(item_balance::banana::ARMING_SECONDS, tick_rate),
                expires_at_tick: tick_i
                    + seconds_to_ticks(item_balance::banana::LIFETIME_SECONDS, tick_rate),
                kind: ProjectileSource::Prep,
                hit_progress_radius: item_balance::banana::HIT_PROGRESS_RADIUS,
                hit_lateral_radius: item_balance::banana::HIT_LATERAL_RADIUS,
                progress_knockback: None,
                lateral_slip: item_balance::banana::LATERAL_SLIP,
            });
            emit.emit(
                EventKind::BananaDropped(BananaDroppedMeta {
                    progress,
                    lateral_offset,
                    aim_offset,
                    auto_reason: reason,
                }),
                Some(&duck_id),
                None,
            );
            true
        }
        ItemKey::QuackHorn => execute_prep_horn(
            candidate, item_state, duck_index, ducks, tick, tick_rate, emit,
        ),
        _ => false,
    }
}

/// The `QUACK_HORN` case of `executePrepAction` (`execute.ts:131-215`).
#[allow(clippy::too_many_lines)]
fn execute_prep_horn(
    candidate: &AutoUseCandidate,
    item_state: &mut ItemRaceState,
    duck_index: usize,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) -> bool {
    use item_balance::horn as h;
    let tick_i = i64::from(tick);
    let duck_id = ducks[duck_index].player_id.clone();
    if !item_state
        .runtime(duck_id.as_str())
        .has_unused(RaceItemId::QuackHorn)
    {
        return false;
    }
    let (side, mut nearby) = {
        let ghosts = &item_state.ghost_player_ids;
        let is_ghost = |target: &DuckPhysicsState| id_set_has(ghosts, target.player_id.as_str());
        let duck = &ducks[duck_index];
        let side = candidate.horn_side.unwrap_or_else(|| {
            default_horn_side(
                duck,
                ducks,
                h::PROGRESS_RADIUS,
                h::SIDE_REACH,
                h::CENTER_BAND,
                is_ghost,
            )
        });
        let nearby = horn_side_targets(
            duck,
            ducks,
            side,
            h::PROGRESS_RADIUS,
            h::SIDE_REACH,
            h::CENTER_BAND,
            is_ghost,
        );
        (side, nearby)
    };
    if nearby.is_empty() {
        return false;
    }
    if let Some(teammates) = item_state.teammates_by_player.get(duck_id.as_str())
        && !teammates.is_empty()
        && nearby
            .iter()
            .any(|&index| id_set_has(teammates, ducks[index].player_id.as_str()))
    {
        return false;
    }
    item_state
        .runtime_mut(duck_id.as_str())
        .mark_used(RaceItemId::QuackHorn);
    let mut slipstream_charge_destroyed_ticks: i64 = 0;
    let mut landed = 0_u32;
    let mut momentum_stolen = false;
    v8_sort_by(&mut nearby, |&left, &right| {
        id_cmp(
            ducks[left].player_id.as_str(),
            ducks[right].player_id.as_str(),
        )
    });
    let direction = f64::from(side.sign());
    for &target_index in &nearby {
        let target_id = ducks[target_index].player_id.clone();
        {
            let defense = item_state.runtime_mut(target_id.as_str());
            // DEFENSE > ATTACK: a raised Bubble shrugs the horn off intact.
            if defense.bubble_available && tick_i < defense.bubble_until_tick {
                emit.emit(
                    EventKind::BubblePopped(BubblePoppedMeta {
                        blocked: IncomingAttack::QuackHorn,
                        intact: Some(true),
                    }),
                    Some(&target_id),
                    Some(&duck_id),
                );
                grant_guard_surge(
                    defense,
                    &target_id,
                    Some(&duck_id),
                    GuardDefenseItem::BubbleShield,
                    IncomingAttack::QuackHorn,
                    tick,
                    tick_rate,
                    emit,
                );
                continue;
            }
            if defense.feather_available {
                defense.feather_available = false;
                emit.emit(
                    EventKind::FeatherDodged(FeatherDodgedMeta {
                        blocked: Some(IncomingAttack::QuackHorn),
                    }),
                    Some(&target_id),
                    Some(&duck_id),
                );
                grant_guard_surge(
                    defense,
                    &target_id,
                    Some(&duck_id),
                    GuardDefenseItem::Feather,
                    IncomingAttack::QuackHorn,
                    tick,
                    tick_rate,
                    emit,
                );
                continue;
            }
        }
        landed += 1;
        let mut push = h::LATERAL_PUSH;
        let mut shove = h::LATERAL_SHOVE;
        let shock_absorbed;
        {
            let defense = item_state.runtime_mut(target_id.as_str());
            if defense.loadout_combo == Some(LoadoutCombo::Fortress) {
                push *= 0.75;
                shove *= 0.75;
            }
            shock_absorbed = defense.shock_absorber_available;
            if shock_absorbed {
                defense.shock_absorber_available = false;
                push *= item_balance::shock_absorber::HORN_PUSH_MULTIPLIER;
                shove *= item_balance::shock_absorber::HORN_SHOVE_MULTIPLIER;
                emit.emit(
                    EventKind::ShockAbsorberProc(ShockAbsorberProcMeta {
                        mitigated: IncomingAttack::QuackHorn,
                    }),
                    Some(&target_id),
                    Some(&duck_id),
                );
                grant_guard_surge(
                    defense,
                    &target_id,
                    Some(&duck_id),
                    GuardDefenseItem::ShockAbsorber,
                    IncomingAttack::QuackHorn,
                    tick,
                    tick_rate,
                    emit,
                );
            }
            slipstream_charge_destroyed_ticks += defense.draft_slipstream_ticks;
            defense.draft_slipstream_ticks = 0;
            defense.draft_target_player_id = None;
        }

        let broken = if shock_absorbed {
            None
        } else {
            break_active_speed_boost(
                item_state.runtime_mut(target_id.as_str()),
                tick,
                tick_rate,
                emit,
                &duck_id,
                &target_id,
                BoostBreakSource::QuackHorn,
            )
        };
        if !momentum_stolen {
            momentum_stolen = grant_momentum_steal(
                item_state,
                &duck_id,
                &target_id,
                broken,
                tick,
                tick_rate,
                emit,
                item_balance::counter::HORN_MOMENTUM_STEAL_SECONDS,
                item_balance::counter::MOMENTUM_STEAL_MULTIPLIER,
            );
        }
        let defense = item_state.runtime_mut(target_id.as_str());
        if !shock_absorbed
            && tick_i
                >= defense
                    .silenced_until_tick
                    .max(defense.silence_immune_until_tick)
        {
            defense.silenced_until_tick =
                tick_i + seconds_to_ticks(h::SILENCE_DURATION_SECONDS, tick_rate);
            defense.silence_immune_until_tick = defense.silenced_until_tick
                + seconds_to_ticks(h::SILENCE_RECOVERY_SECONDS, tick_rate);
            let until = tick_u32(defense.silenced_until_tick);
            emit.emit(
                EventKind::ItemSilenced(ItemSilencedMeta {
                    duration_seconds: h::SILENCE_DURATION_SECONDS,
                    until_tick: until,
                    source: SilenceSource::QuackHorn,
                    auto_reason: None,
                }),
                Some(&target_id),
                Some(&duck_id),
            );
        }

        let target = &mut ducks[target_index];
        target.lateral_velocity += direction * push;
        target.lateral_offset = js_max(
            -0.95,
            js_min(0.95, target.lateral_offset + direction * shove),
        );
    }
    if item_state.runtime(duck_id.as_str()).loadout_combo == Some(LoadoutCombo::Menace)
        && landed > 0
    {
        trigger_menace_predator_rush(
            item_state,
            &duck_id,
            tick,
            tick_rate,
            emit,
            PredatorRushTrigger::QuackHorn,
        );
    }
    let targets: Vec<PlayerId> = nearby
        .iter()
        .map(|&index| ducks[index].player_id.clone())
        .collect();
    let destroyed = u32::try_from(slipstream_charge_destroyed_ticks).expect("tick count fits");
    #[allow(clippy::cast_precision_loss)]
    let destroyed_seconds = slipstream_charge_destroyed_ticks as f64 / f64::from(tick_rate);
    emit.emit(
        EventKind::HornUsed(HornUsedMeta {
            ducks_hit: u32::try_from(targets.len()).expect("lobby fits"),
            targets,
            auto_reason: candidate.reason,
            slipstream_charge_destroyed_ticks: destroyed,
            slipstream_charge_destroyed_seconds: destroyed_seconds,
            side,
            silenced_seconds: h::SILENCE_DURATION_SECONDS,
        }),
        Some(&duck_id),
        None,
    );
    true
}

/// `executeWildAction(candidate, itemState, ducks, tick, tickRate, emit)`
/// (`execute.ts:221-260`).
fn execute_wild_action(
    candidate: &AutoUseCandidate,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) -> bool {
    let Some(duck_index) = ducks
        .iter()
        .position(|entry| entry.player_id == candidate.player_id)
    else {
        return false;
    };
    let Some(instance_id) = candidate.wild_item_instance_id.as_deref() else {
        return false;
    };
    let duck_id = ducks[duck_index].player_id.clone();
    let runtime = item_state.runtime_mut(duck_id.as_str());
    if candidate.action != CandidateAction::Discard && i64::from(tick) < runtime.silenced_until_tick
    {
        return false;
    }

    if candidate.action == CandidateAction::Discard {
        if runtime
            .wild_item
            .as_ref()
            .is_none_or(|wild| wild.instance_id != instance_id)
        {
            return false;
        }
        let consumed = runtime.wild_item.take().expect("checked above");
        let forfeited =
            consumed.item_id == WildItemId::MiniRocket && ducks[duck_index].current_rank == 1;
        emit.emit(
            EventKind::WildItemAutoUsed(WildItemAutoUsedMeta {
                instance_id: consumed.instance_id,
                item_id: consumed.item_id,
                discarded: Some(true),
                forfeited: Some(forfeited),
                auto_reason: candidate.reason,
            }),
            Some(&duck_id),
            None,
        );
        return true;
    }

    let result = activate_wild_item(
        item_state,
        ducks,
        &WildUseInput {
            player_id: &duck_id,
            wild_item_instance_id: instance_id,
            target_player_id: candidate.target_player_id.as_ref(),
            aim_lateral: candidate.aim_lateral,
            horn_side: candidate.horn_side,
        },
        tick,
        tick_rate,
        WildUseMode::Auto(candidate.reason),
        emit,
    );
    result.ok
}
