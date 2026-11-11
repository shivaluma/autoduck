//! `trackDefSha256` (D9): sha256 of the JCS of the *simulation* track
//! definition, the `sim` object of `public/race-tracks/<id>.json`
//! (`lib/racing/track-geometry.ts` `exportTrackGeometry`): length, currents,
//! pickup and hazard zones, boost gates and the two version labels. Never
//! over DTRK bytes.

use alloc::string::String;
use alloc::vec::Vec;

use serde::Serialize;

use crate::digest::sha256_hex;
use crate::serde_jcs::{SerdeJcsError, to_jcs_string};
use crate::track::RaceTrack;

/// The geometry file of the current `river-01-v2` track
/// (`public/race-tracks/river-01-v2@678a27dc.json`). Rust tracks name it in
/// the DTRK header and the `RaceReplayTrack.trackGeometry` column. A test
/// checks that its `sim` object still equals [`track_def_jcs`] of
/// `create_river_track`; if the geometry changes, export a new file
/// (`pnpm race:tracks`) and update this id.
pub const TRACK_GEOMETRY_ID: &str = "river-01-v2@678a27dc";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Lane<'a> {
    center_lateral: f64,
    color_hex: u32,
    color_name: &'a str,
    duration_seconds: f64,
    id: &'a str,
    label: &'a str,
    max_lateral: f64,
    min_lateral: f64,
    speed_multiplier: f64,
    tier: &'a str,
}

#[derive(Serialize)]
struct Gate<'a> {
    id: &'a str,
    lanes: Vec<Lane<'a>>,
    progress: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Current {
    end_progress: f64,
    lateral_force: f64,
    speed_multiplier: f64,
    start_progress: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HazardAnchor<'a> {
    id: &'a str,
    lateral_offset: f64,
    progress: f64,
    radius: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HazardZone<'a> {
    allowed_types: Vec<&'a str>,
    anchors: Vec<HazardAnchor<'a>>,
    id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickupAnchor<'a> {
    id: &'a str,
    lateral_offset: f64,
    progress_offset: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PickupZone<'a> {
    allowed_types: Vec<&'a str>,
    candidate_anchors: Vec<PickupAnchor<'a>>,
    end_progress: f64,
    id: &'a str,
    spawn_ratio: f64,
    start_progress: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackDef<'a> {
    boost_gates: Vec<Gate<'a>>,
    currents: Vec<Current>,
    hazard_zones: Vec<HazardZone<'a>>,
    length: f64,
    pickup_layout_version: &'a str,
    pickup_zones: Vec<PickupZone<'a>>,
    version: &'a str,
}

/// The JCS text of `track`'s simulation definition.
///
/// # Errors
/// A non-finite number in the track (never for `create_river_track`).
pub fn track_def_jcs(track: &RaceTrack) -> Result<String, SerdeJcsError> {
    let def = TrackDef {
        boost_gates: track
            .boost_gates
            .iter()
            .map(|gate| Gate {
                id: &gate.id,
                progress: gate.progress,
                lanes: gate
                    .lanes
                    .iter()
                    .map(|lane| Lane {
                        center_lateral: lane.center_lateral,
                        color_hex: lane.color_hex,
                        color_name: lane.color_name,
                        duration_seconds: lane.duration_seconds,
                        id: &lane.id,
                        label: lane.label,
                        max_lateral: lane.max_lateral,
                        min_lateral: lane.min_lateral,
                        speed_multiplier: lane.speed_multiplier,
                        tier: lane.tier.as_str(),
                    })
                    .collect(),
            })
            .collect(),
        currents: track
            .currents
            .iter()
            .map(|zone| Current {
                end_progress: zone.end_progress,
                lateral_force: zone.lateral_force,
                speed_multiplier: zone.speed_multiplier,
                start_progress: zone.start_progress,
            })
            .collect(),
        hazard_zones: track
            .hazard_zones
            .iter()
            .map(|zone| HazardZone {
                allowed_types: zone.allowed_types.iter().map(|t| t.as_str()).collect(),
                anchors: zone
                    .anchors
                    .iter()
                    .map(|anchor| HazardAnchor {
                        id: &anchor.id,
                        lateral_offset: anchor.lateral_offset,
                        progress: anchor.progress,
                        radius: anchor.radius,
                    })
                    .collect(),
                id: &zone.id,
            })
            .collect(),
        length: track.length,
        pickup_layout_version: track.pickup_layout_version,
        pickup_zones: track
            .pickup_zones
            .iter()
            .map(|zone| PickupZone {
                allowed_types: zone.allowed_types.iter().map(|t| t.as_str()).collect(),
                candidate_anchors: zone
                    .candidate_anchors
                    .iter()
                    .map(|anchor| PickupAnchor {
                        id: &anchor.id,
                        lateral_offset: anchor.lateral_offset,
                        progress_offset: anchor.progress_offset,
                    })
                    .collect(),
                end_progress: zone.end_progress,
                id: &zone.id,
                spawn_ratio: zone.spawn_ratio,
                start_progress: zone.start_progress,
            })
            .collect(),
        version: &track.version,
    };
    to_jcs_string(&def)
}

/// `trackDefSha256` of `track`.
///
/// # Errors
/// As [`track_def_jcs`].
pub fn track_def_sha256(track: &RaceTrack) -> Result<String, SerdeJcsError> {
    track_def_jcs(track).map(|jcs| sha256_hex(jcs.as_bytes()))
}
