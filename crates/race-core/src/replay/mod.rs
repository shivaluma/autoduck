//! Replay tracks and race verification (plan D9, D10, §4.2, Phase 5).
//!
//! - [`recorder`]: [`TrackRecorder`], the Rust DTRK/1 live recorder (port of
//!   `lib/racing/replay-track/recorder.ts`, including the 0.4 choices: rocket
//!   retarget lists, `lastTick` = last tick, unfinished progress capped at
//!   `2^24 − 1`).
//! - [`encode`]: recording → uncompressed DTRK/1 payload ([`encode_track`]).
//! - [`decode`]: payload → per-tick worlds ([`decode_track`]).
//! - [`track_def`]: `trackDefSha256` and the current geometry id.
//! - [`run`]: [`RaceRun`], a race stepped with finish ticks, the motion fold
//!   and an optional recorder, ending in the D9 `DigestEnvelope`.
//!
//! gzip is the caller's job (race-core has no compressor); `byteSha256`
//! covers the uncompressed payload.

pub mod decode;
pub mod encode;
pub mod recorder;
pub mod run;
pub mod track_def;

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::replay_track::{DtrkEngine, TrackEngineImpl, TrackFidelity, TrackSource};
use race_protocol::result::RaceResult;

pub use decode::{DecodedTrack, decode_track};
pub use encode::{TrackMeta, encode_track, quantise_lateral, quantise_progress, quantise_speed};
pub use recorder::{TrackRecorder, TrackRecording};
pub use run::{RaceOutcome, RaceRun, engine_config_json};
pub use track_def::{TRACK_GEOMETRY_ID, track_def_jcs, track_def_sha256};

use crate::digest::sha256_hex;

/// A Rust track ready to store: `RaceReplayTrack` with `source LIVE_RUST`,
/// `fidelity RECORDED`, `engineImpl rust`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodedTrack {
    /// Uncompressed DTRK/1 payload (gzip it for the `bytes` column).
    pub payload: Vec<u8>,
    /// sha256 hex of `payload` (`byteSha256`, the ETag).
    pub byte_sha256: String,
    /// The last tick (`tickCount`; there are `tickCount + 1` samples).
    pub tick_count: u32,
    /// `null`, or a diagnostic such as `moving entities: N`.
    pub note: Option<String>,
}

/// The header metadata of a Rust-recorded track.
#[must_use]
pub fn rust_track_meta(
    result: &RaceResult,
    result_digest: Option<String>,
    commit: Option<String>,
) -> TrackMeta {
    TrackMeta {
        race_id: result.race_id.clone(),
        tick_rate: result.tick_rate,
        track_version: result.track_version.clone(),
        track_geometry: Some(String::from(TRACK_GEOMETRY_ID)),
        engine: DtrkEngine {
            balance_version: result.balance_version.clone(),
            build: Some(String::from(crate::ENGINE_BUILD_ID)),
            commit,
            engine_version: result.engine_version.clone(),
            engine_impl: TrackEngineImpl::Rust,
        },
        source: TrackSource::LiveRust,
        fidelity: TrackFidelity::Recorded,
        result_digest,
    }
}

/// Encodes `recording`, decodes it again and self-checks it against
/// `result` (plan 0.4 step 3): the decoded finish order (final rank,
/// official ducks only) equals the standings, each decoded finish tick
/// agrees with `finishTimeMs` (`(tick-1)·dt ≤ t ≤ tick·dt`), and the last
/// tick is the finish tick of the race.
///
/// # Errors
/// Any encode or self-check failure; the caller stores no track and logs
/// `[replay-track] race <id>: no track stored (<reason>)`.
pub fn encode_and_check(
    recording: &TrackRecording,
    meta: &TrackMeta,
    result: &RaceResult,
    race_tick: u32,
) -> Result<EncodedTrack, String> {
    let payload = encode_track(recording, meta)?;
    let decoded = decode_track(&payload)?;
    if decoded.last_tick() != race_tick || decoded.sample_count != race_tick + 1 {
        return Err(format!(
            "self-check: last tick {} != race tick {race_tick}",
            decoded.last_tick()
        ));
    }
    let finish = decoded.finish_ticks();
    let last = race_tick as usize;
    let dt = 1000.0 / f64::from(result.tick_rate);
    let mut order: Vec<(u8, &str)> = Vec::new();
    for entry in &result.standings {
        let index = decoded
            .header
            .ducks
            .iter()
            .position(|id| *id == entry.player_id)
            .ok_or_else(|| format!("self-check: duck {} missing", entry.player_id))?;
        let tick = finish[index]
            .ok_or_else(|| format!("self-check: duck {} never finishes", entry.player_id))?;
        let t = entry.finish_time_ms;
        if t < f64::from(tick.saturating_sub(1)) * dt - 1e-6 || t > f64::from(tick) * dt + 1e-6 {
            return Err(format!(
                "self-check: duck {} finish tick {tick} vs {t} ms",
                entry.player_id
            ));
        }
        let rank = decoded.rank[index * decoded.sample_count as usize + last];
        order.push((rank, entry.player_id.as_str()));
    }
    let mut sorted = order.clone();
    sorted.sort_by_key(|(rank, _)| *rank);
    if sorted
        .iter()
        .zip(&result.standings)
        .any(|((_, id), entry)| *id != entry.player_id.as_str())
    {
        return Err(String::from(
            "self-check: decoded finish order differs from the standings",
        ));
    }
    let note = (recording.moving_entities > 0 || recording.order_violations > 0).then(|| {
        format!(
            "moving entities: {}, order violations: {}",
            recording.moving_entities, recording.order_violations
        )
    });
    Ok(EncodedTrack {
        byte_sha256: sha256_hex(&payload),
        tick_count: race_tick,
        payload,
        note,
    })
}
