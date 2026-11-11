//! Race configuration: `RaceConfigInput` and its resolved form (D8).
//!
//! `RaceConfigInput::resolve()` is the only place defaults live (one
//! `goldenBoxProbability` default, 0.15). Existing TS field names
//! (`chaosConfig`, `pickupConfig`, ...) are kept. The resolved config is what
//! `race_core::canonical` serialises to `engineConfigJson` (D9).
//!
//! TS sources: `raceConfigSchema` and friends in
//! `packages/race-protocol/src/index.ts:58-121`, plus the engine-side
//! fallbacks that this module absorbs:
//! - `pickups/engine.ts:86-121` (`pickupConfig()`: an absent `pickupConfig`
//!   means "pickups off"; a present one fills per-field defaults),
//! - `items/engine.ts:176-181` (`itemTuning` fallbacks),
//! - `auto-use/objective.ts:21-23`, `chaos-utility.ts:37-40` (absent
//!   `chaosConfig` means `NORMAL`, no target, no groups).

use alloc::string::String;
use alloc::vec::Vec;
use core::fmt;

use serde::{Deserialize, Serialize};

use crate::ids::{IdError, PlayerId, RaceId, RaceItemId, RaceSeed, WildItemId};
use crate::versions;

/// Minimum players in a race (`index.ts:116`).
pub const MIN_PLAYERS: usize = 2;
/// Maximum players in a race (`index.ts:116`).
pub const MAX_PLAYERS: usize = 16;
/// Maximum prep items per loadout (`index.ts:60`).
pub const MAX_LOADOUT_ITEMS: usize = 2;
/// Maximum player display-name length in UTF-16 code units (`index.ts:100`).
pub const MAX_PLAYER_NAME_UTF16: usize = 80;
/// Maximum `cosmeticKey` length in UTF-16 code units (`index.ts:101`).
pub const MAX_COSMETIC_KEY_UTF16: usize = 2048;

/// D8: the single `goldenBoxProbability` default. Replaces Zod's 0.12
/// (`index.ts:83`) and the engine's 0.18 (`pickups/config.ts:5`).
pub const DEFAULT_GOLDEN_BOX_PROBABILITY: f64 = 0.15;
/// The TS S3.15 Zod default (`index.ts:83`), used only by
/// [`RaceConfigInput::resolve_ts_compat`] so `oracle diff` runs exactly what
/// the TS oracle runs.
#[cfg(feature = "ts-compat")]
pub const TS_GOLDEN_BOX_PROBABILITY: f64 = 0.12;
/// Default regular pickup cap (`index.ts:87`, `pickups/config.ts:4`).
pub const DEFAULT_REGULAR_PICKUP_CAP: u32 = 3;
/// Default Nitro peak multiplier (`items/config.ts:13`).
pub const DEFAULT_NITRO_SPEED_MULTIPLIER: f64 = 1.25;
/// Default rocket slow multiplier (`items/config.ts:46`).
pub const DEFAULT_ROCKET_SLOW_MULTIPLIER: f64 = 0.15;
/// Default banana knockback multiplier (`items/engine.ts:179`).
pub const DEFAULT_BANANA_KNOCKBACK_MULTIPLIER: f64 = 1.0;
/// Default banana slow multiplier (`items/engine.ts:180`).
pub const DEFAULT_BANANA_SLOW_MULTIPLIER: f64 = 1.0;

crate::wire_enum! {
    /// Who chose a loadout (`index.ts:61`).
    pub enum LoadoutSource {
        Player => "PLAYER",
        Auto => "AUTO",
    }
}

crate::wire_enum! {
    /// Chaos card types (`index.ts:66`).
    pub enum ChaosType {
        Normal => "NORMAL",
        Reverse => "REVERSE",
        Duo => "DUO",
        TripleElimination => "TRIPLE_ELIMINATION",
        CutLine => "CUT_LINE",
        Constructors => "CONSTRUCTORS",
        BountyHunt => "BOUNTY_HUNT",
    }
}

// ---------------------------------------------------------------------------
// Input (as received)
// ---------------------------------------------------------------------------

/// A player entry as received (`racePlayerConfigSchema`, `index.ts:98-103`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RacePlayerConfigInput {
    pub player_id: PlayerId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub cosmetic_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub is_ghost: Option<bool>,
}

/// A loadout (`raceLoadoutSchema`, `index.ts:58-62`). Same shape as input and
/// resolved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceLoadout {
    pub player_id: PlayerId,
    pub item_ids: Vec<RaceItemId>,
    pub source: LoadoutSource,
}

/// Chaos card as received (`raceChaosConfigSchema`, `index.ts:65-69`).
/// `targetPlayerId` may be absent or `null`; both mean "no target".
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceChaosConfigInput {
    #[serde(rename = "type")]
    pub chaos_type: ChaosType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional = nullable))]
    pub target_player_id: Option<PlayerId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub groups: Option<Vec<Vec<PlayerId>>>,
}

/// Item tuning as received (`raceItemTuningSchema`, `index.ts:72-77`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceItemTuningInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub nitro_speed_multiplier: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub rocket_slow_multiplier: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub banana_knockback_multiplier: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub banana_slow_multiplier: Option<f64>,
}

/// Pickup config as received (`pickupConfigSchema`, `index.ts:80-95`).
/// Every field is optional; [`RaceConfigInput::resolve`] fills defaults.
/// `regularPickupCap` is read as a JSON number and must be an integer.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct PickupConfigInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub golden_box_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub golden_box_probability: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub hazards_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub position_aware_loot: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub spawn_multiplier: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub regular_pickup_cap: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub manual_items_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_items_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub chaos_box_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub force_item: Option<WildItemId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub disabled_items: Option<Vec<WildItemId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub ideal_manual_player_ids: Option<Vec<PlayerId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub force_golden_box: Option<bool>,
}

/// A race config as received (`raceConfigSchema`, `index.ts:105-121`).
///
/// Unknown keys are ignored (Zod `z.object` strips them). Numbers are parsed
/// by Rust (`serde_json` with `float_roundtrip`), never by V8 (D8).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceConfigInput {
    pub race_id: RaceId,
    pub seed: RaceSeed,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub protocol_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub engine_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub balance_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub track_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub pickup_spawn_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub wild_item_balance_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub hazard_balance_version: Option<String>,
    /// Must be 60 when present (`z.literal(RACE_TICK_RATE)`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub tick_rate: Option<f64>,
    pub players: Vec<RacePlayerConfigInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub loadouts: Option<Vec<RaceLoadout>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub chaos_config: Option<RaceChaosConfigInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub item_tuning: Option<RaceItemTuningInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub pickup_config: Option<PickupConfigInput>,
}

// ---------------------------------------------------------------------------
// Resolved
// ---------------------------------------------------------------------------

/// A resolved player entry. `isGhost` is always present.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RacePlayerConfig {
    pub player_id: PlayerId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub cosmetic_key: Option<String>,
    pub is_ghost: bool,
}

/// Resolved Chaos card. `targetPlayerId` is `null` when there is none.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceChaosConfig {
    #[serde(rename = "type")]
    pub chaos_type: ChaosType,
    pub target_player_id: Option<PlayerId>,
    pub groups: Vec<Vec<PlayerId>>,
}

impl Default for RaceChaosConfig {
    fn default() -> Self {
        Self {
            chaos_type: ChaosType::Normal,
            target_player_id: None,
            groups: Vec::new(),
        }
    }
}

/// Resolved item tuning; every multiplier is concrete.
///
/// **F9 (S3.16):** `rocketSlowMultiplier`, `bananaKnockbackMultiplier` and
/// `bananaSlowMultiplier` never changed a race (S3.15 dropped the banana
/// knobs and stored the rocket one on a projectile field nothing read: a
/// rocket hit staggers with its own constants), so the default
/// build no longer carries them: the input still accepts and range-checks
/// them for wire compatibility, and the `s3-15-config` feature (enabled by
/// race-core's `ts-compat`) keeps them in the resolved config (and so in its
/// `engineConfigJson`). `tests/dead_knob.rs` proves
/// every knob left here changes a race.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceItemTuning {
    pub nitro_speed_multiplier: f64,
    #[cfg(feature = "s3-15-config")]
    pub rocket_slow_multiplier: f64,
    #[cfg(feature = "s3-15-config")]
    pub banana_knockback_multiplier: f64,
    #[cfg(feature = "s3-15-config")]
    pub banana_slow_multiplier: f64,
}

impl Default for RaceItemTuning {
    fn default() -> Self {
        Self {
            nitro_speed_multiplier: DEFAULT_NITRO_SPEED_MULTIPLIER,
            #[cfg(feature = "s3-15-config")]
            rocket_slow_multiplier: DEFAULT_ROCKET_SLOW_MULTIPLIER,
            #[cfg(feature = "s3-15-config")]
            banana_knockback_multiplier: DEFAULT_BANANA_KNOCKBACK_MULTIPLIER,
            #[cfg(feature = "s3-15-config")]
            banana_slow_multiplier: DEFAULT_BANANA_SLOW_MULTIPLIER,
        }
    }
}

/// Resolved pickup config; every field is concrete except `forceItem`.
///
/// **F9 (S3.16):** `manualItemsEnabled`, `chaosBoxEnabled` and
/// `idealManualPlayerIds` are never read by the engine (manual wild-item
/// use is a server concern, and the Rust server refuses it), so only
/// `s3-15-config` (race-core `ts-compat`) carries them; the input still
/// accepts them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct PickupConfig {
    pub enabled: bool,
    pub golden_box_enabled: bool,
    pub golden_box_probability: f64,
    pub hazards_enabled: bool,
    pub position_aware_loot: bool,
    pub spawn_multiplier: f64,
    pub regular_pickup_cap: u32,
    #[cfg(feature = "s3-15-config")]
    pub manual_items_enabled: bool,
    pub auto_items_enabled: bool,
    #[cfg(feature = "s3-15-config")]
    pub chaos_box_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub force_item: Option<WildItemId>,
    pub disabled_items: Vec<WildItemId>,
    #[cfg(feature = "s3-15-config")]
    pub ideal_manual_player_ids: Vec<PlayerId>,
    pub force_golden_box: bool,
}

impl PickupConfig {
    /// What an absent `pickupConfig` means: pickups, hazards and golden boxes
    /// off (`pickups/engine.ts:87-104`).
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            golden_box_enabled: false,
            golden_box_probability: 0.0,
            hazards_enabled: false,
            position_aware_loot: true,
            spawn_multiplier: 0.0,
            regular_pickup_cap: DEFAULT_REGULAR_PICKUP_CAP,
            #[cfg(feature = "s3-15-config")]
            manual_items_enabled: false,
            auto_items_enabled: false,
            #[cfg(feature = "s3-15-config")]
            chaos_box_enabled: false,
            force_item: None,
            disabled_items: Vec::new(),
            #[cfg(feature = "s3-15-config")]
            ideal_manual_player_ids: Vec::new(),
            force_golden_box: false,
        }
    }
}

/// The resolved race config: every default applied, every range checked.
/// This is the only config shape `race-core` accepts, and its JCS form is
/// `engineConfigJson` (D9).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct ResolvedRaceConfig {
    pub race_id: RaceId,
    pub seed: RaceSeed,
    pub protocol_version: String,
    pub engine_version: String,
    pub balance_version: String,
    pub track_version: String,
    pub pickup_spawn_version: String,
    /// No D2 constant exists for wild items; passed through when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub wild_item_balance_version: Option<String>,
    pub hazard_balance_version: String,
    pub tick_rate: u32,
    pub players: Vec<RacePlayerConfig>,
    pub loadouts: Vec<RaceLoadout>,
    pub chaos_config: RaceChaosConfig,
    pub item_tuning: RaceItemTuning,
    pub pickup_config: PickupConfig,
}

impl ResolvedRaceConfig {
    /// `true` if `player_id` is flagged `isGhost` (`ghost.ts:7-9`).
    pub fn is_ghost(&self, player_id: &PlayerId) -> bool {
        self.players
            .iter()
            .any(|player| player.is_ghost && &player.player_id == player_id)
    }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Why a config failed to resolve.
#[derive(Clone, Debug, PartialEq)]
pub enum ConfigError {
    /// An id failed D6 validation (`field` names where).
    InvalidId { field: &'static str, error: IdError },
    /// `players` length outside `2..=16`.
    PlayerCount { count: usize }, // usize-ok: error detail, never serialized
    /// The same `playerId` appears twice in `players`.
    DuplicatePlayer { player_id: PlayerId },
    /// A display name is empty or longer than 80 UTF-16 code units.
    PlayerName {
        player_id: PlayerId,
        utf16_len: usize, // usize-ok: error detail, never serialized
    },
    /// `cosmeticKey` longer than 2048 UTF-16 code units.
    CosmeticKey {
        player_id: PlayerId,
        utf16_len: usize, // usize-ok: error detail, never serialized
    },
    /// A loadout lists more than two items.
    LoadoutSize { player_id: PlayerId, count: usize }, // usize-ok: error detail, never serialized
    /// A number outside its schema range, or not finite, or not an integer
    /// where one is required.
    OutOfRange { field: &'static str, value: f64 },
    /// A version label is present but empty.
    EmptyVersion { field: &'static str },
    /// `tickRate` is not 60.
    TickRate { value: f64 },
    /// `engineVersion` names a pre-2.0 engine; use `LegacyRaceConfigV1`.
    LegacyEngineVersion { engine_version: String },
    /// A version label that does not describe this engine (D2, §4.1): the
    /// engine, protocol, track, pickup and hazard labels must equal the D2
    /// constants and the balance label must be in
    /// [`versions::SUPPORTED_BALANCE_VERSIONS`].
    UnsupportedVersion { field: &'static str, value: String },
    /// F11 (S3.16): a `chaosConfig.groups` entry is empty.
    ChaosGroupEmpty { index: usize }, // usize-ok: error detail, never serialized
    /// F11 (S3.16): a Chaos group names a player who is not in `players`.
    ChaosGroupForeignPlayer { player_id: PlayerId },
    /// F11 (S3.16): a player appears in two Chaos groups (or twice in one).
    ChaosGroupOverlap { player_id: PlayerId },
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidId { field, error } => write!(f, "{field}: {error}"),
            Self::PlayerCount { count } => {
                write!(
                    f,
                    "players: {count} entries, expected {MIN_PLAYERS}..={MAX_PLAYERS}"
                )
            }
            Self::DuplicatePlayer { player_id } => {
                write!(f, "players: duplicate playerId {player_id}")
            }
            Self::PlayerName {
                player_id,
                utf16_len,
            } => write!(
                f,
                "players[{player_id}].name: {utf16_len} UTF-16 units, expected 1..={MAX_PLAYER_NAME_UTF16}"
            ),
            Self::CosmeticKey {
                player_id,
                utf16_len,
            } => write!(
                f,
                "players[{player_id}].cosmeticKey: {utf16_len} UTF-16 units, maximum {MAX_COSMETIC_KEY_UTF16}"
            ),
            Self::LoadoutSize { player_id, count } => write!(
                f,
                "loadouts[{player_id}].itemIds: {count} items, maximum {MAX_LOADOUT_ITEMS}"
            ),
            Self::OutOfRange { field, value } => write!(f, "{field}: {value} is out of range"),
            Self::EmptyVersion { field } => write!(f, "{field}: must not be empty"),
            Self::TickRate { value } => {
                write!(
                    f,
                    "tickRate: {value}, expected {}",
                    versions::RACE_TICK_RATE
                )
            }
            Self::LegacyEngineVersion { engine_version } => write!(
                f,
                "engineVersion {engine_version} is a pre-2.0 config; parse it as LegacyRaceConfigV1"
            ),
            Self::UnsupportedVersion { field, value } => {
                write!(f, "{field}: {value} is not supported by this engine")
            }
            Self::ChaosGroupEmpty { index } => {
                write!(f, "chaosConfig.groups[{index}]: empty group")
            }
            Self::ChaosGroupForeignPlayer { player_id } => {
                write!(f, "chaosConfig.groups: {player_id} is not in players")
            }
            Self::ChaosGroupOverlap { player_id } => {
                write!(
                    f,
                    "chaosConfig.groups: {player_id} is in more than one group"
                )
            }
        }
    }
}

fn check_range(field: &'static str, value: f64, min: f64, max: f64) -> Result<f64, ConfigError> {
    if value.is_finite() && value >= min && value <= max {
        Ok(value)
    } else {
        Err(ConfigError::OutOfRange { field, value })
    }
}

fn optional_range(
    field: &'static str,
    value: Option<f64>,
    min: f64,
    max: f64,
    default: f64,
) -> Result<f64, ConfigError> {
    match value {
        Some(value) => check_range(field, value, min, max),
        None => Ok(default),
    }
}

/// How [`RaceConfigInput`] fills defaults and checks version labels.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ResolveMode {
    /// D8 defaults; labels must describe this engine (D2).
    Engine,
    /// TS S3.15 Zod defaults; labels pass through (oracle diff only).
    #[cfg(feature = "ts-compat")]
    TsCompat,
}

/// A version label. Absent: `default`. Present: non-empty and, when
/// `allowed` is `Some`, one of the allowed values.
fn version(
    field: &'static str,
    value: Option<&String>,
    default: &str,
    allowed: Option<&[&str]>,
) -> Result<String, ConfigError> {
    match value {
        Some(value) if value.is_empty() => Err(ConfigError::EmptyVersion { field }),
        Some(value) => match allowed {
            Some(allowed) if !allowed.contains(&value.as_str()) => {
                Err(ConfigError::UnsupportedVersion {
                    field,
                    value: value.clone(),
                })
            }
            _ => Ok(value.clone()),
        },
        None => Ok(String::from(default)),
    }
}

/// Default labels and allow-lists for one [`ResolveMode`].
struct VersionPolicy {
    protocol: (&'static str, Option<&'static [&'static str]>),
    engine: (&'static str, Option<&'static [&'static str]>),
    balance: (&'static str, Option<&'static [&'static str]>),
    track: (&'static str, Option<&'static [&'static str]>),
    pickup_spawn: (&'static str, Option<&'static [&'static str]>),
    hazard_balance: (&'static str, Option<&'static [&'static str]>),
    golden_box_probability: f64,
    refuse_legacy: bool,
}

const ENGINE_POLICY: VersionPolicy = VersionPolicy {
    protocol: (
        versions::RACE_PROTOCOL_VERSION,
        Some(&[versions::RACE_PROTOCOL_VERSION]),
    ),
    engine: (
        versions::RACE_ENGINE_VERSION,
        Some(&[versions::RACE_ENGINE_VERSION]),
    ),
    balance: (
        versions::RACE_BALANCE_VERSION,
        Some(&versions::SUPPORTED_BALANCE_VERSIONS),
    ),
    track: (versions::TRACK_VERSION, Some(&[versions::TRACK_VERSION])),
    pickup_spawn: (
        versions::PICKUP_SPAWN_VERSION,
        Some(&[versions::PICKUP_SPAWN_VERSION]),
    ),
    hazard_balance: (
        versions::HAZARD_BALANCE_VERSION,
        Some(&[versions::HAZARD_BALANCE_VERSION]),
    ),
    golden_box_probability: DEFAULT_GOLDEN_BOX_PROBABILITY,
    refuse_legacy: true,
};

/// What the TS oracle runs: Zod's defaults (`index.ts:3-9,105-121`), labels
/// passed through unchecked, no legacy refusal. Absent optional labels
/// (`pickupSpawnVersion`, `hazardBalanceVersion`) get the TS constants that
/// `lib/season3-race.ts:177-179` writes; the TS engine never reads them.
#[cfg(feature = "ts-compat")]
const TS_COMPAT_POLICY: VersionPolicy = VersionPolicy {
    protocol: (versions::ts_compat::RACE_PROTOCOL_VERSION, None),
    engine: (versions::ts_compat::RACE_ENGINE_VERSION, None),
    balance: (versions::ts_compat::RACE_BALANCE_VERSION, None),
    track: (versions::ts_compat::TRACK_VERSION, None),
    pickup_spawn: (versions::ts_compat::PICKUP_SPAWN_VERSION, None),
    hazard_balance: (versions::ts_compat::HAZARD_BALANCE_VERSION, None),
    golden_box_probability: TS_GOLDEN_BOX_PROBABILITY,
    refuse_legacy: false,
};

/// Parses the major component of a `major.minor.patch` label.
fn major_version(value: &str) -> Option<u32> {
    let major = value.split('.').next()?;
    if major.is_empty() || !major.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    major.parse().ok()
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

impl RaceConfigInput {
    /// Applies every default and validates every range (D8). This is the only
    /// place config defaults live.
    ///
    /// Version labels must describe this engine (D2, §4.1): a pre-2.0
    /// `engineVersion` is [`ConfigError::LegacyEngineVersion`], and any other
    /// label that differs from the D2 constants (balance: not in
    /// [`versions::SUPPORTED_BALANCE_VERSIONS`]) is
    /// [`ConfigError::UnsupportedVersion`].
    pub fn resolve(&self) -> Result<ResolvedRaceConfig, ConfigError> {
        self.resolve_with(ResolveMode::Engine)
    }

    /// The config exactly as the TS S3.15 oracle runs it (Zod parse plus the
    /// engine's fallbacks): `goldenBoxProbability` defaults to 0.12, labels
    /// default to the TS constants and pass through unchecked, and engine
    /// ≤1.2.0 configs are accepted. This is the only resolver
    /// `race-cli oracle diff` may use (gate G1); Phase B races use
    /// [`Self::resolve`].
    #[cfg(feature = "ts-compat")]
    pub fn resolve_ts_compat(&self) -> Result<ResolvedRaceConfig, ConfigError> {
        self.resolve_with(ResolveMode::TsCompat)
    }

    fn resolve_with(&self, mode: ResolveMode) -> Result<ResolvedRaceConfig, ConfigError> {
        let policy = match mode {
            ResolveMode::Engine => &ENGINE_POLICY,
            #[cfg(feature = "ts-compat")]
            ResolveMode::TsCompat => &TS_COMPAT_POLICY,
        };
        let engine_version = version(
            "engineVersion",
            self.engine_version.as_ref(),
            policy.engine.0,
            None,
        )?;
        if policy.refuse_legacy && major_version(&engine_version).is_none_or(|major| major < 2) {
            return Err(ConfigError::LegacyEngineVersion { engine_version });
        }
        let engine_version = version(
            "engineVersion",
            Some(&engine_version),
            policy.engine.0,
            policy.engine.1,
        )?;

        let tick_rate = match self.tick_rate {
            None => versions::RACE_TICK_RATE,
            Some(value) if value == f64::from(versions::RACE_TICK_RATE) => versions::RACE_TICK_RATE,
            Some(value) => return Err(ConfigError::TickRate { value }),
        };

        if !(MIN_PLAYERS..=MAX_PLAYERS).contains(&self.players.len()) {
            return Err(ConfigError::PlayerCount {
                count: self.players.len(),
            });
        }
        let mut players = Vec::with_capacity(self.players.len());
        for player in &self.players {
            if players
                .iter()
                .any(|existing: &RacePlayerConfig| existing.player_id == player.player_id)
            {
                return Err(ConfigError::DuplicatePlayer {
                    player_id: player.player_id.clone(),
                });
            }
            let name_len = utf16_len(&player.name);
            if name_len == 0 || name_len > MAX_PLAYER_NAME_UTF16 {
                return Err(ConfigError::PlayerName {
                    player_id: player.player_id.clone(),
                    utf16_len: name_len,
                });
            }
            if let Some(key) = &player.cosmetic_key {
                let key_len = utf16_len(key);
                if key_len > MAX_COSMETIC_KEY_UTF16 {
                    return Err(ConfigError::CosmeticKey {
                        player_id: player.player_id.clone(),
                        utf16_len: key_len,
                    });
                }
            }
            players.push(RacePlayerConfig {
                player_id: player.player_id.clone(),
                name: player.name.clone(),
                cosmetic_key: player.cosmetic_key.clone(),
                is_ghost: player.is_ghost.unwrap_or(false),
            });
        }

        let loadouts = self.loadouts.clone().unwrap_or_default();
        for loadout in &loadouts {
            if loadout.item_ids.len() > MAX_LOADOUT_ITEMS {
                return Err(ConfigError::LoadoutSize {
                    player_id: loadout.player_id.clone(),
                    count: loadout.item_ids.len(),
                });
            }
        }

        let chaos_config = match &self.chaos_config {
            None => RaceChaosConfig::default(),
            Some(chaos) => RaceChaosConfig {
                chaos_type: chaos.chaos_type,
                target_player_id: chaos.target_player_id.clone(),
                groups: chaos.groups.clone().unwrap_or_default(),
            },
        };

        if mode == ResolveMode::Engine {
            validate_chaos_groups(&chaos_config.groups, &players)?;
        }

        let tuning = self.item_tuning.clone().unwrap_or_default();
        // F9: still range-checked (the Zod schema), carried only by
        // `s3-15-config`.
        let rocket_slow_multiplier = optional_range(
            "itemTuning.rocketSlowMultiplier",
            tuning.rocket_slow_multiplier,
            0.1,
            1.0,
            DEFAULT_ROCKET_SLOW_MULTIPLIER,
        )?;
        let banana_knockback_multiplier = optional_range(
            "itemTuning.bananaKnockbackMultiplier",
            tuning.banana_knockback_multiplier,
            0.5,
            2.0,
            DEFAULT_BANANA_KNOCKBACK_MULTIPLIER,
        )?;
        let banana_slow_multiplier = optional_range(
            "itemTuning.bananaSlowMultiplier",
            tuning.banana_slow_multiplier,
            0.75,
            1.0,
            DEFAULT_BANANA_SLOW_MULTIPLIER,
        )?;
        #[cfg(not(feature = "s3-15-config"))]
        let _ = (
            rocket_slow_multiplier,
            banana_knockback_multiplier,
            banana_slow_multiplier,
        );
        let item_tuning = RaceItemTuning {
            nitro_speed_multiplier: optional_range(
                "itemTuning.nitroSpeedMultiplier",
                tuning.nitro_speed_multiplier,
                1.0,
                1.35,
                DEFAULT_NITRO_SPEED_MULTIPLIER,
            )?,
            #[cfg(feature = "s3-15-config")]
            rocket_slow_multiplier,
            #[cfg(feature = "s3-15-config")]
            banana_knockback_multiplier,
            #[cfg(feature = "s3-15-config")]
            banana_slow_multiplier,
        };

        let pickup_config = match &self.pickup_config {
            None => PickupConfig::disabled(),
            Some(input) => resolve_pickup_config(input, policy.golden_box_probability)?,
        };

        Ok(ResolvedRaceConfig {
            race_id: self.race_id.clone(),
            seed: self.seed.clone(),
            protocol_version: version(
                "protocolVersion",
                self.protocol_version.as_ref(),
                policy.protocol.0,
                policy.protocol.1,
            )?,
            engine_version,
            balance_version: version(
                "balanceVersion",
                self.balance_version.as_ref(),
                policy.balance.0,
                policy.balance.1,
            )?,
            track_version: version(
                "trackVersion",
                self.track_version.as_ref(),
                policy.track.0,
                policy.track.1,
            )?,
            pickup_spawn_version: version(
                "pickupSpawnVersion",
                self.pickup_spawn_version.as_ref(),
                policy.pickup_spawn.0,
                policy.pickup_spawn.1,
            )?,
            wild_item_balance_version: match &self.wild_item_balance_version {
                Some(value) if value.is_empty() => {
                    return Err(ConfigError::EmptyVersion {
                        field: "wildItemBalanceVersion",
                    });
                }
                other => other.clone(),
            },
            hazard_balance_version: version(
                "hazardBalanceVersion",
                self.hazard_balance_version.as_ref(),
                policy.hazard_balance.0,
                policy.hazard_balance.1,
            )?,
            tick_rate,
            players,
            loadouts,
            chaos_config,
            item_tuning,
            pickup_config,
        })
    }
}

/// F11 (S3.16): Chaos groups must be non-empty, name only lobby players and
/// not overlap. S3.15 (`resolve_ts_compat`) accepted any groups, so an empty
/// DUO group averaged `0/0 = NaN` and a player in two groups was counted
/// twice by the Chaos rules and the team AI.
fn validate_chaos_groups(
    groups: &[Vec<PlayerId>],
    players: &[RacePlayerConfig],
) -> Result<(), ConfigError> {
    let mut seen: Vec<&PlayerId> = Vec::new();
    for (index, group) in groups.iter().enumerate() {
        if group.is_empty() {
            return Err(ConfigError::ChaosGroupEmpty { index });
        }
        for player_id in group {
            if !players.iter().any(|player| &player.player_id == player_id) {
                return Err(ConfigError::ChaosGroupForeignPlayer {
                    player_id: player_id.clone(),
                });
            }
            if seen.contains(&player_id) {
                return Err(ConfigError::ChaosGroupOverlap {
                    player_id: player_id.clone(),
                });
            }
            seen.push(player_id);
        }
    }
    Ok(())
}

fn resolve_pickup_config(
    input: &PickupConfigInput,
    default_golden_box_probability: f64,
) -> Result<PickupConfig, ConfigError> {
    let regular_pickup_cap = match input.regular_pickup_cap {
        None => DEFAULT_REGULAR_PICKUP_CAP,
        Some(value) => {
            let value = check_range("pickupConfig.regularPickupCap", value, 1.0, 3.0)?;
            // In range and integral: 1, 2 or 3.
            match value {
                1.0 => 1,
                2.0 => 2,
                3.0 => 3,
                _ => {
                    return Err(ConfigError::OutOfRange {
                        field: "pickupConfig.regularPickupCap",
                        value,
                    });
                }
            }
        }
    };
    Ok(PickupConfig {
        enabled: input.enabled.unwrap_or(true),
        golden_box_enabled: input.golden_box_enabled.unwrap_or(true),
        golden_box_probability: optional_range(
            "pickupConfig.goldenBoxProbability",
            input.golden_box_probability,
            0.0,
            1.0,
            default_golden_box_probability,
        )?,
        hazards_enabled: input.hazards_enabled.unwrap_or(true),
        position_aware_loot: input.position_aware_loot.unwrap_or(true),
        spawn_multiplier: optional_range(
            "pickupConfig.spawnMultiplier",
            input.spawn_multiplier,
            0.0,
            3.0,
            1.0,
        )?,
        regular_pickup_cap,
        #[cfg(feature = "s3-15-config")]
        manual_items_enabled: input.manual_items_enabled.unwrap_or(true),
        auto_items_enabled: input.auto_items_enabled.unwrap_or(true),
        #[cfg(feature = "s3-15-config")]
        chaos_box_enabled: input.chaos_box_enabled.unwrap_or(false),
        force_item: input.force_item,
        disabled_items: input.disabled_items.clone().unwrap_or_default(),
        #[cfg(feature = "s3-15-config")]
        ideal_manual_player_ids: input.ideal_manual_player_ids.clone().unwrap_or_default(),
        force_golden_box: input.force_golden_box.unwrap_or(false),
    })
}
