//! The river track: `packages/race-core/src/track.ts` (S3.15).
//!
//! Everything except [`RaceTrack::sample`] is simulation data (currents,
//! pickup zones, hazard zones, boost gates). `sample` is **render-only**: the
//! simulation never calls it, and it uses the soft-float libm wrappers, not
//! V8's `Math.sin`/`Math.cos`/`Math.hypot`, so it is not bit-exact with the
//! TS renderer (it does not need to be).

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::events::BoostLaneTier;
use race_protocol::ids::{HazardType, PickupSpawnType};

use crate::math;

/// `BoostLane` (`track.ts:3-14`).
#[derive(Clone, Debug, PartialEq)]
pub struct BoostLane {
    pub id: String,
    pub tier: BoostLaneTier,
    pub min_lateral: f64,
    pub max_lateral: f64,
    pub center_lateral: f64,
    pub speed_multiplier: f64,
    pub duration_seconds: f64,
    /// `0xRRGGBB`.
    pub color_hex: u32,
    pub color_name: &'static str,
    pub label: &'static str,
}

/// `BoostGate` (`track.ts:16-20`).
#[derive(Clone, Debug, PartialEq)]
pub struct BoostGate {
    pub id: String,
    pub progress: f64,
    pub lanes: Vec<BoostLane>,
}

/// `CurrentZone` (`track.ts:22-27`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CurrentZone {
    pub start_progress: f64,
    pub end_progress: f64,
    pub speed_multiplier: f64,
    pub lateral_force: f64,
}

/// `TrackPoint` (`track.ts:29-35`), render-only.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TrackPoint {
    pub x: f64,
    pub y: f64,
    pub tangent_x: f64,
    pub tangent_y: f64,
    pub width: f64,
}

/// `PickupAnchor` (`track.ts:37-41`).
#[derive(Clone, Debug, PartialEq)]
pub struct PickupAnchor {
    pub id: String,
    pub lateral_offset: f64,
    pub progress_offset: f64,
}

/// `PickupZone` (`track.ts:43-50`).
#[derive(Clone, Debug, PartialEq)]
pub struct PickupZone {
    pub id: String,
    pub start_progress: f64,
    pub end_progress: f64,
    pub candidate_anchors: Vec<PickupAnchor>,
    pub spawn_ratio: f64,
    pub allowed_types: Vec<PickupSpawnType>,
}

/// `HazardAnchor` (`track.ts:52-57`).
#[derive(Clone, Debug, PartialEq)]
pub struct HazardAnchor {
    pub id: String,
    pub progress: f64,
    pub lateral_offset: f64,
    pub radius: f64,
}

/// `HazardZone` (`track.ts:59-63`).
#[derive(Clone, Debug, PartialEq)]
pub struct HazardZone {
    pub id: String,
    pub anchors: Vec<HazardAnchor>,
    pub allowed_types: Vec<HazardType>,
}

/// `RaceTrack` (`track.ts:65-74`).
#[derive(Clone, Debug, PartialEq)]
pub struct RaceTrack {
    pub version: String,
    pub length: f64,
    pub currents: Vec<CurrentZone>,
    pub pickup_zones: Vec<PickupZone>,
    pub hazard_zones: Vec<HazardZone>,
    pub boost_gates: Vec<BoostGate>,
    pub pickup_layout_version: &'static str,
}

struct TierConfig {
    speed_multiplier: f64,
    duration_seconds: f64,
    color_hex: u32,
    color_name: &'static str,
    label: &'static str,
}

/// `BOOST_TIER_CONFIG` (`track.ts:78-83`).
const fn tier_config(tier: BoostLaneTier) -> TierConfig {
    match tier {
        BoostLaneTier::Hyper => TierConfig {
            speed_multiplier: 1.25,
            duration_seconds: 1.8,
            color_hex: 0x00ff_b703,
            color_name: "#ffb703",
            label: "HYPER +25%",
        },
        BoostLaneTier::Super => TierConfig {
            speed_multiplier: 1.16,
            duration_seconds: 1.5,
            color_hex: 0x0000_f0ff,
            color_name: "#00f0ff",
            label: "SUPER +16%",
        },
        BoostLaneTier::Standard => TierConfig {
            speed_multiplier: 1.08,
            duration_seconds: 1.2,
            color_hex: 0x0006_d6a0,
            color_name: "#06d6a0",
            label: "STANDARD +8%",
        },
        BoostLaneTier::Neutral => TierConfig {
            speed_multiplier: 1.02,
            duration_seconds: 1.0,
            color_hex: 0x00a8_55f7,
            color_name: "#a855f7",
            label: "CLEAR +2%",
        },
    }
}

/// `createBoostLanes` (`track.ts:85-105`).
fn create_boost_lanes(gate_id: &str, tiers: [BoostLaneTier; 4]) -> Vec<BoostLane> {
    const BOUNDARIES: [f64; 5] = [-0.85, -0.425, 0.0, 0.425, 0.85];
    tiers
        .iter()
        .enumerate()
        .map(|(index, &tier)| {
            let min_lateral = BOUNDARIES[index];
            let max_lateral = BOUNDARIES[index + 1];
            let config = tier_config(tier);
            BoostLane {
                id: format!("{gate_id}-lane-{}", index + 1),
                tier,
                min_lateral,
                max_lateral,
                center_lateral: (min_lateral + max_lateral) / 2.0,
                speed_multiplier: config.speed_multiplier,
                duration_seconds: config.duration_seconds,
                color_hex: config.color_hex,
                color_name: config.color_name,
                label: config.label,
            }
        })
        .collect()
}

fn hazard_anchor(id: &str, progress: f64, lateral_offset: f64, radius: f64) -> HazardAnchor {
    HazardAnchor {
        id: String::from(id),
        progress,
        lateral_offset,
        radius,
    }
}

/// `createRiverTrack(version = 'river-01-v2')` (`track.ts:107-197`). The
/// geometry is the same for every version string (the TS code ignores it
/// except as a label).
#[must_use]
pub fn create_river_track(version: &str) -> RaceTrack {
    let currents = Vec::from([
        CurrentZone {
            start_progress: 0.14,
            end_progress: 0.24,
            speed_multiplier: 1.035,
            lateral_force: 0.05,
        },
        CurrentZone {
            start_progress: 0.42,
            end_progress: 0.52,
            speed_multiplier: 0.97,
            lateral_force: -0.06,
        },
        CurrentZone {
            start_progress: 0.7,
            end_progress: 0.82,
            speed_multiplier: 1.045,
            lateral_force: 0.04,
        },
    ]);
    const PICKUP_OFFSETS: [f64; 5] = [-0.72, -0.36, 0.0, 0.36, 0.72];
    let pickup_zones = [0.2, 0.42, 0.64, 0.82]
        .iter()
        .enumerate()
        .map(|(zone_index, &center)| PickupZone {
            id: format!("pickup-zone-{}", zone_index + 1),
            start_progress: center - 0.025,
            end_progress: center + 0.025,
            spawn_ratio: 0.85,
            allowed_types: Vec::from([PickupSpawnType::QuackBox, PickupSpawnType::GoldenBox]),
            candidate_anchors: PICKUP_OFFSETS
                .iter()
                .enumerate()
                .map(|(anchor_index, &lateral_offset)| {
                    // `((anchorIndex % 2) * 2 - 1) * 0.006`: exactly -0.006 or 0.006.
                    let sign = if anchor_index % 2 == 1 { 1.0 } else { -1.0 };
                    PickupAnchor {
                        id: format!("z{}-a{}", zone_index + 1, anchor_index + 1),
                        lateral_offset,
                        progress_offset: sign * 0.006,
                    }
                })
                .collect(),
        })
        .collect();
    let hazard_zones = Vec::from([
        HazardZone {
            id: String::from("hazard-zone-a"),
            anchors: Vec::from([
                hazard_anchor("hz-a1", 0.31, -0.48, 0.13),
                hazard_anchor("hz-a2", 0.34, 0.42, 0.14),
            ]),
            allowed_types: Vec::from([
                HazardType::Anchor,
                HazardType::IcePatch,
                HazardType::StickyGoo,
            ]),
        },
        HazardZone {
            id: String::from("hazard-zone-b"),
            anchors: Vec::from([
                hazard_anchor("hz-b1", 0.54, -0.3, 0.14),
                hazard_anchor("hz-b2", 0.57, 0.5, 0.13),
            ]),
            allowed_types: Vec::from([
                HazardType::Whirlpool,
                HazardType::IcePatch,
                HazardType::StickyGoo,
            ]),
        },
        HazardZone {
            id: String::from("hazard-zone-c"),
            anchors: Vec::from([
                hazard_anchor("hz-c1", 0.73, -0.52, 0.13),
                hazard_anchor("hz-c2", 0.76, 0.28, 0.14),
            ]),
            allowed_types: Vec::from([
                HazardType::Anchor,
                HazardType::Whirlpool,
                HazardType::StickyGoo,
            ]),
        },
    ]);
    use BoostLaneTier::{Hyper, Neutral, Standard, Super};
    let boost_gates = Vec::from([
        BoostGate {
            id: String::from("boost-gate-1"),
            progress: 0.26,
            lanes: create_boost_lanes("bg-1", [Hyper, Super, Standard, Neutral]),
        },
        BoostGate {
            id: String::from("boost-gate-2"),
            progress: 0.48,
            lanes: create_boost_lanes("bg-2", [Standard, Hyper, Neutral, Super]),
        },
        BoostGate {
            id: String::from("boost-gate-3"),
            progress: 0.68,
            lanes: create_boost_lanes("bg-3", [Neutral, Standard, Super, Hyper]),
        },
        BoostGate {
            id: String::from("boost-gate-4"),
            progress: 0.85,
            lanes: create_boost_lanes("bg-4", [Super, Hyper, Standard, Neutral]),
        },
    ]);
    RaceTrack {
        version: String::from(version),
        length: 4200.0,
        currents,
        pickup_zones,
        hazard_zones,
        boost_gates,
        pickup_layout_version: "river-pickups-v1",
    }
}

/// `currentAt(track, progress)` (`track.ts:199-201`): the first current zone
/// containing `progress` (bounds inclusive).
#[must_use]
pub fn current_at(track: &RaceTrack, progress: f64) -> Option<&CurrentZone> {
    track
        .currents
        .iter()
        .find(|zone| progress >= zone.start_progress && progress <= zone.end_progress)
}

impl BoostGate {
    /// The lane a duck at `lateral_offset` passes through
    /// (`simulation.ts:354-355,576-577`): the first lane whose inclusive
    /// bounds contain it, else the outermost lane on that side.
    ///
    /// # Panics
    /// If the gate has no lanes (every river gate has four).
    #[must_use]
    pub fn lane_at(&self, lateral_offset: f64) -> &BoostLane {
        self.lanes
            .iter()
            .find(|lane| lateral_offset >= lane.min_lateral && lateral_offset <= lane.max_lateral)
            .unwrap_or_else(|| {
                if lateral_offset < -0.85 {
                    self.lanes.first().expect("gate has lanes")
                } else {
                    self.lanes.last().expect("gate has lanes")
                }
            })
    }
}

impl RaceTrack {
    /// `track.sample(progress, lateralOffset)` (`track.ts:173-195`).
    ///
    /// **Render-only.** Uses the libm wrappers, so it is deterministic across
    /// targets but not bit-exact with V8's `Math.sin/cos/hypot`. The
    /// simulation never calls it.
    #[must_use]
    pub fn sample(&self, progress: f64, lateral_offset: f64) -> TrackPoint {
        use core::f64::consts::PI;
        let length = self.length;
        let p = math::js_clamp(progress, 0.0, 1.0);
        let center_x = p * length;
        let center_y = 270.0 * math::sin(p * PI * 2.25) + 125.0 * math::sin(p * PI * 5.1 + 0.7);
        let derivative_x = length;
        let derivative_y = 270.0 * PI * 2.25 * math::cos(p * PI * 2.25)
            + 125.0 * PI * 5.1 * math::cos(p * PI * 5.1 + 0.7);
        let magnitude = math::hypot(derivative_x, derivative_y);
        let tangent_x = derivative_x / magnitude;
        let tangent_y = derivative_y / magnitude;
        let normal_x = -tangent_y;
        let normal_y = tangent_x;
        let width = 310.0 + 45.0 * math::sin(p * PI * 3.7 + 0.4);
        let offset = math::js_clamp(lateral_offset, -1.0, 1.0) * width * 0.42;
        TrackPoint {
            x: center_x + normal_x * offset,
            y: center_y + normal_y * offset,
            tangent_x,
            tangent_y,
            width,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn river_layout_matches_ts() {
        let track = create_river_track("river-01-v2");
        assert_eq!(track.pickup_zones.len(), 4);
        assert_eq!(track.pickup_zones[1].candidate_anchors[0].id, "z2-a1");
        assert_eq!(
            track.pickup_zones[1].candidate_anchors[0].progress_offset,
            -0.006
        );
        assert_eq!(
            track.pickup_zones[1].candidate_anchors[1].progress_offset,
            0.006
        );
        assert_eq!(track.pickup_zones[0].start_progress, 0.2 - 0.025);
        assert_eq!(track.boost_gates[2].lanes[3].id, "bg-3-lane-4");
        assert_eq!(track.boost_gates[2].lanes[3].tier, BoostLaneTier::Hyper);
        assert_eq!(track.boost_gates[0].lanes[0].center_lateral, -0.6375);
        assert_eq!(track.boost_gates[0].lane_at(-0.9).id, "bg-1-lane-1");
        assert_eq!(track.boost_gates[0].lane_at(0.9).id, "bg-1-lane-4");
        assert_eq!(track.boost_gates[0].lane_at(0.0).id, "bg-1-lane-2");
        assert!(current_at(&track, 0.24).is_some());
        assert!(current_at(&track, 0.3).is_none());
    }
}
