//! The pickup system entry points the core step calls
//! (`packages/race-core/src/pickups/engine.ts`, S3.15).

use alloc::collections::BTreeSet;
use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{
    EmptyMeta, EventKind, HazardSpawnedMeta, MiniBubbleExpiredMeta, PickupSpawnedMeta,
    PickupZoneActivatedMeta, RecordedWildItemInput, WildItemManualInputMeta,
};
use race_protocol::ids::PickupSpawnType;
use race_protocol::snapshot::{HazardSnapshot, PickupSnapshot};

use super::collect::{collect_pickups, resolve_hazards};
use super::config::pickup_balance;
use super::spawn::{create_golden_box, create_hazards, create_regular_boxes};
use super::state::PickupRaceState;
use super::wild::{WildUseInput, WildUseMode, activate_wild_item};
use crate::items::{ItemRaceState, apply_item_boost};
use crate::js_sort::v8_sort_by;
use crate::math::{cmp_f64_js, js_max_of};
use crate::sim::{DuckPhysicsState, Emitter, WildLootOverride, id_cmp};
use crate::track::RaceTrack;

/// `createPickupRaceState(config, track)` (`pickups/engine.ts:195-207`), plus
/// the `lootOverride` that `createSimulation` spreads in.
#[must_use]
pub fn create_pickup_race_state(
    config: &ResolvedRaceConfig,
    track: &RaceTrack,
    loot_override: Option<WildLootOverride>,
) -> PickupRaceState {
    let resolved = config.pickup_config.clone();
    let regular = create_regular_boxes(config, track, &resolved);
    let golden = create_golden_box(config, track, &resolved, &regular);
    let pickups = match golden {
        Some(golden) => {
            let mut all = regular;
            all.push(golden);
            v8_sort_by(&mut all, |left, right| {
                cmp_f64_js(left.progress, right.progress).then_with(|| id_cmp(&left.id, &right.id))
            });
            all
        }
        None => regular,
    };
    let hazards = create_hazards(config, &track.hazard_zones, &resolved);
    PickupRaceState {
        config: resolved,
        pickups,
        hazards,
        activated_zone_ids: BTreeSet::new(),
        slot_full_feedback: BTreeSet::new(),
        golden_collector_player_id: None,
        loot_override,
    }
}

/// `announcePickupWorld(state, emit)` (`pickups/engine.ts:209-220`).
pub fn announce_pickup_world(state: &PickupRaceState, emit: &mut Emitter<'_>) {
    for pickup in &state.pickups {
        let meta = PickupSpawnedMeta {
            pickup_id: pickup.id.clone(),
            zone_id: pickup.zone_id.clone(),
            pickup_type: pickup.spawn_type,
            progress: pickup.progress,
            lateral_offset: pickup.lateral_offset,
        };
        let kind = if pickup.spawn_type == PickupSpawnType::GoldenBox {
            EventKind::GoldenBoxSpawned(meta)
        } else {
            EventKind::PickupSpawned(meta)
        };
        emit.emit(kind, None, None);
    }
    for hazard in &state.hazards {
        emit.emit(
            EventKind::HazardSpawned(HazardSpawnedMeta {
                hazard_id: hazard.id.clone(),
                zone_id: hazard.zone_id.clone(),
                hazard_type: hazard.hazard_type,
                progress: hazard.progress,
                lateral_offset: hazard.lateral_offset,
                radius: hazard.radius,
            }),
            None,
            None,
        );
    }
}

/// `expireWildEffects(itemState, tick, tickRate, emit)` (`pickups/engine.ts:495-509`).
fn expire_wild_effects(
    item_state: &mut ItemRaceState,
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let mut ids: Vec<race_protocol::ids::PlayerId> = item_state.by_player.keys().cloned().collect();
    v8_sort_by(&mut ids, |left, right| {
        id_cmp(left.as_str(), right.as_str())
    });
    let tick_i = i64::from(tick);
    for player_id in &ids {
        let runtime = item_state.runtime_mut(player_id.as_str());
        if runtime.wild_bubble_available && tick_i >= runtime.wild_bubble_until_tick {
            runtime.wild_bubble_available = false;
            apply_item_boost(
                runtime,
                pickup_balance::counter::MINI_BUBBLE_EXPIRY_BOOST_MULTIPLIER,
                pickup_balance::counter::MINI_BUBBLE_EXPIRY_BOOST_DURATION_SECONDS,
                tick,
                tick_rate,
            );
            emit.emit(
                EventKind::MiniBubbleExpired(MiniBubbleExpiredMeta { expiry_boost: true }),
                Some(player_id),
                None,
            );
        }
        if runtime.wild_feather_available && tick_i >= runtime.wild_feather_until_tick {
            runtime.wild_feather_available = false;
            apply_item_boost(
                runtime,
                pickup_balance::counter::EXPIRY_BOOST_MULTIPLIER,
                pickup_balance::counter::EXPIRY_BOOST_DURATION_SECONDS,
                tick,
                tick_rate,
            );
        }
        if runtime.tailwind_until_tick > 0 && tick_i == runtime.tailwind_until_tick {
            emit.emit(
                EventKind::TailwindEnded(EmptyMeta {}),
                Some(player_id),
                None,
            );
        }
        if runtime.magnet_until_tick > 0 && tick_i == runtime.magnet_until_tick {
            emit.emit(EventKind::MagnetEnded(EmptyMeta {}), Some(player_id), None);
        }
    }
}

/// `activateZones(track, pickupState, ducks, emit)` (`pickups/engine.ts:342-349`).
fn activate_zones(
    track: &RaceTrack,
    pickup_state: &mut PickupRaceState,
    ducks: &[DuckPhysicsState],
    emit: &mut Emitter<'_>,
) {
    let progresses: Vec<f64> = ducks.iter().map(|duck| duck.progress).collect();
    let furthest = js_max_of(&progresses);
    for zone in &track.pickup_zones {
        if furthest < zone.start_progress || pickup_state.activated_zone_ids.contains(&zone.id) {
            continue;
        }
        pickup_state.activated_zone_ids.insert(zone.id.clone());
        emit.emit(
            EventKind::PickupZoneActivated(PickupZoneActivatedMeta {
                zone_id: zone.id.clone(),
            }),
            None,
            None,
        );
    }
}

/// `applyRecordedWildInputs(itemState, ducks, inputs, tick, tickRate, emit)`
/// (`pickups/engine.ts:511-522`): inputs for this tick, by `clientActionId`.
pub fn apply_recorded_wild_inputs(
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    inputs: &[RecordedWildItemInput],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let mut due: Vec<&RecordedWildItemInput> = inputs
        .iter()
        .filter(|entry| entry.authoritative_tick == tick)
        .collect();
    if due.is_empty() {
        return;
    }
    v8_sort_by(&mut due, |left, right| {
        id_cmp(
            left.client_action_id.as_str(),
            right.client_action_id.as_str(),
        )
    });
    for input in due {
        let result = activate_wild_item(
            item_state,
            ducks,
            &WildUseInput {
                player_id: &input.player_id,
                wild_item_instance_id: &input.wild_item_instance_id,
                target_player_id: None,
                aim_lateral: None,
                horn_side: None,
            },
            tick,
            tick_rate,
            WildUseMode::Manual,
            emit,
        );
        emit.emit(
            EventKind::WildItemManualInput(WildItemManualInputMeta {
                instance_id: input.wild_item_instance_id.clone(),
                client_action_id: input.client_action_id.clone(),
                action: input.action,
                applied: result.ok,
                reason: result.reason,
            }),
            Some(&input.player_id),
            result.target_player_id.as_ref(),
        );
    }
}

/// `tickPickupSystem(config, track, pickupState, itemState, ducks, tick,
/// tickRate, emit)` (`pickups/engine.ts:524-530`).
#[allow(clippy::too_many_arguments)]
pub fn tick_pickup_system(
    config: &ResolvedRaceConfig,
    track: &RaceTrack,
    pickup_state: &mut PickupRaceState,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    expire_wild_effects(item_state, tick, tick_rate, emit);
    if !pickup_state.config.enabled
        && pickup_state.pickups.is_empty()
        && pickup_state.hazards.is_empty()
    {
        return;
    }
    activate_zones(track, pickup_state, ducks, emit);
    collect_pickups(
        config,
        pickup_state,
        item_state,
        ducks,
        tick,
        tick_rate,
        emit,
    );
    resolve_hazards(pickup_state, item_state, ducks, tick, tick_rate, emit);
}

/// `snapshotPickupWorld(state)` (`pickups/engine.ts:532-537`).
#[must_use]
pub fn snapshot_pickup_world(
    state: &PickupRaceState,
) -> (Vec<PickupSnapshot>, Vec<HazardSnapshot>) {
    let pickups = state
        .pickups
        .iter()
        .map(|pickup| PickupSnapshot {
            id: pickup.id.clone(),
            pickup_type: pickup.spawn_type,
            progress: pickup.progress,
            lateral_offset: pickup.lateral_offset,
            state: pickup.state,
        })
        .collect();
    let hazards = state
        .hazards
        .iter()
        .map(|hazard| HazardSnapshot {
            id: hazard.id.clone(),
            hazard_type: hazard.hazard_type,
            progress: hazard.progress,
            lateral_offset: hazard.lateral_offset,
            radius: hazard.radius,
        })
        .collect();
    (pickups, hazards)
}
