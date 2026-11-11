//! DTRK/1 replay track format (D10, plan section 4.2), mirroring
//! `lib/racing/replay-track/format.ts`. `byteSha256` covers the uncompressed
//! payload; the header names `trackGeometry: "<trackVersion>@<sha8>"`.
//!
//! ```text
//! payload (LE): "DTRK" | u16 version=1 | u16 flags | u32 headerLen | header (UTF-8 JSON, sorted keys, no undefined)
//!               then sections: u8 id | u32 byteLen | bytes
//! ```
//!
//! This module owns the container: the preamble, the header struct and the
//! section framing. The section bodies (duck columns, change records,
//! entities, rockets) are encoded by the recorders and decoded into
//! [`crate::snapshot::RaceWorld`].
//!
//! `format.ts` lands on `main` in Phase 0.4 and did not exist when this
//! module was written. The section ids, change-kind codes and flag bits below
//! are therefore provisional; they must be reconciled with `format.ts` when
//! it lands (see `docs/rewrite/phase1-notes.md`).

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use core::fmt;

use serde::{Deserialize, Serialize};

use crate::ids::{PlayerId, RaceId};

/// Magic bytes at offset 0.
pub const DTRK_MAGIC: [u8; 4] = *b"DTRK";
/// Container version at offset 4.
pub const DTRK_VERSION: u16 = 1;
/// Bytes before the header JSON: magic, version, flags, header length.
pub const DTRK_PREAMBLE_LEN: usize = 12;
/// Bytes before each section body: id and byte length.
pub const DTRK_SECTION_HEADER_LEN: usize = 5;

/// Preamble flag: entity positions are not static, so section 3 carries
/// per-sample positions (plan 4.2, "finalize() asserts static positions;
/// else flag bit0 + per-sample"). Provisional.
pub const FLAG_ENTITY_PER_SAMPLE: u16 = 1 << 0;

/// Progress quantisation: `js_round(p * 2^24)`.
pub const Q_PROGRESS: u32 = 16_777_216;
/// Speed quantisation: `js_round(s * 2^24)`.
pub const Q_SPEED: u32 = 16_777_216;
/// Lateral quantisation: `js_round(l * 32767)` as `i16`.
pub const Q_LATERAL: u32 = 32_767;
/// Section 3 `srcDuck` when an entity has no source duck.
pub const NO_SOURCE_DUCK: u8 = 0xFF;

crate::wire_enum! {
    /// Which engine wrote the track.
    pub enum TrackEngineImpl {
        Ts => "ts",
        Rust => "rust",
    }
}

crate::wire_enum! {
    /// Who wrote the track (`RaceReplayTrack.source`, plan 4.3).
    pub enum TrackSource {
        LiveTs => "LIVE_TS",
        Backfill => "BACKFILL",
        LiveRust => "LIVE_RUST",
    }
}

crate::wire_enum! {
    /// How the track was verified (`RaceReplayTrack.fidelity`, D11).
    pub enum TrackFidelity {
        Recorded => "RECORDED",
        VerifiedDigest => "VERIFIED_DIGEST",
        VerifiedEvents => "VERIFIED_EVENTS",
        Unavailable => "UNAVAILABLE",
    }
}

/// Section ids (plan 4.2). Provisional numbering, in plan order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum SectionId {
    /// Section 1: per column, all ducks x samples: progress delta `i32`,
    /// speed delta `i32`, lateral `i16`, rank `u8`.
    DuckColumns = 1,
    /// Section 2: `{u32 tick, u8 duck, u8 kind, payload}` change records.
    DuckChanges = 2,
    /// Section 3: pickups, hazards, bananas.
    Entities = 3,
    /// Section 4: rockets.
    Rockets = 4,
    /// Section 5: reserved for a candidate event stream (only if Q10 = yes).
    Reserved5 = 5,
}

impl SectionId {
    /// Maps a section id byte.
    pub const fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::DuckColumns),
            2 => Some(Self::DuckChanges),
            3 => Some(Self::Entities),
            4 => Some(Self::Rockets),
            5 => Some(Self::Reserved5),
            _ => None,
        }
    }
}

/// Section 2 change kinds (plan 4.2). Provisional numbering, in plan order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[repr(u8)]
pub enum DuckChangeKind {
    /// `{item, acquiredAtTick, instanceId}`.
    WildItemSet = 1,
    /// No payload.
    WildItemClear = 2,
    /// `{u8 count}`.
    RegularPickupCount = 3,
    /// `{n, effectIdx...}`, exact `activeEffects` order.
    EffectsSet = 4,
}

impl DuckChangeKind {
    /// Maps a change-kind byte.
    pub const fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::WildItemSet),
            2 => Some(Self::WildItemClear),
            3 => Some(Self::RegularPickupCount),
            4 => Some(Self::EffectsSet),
            _ => None,
        }
    }
}

/// Quantisation scales, header key `q`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-export",
    derive(ts_rs::TS),
    ts(export, rename = "DtrkQuantisation")
)]
pub struct DtrkQuantisation {
    // Keys in sorted order (the header is written with sorted keys).
    pub lateral: u32,
    pub progress: u32,
    pub speed: u32,
}

impl Default for DtrkQuantisation {
    fn default() -> Self {
        Self {
            lateral: Q_LATERAL,
            progress: Q_PROGRESS,
            speed: Q_SPEED,
        }
    }
}

/// Engine identity, header key `engine`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct DtrkEngine {
    // Keys in sorted order.
    pub balance_version: String,
    /// `ENGINE_BUILD_ID` for Rust tracks; `null` when unknown.
    pub build: Option<String>,
    /// Git commit of the engine that produced the track; `null` when unknown.
    pub commit: Option<String>,
    pub engine_version: String,
    #[serde(rename = "impl")]
    pub engine_impl: TrackEngineImpl,
}

/// The DTRK/1 header JSON (plan 4.2). Fields are declared in sorted key
/// order (UTF-16 code-unit order, as JCS) so `serde_json` writes sorted keys.
/// Absent values are `null`, never omitted.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct DtrkHeader {
    /// Player ids in simulation order; index = duck index in sections.
    pub ducks: Vec<PlayerId>,
    /// Effect-name table; section 2 `EFFECTS_SET` stores indexes into it.
    pub effects: Vec<String>,
    pub engine: DtrkEngine,
    pub fidelity: TrackFidelity,
    pub first_tick: u32,
    /// Hazard-type table for section 3.
    pub hazard_types: Vec<String>,
    pub last_tick: u32,
    /// Pickup-type table for section 3.
    pub pickup_types: Vec<String>,
    pub q: DtrkQuantisation,
    pub race_id: RaceId,
    /// `null` until known (e.g. a track recorded for a race that failed).
    pub result_digest: Option<String>,
    pub source: TrackSource,
    pub stride: u32,
    pub tick_rate: u32,
    /// `"<trackVersion>@<sha8>"`, resolving to
    /// `public/race-tracks/<trackGeometry>.json`; `null` in tracks recorded
    /// before the geometry files existed (TS 0.4, `fixtures/replay-track`).
    pub track_geometry: Option<String>,
    pub track_version: String,
    /// Wild-item table for section 2 `WILD_ITEM_SET`.
    pub wild_items: Vec<String>,
}

/// Builds `"<trackVersion>@<sha8>"` from the geometry file's sha256 hex.
pub fn track_geometry_key(track_version: &str, geometry_sha256_hex: &str) -> String {
    let sha8 = geometry_sha256_hex.get(..8).unwrap_or(geometry_sha256_hex);
    format!("{track_version}@{sha8}")
}

/// The fixed 12-byte preamble.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DtrkPreamble {
    pub version: u16,
    pub flags: u16,
    pub header_len: u32,
}

impl DtrkPreamble {
    /// Encodes the preamble (little-endian).
    pub fn encode(&self) -> [u8; DTRK_PREAMBLE_LEN] {
        let mut out = [0u8; DTRK_PREAMBLE_LEN];
        out[0..4].copy_from_slice(&DTRK_MAGIC);
        out[4..6].copy_from_slice(&self.version.to_le_bytes());
        out[6..8].copy_from_slice(&self.flags.to_le_bytes());
        out[8..12].copy_from_slice(&self.header_len.to_le_bytes());
        out
    }

    /// Decodes and checks magic and version.
    pub fn decode(bytes: &[u8]) -> Result<Self, TrackFormatError> {
        let preamble = bytes
            .get(..DTRK_PREAMBLE_LEN)
            .ok_or(TrackFormatError::Truncated { at: 0 })?;
        if preamble[0..4] != DTRK_MAGIC {
            return Err(TrackFormatError::BadMagic);
        }
        let version = u16::from_le_bytes([preamble[4], preamble[5]]);
        if version != DTRK_VERSION {
            return Err(TrackFormatError::UnsupportedVersion { version });
        }
        Ok(Self {
            version,
            flags: u16::from_le_bytes([preamble[6], preamble[7]]),
            header_len: u32::from_le_bytes([preamble[8], preamble[9], preamble[10], preamble[11]]),
        })
    }
}

/// Container-level decode errors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrackFormatError {
    /// Fewer bytes than a length field promised, at byte offset `at`.
    Truncated { at: usize }, // usize-ok: error detail, never serialized
    /// The first four bytes are not `DTRK`.
    BadMagic,
    /// A container version other than 1.
    UnsupportedVersion { version: u16 },
    /// The header is not valid UTF-8 JSON for [`DtrkHeader`].
    Header(String),
}

impl fmt::Display for TrackFormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Truncated { at } => write!(f, "DTRK payload truncated at byte {at}"),
            Self::BadMagic => f.write_str("not a DTRK payload"),
            Self::UnsupportedVersion { version } => write!(f, "unsupported DTRK version {version}"),
            Self::Header(message) => write!(f, "invalid DTRK header: {message}"),
        }
    }
}

/// Writes the preamble and the header JSON. Sections are appended with
/// [`write_section`].
pub fn write_preamble_and_header(
    out: &mut Vec<u8>,
    flags: u16,
    header: &DtrkHeader,
) -> Result<(), TrackFormatError> {
    let json =
        serde_json::to_vec(header).map_err(|error| TrackFormatError::Header(format!("{error}")))?;
    let header_len = u32::try_from(json.len())
        .map_err(|_| TrackFormatError::Header(String::from("header too large")))?;
    out.extend_from_slice(
        &DtrkPreamble {
            version: DTRK_VERSION,
            flags,
            header_len,
        }
        .encode(),
    );
    out.extend_from_slice(&json);
    Ok(())
}

/// Appends one `u8 id | u32 byteLen | bytes` section.
///
/// # Panics
/// If `body` is 4 GiB or larger.
pub fn write_section(out: &mut Vec<u8>, id: SectionId, body: &[u8]) {
    let len = u32::try_from(body.len()).expect("DTRK section larger than u32::MAX bytes");
    out.push(id as u8);
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(body);
}

/// A decoded container: preamble, header and raw section bodies in payload
/// order. Unknown section ids are kept (forward compatibility).
#[derive(Clone, Debug, PartialEq)]
pub struct DtrkContainer<'a> {
    pub preamble: DtrkPreamble,
    pub header: DtrkHeader,
    pub sections: Vec<(u8, &'a [u8])>,
}

/// Splits an uncompressed DTRK/1 payload into preamble, header and sections.
pub fn read_container(payload: &[u8]) -> Result<DtrkContainer<'_>, TrackFormatError> {
    let preamble = DtrkPreamble::decode(payload)?;
    let header_end = DTRK_PREAMBLE_LEN
        .checked_add(preamble.header_len as usize)
        .ok_or(TrackFormatError::Truncated {
            at: DTRK_PREAMBLE_LEN,
        })?;
    let header_bytes =
        payload
            .get(DTRK_PREAMBLE_LEN..header_end)
            .ok_or(TrackFormatError::Truncated {
                at: DTRK_PREAMBLE_LEN,
            })?;
    let header: DtrkHeader = serde_json::from_slice(header_bytes)
        .map_err(|error| TrackFormatError::Header(format!("{error}")))?;
    let mut sections = Vec::new();
    let mut offset = header_end;
    while offset < payload.len() {
        let head = payload
            .get(offset..offset + DTRK_SECTION_HEADER_LEN)
            .ok_or(TrackFormatError::Truncated { at: offset })?;
        let id = head[0];
        let len = u32::from_le_bytes([head[1], head[2], head[3], head[4]]) as usize;
        let start = offset + DTRK_SECTION_HEADER_LEN;
        let end = start
            .checked_add(len)
            .ok_or(TrackFormatError::Truncated { at: start })?;
        let body = payload
            .get(start..end)
            .ok_or(TrackFormatError::Truncated { at: start })?;
        sections.push((id, body));
        offset = end;
    }
    Ok(DtrkContainer {
        preamble,
        header,
        sections,
    })
}
