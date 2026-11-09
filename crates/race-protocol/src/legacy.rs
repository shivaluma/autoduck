//! `LegacyRaceConfigV1` (D8) and `LegacyRaceEvent` (§4.6): lenient,
//! display-only parsing of configs and stored events written by engine
//! <= 1.2.0. Never fed to the simulation.
//!
//! Leniency rules:
//! - every field has a default (`#[serde(default)]`), so a missing key never
//!   fails the parse;
//! - every known field is read through [`LegacyJson`] first and converted
//!   best-effort, so a key with an unexpected type becomes its default
//!   instead of failing the whole parse (numbers are accepted where strings
//!   are expected and are formatted with Rust's shortest `Display`);
//! - list entries that do not convert are dropped, the rest are kept;
//! - unknown keys are kept in `extra` (flattened back on serialisation);
//! - item, chaos and source names stay strings, because old configs may use
//!   names the current enums do not know.
//!
//! The only hard failure is input that is not a JSON object.
//!
//! TS history: the shape has been stable since `09add72` (2026-08-13); only
//! ranges and defaults changed (`cosmeticKey` max 80 -> 2048, `isGhost`
//! default, `nitroSpeedMultiplier` max 1.2 -> 1.35, `rocketSlowMultiplier` min
//! 0.75 -> 0.1, `regularPickupCap` default 2 -> 3).

use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::fmt;

use serde::de::value::{Error as ValueError, MapDeserializer, SeqDeserializer};
use serde::de::{
    self, DeserializeOwned, Deserializer, IntoDeserializer, MapAccess, SeqAccess, Visitor,
};
use serde::{Deserialize, Serialize, Serializer};

/// A JSON value for lenient legacy parsing. Exists because
/// `serde_json::Value` is banned in this crate (D4(b)). Object keys are kept
/// in sorted order; numbers are `f64` (display-only, so integers above 2^53
/// lose precision, as they do in JS).
#[derive(Clone, Debug, PartialEq)]
pub enum LegacyJson {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<LegacyJson>),
    Object(BTreeMap<String, LegacyJson>),
}

impl Serialize for LegacyJson {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Null => serializer.serialize_unit(),
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::Number(value) => match integral(*value) {
                Some(Integral::Unsigned(value)) => serializer.serialize_u64(value),
                Some(Integral::Signed(value)) => serializer.serialize_i64(value),
                None => serializer.serialize_f64(*value),
            },
            Self::String(value) => serializer.serialize_str(value),
            Self::Array(values) => serializer.collect_seq(values),
            Self::Object(map) => serializer.collect_map(map),
        }
    }
}

struct LegacyJsonVisitor;

impl<'de> Visitor<'de> for LegacyJsonVisitor {
    type Value = LegacyJson;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("any JSON value")
    }

    fn visit_bool<E>(self, value: bool) -> Result<LegacyJson, E> {
        Ok(LegacyJson::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<LegacyJson, E> {
        Ok(LegacyJson::Number(value as f64))
    }

    fn visit_u64<E>(self, value: u64) -> Result<LegacyJson, E> {
        Ok(LegacyJson::Number(value as f64))
    }

    fn visit_f64<E>(self, value: f64) -> Result<LegacyJson, E> {
        Ok(LegacyJson::Number(value))
    }

    fn visit_str<E>(self, value: &str) -> Result<LegacyJson, E> {
        Ok(LegacyJson::String(value.to_string()))
    }

    fn visit_string<E>(self, value: String) -> Result<LegacyJson, E> {
        Ok(LegacyJson::String(value))
    }

    fn visit_unit<E>(self) -> Result<LegacyJson, E> {
        Ok(LegacyJson::Null)
    }

    fn visit_none<E>(self) -> Result<LegacyJson, E> {
        Ok(LegacyJson::Null)
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<LegacyJson, D::Error> {
        LegacyJson::deserialize(deserializer)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<LegacyJson, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = seq.next_element()? {
            values.push(value);
        }
        Ok(LegacyJson::Array(values))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<LegacyJson, A::Error> {
        let mut values = BTreeMap::new();
        while let Some((key, value)) = map.next_entry::<String, LegacyJson>()? {
            values.insert(key, value);
        }
        Ok(LegacyJson::Object(values))
    }
}

impl<'de> Deserialize<'de> for LegacyJson {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(LegacyJsonVisitor)
    }
}

enum Integral {
    Unsigned(u64),
    Signed(i64),
}

/// `Some` when `value` is an integer exactly representable as `u64`/`i64`.
fn integral(value: f64) -> Option<Integral> {
    // 2^63 as f64; every integral f64 below it in magnitude fits i64.
    const LIMIT: f64 = 9_223_372_036_854_775_808.0;
    if !value.is_finite() || value != (value as i64) as f64 || value >= LIMIT || value < -LIMIT {
        return None;
    }
    if value >= 0.0 {
        Some(Integral::Unsigned(value as u64))
    } else {
        Some(Integral::Signed(value as i64))
    }
}

impl<'de> IntoDeserializer<'de, ValueError> for LegacyJson {
    type Deserializer = Self;

    fn into_deserializer(self) -> Self {
        self
    }
}

/// Lets typed structs be read out of a [`LegacyJson`], with two leniencies:
/// numbers satisfy string fields, and integral numbers satisfy integer fields.
impl<'de> Deserializer<'de> for LegacyJson {
    type Error = ValueError;

    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, ValueError> {
        match self {
            Self::Null => visitor.visit_unit(),
            Self::Bool(value) => visitor.visit_bool(value),
            Self::Number(value) => match integral(value) {
                Some(Integral::Unsigned(value)) => visitor.visit_u64(value),
                Some(Integral::Signed(value)) => visitor.visit_i64(value),
                None => visitor.visit_f64(value),
            },
            Self::String(value) => visitor.visit_string(value),
            Self::Array(values) => {
                let mut seq = SeqDeserializer::new(values.into_iter());
                let value = visitor.visit_seq(&mut seq)?;
                seq.end()?;
                Ok(value)
            }
            Self::Object(map) => {
                let mut access = MapDeserializer::new(map.into_iter());
                let value = visitor.visit_map(&mut access)?;
                access.end()?;
                Ok(value)
            }
        }
    }

    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, ValueError> {
        match self {
            Self::Null => visitor.visit_none(),
            other => visitor.visit_some(other),
        }
    }

    fn deserialize_f64<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, ValueError> {
        match self {
            Self::Number(value) => visitor.visit_f64(value),
            other => other.deserialize_any(visitor),
        }
    }

    fn deserialize_f32<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, ValueError> {
        self.deserialize_f64(visitor)
    }

    fn deserialize_str<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, ValueError> {
        self.deserialize_string(visitor)
    }

    fn deserialize_string<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, ValueError> {
        match self {
            Self::Number(value) => match integral(value) {
                Some(Integral::Unsigned(value)) => visitor.visit_string(format!("{value}")),
                Some(Integral::Signed(value)) => visitor.visit_string(format!("{value}")),
                None => visitor.visit_string(format!("{value}")),
            },
            other => other.deserialize_any(visitor),
        }
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        _name: &'static str,
        visitor: V,
    ) -> Result<V::Value, ValueError> {
        visitor.visit_newtype_struct(self)
    }

    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _variants: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, ValueError> {
        match self {
            Self::String(value) => visitor.visit_enum(value.into_deserializer()),
            _ => Err(de::Error::custom("expected a string enum")),
        }
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 char bytes byte_buf unit
        unit_struct seq tuple tuple_struct map struct identifier ignored_any
    }
}

/// Reads any JSON value, then converts it to `T`, falling back to
/// `T::default()` when it does not fit.
fn lenient<'de, D: Deserializer<'de>, T: DeserializeOwned + Default>(
    deserializer: D,
) -> Result<T, D::Error> {
    let value = LegacyJson::deserialize(deserializer)?;
    Ok(T::deserialize(value).unwrap_or_default())
}

/// Reads a JSON array, keeping the entries that convert to `T`. Anything
/// other than an array becomes an empty list.
fn lenient_vec<'de, D: Deserializer<'de>, T: DeserializeOwned>(
    deserializer: D,
) -> Result<Vec<T>, D::Error> {
    match LegacyJson::deserialize(deserializer)? {
        LegacyJson::Array(values) => Ok(values
            .into_iter()
            .filter_map(|value| T::deserialize(value).ok())
            .collect()),
        _ => Ok(Vec::new()),
    }
}

/// Like [`lenient_vec`] for an optional list (`None` when absent or not a list).
fn lenient_opt_vec<'de, D: Deserializer<'de>, T: DeserializeOwned>(
    deserializer: D,
) -> Result<Option<Vec<T>>, D::Error> {
    match LegacyJson::deserialize(deserializer)? {
        LegacyJson::Array(values) => Ok(Some(
            values
                .into_iter()
                .filter_map(|value| T::deserialize(value).ok())
                .collect(),
        )),
        _ => Ok(None),
    }
}

/// Like [`lenient`] for a key that may be present as `null`: `null` ->
/// `Some(None)`, a convertible value -> `Some(Some(v))`, anything else ->
/// `Some(None)`. Absent keys stay `None` through `#[serde(default)]`.
fn lenient_nullable<'de, D: Deserializer<'de>, T: DeserializeOwned>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    match LegacyJson::deserialize(deserializer)? {
        LegacyJson::Null => Ok(Some(None)),
        value => Ok(Some(T::deserialize(value).ok())),
    }
}

/// A legacy player entry.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct LegacyPlayerConfig {
    #[serde(deserialize_with = "lenient")]
    pub player_id: String,
    #[serde(deserialize_with = "lenient")]
    pub name: String,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub cosmetic_key: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub is_ghost: Option<bool>,
    #[serde(flatten)]
    #[cfg_attr(feature = "ts-export", ts(skip))]
    pub extra: BTreeMap<String, LegacyJson>,
}

/// A legacy loadout; item names stay strings.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct LegacyLoadout {
    #[serde(deserialize_with = "lenient")]
    pub player_id: String,
    #[serde(deserialize_with = "lenient_vec")]
    pub item_ids: Vec<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub source: Option<String>,
    #[serde(flatten)]
    #[cfg_attr(feature = "ts-export", ts(skip))]
    pub extra: BTreeMap<String, LegacyJson>,
}

/// A legacy Chaos card; the type stays a string.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct LegacyChaosConfig {
    #[serde(rename = "type", deserialize_with = "lenient")]
    pub chaos_type: String,
    /// Absent -> `None`, `null` -> `Some(None)` (TS writes `null` for "no
    /// target").
    #[serde(
        deserialize_with = "lenient_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "ts-export", ts(optional = nullable, as = "Option<String>"))]
    pub target_player_id: Option<Option<String>>,
    #[serde(
        deserialize_with = "lenient_opt_vec",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub groups: Option<Vec<Vec<String>>>,
    #[serde(flatten)]
    #[cfg_attr(feature = "ts-export", ts(skip))]
    pub extra: BTreeMap<String, LegacyJson>,
}

/// Legacy item tuning.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct LegacyItemTuning {
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub nitro_speed_multiplier: Option<f64>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub rocket_slow_multiplier: Option<f64>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub banana_knockback_multiplier: Option<f64>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub banana_slow_multiplier: Option<f64>,
    #[serde(flatten)]
    #[cfg_attr(feature = "ts-export", ts(skip))]
    pub extra: BTreeMap<String, LegacyJson>,
}

/// Legacy pickup config, as stored (no defaults applied: Zod already wrote
/// its defaults into stored configs).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct LegacyPickupConfig {
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub enabled: Option<bool>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub golden_box_enabled: Option<bool>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub golden_box_probability: Option<f64>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub hazards_enabled: Option<bool>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub position_aware_loot: Option<bool>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub spawn_multiplier: Option<f64>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub regular_pickup_cap: Option<f64>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub manual_items_enabled: Option<bool>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_items_enabled: Option<bool>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub chaos_box_enabled: Option<bool>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub force_item: Option<String>,
    #[serde(
        deserialize_with = "lenient_opt_vec",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub disabled_items: Option<Vec<String>>,
    #[serde(
        deserialize_with = "lenient_opt_vec",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub ideal_manual_player_ids: Option<Vec<String>>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub force_golden_box: Option<bool>,
    #[serde(flatten)]
    #[cfg_attr(feature = "ts-export", ts(skip))]
    pub extra: BTreeMap<String, LegacyJson>,
}

/// A race config written by engine <= 1.2.0 (TS `raceConfigSchema` output,
/// stored as `Race.engineConfigJson`). Display-only.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct LegacyRaceConfigV1 {
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub race_id: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub seed: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub protocol_version: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub engine_version: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub balance_version: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub track_version: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub pickup_spawn_version: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub wild_item_balance_version: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub hazard_balance_version: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub tick_rate: Option<f64>,
    #[serde(deserialize_with = "lenient_vec")]
    pub players: Vec<LegacyPlayerConfig>,
    #[serde(deserialize_with = "lenient_vec")]
    pub loadouts: Vec<LegacyLoadout>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub chaos_config: Option<LegacyChaosConfig>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub item_tuning: Option<LegacyItemTuning>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub pickup_config: Option<LegacyPickupConfig>,
    /// Keys this struct does not know, kept verbatim.
    #[serde(flatten)]
    #[cfg_attr(feature = "ts-export", ts(skip))]
    pub extra: BTreeMap<String, LegacyJson>,
}

impl LegacyRaceConfigV1 {
    /// Parses stored `engineConfigJson`. Fails only when the text is not a
    /// JSON object. A repeated key keeps its last value, as `JSON.parse`
    /// does (the text is read into [`LegacyJson`] first).
    pub fn parse(json: &str) -> Result<Self, serde_json::Error> {
        let value: LegacyJson = serde_json::from_str(json)?;
        if !matches!(value, LegacyJson::Object(_)) {
            return Err(<serde_json::Error as de::Error>::custom(
                "legacy config is not a JSON object",
            ));
        }
        Self::deserialize(value).map_err(<serde_json::Error as de::Error>::custom)
    }

    /// `true` when `engineVersion` is missing, unparsable, or has major < 2,
    /// i.e. when a stored config belongs to the TS engine generation.
    pub fn is_legacy_engine_version(engine_version: Option<&str>) -> bool {
        let Some(version) = engine_version else {
            return true;
        };
        let major = version.split('.').next().unwrap_or("");
        match major.parse::<u32>() {
            Ok(major) => major < 2,
            Err(_) => true,
        }
    }
}

/// A stored `RaceEngineEvent` row from a race whose engine is <= 1.2.0
/// (review 3 M2, plan §4.6). Display-only and lenient: stored rows predate
/// metadata keys the typed [`crate::events::RaceEvent`] requires (for
/// example `aimOffset`, `durationSeconds`, `autoReason`, `shockAbsorbed`)
/// and have no `seq`, so every row of a legacy race goes through this type,
/// never through `EventKind`. Use
/// [`LegacyRaceConfigV1::is_legacy_engine_version`] on the race's
/// `engineVersion` to route rows.
///
/// Serialises to the TS wire shape without `seq`:
/// `{type, tick, timestampWithinRaceMs, sourcePlayerId?, targetPlayerId?,
/// metadata}`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct LegacyRaceEvent {
    /// The event type as stored; may name a type the current enum lacks.
    #[serde(rename = "type", deserialize_with = "lenient")]
    pub event_type: String,
    /// `RaceEngineEvent.tick` is an `Int` column.
    #[serde(deserialize_with = "lenient")]
    pub tick: u32,
    #[serde(deserialize_with = "lenient")]
    pub timestamp_within_race_ms: f64,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub source_player_id: Option<String>,
    #[serde(deserialize_with = "lenient", skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub target_player_id: Option<String>,
    /// Metadata as stored. A `metadataJson` column that is not valid JSON is
    /// kept as a string.
    #[cfg_attr(feature = "ts-export", ts(type = "Record<string, unknown>"))]
    pub metadata: LegacyJson,
}

impl Default for LegacyJson {
    fn default() -> Self {
        Self::Object(BTreeMap::new())
    }
}

impl LegacyRaceEvent {
    /// Builds an event from the `RaceEngineEvent` columns. Never fails.
    pub fn from_row(
        event_type: &str,
        tick: u32,
        timestamp_within_race_ms: f64,
        source_player_id: Option<&str>,
        target_player_id: Option<&str>,
        metadata_json: &str,
    ) -> Self {
        let metadata = serde_json::from_str::<LegacyJson>(metadata_json)
            .unwrap_or_else(|_| LegacyJson::String(metadata_json.to_string()));
        Self {
            event_type: event_type.to_string(),
            tick,
            timestamp_within_race_ms,
            source_player_id: source_player_id.map(ToString::to_string),
            target_player_id: target_player_id.map(ToString::to_string),
            metadata,
        }
    }

    /// Parses one event in the wire shape (a JSON object). Fails only when
    /// the text is not a JSON object.
    pub fn parse(json: &str) -> Result<Self, serde_json::Error> {
        let value: LegacyJson = serde_json::from_str(json)?;
        if !matches!(value, LegacyJson::Object(_)) {
            return Err(<serde_json::Error as de::Error>::custom(
                "legacy event is not a JSON object",
            ));
        }
        Self::deserialize(value).map_err(<serde_json::Error as de::Error>::custom)
    }
}
