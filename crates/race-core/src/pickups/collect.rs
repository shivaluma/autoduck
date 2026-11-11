//! Box collection and hazard contact (`pickups/engine.ts:222-372`):
//! `rankBucket`, `weightedCategory`, `nearestAhead`, `rollWildItem`,
//! `grantOrTriggerItem`, `crossingFraction`, `touches`, `collectPickups`,
//! `resolveHazards`.
//!
//! `tick_pickup_system` only reaches these when pickups are enabled or a box
//! or hazard exists (`pickups/engine.ts:526`).
//!
//! Order-sensitive details kept from TS:
//! - loot: `pickup-loot:<raceId>:<pickupId>:<playerId>` stream; one
//!   `range(0, 100)` walked over `POSITION_CATEGORY_WEIGHTS` in
//!   `Object.entries` order, then one `integer` over the filtered
//!   `WILD_ITEM_CATALOG` (catalog order); a forced item draws nothing;
//! - active boxes are visited by `id.localeCompare`; contacts and the
//!   slot-full feedback in `state.ducks` order; the collector is the first of
//!   `Math.hypot(Δprogress, Δlateral) || crossingFraction ||
//!   playerId.localeCompare` (`EngineMath::hypot2`, V8-exact under
//!   `ts-compat`). **F6 (S3.16):** the distance key is the squared distance
//!   `Δprogress² + Δlateral²` (same order, no `hypot` in the sim, nothing
//!   host-dependent);
//! - hazards are visited in spawn order, ducks by `playerId.localeCompare`.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use core::cmp::Ordering;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{
    EventKind, GoldenBoxCollectedMeta, HazardMeta, PickupCollectedMeta, PickupSkippedSlotFullMeta,
    UntilTickMeta, WildFeatherDodgedMeta, WildItemGrantedMeta,
};
use race_protocol::ids::{HazardType, PickupSpawnType, PlayerId, WildItemId};
use race_protocol::snapshot::PickupState;

use super::catalog::{WILD_ITEM_CATALOG, WildItemBehavior, WildItemCategory, get_wild_item};
use super::config::{pickup_balance, position_category_weights};
use super::state::{PickupRaceState, PickupSpawn};
use crate::items::engine::seconds_to_ticks;
use crate::items::interactions::{
    DefenseOutcome, IncomingRaceEffect, resolve_incoming_race_effect,
};
use crate::items::{
    DuckItemRuntime, HeldWildItem, ItemRaceState, apply_item_boost, apply_item_slow,
};
use crate::js_sort::v8_sort_by;
use crate::math::{abs, cmp_f64_js, js_clamp, js_max, js_min, js_sign};
use crate::rng::{DeterministicRng, create_race_rng, engine_stream};
use crate::sim::{DuckPhysicsState, Emitter, EngineMath, LootPick, id_cmp, id_set_has};

/// `'front' | 'middle' | 'back'`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RankBucket {
    Front,
    Middle,
    Back,
}

/// The collector's distance key to `pickup`: `Math.hypot(Δprogress,
/// Δlateral)` under `ts-compat`, the squared distance in S3.16 (F6). Both
/// order ducks the same way up to rounding; the squared form needs no
/// `hypot`.
fn collector_distance(math: EngineMath, duck: &DuckPhysicsState, pickup: &PickupSpawn) -> f64 {
    let progress = duck.progress - pickup.progress;
    let lateral = duck.lateral_offset - pickup.lateral_offset;
    #[cfg(feature = "ts-compat")]
    {
        math.hypot2(progress, lateral)
    }
    #[cfg(not(feature = "ts-compat"))]
    {
        let _ = math;
        progress * progress + lateral * lateral
    }
}

/// `rankBucket(duck, playerCount)` (`pickups/engine.ts:222-227`).
#[must_use]
pub fn rank_bucket(current_rank: u32, player_count: usize) -> RankBucket {
    let player_count = i64::try_from(player_count).expect("player count fits in i64");
    // `Math.max(1, Math.ceil(playerCount * 0.25))` on an integer count.
    let edge = ((player_count + 3) / 4).max(1);
    let rank = i64::from(current_rank);
    if rank <= edge {
        RankBucket::Front
    } else if rank > player_count - edge {
        RankBucket::Back
    } else {
        RankBucket::Middle
    }
}

/// `weightedCategory(rng, bucket)` (`pickups/engine.ts:229-239`).
fn weighted_category(rng: &mut DeterministicRng, bucket: RankBucket) -> WildItemCategory {
    let entries: &[(WildItemCategory, u32)] = match bucket {
        RankBucket::Front => &position_category_weights::FRONT,
        RankBucket::Middle => &position_category_weights::MIDDLE,
        RankBucket::Back => &position_category_weights::BACK,
    };
    let total: u32 = entries.iter().map(|(_, weight)| weight).sum();
    let roll = rng.range(0.0, f64::from(total));
    let mut cursor = 0.0;
    for (category, weight) in entries {
        cursor += f64::from(*weight);
        if roll < cursor {
            return *category;
        }
    }
    entries[entries.len() - 1].0
}

/// The optional tail of `nearestAhead(duck, ducks, maximumDistance,
/// itemState?, tick?, excludedPlayerIds?)`. Every TS caller passes either
/// none of them or `itemState` and `tick` together.
#[derive(Clone, Copy, Debug)]
pub struct AheadFilter<'a> {
    /// Ghosts are skipped and `rocketProtectionUntilTick` is honoured.
    pub item_state: &'a ItemRaceState,
    pub tick: u32,
    /// `excludedPlayerIds` (teammates); `None` is `undefined`.
    pub excluded: Option<&'a [PlayerId]>,
}

/// `nearestAhead(...)` (`pickups/engine.ts:241-248`): the index in `ducks`
/// of the closest unfinished duck strictly ahead within `maximum_distance`,
/// ties by `playerId.localeCompare`.
///
/// Without a filter, ghosts *are* candidates (TS `!itemState?.ghostPlayerIds
/// .has(...)` is `true` when `itemState` is absent), which is how
/// `rollWildItem` and the magnet target call it.
#[must_use]
pub fn nearest_ahead(
    duck: &DuckPhysicsState,
    ducks: &[DuckPhysicsState],
    maximum_distance: f64,
    filter: Option<AheadFilter<'_>>,
) -> Option<usize> {
    let mut candidates: Vec<usize> = (0..ducks.len())
        .filter(|&index| {
            let candidate = &ducks[index];
            !candidate.finished
                && candidate.player_id != duck.player_id
                && candidate.progress > duck.progress
        })
        .filter(|&index| {
            filter.is_none_or(|filter| {
                !id_set_has(
                    &filter.item_state.ghost_player_ids,
                    ducks[index].player_id.as_str(),
                )
            })
        })
        .filter(|&index| {
            filter
                .and_then(|filter| filter.excluded)
                .is_none_or(|excluded| !id_set_has(excluded, ducks[index].player_id.as_str()))
        })
        .filter(|&index| ducks[index].progress - duck.progress <= maximum_distance)
        .filter(|&index| {
            filter.is_none_or(|filter| {
                i64::from(filter.tick)
                    >= filter
                        .item_state
                        .runtime(ducks[index].player_id.as_str())
                        .rocket_protection_until_tick
            })
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

/// `rollWildItem(config, pickupState, pickup, duck, ducks)` (`pickups/engine.ts:250-262`).
///
/// # Panics
/// If every wild item is disabled (TS throws `At least one Wild Item must be
/// enabled`).
#[must_use]
pub fn roll_wild_item(
    config: &ResolvedRaceConfig,
    pickup_state: &PickupRaceState,
    pickup_id: &str,
    duck: &DuckPhysicsState,
    ducks: &[DuckPhysicsState],
) -> WildItemId {
    let disabled = &pickup_state.config.disabled_items;
    if let Some(forced) = pickup_state.config.force_item
        && !disabled.contains(&forced)
    {
        return forced;
    }
    let mut rng = create_race_rng(
        config.seed.as_str(),
        &engine_stream(
            "pickup-loot",
            config.race_id.as_str(),
            &format!("{pickup_id}:{}", duck.player_id),
        ),
    );
    let bucket = if pickup_state.config.position_aware_loot {
        rank_bucket(duck.current_rank, ducks.len())
    } else {
        RankBucket::Middle
    };
    let category = weighted_category(&mut rng, bucket);
    let mut candidates: Vec<WildItemId> = WILD_ITEM_CATALOG
        .iter()
        .filter(|item| item.category == category && !disabled.contains(&item.id))
        .map(|item| item.id)
        .collect();
    if nearest_ahead(
        duck,
        ducks,
        pickup_balance::magnet::MAXIMUM_TARGET_DISTANCE,
        None,
    )
    .is_none()
    {
        candidates.retain(|item| *item != WildItemId::SlipstreamMagnet);
    }
    if candidates.is_empty() {
        candidates = WILD_ITEM_CATALOG
            .iter()
            .filter(|item| !disabled.contains(&item.id))
            .map(|item| item.id)
            .collect();
    }
    assert!(
        !candidates.is_empty(),
        "At least one Wild Item must be enabled"
    );
    candidates[rng.index(candidates.len())]
}

/// `tick + Math.round(seconds * tickRate)` as an event/runtime tick.
fn until_tick(tick: u32, seconds: f64, tick_rate: u32) -> i64 {
    i64::from(tick) + seconds_to_ticks(seconds, tick_rate)
}

/// A runtime tick as the `u32` an event carries.
fn event_tick(tick: i64) -> u32 {
    u32::try_from(tick).expect("event tick fits in u32")
}

/// `grantOrTriggerItem(config, pickupState, itemState, pickup, duck, ducks,
/// tick, tickRate, emit)` (`pickups/engine.ts:264-288`).
#[allow(clippy::too_many_arguments)]
fn grant_or_trigger_item(
    config: &ResolvedRaceConfig,
    pickup_state: &PickupRaceState,
    item_state: &mut ItemRaceState,
    pickup_id: &str,
    duck_index: usize,
    ducks: &[DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let duck = &ducks[duck_index];
    let player_id = &duck.player_id;
    let pick = pickup_state
        .loot_override
        .as_ref()
        .and_then(|loot| (loot.0)(player_id));
    let item_id = match pick {
        Some(LootPick::Empty) => return,
        Some(LootPick::Item(item)) => item,
        None => roll_wild_item(config, pickup_state, pickup_id, duck, ducks),
    };
    let definition = get_wild_item(item_id);
    let instance_id = format!("wild:{}:{}:{}", config.race_id, pickup_id, player_id);
    let runtime: &mut DuckItemRuntime = item_state.runtime_mut(player_id.as_str());
    let granted = WildItemGrantedMeta {
        pickup_id: String::from(pickup_id),
        instance_id: instance_id.clone(),
        item_id,
        rank: duck.current_rank,
    };
    if definition.behavior == WildItemBehavior::Held {
        runtime.wild_item = Some(HeldWildItem {
            instance_id,
            item_id,
            acquired_at_tick: tick,
        });
        emit.emit(EventKind::WildItemGranted(granted), Some(player_id), None);
        return;
    }
    match item_id {
        WildItemId::MiniNitro => {
            apply_item_boost(
                runtime,
                pickup_balance::mini_nitro::MULTIPLIER,
                pickup_balance::mini_nitro::DURATION_SECONDS,
                tick,
                tick_rate,
            );
        }
        WildItemId::Tailwind => {
            apply_item_boost(
                runtime,
                pickup_balance::tailwind::MULTIPLIER,
                pickup_balance::tailwind::DURATION_SECONDS,
                tick,
                tick_rate,
            );
            runtime.tailwind_until_tick =
                until_tick(tick, pickup_balance::tailwind::DURATION_SECONDS, tick_rate);
            let until = event_tick(runtime.tailwind_until_tick);
            emit.emit(
                EventKind::TailwindStarted(UntilTickMeta {
                    until_tick: until,
                    auto_reason: None,
                }),
                Some(player_id),
                None,
            );
        }
        WildItemId::SlipstreamMagnet => {
            apply_item_boost(
                runtime,
                pickup_balance::magnet::MULTIPLIER,
                pickup_balance::magnet::DURATION_SECONDS,
                tick,
                tick_rate,
            );
            runtime.magnet_until_tick =
                until_tick(tick, pickup_balance::magnet::DURATION_SECONDS, tick_rate);
            let until = event_tick(runtime.magnet_until_tick);
            let target = nearest_ahead(
                duck,
                ducks,
                pickup_balance::magnet::MAXIMUM_TARGET_DISTANCE,
                None,
            )
            .map(|index| &ducks[index].player_id);
            emit.emit(
                EventKind::MagnetStarted(UntilTickMeta {
                    until_tick: until,
                    auto_reason: None,
                }),
                Some(player_id),
                target,
            );
        }
        // Every other INSTANT item: none exist (the rest are HELD).
        _ => {}
    }
    emit.emit(
        EventKind::InstantPickupTriggered(granted),
        Some(player_id),
        None,
    );
}

/// `crossingFraction(duck, progress)` (`pickups/engine.ts:290-295`).
fn crossing_fraction(duck: &DuckPhysicsState, progress: f64) -> f64 {
    let previous = duck.previous_progress;
    let travelled = duck.progress - previous;
    if travelled <= 0.0 {
        return 1.0;
    }
    js_clamp((progress - previous) / travelled, 0.0, 1.0)
}

/// `touches(duck, progress, lateralOffset, progressRadius, lateralRadius)`
/// (`pickups/engine.ts:297-301`).
fn touches(
    duck: &DuckPhysicsState,
    progress: f64,
    lateral_offset: f64,
    progress_radius: f64,
    lateral_radius: f64,
) -> bool {
    let minimum = js_min(duck.previous_progress, duck.progress) - progress_radius;
    let maximum = js_max(duck.previous_progress, duck.progress) + progress_radius;
    progress >= minimum
        && progress <= maximum
        && abs(duck.lateral_offset - lateral_offset) <= lateral_radius
}

/// `collectPickups(config, pickupState, itemState, ducks, tick, tickRate, emit)`
/// (`pickups/engine.ts:303-340`).
#[allow(clippy::too_many_arguments)]
pub fn collect_pickups(
    config: &ResolvedRaceConfig,
    pickup_state: &mut PickupRaceState,
    item_state: &mut ItemRaceState,
    ducks: &[DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let mut order: Vec<usize> = (0..pickup_state.pickups.len())
        .filter(|&index| pickup_state.pickups[index].state == PickupState::Active)
        .collect();
    {
        let pickups = &pickup_state.pickups;
        v8_sort_by(&mut order, |&left, &right| {
            id_cmp(&pickups[left].id, &pickups[right].id)
        });
    }
    let math = emit.math;
    for pickup_index in order {
        let pickup: PickupSpawn = pickup_state.pickups[pickup_index].clone();
        let contacts: Vec<usize> = (0..ducks.len())
            .filter(|&index| {
                !ducks[index].finished
                    && touches(
                        &ducks[index],
                        pickup.progress,
                        pickup.lateral_offset,
                        pickup_balance::PROGRESS_RADIUS,
                        pickup_balance::LATERAL_RADIUS,
                    )
            })
            .collect();
        if contacts.is_empty() {
            continue;
        }
        let mut eligible: Vec<usize> = Vec::with_capacity(contacts.len());
        for index in contacts {
            if pickup.spawn_type == PickupSpawnType::GoldenBox {
                eligible.push(index);
                continue;
            }
            let player_id = &ducks[index].player_id;
            let runtime = item_state.runtime(player_id.as_str());
            if runtime.regular_pickup_count >= pickup_state.config.regular_pickup_cap {
                continue;
            }
            let Some(held) = runtime.wild_item.as_ref() else {
                eligible.push(index);
                continue;
            };
            let key = format!("{}:{}", pickup.id, player_id);
            if !pickup_state.slot_full_feedback.contains(&key) {
                pickup_state.slot_full_feedback.insert(key);
                emit.emit(
                    EventKind::PickupSkippedSlotFull(PickupSkippedSlotFullMeta {
                        pickup_id: pickup.id.clone(),
                        item_id: held.item_id,
                    }),
                    Some(player_id),
                    None,
                );
            }
        }
        v8_sort_by(&mut eligible, |&left, &right| {
            let left_duck = &ducks[left];
            let right_duck = &ducks[right];
            let left_distance = collector_distance(math, left_duck, &pickup);
            let right_distance = collector_distance(math, right_duck, &pickup);
            cmp_f64_js(left_distance, right_distance)
                .then_with(|| {
                    cmp_f64_js(
                        crossing_fraction(left_duck, pickup.progress),
                        crossing_fraction(right_duck, pickup.progress),
                    )
                })
                .then_with(|| id_cmp(left_duck.player_id.as_str(), right_duck.player_id.as_str()))
        });
        let Some(&collector_index) = eligible.first() else {
            continue;
        };
        let collector_id = &ducks[collector_index].player_id;
        {
            let spawn = &mut pickup_state.pickups[pickup_index];
            spawn.state = PickupState::Collected;
            spawn.collected_by_player_id = Some(collector_id.clone());
            spawn.collected_at_tick = Some(tick);
        }
        emit.emit(
            EventKind::PickupCollected(PickupCollectedMeta {
                pickup_id: pickup.id.clone(),
                pickup_type: pickup.spawn_type,
                progress: pickup.progress,
                lateral_offset: pickup.lateral_offset,
            }),
            Some(collector_id),
            None,
        );
        if pickup.spawn_type == PickupSpawnType::GoldenBox {
            pickup_state.golden_collector_player_id = Some(collector_id.clone());
            emit.emit(
                EventKind::GoldenBoxCollected(GoldenBoxCollectedMeta {
                    pickup_id: pickup.id.clone(),
                }),
                Some(collector_id),
                None,
            );
            continue;
        }
        let runtime = item_state.runtime_mut(collector_id.as_str());
        runtime.regular_pickup_count = runtime
            .regular_pickup_count
            .checked_add(1)
            .expect("pickup count fits in u32");
        grant_or_trigger_item(
            config,
            pickup_state,
            item_state,
            &pickup.id,
            collector_index,
            ducks,
            tick,
            tick_rate,
            emit,
        );
    }
}

/// `resolveHazards(pickupState, itemState, ducks, tick, tickRate, emit)`
/// (`pickups/engine.ts:351-372`).
pub fn resolve_hazards(
    pickup_state: &mut PickupRaceState,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    for hazard in &mut pickup_state.hazards {
        let mut order: Vec<usize> = (0..ducks.len())
            .filter(|&index| !ducks[index].finished)
            .collect();
        v8_sort_by(&mut order, |&left, &right| {
            id_cmp(
                ducks[left].player_id.as_str(),
                ducks[right].player_id.as_str(),
            )
        });
        for index in order {
            let duck = &ducks[index];
            if id_set_has(&hazard.hit_player_ids, duck.player_id.as_str())
                || !touches(
                    duck,
                    hazard.progress,
                    hazard.lateral_offset,
                    pickup_balance::PROGRESS_RADIUS,
                    hazard.radius,
                )
            {
                continue;
            }
            let player_id = duck.player_id.clone();
            hazard.hit_player_ids.push(player_id.clone());
            let runtime = item_state.runtime_mut(player_id.as_str());
            let minor = hazard.hazard_type != HazardType::Whirlpool;
            let outcome = if minor {
                resolve_incoming_race_effect(
                    runtime,
                    IncomingRaceEffect::MinorHazard,
                    tick,
                    tick_rate,
                )
            } else {
                DefenseOutcome::Hit
            };
            let meta = HazardMeta {
                hazard_id: hazard.id.clone(),
                hazard_type: hazard.hazard_type,
            };
            if outcome == DefenseOutcome::DodgedWildFeather {
                apply_item_boost(
                    runtime,
                    pickup_balance::counter::GUARD_SURGE_MULTIPLIER,
                    pickup_balance::counter::GUARD_SURGE_DURATION_SECONDS,
                    tick,
                    tick_rate,
                );
                emit.emit(
                    EventKind::WildFeatherDodged(WildFeatherDodgedMeta {
                        hazard_id: Some(hazard.id.clone()),
                        hazard_type: Some(hazard.hazard_type),
                    }),
                    Some(&player_id),
                    None,
                );
                emit.emit(EventKind::HazardDodged(meta), Some(&player_id), None);
                continue;
            }
            let tuning = pickup_balance::hazard(hazard.hazard_type);
            apply_item_slow(
                runtime,
                tuning.slow_multiplier,
                tuning.duration_seconds,
                tick,
                tick_rate,
            );
            let duck = &mut ducks[index];
            let direction = if duck.lateral_offset == hazard.lateral_offset {
                if id_cmp(duck.player_id.as_str(), &hazard.id) == Ordering::Less {
                    -1.0
                } else {
                    1.0
                }
            } else {
                js_sign(duck.lateral_offset - hazard.lateral_offset)
            };
            duck.lateral_velocity += direction * tuning.wobble;
            emit.emit(EventKind::HazardHit(meta), Some(&player_id), None);
        }
    }
}

#[cfg(all(test, not(feature = "ts-compat")))]
mod tests {
    use crate::math::{cmp_f64_js, hypot};

    /// F6: the squared distance orders contacts exactly like `hypot` on the
    /// contact scale (Δprogress ≤ 0.01, Δlateral ≤ 0.2).
    #[test]
    fn f6_squared_distance_orders_like_hypot() {
        let mut points: alloc::vec::Vec<(f64, f64)> = alloc::vec::Vec::new();
        for i in 0..40_i32 {
            for j in 0..40_i32 {
                points.push((
                    f64::from(i - 20) * 0.000_5,
                    f64::from(j - 20) * 0.01 + f64::from(i) * 1e-7,
                ));
            }
        }
        for (a, b) in points.iter().zip(points.iter().skip(7)) {
            let squared = cmp_f64_js(a.0 * a.0 + a.1 * a.1, b.0 * b.0 + b.1 * b.1);
            let hyp = cmp_f64_js(hypot(a.0, a.1), hypot(b.0, b.1));
            assert!(
                squared == hyp || hyp == core::cmp::Ordering::Equal,
                "{a:?} vs {b:?}"
            );
        }
    }
}
