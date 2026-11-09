//! Box and hazard spawns: `shuffled`, `boxCount`, `createRegularBoxes`,
//! `createGoldenBox`, `createHazards` (`pickups/engine.ts:77-193`).
//!
//! RNG streams (raceId inside the label, Phase A): `pickup-spawn:<raceId>`,
//! `gold-box:<raceId>`, `hazards:<raceId>`. Draw order is part of the replay
//! contract and is kept call for call:
//! - regular boxes: one Fisher-Yates over every zone's `candidateAnchors`
//!   (zones in track order), whether or not the zone spawns any box;
//! - golden box: `next()` (skipped when `forceGoldenBox`), then the zone
//!   index, then the anchor index;
//! - hazards: `next()` for the count, one Fisher-Yates over all zones, then
//!   per chosen zone the anchor index and then the type index.
//!
//! Both spawn lists sort by `progress - progress || id.localeCompare(id)`
//! (`js_sort::v8_sort_by`, `cmp_f64_js`, `sim::id_cmp`).

use alloc::format;
use alloc::vec::Vec;

use race_protocol::config::{PickupConfig, ResolvedRaceConfig};
use race_protocol::ids::PickupSpawnType;
use race_protocol::snapshot::PickupState;

use super::config::pickup_balance;
use super::state::{HazardSpawn, PickupSpawn};
use crate::js_sort::v8_sort_by;
use crate::math::{cmp_f64_js, js_clamp, js_max, js_min, js_round, trunc};
use crate::rng::{DeterministicRng, create_race_rng};
use crate::sim::id_cmp;
use crate::track::{HazardZone, PickupZone, RaceTrack};

/// `shuffled(values, rng)` (`pickups/engine.ts:77-84`): Fisher-Yates from the
/// end with `rng.integer(0, index)`, on a copy.
fn shuffled<T: Clone>(values: &[T], rng: &mut DeterministicRng) -> Vec<T> {
    let mut result = values.to_vec();
    for index in (1..result.len()).rev() {
        let upper = i64::try_from(index).expect("shuffle index fits in i64");
        let swap = usize::try_from(rng.integer(0, upper)).expect("integer(0, index) >= 0");
        result.swap(index, swap);
    }
    result
}

/// `len` as a JS number.
fn len_f64(len: usize) -> f64 {
    f64::from(u32::try_from(len).expect("length fits in u32"))
}

/// `boxCount(playerCount, zone, multiplier)` (`pickups/engine.ts:123-127`),
/// as the JS number `slice` then receives.
fn box_count(player_count: usize, zone: &PickupZone, multiplier: f64) -> f64 {
    if multiplier <= 0.0 || zone.spawn_ratio <= 0.0 {
        return 0.0;
    }
    let normal = js_clamp(js_round(len_f64(player_count) * 0.5), 2.0, 5.0);
    js_clamp(
        js_round(normal * multiplier * zone.spawn_ratio),
        2.0,
        len_f64(zone.candidate_anchors.len()),
    )
}

/// The length of `array.slice(0, end)` for a JS number `end`
/// (`ToIntegerOrInfinity`; a negative end counts from the back).
fn slice_end(len: usize, end: f64) -> usize {
    let len_f = len_f64(len);
    let relative = if end.is_nan() { 0.0 } else { trunc(end) };
    let clamped = if relative < 0.0 {
        js_max(len_f + relative, 0.0)
    } else {
        js_min(relative, len_f)
    };
    // Integral and within [0, len].
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let end = clamped as usize;
    end
}

/// The spawn order: `left.progress - right.progress ||
/// left.id.localeCompare(right.id)` (`pickups/engine.ts:148,201`).
pub fn sort_pickups(spawns: &mut [PickupSpawn]) {
    v8_sort_by(spawns, |left, right| {
        cmp_f64_js(left.progress, right.progress).then_with(|| id_cmp(&left.id, &right.id))
    });
}

/// `createRegularBoxes(config, track, resolved)` (`pickups/engine.ts:129-149`).
#[must_use]
pub fn create_regular_boxes(
    config: &ResolvedRaceConfig,
    track: &RaceTrack,
    resolved: &PickupConfig,
) -> Vec<PickupSpawn> {
    if !resolved.enabled {
        return Vec::new();
    }
    let mut rng = create_race_rng(
        config.seed.as_str(),
        &format!("pickup-spawn:{}", config.race_id),
    );
    let mut spawns: Vec<PickupSpawn> = Vec::new();
    for zone in &track.pickup_zones {
        let order = shuffled(&zone.candidate_anchors, &mut rng);
        let count = slice_end(
            order.len(),
            box_count(config.players.len(), zone, resolved.spawn_multiplier),
        );
        let center = (zone.start_progress + zone.end_progress) / 2.0;
        for anchor in &order[..count] {
            spawns.push(PickupSpawn {
                id: format!("box:{}:{}", zone.id, anchor.id),
                zone_id: zone.id.clone(),
                anchor_id: anchor.id.clone(),
                spawn_type: PickupSpawnType::QuackBox,
                progress: js_clamp(
                    center + anchor.progress_offset,
                    zone.start_progress,
                    zone.end_progress,
                ),
                lateral_offset: anchor.lateral_offset,
                state: PickupState::Active,
                collected_by_player_id: None,
                collected_at_tick: None,
            });
        }
    }
    sort_pickups(&mut spawns);
    spawns
}

/// `createGoldenBox(config, track, resolved, occupied)` (`pickups/engine.ts:151-172`).
///
/// # Panics
/// If the chosen zone has no candidate anchors (TS reads `undefined.id` and
/// throws).
#[must_use]
pub fn create_golden_box(
    config: &ResolvedRaceConfig,
    track: &RaceTrack,
    resolved: &PickupConfig,
    occupied: &[PickupSpawn],
) -> Option<PickupSpawn> {
    if !resolved.golden_box_enabled {
        return None;
    }
    let mut rng = create_race_rng(
        config.seed.as_str(),
        &format!("gold-box:{}", config.race_id),
    );
    if !resolved.force_golden_box && rng.next_f64() >= resolved.golden_box_probability {
        return None;
    }
    let zones: Vec<&PickupZone> = track
        .pickup_zones
        .iter()
        .filter(|zone| {
            zone.start_progress >= pickup_balance::GOLDEN_PROGRESS_MINIMUM
                && zone.end_progress <= pickup_balance::GOLDEN_PROGRESS_MAXIMUM
        })
        .collect();
    if zones.is_empty() {
        return None;
    }
    let zone = zones[rng.index(zones.len())];
    let occupied_anchors: Vec<&str> = occupied
        .iter()
        .filter(|spawn| spawn.zone_id == zone.id)
        .map(|spawn| spawn.anchor_id.as_str())
        .collect();
    let available: Vec<_> = zone
        .candidate_anchors
        .iter()
        .filter(|anchor| !occupied_anchors.contains(&anchor.id.as_str()))
        .collect();
    let candidates: Vec<_> = if available.is_empty() {
        zone.candidate_anchors.iter().collect()
    } else {
        available
    };
    let anchor = candidates[rng.index(candidates.len())];
    let center = (zone.start_progress + zone.end_progress) / 2.0;
    Some(PickupSpawn {
        id: format!("gold:{}:{}", zone.id, anchor.id),
        zone_id: zone.id.clone(),
        anchor_id: anchor.id.clone(),
        spawn_type: PickupSpawnType::GoldenBox,
        progress: js_clamp(
            center + anchor.progress_offset,
            pickup_balance::GOLDEN_PROGRESS_MINIMUM,
            pickup_balance::GOLDEN_PROGRESS_MAXIMUM,
        ),
        lateral_offset: anchor.lateral_offset,
        state: PickupState::Active,
        collected_by_player_id: None,
        collected_at_tick: None,
    })
}

/// `createHazards(config, zones, resolved)` (`pickups/engine.ts:174-193`).
///
/// # Panics
/// If a chosen zone has no anchors or no allowed types (TS throws on
/// `undefined.id`, or builds a hazard whose type is `undefined`).
#[must_use]
pub fn create_hazards(
    config: &ResolvedRaceConfig,
    zones: &[HazardZone],
    resolved: &PickupConfig,
) -> Vec<HazardSpawn> {
    if !resolved.hazards_enabled {
        return Vec::new();
    }
    let mut rng = create_race_rng(config.seed.as_str(), &format!("hazards:{}", config.race_id));
    let count_roll = rng.next_f64();
    let count: usize = if count_roll < 0.45 {
        0
    } else if count_roll < 0.9 {
        1
    } else {
        2
    };
    let order = shuffled(zones, &mut rng);
    let mut hazards: Vec<HazardSpawn> = Vec::new();
    for (index, zone) in order.iter().take(count).enumerate() {
        let anchor = &zone.anchors[rng.index(zone.anchors.len())];
        let hazard_type = zone.allowed_types[rng.index(zone.allowed_types.len())];
        hazards.push(HazardSpawn {
            id: format!("hazard:{}:{}:{}", zone.id, anchor.id, index + 1),
            zone_id: zone.id.clone(),
            anchor_id: anchor.id.clone(),
            hazard_type,
            progress: anchor.progress,
            lateral_offset: anchor.lateral_offset,
            radius: anchor.radius,
            hit_player_ids: Vec::new(),
        });
    }
    v8_sort_by(&mut hazards, |left, right| {
        cmp_f64_js(left.progress, right.progress).then_with(|| id_cmp(&left.id, &right.id))
    });
    hazards
}
