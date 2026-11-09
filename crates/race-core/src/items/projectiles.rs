//! Rockets and bananas in flight: `updateRockets` / `updateBananas`
//! (`items/engine.ts:563-778`) and `bananaTouches` (`:520-526`).
//!
//! Both are called from `tick_item_system` every tick, after the slipstream
//! tracking. Shared shape, kept from TS:
//!
//! - The list is sorted by `id` **in place** first (`itemState.rockets.sort`),
//!   then iterated; survivors go to `keep`, which replaces the list at the
//!   end. Here the sorted list is moved out with `mem::take` before the loop.
//!   That is equivalent because nothing reachable from the loop body pushes a
//!   projectile (TS `for...of` would visit an element pushed mid-loop).
//! - Ducks are looked up in `ducks` order (`state.ducks`, the creation
//!   order), except the banana victim search, which sorts the candidates by
//!   `playerId.localeCompare` (`sim::id_cmp`).
//! - The victim's item runtime is re-fetched after each call that needs the
//!   whole `ItemRaceState` (`grantMomentumSteal`, `triggerMenacePredatorRush`);
//!   TS holds one object reference throughout, so the state is the same.

use alloc::vec::Vec;
use core::mem;

use race_protocol::events::{
    BananaExpiredMeta, BananaHitMeta, BlockDefense, BoostBreakSource, BubblePoppedMeta, EmptyMeta,
    EventKind, FeatherDodgedMeta, GuardDefenseItem, IncomingAttack, MiniBubbleBlockedMeta,
    PredatorRushTrigger, ProjectileBlockedMeta, ReflexThreat, RocketHitMeta, ShockAbsorberProcMeta,
    WildFeatherDodgedMeta,
};

use super::config::item_balance;
use super::engine::{
    MOMENTUM_STEAL_DEFAULTS, apply_item_boost, apply_staged_slow, arm_bubble_reflex,
    break_active_speed_boost, grant_guard_surge, grant_momentum_steal,
    trigger_menace_predator_rush,
};
use super::interactions::{DefenseOutcome, IncomingRaceEffect, resolve_incoming_race_effect};
use super::state::{BananaRuntime, ItemRaceState, ProjectileSource, RocketRuntime};
use crate::js_sort::v8_sort_by;
use crate::math::{abs, cmp_f64_js, js_max, js_min};
use crate::pickups::config::pickup_balance;
use crate::sim::{DuckPhysicsState, Emitter, id_cmp, id_set_has};

/// `(left, right) => left.id - right.id`, in place.
fn sort_by_object_id<T>(items: &mut [T], id: impl Fn(&T) -> u32) {
    v8_sort_by(items, |left, right| id(left).cmp(&id(right)));
}

/// `ducks.find((duck) => duck.playerId === playerId)` as an index.
fn find_duck(ducks: &[DuckPhysicsState], player_id: &str) -> Option<usize> {
    ducks
        .iter()
        .position(|duck| duck.player_id.as_str() == player_id)
}

/// The retarget search of a wild rocket whose target is gone or finished
/// (`items/engine.ts:568-573`): the nearest eligible duck ahead of the
/// rocket, by progress then `localeCompare`.
fn retarget_wild_rocket(
    item_state: &ItemRaceState,
    ducks: &[DuckPhysicsState],
    rocket: &RocketRuntime,
    tick: i64,
) -> Option<usize> {
    let teammates = item_state
        .teammates_by_player
        .get(rocket.source_player_id.as_str());
    let mut candidates: Vec<usize> = (0..ducks.len())
        .filter(|&index| {
            let duck = &ducks[index];
            !duck.finished
                && duck.player_id != rocket.source_player_id
                && duck.progress > rocket.progress
        })
        .filter(|&index| {
            !id_set_has(
                &item_state.ghost_player_ids,
                ducks[index].player_id.as_str(),
            )
        })
        .filter(|&index| teammates.is_none_or(|mates| !mates.contains(&ducks[index].player_id)))
        .filter(|&index| {
            tick >= item_state
                .runtime(ducks[index].player_id.as_str())
                .rocket_protection_until_tick
        })
        .collect();
    v8_sort_by(&mut candidates, |&left, &right| {
        cmp_f64_js(ducks[left].progress, ducks[right].progress).then_with(|| {
            id_cmp(
                ducks[left].player_id.as_str(),
                ducks[right].player_id.as_str(),
            )
        })
    });
    candidates.first().copied()
}

/// `updateRockets(itemState, ducks, tick, tickRate, emit)` (`items/engine.ts:563-680`).
///
/// Quirks kept: a mini-rocket popping a raised prep bubble emits
/// `BUBBLE_POPPED {blocked: 'ROCKET'}` (not `MINI_ROCKET`) and a shock-absorbed
/// hit queues its surge as `'ROCKET'`; a failed wild retarget leaves `target`
/// undefined, so the rocket expires; `armingTicks` is the prep value for
/// mini-rockets too.
///
/// # Panics
/// If a duck has no item runtime (the TS `!`).
#[allow(clippy::too_many_lines)]
pub fn update_rockets(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let tick_i = i64::from(tick);
    sort_by_object_id(&mut item_state.rockets, |rocket| rocket.id);
    let rockets = mem::take(&mut item_state.rockets);
    let mut keep: Vec<RocketRuntime> = Vec::new();
    for mut rocket in rockets {
        let mut target = find_duck(ducks, rocket.target_player_id.as_str());
        if rocket.kind == ProjectileSource::Wild
            && target.is_none_or(|index| ducks[index].finished)
            && !rocket.retargeted
            && tick_i < rocket.expires_at_tick
        {
            // `target = ...[0]`: undefined when nobody qualifies.
            target = retarget_wild_rocket(item_state, ducks, &rocket, tick_i);
            if let Some(index) = target {
                rocket.target_player_id = ducks[index].player_id.clone();
                rocket.retargeted = true;
            }
        }
        let wild = rocket.kind == ProjectileSource::Wild;
        let target = match target {
            Some(index) if !ducks[index].finished && tick_i < rocket.expires_at_tick => index,
            _ => {
                let kind = if wild {
                    EventKind::MiniRocketExpired(EmptyMeta {})
                } else {
                    EventKind::RocketExpired(EmptyMeta {})
                };
                emit.emit(
                    kind,
                    Some(&rocket.source_player_id),
                    Some(&rocket.target_player_id),
                );
                continue;
            }
        };
        let launch_at_tick = rocket.launch_at_tick;
        if tick_i < launch_at_tick {
            keep.push(rocket);
            continue;
        }
        if tick_i == launch_at_tick
            && launch_at_tick > rocket.spawned_at_tick
            && let Some(source) = find_duck(ducks, rocket.source_player_id.as_str())
        {
            rocket.progress = ducks[source].progress;
        }
        rocket.progress += rocket.speed_per_second / f64::from(tick_rate);
        let arming_ticks = item_balance::rocket::ARMING_TICKS;
        if tick_i < launch_at_tick + arming_ticks
            || rocket.progress + rocket.hit_radius < ducks[target].progress
        {
            keep.push(rocket);
            continue;
        }
        let target_id = ducks[target].player_id.clone();
        let source_id = rocket.source_player_id.clone();
        let (incoming, incoming_attack) = if wild {
            (IncomingRaceEffect::MiniRocket, IncomingAttack::MiniRocket)
        } else {
            (IncomingRaceEffect::Rocket, IncomingAttack::Rocket)
        };
        let outcome = {
            let defense = item_state.runtime_mut(target_id.as_str());
            if rocket.kind == ProjectileSource::Prep {
                arm_bubble_reflex(
                    defense,
                    &target_id,
                    tick,
                    tick_rate,
                    emit,
                    ReflexThreat::Rocket,
                );
            }
            resolve_incoming_race_effect(defense, incoming, tick, tick_rate)
        };
        let blocked_kind = |meta: ProjectileBlockedMeta| {
            if wild {
                EventKind::MiniRocketBlocked(meta)
            } else {
                EventKind::RocketBlocked(meta)
            }
        };
        match outcome {
            DefenseOutcome::Hit => {
                let defense = item_state.runtime_mut(target_id.as_str());
                let mut is_shock_absorbed = false;
                if defense.shock_absorber_available {
                    defense.shock_absorber_available = false;
                    is_shock_absorbed = true;
                    emit.emit(
                        EventKind::ShockAbsorberProc(ShockAbsorberProcMeta {
                            mitigated: incoming_attack,
                        }),
                        Some(&target_id),
                        Some(&source_id),
                    );
                }

                // Shock softens the slow only; a prep rocket still fully
                // breaks the boost (ATTACK > SPEED).
                let break_source = if wild {
                    BoostBreakSource::MiniRocket
                } else {
                    BoostBreakSource::Rocket
                };
                let broken = break_active_speed_boost(
                    defense,
                    tick,
                    tick_rate,
                    emit,
                    &source_id,
                    &target_id,
                    break_source,
                );
                // Shock softens the blow but a packed Nitro is still up for grabs.
                let (steal_seconds, steal_multiplier) = if rocket.kind == ProjectileSource::Prep {
                    MOMENTUM_STEAL_DEFAULTS
                } else {
                    (
                        pickup_balance::counter::MOMENTUM_STEAL_SECONDS,
                        pickup_balance::counter::MOMENTUM_STEAL_MULTIPLIER,
                    )
                };
                grant_momentum_steal(
                    item_state,
                    &source_id,
                    &target_id,
                    broken,
                    tick,
                    tick_rate,
                    emit,
                    steal_seconds,
                    steal_multiplier,
                );

                // Slight lateral wobble on impact without backward coordinate teleport.
                let lateral_jolt = if is_shock_absorbed { 0.08 } else { 0.18 };
                let dir: f64 = if ducks[target].lateral_offset >= 0.0 {
                    1.0
                } else {
                    -1.0
                };
                ducks[target].lateral_velocity += dir * lateral_jolt;

                let defense = item_state.runtime_mut(target_id.as_str());
                if is_shock_absorbed {
                    apply_staged_slow(
                        defense,
                        item_balance::shock_absorber::STAGGER_MULTIPLIER,
                        item_balance::shock_absorber::STAGGER_DURATION_SECONDS,
                        item_balance::shock_absorber::RECOVERY_SLOW_MULTIPLIER,
                        item_balance::shock_absorber::RECOVERY_DURATION_SECONDS,
                        tick,
                        tick_rate,
                    );
                    // The surge starts once the absorbed stagger has played out.
                    defense.queued_guard_surge_tick = defense.recovery_slow_until_tick;
                    defense.queued_guard_surge_source = Some(source_id.clone());
                    defense.queued_guard_surge_blocked = Some(IncomingAttack::Rocket);
                } else if rocket.kind == ProjectileSource::Prep {
                    apply_staged_slow(
                        defense,
                        item_balance::rocket::STAGGER_MULTIPLIER,
                        item_balance::rocket::STAGGER_DURATION_SECONDS,
                        item_balance::rocket::RECOVERY_SLOW_MULTIPLIER,
                        item_balance::rocket::RECOVERY_DURATION_SECONDS,
                        tick,
                        tick_rate,
                    );
                } else {
                    apply_staged_slow(
                        defense,
                        pickup_balance::mini_rocket::STAGGER_MULTIPLIER,
                        pickup_balance::mini_rocket::STAGGER_DURATION_SECONDS,
                        pickup_balance::mini_rocket::RECOVERY_SLOW_MULTIPLIER,
                        pickup_balance::mini_rocket::RECOVERY_DURATION_SECONDS,
                        tick,
                        tick_rate,
                    );
                }

                let hit_meta = RocketHitMeta {
                    shock_absorbed: is_shock_absorbed,
                };
                let hit_kind = if wild {
                    EventKind::MiniRocketHit(hit_meta)
                } else {
                    EventKind::RocketHit(hit_meta)
                };
                emit.emit(hit_kind, Some(&source_id), Some(&target_id));

                // `rocket.sourcePlayerId && !isShockAbsorbed`.
                if rocket.kind == ProjectileSource::Prep
                    && !source_id.as_str().is_empty()
                    && !is_shock_absorbed
                {
                    trigger_menace_predator_rush(
                        item_state,
                        &source_id,
                        tick,
                        tick_rate,
                        emit,
                        PredatorRushTrigger::Rocket,
                    );
                }
            }
            DefenseOutcome::BlockedMiniBubble => {
                emit.emit(
                    EventKind::MiniBubbleBlocked(MiniBubbleBlockedMeta {
                        blocked: incoming_attack,
                    }),
                    Some(&target_id),
                    Some(&source_id),
                );
                emit.emit(
                    blocked_kind(ProjectileBlockedMeta {
                        blocked: None,
                        defense: BlockDefense::MiniBubble,
                    }),
                    Some(&source_id),
                    Some(&target_id),
                );
                apply_item_boost(
                    item_state.runtime_mut(target_id.as_str()),
                    pickup_balance::counter::GUARD_SURGE_MULTIPLIER,
                    pickup_balance::counter::GUARD_SURGE_DURATION_SECONDS,
                    tick,
                    tick_rate,
                );
            }
            DefenseOutcome::BlockedBubble => {
                emit.emit(
                    EventKind::BubblePopped(BubblePoppedMeta {
                        blocked: IncomingAttack::Rocket,
                        intact: None,
                    }),
                    Some(&target_id),
                    Some(&source_id),
                );
                emit.emit(
                    blocked_kind(ProjectileBlockedMeta {
                        blocked: None,
                        defense: BlockDefense::BubbleShield,
                    }),
                    Some(&source_id),
                    Some(&target_id),
                );
                grant_guard_surge(
                    item_state.runtime_mut(target_id.as_str()),
                    &target_id,
                    Some(&source_id),
                    GuardDefenseItem::BubbleShield,
                    incoming_attack,
                    tick,
                    tick_rate,
                    emit,
                );
            }
            // `IMMUNE`, and the dodges a rocket can never get.
            DefenseOutcome::Immune
            | DefenseOutcome::DodgedFeather
            | DefenseOutcome::DodgedWildFeather => {
                emit.emit(
                    blocked_kind(ProjectileBlockedMeta {
                        blocked: None,
                        defense: BlockDefense::Immunity,
                    }),
                    Some(&source_id),
                    Some(&target_id),
                );
            }
        }
    }
    item_state.rockets = keep;
}

/// `bananaTouches(duck, banana)` (`items/engine.ts:520-526`). Engine ducks
/// always carry `previousProgress`, so the `?? duck.progress` fallback never
/// applies.
#[must_use]
pub fn banana_touches(duck: &DuckPhysicsState, banana: &BananaRuntime) -> bool {
    let previous = duck.previous_progress;
    let minimum = js_min(previous, duck.progress) - banana.hit_progress_radius;
    let maximum = js_max(previous, duck.progress) + banana.hit_progress_radius;
    if banana.progress < minimum || banana.progress > maximum {
        return false;
    }
    abs(duck.lateral_offset - banana.lateral_offset) <= banana.hit_lateral_radius
}

/// `false as boolean` (`items/engine.ts:707`): a banana is never
/// shock-absorbed. A function rather than a literal so the dead branches stay
/// compiled without a constant-condition lint.
#[inline]
const fn shock_absorbed_on_banana() -> bool {
    false
}

/// `updateBananas(itemState, ducks, tick, tickRate, emit)` (`items/engine.ts:682-778`).
///
/// Quirks kept: `shockAbsorbed` is the constant `false` (its branches are
/// dead but ported); a raised prep bubble popping a wild banana emits
/// `BUBBLE_POPPED {blocked: 'BANANA'}`; the Feather-dodge and immunity paths
/// emit `BANANA_BLOCKED` even for a wild banana, without `blocked: true`.
///
/// # Panics
/// If a duck has no item runtime (the TS `!`).
#[allow(clippy::too_many_lines)]
pub fn update_bananas(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let tick_i = i64::from(tick);
    sort_by_object_id(&mut item_state.bananas, |banana| banana.id);
    let bananas = mem::take(&mut item_state.bananas);
    let mut keep: Vec<BananaRuntime> = Vec::new();
    for banana in bananas {
        let wild = banana.kind == ProjectileSource::Wild;
        if tick_i >= banana.expires_at_tick {
            let meta = BananaExpiredMeta { id: banana.id };
            let kind = if wild {
                EventKind::WildBananaExpired(meta)
            } else {
                EventKind::BananaExpired(meta)
            };
            emit.emit(kind, Some(&banana.source_player_id), None);
            continue;
        }
        if tick_i < banana.armed_at_tick {
            keep.push(banana);
            continue;
        }
        let mut candidates: Vec<usize> = (0..ducks.len())
            .filter(|&index| {
                !ducks[index].finished && ducks[index].player_id != banana.source_player_id
            })
            .collect();
        v8_sort_by(&mut candidates, |&left, &right| {
            id_cmp(
                ducks[left].player_id.as_str(),
                ducks[right].player_id.as_str(),
            )
        });
        let Some(target) = candidates
            .into_iter()
            .find(|&index| banana_touches(&ducks[index], &banana))
        else {
            keep.push(banana);
            continue;
        };
        let target_id = ducks[target].player_id.clone();
        let source_id = banana.source_player_id.clone();
        let (incoming, incoming_attack) = if wild {
            (IncomingRaceEffect::WildBanana, IncomingAttack::WildBanana)
        } else {
            (IncomingRaceEffect::Banana, IncomingAttack::Banana)
        };
        let outcome = {
            let defense = item_state.runtime_mut(target_id.as_str());
            if banana.kind == ProjectileSource::Prep {
                arm_bubble_reflex(
                    defense,
                    &target_id,
                    tick,
                    tick_rate,
                    emit,
                    ReflexThreat::Banana,
                );
            }
            resolve_incoming_race_effect(defense, incoming, tick, tick_rate)
        };
        let blocked_kind = |meta: ProjectileBlockedMeta| {
            if wild {
                EventKind::WildBananaBlocked(meta)
            } else {
                EventKind::BananaBlocked(meta)
            }
        };
        match outcome {
            DefenseOutcome::Hit => {
                let shock_absorbed = shock_absorbed_on_banana();
                if shock_absorbed {
                    item_state
                        .runtime_mut(target_id.as_str())
                        .shock_absorber_available = false;
                    emit.emit(
                        EventKind::ShockAbsorberProc(ShockAbsorberProcMeta {
                            mitigated: incoming_attack,
                        }),
                        Some(&target_id),
                        Some(&source_id),
                    );
                }
                let break_source = if wild || shock_absorbed {
                    BoostBreakSource::WildBanana
                } else {
                    BoostBreakSource::Banana
                };
                let broken = break_active_speed_boost(
                    item_state.runtime_mut(target_id.as_str()),
                    tick,
                    tick_rate,
                    emit,
                    &source_id,
                    &target_id,
                    break_source,
                );
                let (steal_seconds, steal_multiplier) = if banana.kind == ProjectileSource::Prep {
                    MOMENTUM_STEAL_DEFAULTS
                } else {
                    (
                        pickup_balance::counter::MOMENTUM_STEAL_SECONDS,
                        pickup_balance::counter::MOMENTUM_STEAL_MULTIPLIER,
                    )
                };
                grant_momentum_steal(
                    item_state,
                    &source_id,
                    &target_id,
                    broken,
                    tick,
                    tick_rate,
                    emit,
                    steal_seconds,
                    steal_multiplier,
                );
                let direction: f64 = if ducks[target].lateral_offset >= banana.lateral_offset {
                    1.0
                } else {
                    -1.0
                };
                let push = if shock_absorbed {
                    item_balance::shock_absorber::HORN_PUSH_MULTIPLIER
                } else {
                    1.0
                };
                // `direction * lateralSlip * push`, left to right.
                ducks[target].lateral_velocity += direction * banana.lateral_slip * push;

                let defense = item_state.runtime_mut(target_id.as_str());
                if shock_absorbed {
                    apply_staged_slow(
                        defense,
                        item_balance::shock_absorber::STAGGER_MULTIPLIER,
                        item_balance::shock_absorber::STAGGER_DURATION_SECONDS,
                        item_balance::shock_absorber::RECOVERY_SLOW_MULTIPLIER,
                        item_balance::shock_absorber::RECOVERY_DURATION_SECONDS,
                        tick,
                        tick_rate,
                    );
                    defense.queued_guard_surge_tick = defense.recovery_slow_until_tick;
                    defense.queued_guard_surge_source = Some(source_id.clone());
                    defense.queued_guard_surge_blocked = Some(IncomingAttack::Banana);
                } else if banana.kind == ProjectileSource::Prep {
                    apply_staged_slow(
                        defense,
                        item_balance::banana::STAGGER_MULTIPLIER,
                        item_balance::banana::STAGGER_DURATION_SECONDS,
                        item_balance::banana::RECOVERY_SLOW_MULTIPLIER,
                        item_balance::banana::RECOVERY_DURATION_SECONDS,
                        tick,
                        tick_rate,
                    );
                } else {
                    apply_staged_slow(
                        defense,
                        pickup_balance::banana::STAGGER_MULTIPLIER,
                        pickup_balance::banana::STAGGER_DURATION_SECONDS,
                        pickup_balance::banana::RECOVERY_SLOW_MULTIPLIER,
                        pickup_balance::banana::RECOVERY_DURATION_SECONDS,
                        tick,
                        tick_rate,
                    );
                }

                let hit_meta = BananaHitMeta {
                    lateral_slip: banana.lateral_slip,
                    shock_absorbed,
                };
                let hit_kind = if wild {
                    EventKind::WildBananaHit(hit_meta)
                } else {
                    EventKind::BananaHit(hit_meta)
                };
                emit.emit(hit_kind, Some(&source_id), Some(&target_id));
                // `banana.sourcePlayerId && !shockAbsorbed`.
                if banana.kind == ProjectileSource::Prep
                    && !source_id.as_str().is_empty()
                    && !shock_absorbed
                {
                    trigger_menace_predator_rush(
                        item_state,
                        &source_id,
                        tick,
                        tick_rate,
                        emit,
                        PredatorRushTrigger::Banana,
                    );
                }
            }
            DefenseOutcome::BlockedMiniBubble => {
                emit.emit(
                    EventKind::MiniBubbleBlocked(MiniBubbleBlockedMeta {
                        blocked: incoming_attack,
                    }),
                    Some(&target_id),
                    Some(&source_id),
                );
                emit.emit(
                    blocked_kind(ProjectileBlockedMeta {
                        blocked: Some(true),
                        defense: BlockDefense::MiniBubble,
                    }),
                    Some(&source_id),
                    Some(&target_id),
                );
                apply_item_boost(
                    item_state.runtime_mut(target_id.as_str()),
                    pickup_balance::counter::GUARD_SURGE_MULTIPLIER,
                    pickup_balance::counter::GUARD_SURGE_DURATION_SECONDS,
                    tick,
                    tick_rate,
                );
            }
            DefenseOutcome::BlockedBubble => {
                emit.emit(
                    EventKind::BubblePopped(BubblePoppedMeta {
                        blocked: IncomingAttack::Banana,
                        intact: None,
                    }),
                    Some(&target_id),
                    Some(&source_id),
                );
                emit.emit(
                    blocked_kind(ProjectileBlockedMeta {
                        blocked: Some(true),
                        defense: BlockDefense::BubbleShield,
                    }),
                    Some(&source_id),
                    Some(&target_id),
                );
                grant_guard_surge(
                    item_state.runtime_mut(target_id.as_str()),
                    &target_id,
                    Some(&source_id),
                    GuardDefenseItem::BubbleShield,
                    incoming_attack,
                    tick,
                    tick_rate,
                    emit,
                );
            }
            DefenseOutcome::DodgedWildFeather => {
                emit.emit(
                    EventKind::WildFeatherDodged(WildFeatherDodgedMeta {
                        hazard_id: None,
                        hazard_type: None,
                    }),
                    Some(&target_id),
                    Some(&source_id),
                );
                emit.emit(
                    blocked_kind(ProjectileBlockedMeta {
                        blocked: Some(true),
                        defense: BlockDefense::WildFeather,
                    }),
                    Some(&source_id),
                    Some(&target_id),
                );
                apply_item_boost(
                    item_state.runtime_mut(target_id.as_str()),
                    pickup_balance::counter::GUARD_SURGE_MULTIPLIER,
                    pickup_balance::counter::GUARD_SURGE_DURATION_SECONDS,
                    tick,
                    tick_rate,
                );
            }
            DefenseOutcome::DodgedFeather => {
                emit.emit(
                    EventKind::FeatherDodged(FeatherDodgedMeta { blocked: None }),
                    Some(&target_id),
                    Some(&source_id),
                );
                grant_guard_surge(
                    item_state.runtime_mut(target_id.as_str()),
                    &target_id,
                    Some(&source_id),
                    GuardDefenseItem::Feather,
                    incoming_attack,
                    tick,
                    tick_rate,
                    emit,
                );
                // Always `BANANA_BLOCKED`, even for a wild banana.
                emit.emit(
                    EventKind::BananaBlocked(ProjectileBlockedMeta {
                        blocked: None,
                        defense: BlockDefense::Feather,
                    }),
                    Some(&source_id),
                    Some(&target_id),
                );
            }
            DefenseOutcome::Immune => {
                emit.emit(
                    EventKind::BananaBlocked(ProjectileBlockedMeta {
                        blocked: None,
                        defense: BlockDefense::Immunity,
                    }),
                    Some(&source_id),
                    Some(&target_id),
                );
            }
        }
    }
    item_state.bananas = keep;
}
