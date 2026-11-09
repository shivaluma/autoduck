//! Box and hazard spawns: `createRegularBoxes`, `createGoldenBox`,
//! `createHazards` (`pickups/engine.ts:77-193`). **M2 hook (not ported yet).**
//!
//! Exact while the corresponding switch is off (`enabled`,
//! `goldenBoxEnabled`, `hazardsEnabled`), which is what an absent
//! `pickupConfig` resolves to. Note that `pickupConfig: {enabled: false}`
//! still defaults `goldenBoxEnabled`/`hazardsEnabled` to `true`, so those
//! configs need the M2 port.
//!
//! RNG streams to keep (raceId inside the label, Phase A):
//! `pickup-spawn:<raceId>`, `gold-box:<raceId>`, `hazards:<raceId>`.
//! `shuffled` is a Fisher-Yates from the end with `rng.integer(0, index)`,
//! and both spawn lists sort by `progress - progress || id.localeCompare`.

use alloc::vec::Vec;

use race_protocol::config::{PickupConfig, ResolvedRaceConfig};

use super::state::{HazardSpawn, PickupSpawn};
use crate::track::{HazardZone, RaceTrack};

/// `createRegularBoxes(config, track, resolved)` (`pickups/engine.ts:129-149`).
///
/// # Panics
/// Until M2 lands, when regular boxes are enabled.
#[must_use]
pub fn create_regular_boxes(
    config: &ResolvedRaceConfig,
    track: &RaceTrack,
    resolved: &PickupConfig,
) -> Vec<PickupSpawn> {
    let _ = (config, track);
    if !resolved.enabled {
        return Vec::new();
    }
    todo!("M2: port createRegularBoxes (pickups/engine.ts:129-149)")
}

/// `createGoldenBox(config, track, resolved, occupied)` (`pickups/engine.ts:151-172`).
///
/// # Panics
/// Until M2 lands, when the golden box is enabled.
#[must_use]
pub fn create_golden_box(
    config: &ResolvedRaceConfig,
    track: &RaceTrack,
    resolved: &PickupConfig,
    occupied: &[PickupSpawn],
) -> Option<PickupSpawn> {
    let _ = (config, track, occupied);
    if !resolved.golden_box_enabled {
        return None;
    }
    todo!("M2: port createGoldenBox (pickups/engine.ts:151-172)")
}

/// `createHazards(config, zones, resolved)` (`pickups/engine.ts:174-193`).
///
/// # Panics
/// Until M2 lands, when hazards are enabled.
#[must_use]
pub fn create_hazards(
    config: &ResolvedRaceConfig,
    zones: &[HazardZone],
    resolved: &PickupConfig,
) -> Vec<HazardSpawn> {
    let _ = (config, zones);
    if !resolved.hazards_enabled {
        return Vec::new();
    }
    todo!("M2: port createHazards (pickups/engine.ts:174-193)")
}
