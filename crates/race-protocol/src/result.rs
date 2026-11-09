//! Race result types: raw standings and the `DigestEnvelope` (D9).
//!
//! `DigestEnvelope = {digestVersion, configCommit, engineVersion,
//! balanceVersion, protocolVersion, rngVersion, trackVersion, trackDefSha256,
//! durationTicks, standings:[{playerId,rank,finishTick,finishTimeMs}],
//! eventsSha256, motionSha256}`. `engineBuildId` is stored but kept out of the
//! digest.
//!
//! TS sources: `RaceFinishEntry` / `RaceResult`
//! (`packages/race-protocol/src/index.ts:236-252`), built by
//! `resultFromSimulation` (`packages/race-core/src/simulation.ts:656-677`).
//! Standings are raw (core returns raw standings only; Chaos and Season meta
//! act on them later). Ghost ducks are excluded from standings.

use alloc::string::String;
use alloc::vec::Vec;

use serde::{Deserialize, Serialize};

use crate::events::RaceEvent;
use crate::ids::{PlayerId, RaceId};

/// One finisher (`RaceFinishEntry`, `index.ts:236-241`). Rank is 1-based.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceFinishEntry {
    pub player_id: PlayerId,
    pub name: String,
    pub rank: u32,
    pub finish_time_ms: f64,
}

/// A finished race (`RaceResult`, `index.ts:243-252`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceResult {
    pub race_id: RaceId,
    pub engine_version: String,
    pub balance_version: String,
    pub track_version: String,
    pub tick_rate: u32,
    /// `max(finishTimeMs)` over standings.
    pub duration_ms: f64,
    pub standings: Vec<RaceFinishEntry>,
    pub events: Vec<RaceEvent>,
}

/// One standing inside the digest envelope (D9).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct DigestStanding {
    pub player_id: PlayerId,
    pub rank: u32,
    /// The tick in which the duck crossed the line.
    pub finish_tick: u32,
    pub finish_time_ms: f64,
}

/// What `resultDigest = sha256(JCS(DigestEnvelope))` covers (D9).
///
/// `configCommit` is `seedCommit = sha256(engineConfigJson)`. `eventsSha256`
/// excludes meta events and `seq`. `motionSha256` folds `state_hash` at every
/// 60th tick and the final tick. Field order here is irrelevant: JCS sorts
/// keys (`race_core::canonical`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct DigestEnvelope {
    pub digest_version: String,
    pub config_commit: String,
    pub engine_version: String,
    pub balance_version: String,
    pub protocol_version: String,
    pub rng_version: String,
    pub track_version: String,
    pub track_def_sha256: String,
    pub duration_ticks: u32,
    pub standings: Vec<DigestStanding>,
    pub events_sha256: String,
    pub motion_sha256: String,
}
