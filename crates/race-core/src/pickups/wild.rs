//! Using a held box item: `createWildRocket`, `createWildBanana`,
//! `wildHornReach`, the `HELD_HANDLERS` and `activateWildItem`
//! (`pickups/engine.ts:374-493`). Aiming is `crate::items::aim`.
//!
//! # `autoReason`
//!
//! `executeWildAction` (`auto-use/execute.ts:250-258`) calls
//! `activateWildItem` with an `emit` wrapper that spreads
//! `{...metadata, autoReason: candidate.reason}` into **every** event the
//! activation emits: the handler's own events, `BOOST_BROKEN`,
//! `*_ENDED` (broken), `MOMENTUM_STOLEN`, `ITEM_SILENCED` from the horn, and
//! `WILD_ITEM_AUTO_USED`. Here that is [`WildUseMode::Auto`] carrying the
//! reason: [`activate_wild_item`] runs the handler against a capturing
//! [`Emitter`] and patches `auto_reason` into each captured event before it
//! reaches the real log and sink (see [`with_auto_reason`]). Brain memory
//! (`noteBrainEvent`) still sees each event at emission time, in order.

use alloc::vec::Vec;

use race_protocol::events::{
    AutoReasonMeta, AutoUseReason, BoostBreakSource, EventKind, HornSide, ItemSilencedMeta,
    SilenceSource, UntilTickMeta, WildBananaDroppedMeta, WildHornUsedMeta, WildItemAutoUsedMeta,
    WildItemUsedMeta, WildUseFailure,
};
use race_protocol::ids::{PlayerId, WildItemId};

use super::catalog::{WildItemBehavior, get_wild_item};
use super::collect::{AheadFilter, nearest_ahead};
use super::config::pickup_balance;
use crate::items::aim::{aimed_banana_lateral, default_horn_side, horn_side_targets};
use crate::items::config::item_balance;
use crate::items::engine::{
    break_active_speed_boost, grant_momentum_steal, next_object_id, seconds_to_ticks,
};
use crate::items::{BananaRuntime, ItemRaceState, ProjectileSource, RocketRuntime};
use crate::js_sort::v8_sort_by;
use crate::math::{abs, js_max, js_min};
use crate::sim::{DuckPhysicsState, Emitter, EventLog, id_cmp, id_set_has};

/// `'MANUAL' | 'AUTO'`. `Auto` carries the `candidate.reason` that the
/// `executeWildAction` emit wrapper adds to every event (module docs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WildUseMode {
    Manual,
    Auto(AutoUseReason),
}

/// The `input` of `activateWildItem` (`pickups/engine.ts:478`).
#[derive(Clone, Debug, PartialEq)]
pub struct WildUseInput<'a> {
    pub player_id: &'a PlayerId,
    pub wild_item_instance_id: &'a str,
    pub target_player_id: Option<&'a PlayerId>,
    pub aim_lateral: Option<f64>,
    pub horn_side: Option<HornSide>,
}

/// `WildUseResult` (`pickups/engine.ts:69-73`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WildUseResult {
    pub ok: bool,
    pub reason: Option<WildUseFailure>,
    pub target_player_id: Option<PlayerId>,
}

impl WildUseResult {
    #[must_use]
    pub const fn failed(reason: WildUseFailure) -> Self {
        Self {
            ok: false,
            reason: Some(reason),
            target_player_id: None,
        }
    }

    #[must_use]
    pub const fn ok() -> Self {
        Self {
            ok: true,
            reason: None,
            target_player_id: None,
        }
    }
}

// ---------------------------------------------------------------------------
// pickups/engine.ts
// ---------------------------------------------------------------------------

/// `wildHornReach(duck)` (`pickups/engine.ts:405-410`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HornReach {
    pub progress_radius: f64,
    pub side_reach: f64,
    pub center_band: f64,
}

/// `wildHornReach(duck)` (`pickups/engine.ts:405-410`): box horn reach grows
/// in the end game so late horns still find someone.
#[must_use]
pub fn wild_horn_reach(progress: f64) -> HornReach {
    let end_game = progress >= pickup_balance::auto_use::END_GAME_BURN_PROGRESS;
    let force_burn = progress >= pickup_balance::auto_use::FORCE_BURN_PROGRESS;
    let scale = if force_burn {
        pickup_balance::horn::END_GAME_PROGRESS_RADIUS_MULTIPLIER
    } else if end_game {
        1.25
    } else {
        1.0
    };
    HornReach {
        progress_radius: pickup_balance::horn::PROGRESS_RADIUS * scale,
        side_reach: pickup_balance::horn::SIDE_REACH * scale,
        center_band: pickup_balance::horn::CENTER_BAND,
    }
}

/// `tick + Math.round(seconds * tickRate)`.
fn until_tick(tick: u32, seconds: f64, tick_rate: u32) -> i64 {
    i64::from(tick) + seconds_to_ticks(seconds, tick_rate)
}

/// A runtime tick as the `u32` an event carries.
fn event_tick(tick: i64) -> u32 {
    u32::try_from(tick).expect("event tick fits in u32")
}

/// `createWildRocket(itemState, duck, target, tick, tickRate)` (`pickups/engine.ts:374-384`).
fn create_wild_rocket(
    item_state: &mut ItemRaceState,
    duck: &DuckPhysicsState,
    target: &DuckPhysicsState,
    tick: u32,
    tick_rate: u32,
) -> RocketRuntime {
    let tick_i = i64::from(tick);
    RocketRuntime {
        id: next_object_id(item_state),
        source_player_id: duck.player_id.clone(),
        target_player_id: target.player_id.clone(),
        progress: duck.progress,
        spawned_at_tick: tick_i,
        launch_at_tick: tick_i,
        expires_at_tick: until_tick(
            tick,
            pickup_balance::mini_rocket::LIFETIME_SECONDS,
            tick_rate,
        ),
        kind: ProjectileSource::Wild,
        speed_per_second: pickup_balance::mini_rocket::PROJECTILE_SPEED,
        hit_radius: pickup_balance::mini_rocket::HIT_RADIUS,
        retargeted: false,
    }
}

/// `createWildBanana(itemState, duck, tick, tickRate, aimLateral)` (`pickups/engine.ts:386-402`).
fn create_wild_banana(
    item_state: &mut ItemRaceState,
    duck: &DuckPhysicsState,
    tick: u32,
    tick_rate: u32,
    aim_lateral: Option<f64>,
) -> Option<BananaRuntime> {
    use pickup_balance::banana;
    let lateral_offset =
        aimed_banana_lateral(duck.lateral_offset, aim_lateral, banana::AIM_MAX_OFFSET);
    let offsets = [
        banana::DROP_BEHIND_PROGRESS,
        banana::DROP_BEHIND_PROGRESS + 0.012,
        banana::DROP_BEHIND_PROGRESS + 0.024,
    ];
    let progress = offsets
        .iter()
        .map(|offset| js_max(0.0, duck.progress - offset))
        .find(|&point| {
            point <= 0.985
                && !item_state.bananas.iter().any(|existing| {
                    abs(existing.progress - point) < banana::MINIMUM_TRAP_SPACING
                        && abs(existing.lateral_offset - lateral_offset)
                            < banana::HIT_LATERAL_RADIUS
                })
        })?;
    Some(BananaRuntime {
        id: next_object_id(item_state),
        source_player_id: duck.player_id.clone(),
        progress,
        lateral_offset,
        armed_at_tick: until_tick(tick, banana::ARMING_SECONDS, tick_rate),
        expires_at_tick: until_tick(tick, banana::LIFETIME_SECONDS, tick_rate),
        kind: ProjectileSource::Wild,
        hit_progress_radius: banana::HIT_PROGRESS_RADIUS,
        hit_lateral_radius: banana::HIT_LATERAL_RADIUS,
        progress_knockback: None,
        lateral_slip: banana::LATERAL_SLIP,
    })
}

/// `HELD_HANDLERS.MINI_BUBBLE` (`pickups/engine.ts:415-420`).
fn use_mini_bubble(
    item_state: &mut ItemRaceState,
    player_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) -> WildUseResult {
    let runtime = item_state.runtime_mut(player_id.as_str());
    runtime.wild_bubble_available = true;
    runtime.wild_bubble_until_tick = until_tick(
        tick,
        pickup_balance::mini_bubble::DURATION_SECONDS,
        tick_rate,
    );
    let until = event_tick(runtime.wild_bubble_until_tick);
    emit.emit(
        EventKind::MiniBubbleActivated(UntilTickMeta {
            until_tick: until,
            auto_reason: None,
        }),
        Some(player_id),
        None,
    );
    WildUseResult::ok()
}

/// `HELD_HANDLERS.MINI_ROCKET` (`pickups/engine.ts:421-436`).
#[allow(clippy::too_many_arguments)]
fn use_mini_rocket(
    item_state: &mut ItemRaceState,
    duck_index: usize,
    ducks: &[DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    target_player_id: Option<&PlayerId>,
    emit: &mut Emitter<'_>,
) -> WildUseResult {
    use pickup_balance::{auto_use, mini_rocket};
    let duck = &ducks[duck_index];
    let maximum_distance = if duck.progress >= auto_use::FORCE_BURN_PROGRESS {
        mini_rocket::MAXIMUM_TARGET_DISTANCE * mini_rocket::FORCE_BURN_TARGET_DISTANCE_MULTIPLIER
    } else if duck.progress >= auto_use::END_GAME_BURN_PROGRESS {
        mini_rocket::MAXIMUM_TARGET_DISTANCE * mini_rocket::END_GAME_TARGET_DISTANCE_MULTIPLIER
    } else {
        mini_rocket::MAXIMUM_TARGET_DISTANCE
    };
    let teammates: Option<&[PlayerId]> = item_state
        .teammates_by_player
        .get(duck.player_id.as_str())
        .map(Vec::as_slice);
    // `targetPlayerId ? ducks.find(...) : undefined` (an empty id is falsy).
    let preferred = target_player_id
        .filter(|target| !target.as_str().is_empty())
        .and_then(|target| {
            ducks.iter().position(|candidate| {
                candidate.player_id == *target
                    && !candidate.finished
                    && candidate.progress > duck.progress
                    && candidate.progress - duck.progress <= maximum_distance
                    && !id_set_has(&item_state.ghost_player_ids, candidate.player_id.as_str())
                    && !teammates
                        .is_some_and(|mates| id_set_has(mates, candidate.player_id.as_str()))
            })
        });
    let target_index = preferred.or_else(|| {
        nearest_ahead(
            duck,
            ducks,
            maximum_distance,
            Some(AheadFilter {
                item_state,
                tick,
                excluded: teammates,
            }),
        )
    });
    let Some(target_index) = target_index else {
        return WildUseResult::failed(WildUseFailure::NoTarget);
    };
    let target = &ducks[target_index];
    let rocket = create_wild_rocket(item_state, duck, target, tick, tick_rate);
    item_state.rockets.push(rocket);
    emit.emit(
        EventKind::MiniRocketFired(AutoReasonMeta::default()),
        Some(&duck.player_id),
        Some(&target.player_id),
    );
    WildUseResult {
        ok: true,
        reason: None,
        target_player_id: Some(target.player_id.clone()),
    }
}

/// `HELD_HANDLERS.BANANA` (`pickups/engine.ts:437-443`).
fn use_banana(
    item_state: &mut ItemRaceState,
    duck: &DuckPhysicsState,
    tick: u32,
    tick_rate: u32,
    aim_lateral: Option<f64>,
    emit: &mut Emitter<'_>,
) -> WildUseResult {
    let Some(banana) = create_wild_banana(item_state, duck, tick, tick_rate, aim_lateral) else {
        return WildUseResult::failed(WildUseFailure::NotUseable);
    };
    let meta = WildBananaDroppedMeta {
        id: banana.id,
        progress: banana.progress,
        lateral_offset: banana.lateral_offset,
        auto_reason: None,
    };
    item_state.bananas.push(banana);
    emit.emit(
        EventKind::WildBananaDropped(meta),
        Some(&duck.player_id),
        None,
    );
    WildUseResult::ok()
}

/// `HELD_HANDLERS.QUACK_HORN` (`pickups/engine.ts:444-469`).
fn use_quack_horn(
    item_state: &mut ItemRaceState,
    duck_index: usize,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    horn_side: Option<HornSide>,
    emit: &mut Emitter<'_>,
) -> WildUseResult {
    let horner_id = ducks[duck_index].player_id.clone();
    let reach = wild_horn_reach(ducks[duck_index].progress);
    let (side, nearby) = {
        let ghosts = &item_state.ghost_player_ids;
        let is_ghost =
            |candidate: &DuckPhysicsState| id_set_has(ghosts, candidate.player_id.as_str());
        let horner = &ducks[duck_index];
        let side = horn_side.unwrap_or_else(|| {
            default_horn_side(
                horner,
                ducks,
                reach.progress_radius,
                reach.side_reach,
                reach.center_band,
                is_ghost,
            )
        });
        let mut nearby = horn_side_targets(
            horner,
            ducks,
            side,
            reach.progress_radius,
            reach.side_reach,
            reach.center_band,
            is_ghost,
        );
        v8_sort_by(&mut nearby, |&left, &right| {
            id_cmp(
                ducks[left].player_id.as_str(),
                ducks[right].player_id.as_str(),
            )
        });
        (side, nearby)
    };
    if nearby.is_empty() {
        return WildUseResult::failed(WildUseFailure::NoTarget);
    }
    let tick_i = i64::from(tick);
    let direction = f64::from(side.sign());
    let mut momentum_stolen = false;
    for &target_index in &nearby {
        let target_id = ducks[target_index].player_id.clone();
        {
            let defense = item_state.runtime(target_id.as_str());
            // Box defenses shrug the blast off, like their prep counterparts.
            if (defense.wild_bubble_available && tick_i < defense.wild_bubble_until_tick)
                || (defense.bubble_available && tick_i < defense.bubble_until_tick)
            {
                continue;
            }
        }
        let broken = break_active_speed_boost(
            item_state.runtime_mut(target_id.as_str()),
            tick,
            tick_rate,
            emit,
            &horner_id,
            &target_id,
            BoostBreakSource::WildHorn,
        );
        if !momentum_stolen {
            momentum_stolen = grant_momentum_steal(
                item_state,
                &horner_id,
                &target_id,
                broken,
                tick,
                tick_rate,
                emit,
                pickup_balance::counter::MOMENTUM_STEAL_SECONDS,
                pickup_balance::counter::MOMENTUM_STEAL_MULTIPLIER,
            );
        }
        let defense = item_state.runtime_mut(target_id.as_str());
        if tick_i
            >= defense
                .silenced_until_tick
                .max(defense.silence_immune_until_tick)
        {
            defense.silenced_until_tick = until_tick(
                tick,
                pickup_balance::counter::HORN_SILENCE_SECONDS,
                tick_rate,
            );
            defense.silence_immune_until_tick = defense.silenced_until_tick
                + seconds_to_ticks(item_balance::horn::SILENCE_RECOVERY_SECONDS, tick_rate);
            let until = event_tick(defense.silenced_until_tick);
            emit.emit(
                EventKind::ItemSilenced(ItemSilencedMeta {
                    duration_seconds: pickup_balance::counter::HORN_SILENCE_SECONDS,
                    until_tick: until,
                    source: SilenceSource::WildHorn,
                    auto_reason: None,
                }),
                Some(&target_id),
                Some(&horner_id),
            );
        }
        let target = &mut ducks[target_index];
        target.lateral_velocity += direction * pickup_balance::horn::LATERAL_PUSH;
        target.lateral_offset = js_max(
            -0.95,
            js_min(
                0.95,
                target.lateral_offset + direction * pickup_balance::horn::LATERAL_SHOVE,
            ),
        );
    }
    let targets: Vec<PlayerId> = nearby
        .iter()
        .map(|&index| ducks[index].player_id.clone())
        .collect();
    emit.emit(
        EventKind::WildHornUsed(WildHornUsedMeta {
            targets,
            side,
            auto_reason: None,
        }),
        Some(&horner_id),
        None,
    );
    WildUseResult::ok()
}

/// `HELD_HANDLERS.FEATHER` (`pickups/engine.ts:470-475`).
fn use_feather(
    item_state: &mut ItemRaceState,
    player_id: &PlayerId,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) -> WildUseResult {
    let runtime = item_state.runtime_mut(player_id.as_str());
    runtime.wild_feather_available = true;
    runtime.wild_feather_until_tick =
        until_tick(tick, pickup_balance::feather::DURATION_SECONDS, tick_rate);
    let until = event_tick(runtime.wild_feather_until_tick);
    emit.emit(
        EventKind::WildFeatherUsed(UntilTickMeta {
            until_tick: until,
            auto_reason: None,
        }),
        Some(player_id),
        None,
    );
    WildUseResult::ok()
}

/// Sets `autoReason` on an event emitted during an auto-used wild item
/// (the `{...metadata, autoReason}` spread of `auto-use/execute.ts:256`).
///
/// # Panics
/// On an event kind whose metadata has no `autoReason` field in the protocol
/// model: no such event can be emitted by `activateWildItem`, and adding the
/// key silently would diverge from TS.
pub fn set_auto_reason(kind: &mut EventKind, reason: AutoUseReason) {
    match kind {
        EventKind::MiniBubbleActivated(meta) | EventKind::WildFeatherUsed(meta) => {
            meta.auto_reason = Some(reason);
        }
        EventKind::MiniRocketFired(meta) => meta.auto_reason = Some(reason),
        EventKind::WildBananaDropped(meta) => meta.auto_reason = Some(reason),
        EventKind::WildHornUsed(meta) => meta.auto_reason = Some(reason),
        EventKind::ItemSilenced(meta) => meta.auto_reason = Some(reason),
        EventKind::BoostBroken(meta) => meta.auto_reason = Some(reason),
        EventKind::NitroEnded(meta)
        | EventKind::DraftFinEnded(meta)
        | EventKind::PaddleBurstEnded(meta) => meta.auto_reason = Some(reason),
        EventKind::MomentumStolen(meta) => meta.auto_reason = Some(reason),
        EventKind::WildItemAutoUsed(meta) => meta.auto_reason = reason,
        other => panic!(
            "autoReason on {}: not in the protocol model",
            other.type_name()
        ),
    }
}

/// Runs `body` with an [`Emitter`] whose events get `autoReason` before they
/// reach `emit`'s log and sink (the `executeWildAction` emit wrapper).
///
/// The capturing emitter shares `emit`'s brains, so `noteBrainEvent` runs at
/// emission time and in order; it continues `emit`'s `seq` counter and only
/// builds events when `emit` would (recorded, or a sink listens). Captured
/// events are forwarded in order, each to the sink first and then the log, as
/// [`Emitter::emit`] does.
pub fn with_auto_reason<R>(
    emit: &mut Emitter<'_>,
    reason: AutoUseReason,
    body: impl FnOnce(&mut Emitter<'_>) -> R,
) -> R {
    let builds = emit.log.record || emit.sink.is_some();
    let mut captured = EventLog {
        record: builds,
        events: Vec::new(),
        next_seq: emit.log.next_seq,
    };
    let result = {
        let mut inner = Emitter {
            log: &mut captured,
            sink: None,
            brains: &mut *emit.brains,
            race_id: emit.race_id,
            tick: emit.tick,
            tick_rate: emit.tick_rate,
            math: emit.math,
        };
        body(&mut inner)
    };
    emit.log.next_seq = captured.next_seq;
    for mut event in captured.events {
        set_auto_reason(&mut event.kind, reason);
        if let Some(sink) = emit.sink.as_deref_mut() {
            sink.on_event(&event);
        }
        if emit.log.record {
            emit.log.events.push(event);
        }
    }
    result
}

/// `activateWildItem(itemState, ducks, input, tick, tickRate, mode, emit)`
/// (`pickups/engine.ts:478-493`). In [`WildUseMode::Auto`] every emitted
/// event carries the reason (module docs).
#[allow(clippy::too_many_arguments)]
pub fn activate_wild_item(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    input: &WildUseInput<'_>,
    tick: u32,
    tick_rate: u32,
    mode: WildUseMode,
    emit: &mut Emitter<'_>,
) -> WildUseResult {
    match mode {
        WildUseMode::Manual => {
            activate_inner(item_state, ducks, input, tick, tick_rate, mode, emit)
        }
        WildUseMode::Auto(reason) => with_auto_reason(emit, reason, |inner| {
            activate_inner(item_state, ducks, input, tick, tick_rate, mode, inner)
        }),
    }
}

#[allow(clippy::too_many_arguments)]
fn activate_inner(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    input: &WildUseInput<'_>,
    tick: u32,
    tick_rate: u32,
    mode: WildUseMode,
    emit: &mut Emitter<'_>,
) -> WildUseResult {
    let duck_index = ducks
        .iter()
        .position(|candidate| candidate.player_id == *input.player_id);
    let Some(runtime) = item_state.by_player.get(input.player_id.as_str()) else {
        return WildUseResult::failed(WildUseFailure::NoItem);
    };
    let Some(wild) = runtime.wild_item.as_ref() else {
        return WildUseResult::failed(WildUseFailure::NoItem);
    };
    let Some(duck_index) = duck_index else {
        return WildUseResult::failed(WildUseFailure::NoItem);
    };
    if wild.instance_id != input.wild_item_instance_id {
        return WildUseResult::failed(WildUseFailure::ItemChanged);
    }
    if i64::from(tick) < runtime.silenced_until_tick {
        return WildUseResult::failed(WildUseFailure::Silenced);
    }
    let item_id = wild.item_id;
    if get_wild_item(item_id).behavior != WildItemBehavior::Held {
        return WildUseResult::failed(WildUseFailure::NotUseable);
    }
    let player_id = ducks[duck_index].player_id.clone();
    let result = match item_id {
        WildItemId::MiniBubble => use_mini_bubble(item_state, &player_id, tick, tick_rate, emit),
        WildItemId::MiniRocket => use_mini_rocket(
            item_state,
            duck_index,
            ducks,
            tick,
            tick_rate,
            input.target_player_id,
            emit,
        ),
        WildItemId::Banana => use_banana(
            item_state,
            &ducks[duck_index],
            tick,
            tick_rate,
            input.aim_lateral,
            emit,
        ),
        WildItemId::QuackHorn => use_quack_horn(
            item_state,
            duck_index,
            ducks,
            tick,
            tick_rate,
            input.horn_side,
            emit,
        ),
        WildItemId::Feather => use_feather(item_state, &player_id, tick, tick_rate, emit),
        WildItemId::MiniNitro | WildItemId::Tailwind | WildItemId::SlipstreamMagnet => {
            unreachable!("INSTANT wild items were rejected as NOT_USEABLE above")
        }
    };
    if !result.ok {
        return result;
    }
    let consumed = item_state
        .runtime_mut(player_id.as_str())
        .wild_item
        .take()
        .expect("the held item is still there after its handler");
    let kind = match mode {
        WildUseMode::Manual => EventKind::WildItemUsed(WildItemUsedMeta {
            instance_id: consumed.instance_id,
            item_id: consumed.item_id,
        }),
        WildUseMode::Auto(reason) => EventKind::WildItemAutoUsed(WildItemAutoUsedMeta {
            instance_id: consumed.instance_id,
            item_id: consumed.item_id,
            discarded: None,
            forfeited: None,
            auto_reason: reason,
        }),
    };
    emit.emit(kind, Some(&player_id), result.target_player_id.as_ref());
    result
}
