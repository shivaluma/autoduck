//! Recording → uncompressed DTRK/1 payload, a port of
//! `lib/racing/replay-track/encode.ts` (layout: `docs/replay-tracks.md`).
//!
//! Quantisation is the TS one: `js_round` (ties up), progress capped at
//! `2^24 − 1` while unfinished, lateral through the recorder's f32 and
//! clamped to ±32767. The same recording therefore encodes to the same
//! bytes in both implementations.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::ids::RaceId;
use race_protocol::replay_track::{
    DtrkEngine, DtrkHeader, DtrkQuantisation, FLAG_ENTITY_PER_SAMPLE, Q_LATERAL, Q_PROGRESS,
    Q_SPEED, SectionId, TrackFidelity, TrackSource, write_preamble_and_header, write_section,
};

use super::recorder::{DuckChange, ENTITY_BANANA, EntityId, TrackRecording};
use crate::math::js_round;

/// The header fields that don't come from the recording (`ReplayTrackMeta`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackMeta {
    pub race_id: RaceId,
    pub tick_rate: u32,
    pub track_version: String,
    pub track_geometry: Option<String>,
    pub engine: DtrkEngine,
    pub source: TrackSource,
    pub fidelity: TrackFidelity,
    pub result_digest: Option<String>,
}

/// `quantiseProgress`: an unfinished duck (`p < 1`) never quantises to 1.0.
#[must_use]
pub fn quantise_progress(progress: f64) -> f64 {
    let q = js_round(progress * f64::from(Q_PROGRESS));
    if progress < 1.0 && q >= f64::from(Q_PROGRESS) {
        f64::from(Q_PROGRESS - 1)
    } else {
        q
    }
}

/// `quantiseSpeed`.
#[must_use]
pub fn quantise_speed(speed: f64) -> f64 {
    js_round(speed * f64::from(Q_SPEED))
}

/// `quantiseLateral` (of the recorder's f32 value), clamped to ±32767.
#[must_use]
pub fn quantise_lateral(lateral: f32) -> f64 {
    let q = js_round(f64::from(lateral) * f64::from(Q_LATERAL));
    let max = f64::from(Q_LATERAL);
    if q > max {
        max
    } else if q < -max {
        -max
    } else {
        q
    }
}

#[allow(clippy::cast_possible_truncation)]
fn to_i32(value: f64) -> Result<i32, String> {
    if value.is_finite() && value >= f64::from(i32::MIN) && value <= f64::from(i32::MAX) {
        Ok(value as i32)
    } else {
        Err(format!("DTRK i32 out of range: {value}"))
    }
}

#[allow(clippy::cast_possible_truncation)]
fn to_i16(value: f64) -> Result<i16, String> {
    if value.is_finite() && value >= f64::from(i16::MIN) && value <= f64::from(i16::MAX) {
        Ok(value as i16)
    } else {
        Err(format!("DTRK i16 out of range: {value}"))
    }
}

fn u16_len(len: usize, what: &str) -> Result<[u8; 2], String> {
    u16::try_from(len)
        .map(u16::to_le_bytes)
        .map_err(|_| format!("DTRK {what} length {len} exceeds u16"))
}

fn u32_len(len: usize, what: &str) -> Result<[u8; 4], String> {
    u32::try_from(len)
        .map(u32::to_le_bytes)
        .map_err(|_| format!("DTRK {what} length {len} exceeds u32"))
}

fn str16(out: &mut Vec<u8>, value: &str) -> Result<(), String> {
    out.extend_from_slice(&u16_len(value.len(), "string")?);
    out.extend_from_slice(value.as_bytes());
    Ok(())
}

/// The header `buildReplayTrackHeader` writes.
#[must_use]
pub fn track_header(recording: &TrackRecording, meta: &TrackMeta) -> DtrkHeader {
    DtrkHeader {
        ducks: recording.ducks.clone(),
        effects: recording.effects.clone(),
        engine: meta.engine.clone(),
        fidelity: meta.fidelity,
        first_tick: 0,
        hazard_types: recording.hazard_types.clone(),
        last_tick: recording.sample_count.saturating_sub(1),
        pickup_types: recording.pickup_types.clone(),
        q: DtrkQuantisation::default(),
        race_id: meta.race_id.clone(),
        result_digest: meta.result_digest.clone(),
        source: meta.source,
        stride: 1,
        tick_rate: meta.tick_rate,
        track_geometry: meta.track_geometry.clone(),
        track_version: meta.track_version.clone(),
        wild_items: recording.wild_items.clone(),
    }
}

/// Encodes a finalized recording into the uncompressed DTRK/1 payload.
///
/// # Errors
/// A value out of its field's range (a broken recording); the caller stores
/// no track.
#[allow(clippy::too_many_lines)]
pub fn encode_track(recording: &TrackRecording, meta: &TrackMeta) -> Result<Vec<u8>, String> {
    let header = track_header(recording, meta);
    let duck_count = recording.ducks.len();
    let samples = recording.sample_count as usize;
    let expected = duck_count * samples;
    if recording.progress.len() != expected
        || recording.speed.len() != expected
        || recording.lateral.len() != expected
        || recording.rank.len() != expected
    {
        return Err(String::from("DTRK duck columns have the wrong length"));
    }
    let mut out = Vec::with_capacity(expected * 11 + 4096);
    write_preamble_and_header(&mut out, 0, &header).map_err(|error| format!("{error}"))?;

    // §1 DUCK_COLUMNS
    let mut body = Vec::with_capacity(expected * 11 + 6);
    body.extend_from_slice(&u16_len(duck_count, "duck count")?);
    body.extend_from_slice(&recording.sample_count.to_le_bytes());
    for (values, quantise) in [
        (&recording.progress, quantise_progress as fn(f64) -> f64),
        (&recording.speed, quantise_speed as fn(f64) -> f64),
    ] {
        for duck in 0..duck_count {
            let mut previous = 0.0;
            for sample in 0..samples {
                let q = quantise(values[sample * duck_count + duck]);
                body.extend_from_slice(&to_i32(q - previous)?.to_le_bytes());
                previous = q;
            }
        }
    }
    for duck in 0..duck_count {
        for sample in 0..samples {
            let q = quantise_lateral(recording.lateral[sample * duck_count + duck]);
            body.extend_from_slice(&to_i16(q)?.to_le_bytes());
        }
    }
    for duck in 0..duck_count {
        for sample in 0..samples {
            body.push(recording.rank[sample * duck_count + duck]);
        }
    }
    write_section(&mut out, SectionId::DuckColumns, &body);

    // §2 DUCK_CHANGES
    body.clear();
    body.extend_from_slice(&u32_len(recording.changes.len(), "changes")?);
    for change in &recording.changes {
        match change {
            DuckChange::WildItemSet {
                tick,
                duck,
                item,
                acquired_at_tick,
                instance_id,
            } => {
                body.extend_from_slice(&tick.to_le_bytes());
                body.extend_from_slice(&[*duck, 1, *item]);
                body.extend_from_slice(&acquired_at_tick.to_le_bytes());
                str16(&mut body, instance_id)?;
            }
            DuckChange::WildItemClear { tick, duck } => {
                body.extend_from_slice(&tick.to_le_bytes());
                body.extend_from_slice(&[*duck, 2]);
            }
            DuckChange::RegularPickupCount { tick, duck, count } => {
                body.extend_from_slice(&tick.to_le_bytes());
                body.extend_from_slice(&[*duck, 3, *count]);
            }
            DuckChange::EffectsSet {
                tick,
                duck,
                effects,
            } => {
                body.extend_from_slice(&tick.to_le_bytes());
                let n = u8::try_from(effects.len())
                    .map_err(|_| String::from("DTRK too many effects"))?;
                body.extend_from_slice(&[*duck, 4, n]);
                body.extend_from_slice(effects);
            }
        }
    }
    write_section(&mut out, SectionId::DuckChanges, &body);

    // §3 ENTITIES
    body.clear();
    body.extend_from_slice(&u32_len(recording.entities.len(), "entities")?);
    for entity in &recording.entities {
        body.push(entity.class);
        body.push(if entity.moving {
            #[allow(clippy::cast_possible_truncation)]
            {
                FLAG_ENTITY_PER_SAMPLE as u8
            }
        } else {
            0
        });
        match (&entity.id, entity.class == ENTITY_BANANA) {
            (EntityId::Number(id), true) => body.extend_from_slice(&id.to_le_bytes()),
            (EntityId::Text(id), false) => str16(&mut body, id)?,
            (EntityId::Number(id), false) => str16(&mut body, &format!("{id}"))?,
            (EntityId::Text(id), true) => {
                return Err(format!("DTRK banana id {id} is not numeric"));
            }
        }
        body.extend_from_slice(&[entity.type_index, entity.source]);
        body.extend_from_slice(&entity.progress.to_le_bytes());
        body.extend_from_slice(&entity.lateral.to_le_bytes());
        body.extend_from_slice(&entity.radius.to_le_bytes());
        body.extend_from_slice(&entity.first_tick.to_le_bytes());
        body.extend_from_slice(&entity.last_tick.to_le_bytes());
        body.push(entity.initial_state);
        body.extend_from_slice(&u16_len(entity.state_changes.len(), "state changes")?);
        for (tick, state) in &entity.state_changes {
            body.extend_from_slice(&tick.to_le_bytes());
            body.push(*state);
        }
        if entity.moving {
            for value in &entity.samples {
                body.extend_from_slice(&value.to_le_bytes());
            }
        }
    }
    write_section(&mut out, SectionId::Entities, &body);

    // §4 ROCKETS
    body.clear();
    body.extend_from_slice(&u32_len(recording.rockets.len(), "rockets")?);
    for rocket in &recording.rockets {
        body.extend_from_slice(&rocket.id.to_le_bytes());
        body.extend_from_slice(&[rocket.kind, rocket.source, rocket.target]);
        body.extend_from_slice(&rocket.first_tick.to_le_bytes());
        body.extend_from_slice(&u32_len(rocket.progress.len(), "rocket samples")?);
        for value in &rocket.progress {
            let q = js_round(value * f64::from(Q_PROGRESS));
            body.extend_from_slice(&to_i32(q)?.to_le_bytes());
        }
        body.extend_from_slice(&u16_len(rocket.retargets.len(), "retargets")?);
        for (tick, target) in &rocket.retargets {
            body.extend_from_slice(&tick.to_le_bytes());
            body.push(*target);
        }
    }
    write_section(&mut out, SectionId::Rockets, &body);
    Ok(out)
}
