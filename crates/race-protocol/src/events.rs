//! Typed race events (D7).
//!
//! `EventKind` serialises to today's wire shape plus `seq`, the per-race
//! emission index. `Option::None` keys are omitted and metadata key names are
//! pinned by `tests/event_wire_keys.rs`. `CHAOS_RESOLVED` and
//! `QP_TRACK_REWARD_GRANTED` are server meta events excluded from
//! `eventsSha256`; `seq` is excluded too.
//!
//! Wire shape (`RaceEvent`, `packages/race-protocol/src/index.ts:216-234`):
//!
//! ```text
//! { raceId, tick, timestampWithinRaceMs, type, sourcePlayerId?, targetPlayerId?, metadata: {...}, seq }
//! ```
//!
//! `EventKind` has one variant per entry of `raceEventTypeSchema`
//! (`index.ts:193-213`, 69 literals):
//! - 65 are emitted by the TS engine (`packages/race-core/src`),
//! - 2 are server meta events (`CHAOS_RESOLVED`, `QP_TRACK_REWARD_GRANTED`,
//!   `lib/season3-race.ts:314-323,446-456`),
//! - 2 are declared but never emitted (`ITEM_ACTIVATED`,
//!   `PREDATOR_RUSH_ENDED`); they carry an empty metadata object.
//!
//! The plan's "68 engine variants" counts the 69 literals minus one; see
//! `docs/rewrite/protocol-mapping.md` for the per-event key table with TS
//! source lines.
//!
//! Metadata keys that a TS emit site sometimes leaves `undefined` are
//! `Option<T>` with `skip_serializing_if`; keys that TS writes as `null` are
//! `Option<T>` without it (`null` on the wire). `draftTarget` can be absent,
//! `null` or a player id, so it is `Option<Option<PlayerId>>`.

use alloc::string::String;
use alloc::vec::Vec;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::config::ChaosType;
use crate::ids::{
    ClientActionId, HazardType, ItemKey, PickupSpawnType, PlayerId, RaceId, RaceItemId, WildItemId,
};

// ---------------------------------------------------------------------------
// Metadata value enums
// ---------------------------------------------------------------------------

crate::wire_enum! {
    /// Duck brain temperament (`auto-use/brain.ts:9`).
    pub enum Temperament {
        Aggressive => "AGGRESSIVE",
        Tactician => "TACTICIAN",
        Opportunist => "OPPORTUNIST",
        Showman => "SHOWMAN",
    }
}

crate::wire_enum! {
    /// Brain intent shown in `AI_INTENT` (`auto-use/brain.ts:48-59`).
    pub enum AiIntent {
        Holding => "HOLDING",
        Hunting => "HUNTING",
        Retaliating => "RETALIATING",
        Rivalry => "RIVALRY",
        TeamPlay => "TEAM_PLAY",
        Bounty => "BOUNTY",
        Desperate => "DESPERATE",
        Clutch => "CLUTCH",
        Breakaway => "BREAKAWAY",
        Shove => "SHOVE",
        TrapSet => "TRAP_SET",
    }
}

crate::wire_enum! {
    /// Why the auto-use arbiter fired an item (`auto-use/types.ts:6-13`).
    pub enum AutoUseReason {
        ReactiveDefense => "REACTIVE_DEFENSE",
        Opportunity => "OPPORTUNITY",
        InventoryPressure => "INVENTORY_PRESSURE",
        LateRace => "LATE_RACE",
        EndGameBurn => "END_GAME_BURN",
        Objective => "OBJECTIVE",
        Discard => "DISCARD",
    }
}

crate::wire_enum! {
    /// What broke a speed boost (`items/engine.ts:74`).
    pub enum BoostBreakSource {
        Rocket => "ROCKET",
        MiniRocket => "MINI_ROCKET",
        Banana => "BANANA",
        WildBanana => "WILD_BANANA",
        QuackHorn => "QUACK_HORN",
        WildHorn => "WILD_HORN",
    }
}

crate::wire_enum! {
    /// An incoming attack a defense met (`items/engine.ts:342`).
    pub enum IncomingAttack {
        Rocket => "ROCKET",
        MiniRocket => "MINI_ROCKET",
        Banana => "BANANA",
        WildBanana => "WILD_BANANA",
        QuackHorn => "QUACK_HORN",
    }
}

crate::wire_enum! {
    /// The prep defense behind a `GUARD_SURGE` (`items/engine.ts:331`).
    pub enum GuardDefenseItem {
        BubbleShield => "BUBBLE_SHIELD",
        Feather => "FEATHER",
        ShockAbsorber => "SHOCK_ABSORBER",
    }
}

crate::wire_enum! {
    /// `defense` of a `*_BLOCKED` projectile event (`items/engine.ts:669-774`).
    pub enum BlockDefense {
        MiniBubble => "MINI_BUBBLE",
        BubbleShield => "BUBBLE_SHIELD",
        WildFeather => "WILD_FEATHER",
        Feather => "FEATHER",
        Immunity => "IMMUNITY",
    }
}

crate::wire_enum! {
    /// The prep threat that snapped a packed bubble up (`items/engine.ts:365`).
    pub enum ReflexThreat {
        Rocket => "ROCKET",
        Banana => "BANANA",
    }
}

crate::wire_enum! {
    /// What started a MENACE predator rush (`items/engine.ts:377`).
    pub enum PredatorRushTrigger {
        Rocket => "ROCKET",
        Banana => "BANANA",
        QuackHorn => "QUACK_HORN",
    }
}

crate::wire_enum! {
    /// Which horn silenced a duck (`auto-use/execute.ts:194`, `pickups/engine.ts:461`).
    pub enum SilenceSource {
        QuackHorn => "QUACK_HORN",
        WildHorn => "WILD_HORN",
    }
}

crate::wire_enum! {
    /// Boost-gate lane tier (`track.ts:1`).
    pub enum BoostLaneTier {
        Hyper => "HYPER",
        Super => "SUPER",
        Standard => "STANDARD",
        Neutral => "NEUTRAL",
    }
}

crate::wire_enum! {
    /// Why a wild-item use failed (`pickups/engine.ts:71`).
    pub enum WildUseFailure {
        NoItem => "NO_ITEM",
        ItemChanged => "ITEM_CHANGED",
        NoTarget => "NO_TARGET",
        NotUseable => "NOT_USEABLE",
        Silenced => "SILENCED",
    }
}

crate::wire_enum! {
    /// Manual wild-item action (`index.ts:43`).
    pub enum WildItemAction {
        Use => "USE",
    }
}

crate::wire_enum! {
    /// Reason of a QP track reward (`lib/season3-race.ts:454`).
    pub enum QpRewardReason {
        TrackGoldenBox => "TRACK_GOLDEN_BOX",
    }
}

/// Horn blast side: `-1` (left) or `1` (right) (`items/aim.ts:6`). Serialised
/// as a JSON number.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export, type = "-1 | 1"))]
pub enum HornSide {
    Left,
    Right,
}

impl HornSide {
    /// `-1` or `1`.
    pub const fn sign(self) -> i8 {
        match self {
            Self::Left => -1,
            Self::Right => 1,
        }
    }
}

impl Serialize for HornSide {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_i8(self.sign())
    }
}

impl<'de> Deserialize<'de> for HornSide {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match i8::deserialize(deserializer)? {
            -1 => Ok(Self::Left),
            1 => Ok(Self::Right),
            other => Err(serde::de::Error::custom(alloc::format!(
                "horn side must be -1 or 1, got {other}"
            ))),
        }
    }
}

/// `deserialize_with` for `Option<Option<T>>`: absent -> `None` (with
/// `#[serde(default)]`), `null` -> `Some(None)`, value -> `Some(Some(v))`.
fn double_option<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

// ---------------------------------------------------------------------------
// Metadata structs
// ---------------------------------------------------------------------------

/// `{}`: events that carry no metadata keys.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct EmptyMeta {}

/// `RACE_STARTED` (`simulation.ts:213`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceStartedMeta {
    pub player_count: u32,
}

/// `DUCK_TEMPERAMENT` (`simulation.ts:215`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct DuckTemperamentMeta {
    pub temperament: Temperament,
}

/// `BOOST_GATE_PASSED` (`simulation.ts:580-593`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct BoostGatePassedMeta {
    pub gate_id: String,
    pub lane_id: String,
    pub tier: BoostLaneTier,
    pub multiplier: f64,
    pub duration_seconds: f64,
    /// `0xRRGGBB` as a number (`track.ts:79-82`).
    pub color_hex: u32,
    pub color_name: String,
    pub label: String,
}

/// `DUCK_FINISHED` (`simulation.ts:604-608`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct DuckFinishedMeta {
    pub finish_time_ms: f64,
}

/// `BOOST_BROKEN` (`items/engine.ts:270-278,290-298`). Source = victim,
/// target = attacker.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct BoostBrokenMeta {
    /// The speed item that ended, or `null` (partial break, or a boost not
    /// owned by a prep speed item).
    pub ended_item: Option<RaceItemId>,
    pub remaining_boost_ticks: u32,
    pub original_boost_ticks: u32,
    pub boost_multiplier: f64,
    pub fraction_denied: f64,
    pub break_source: BoostBreakSource,
    pub partial: bool,
    /// Present when an auto-used wild item caused the break (`auto-use/execute.ts:256`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
}

/// `NITRO_STARTED`, `DRAFT_FIN_STARTED`, `PADDLE_BURST_STARTED`
/// (`items/engine.ts:414-435` direct start, `:476-481` queued start).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct SpeedBoostStartedMeta {
    pub until_tick: u32,
    pub duration_seconds: f64,
    pub multiplier: f64,
    /// `true` when a queued boost starts as the previous one ends.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub queued: Option<bool>,
    /// `DRAFT_FIN` only: the duck being drafted (`auto-use/execute.ts:50`);
    /// TS writes `runtime.draftTargetPlayerId`, which may be `null`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "double_option"
    )]
    #[cfg_attr(feature = "ts-export", ts(optional = nullable, as = "Option<PlayerId>"))]
    pub draft_target: Option<Option<PlayerId>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
    /// `NITRO` only (`auto-use/execute.ts:40-41`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub start_rank: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub start_progress: Option<f64>,
    /// `true` when a momentum steal shortened this boost (`items/engine.ts:403-407`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub drained: Option<bool>,
}

/// `NITRO_ENDED`, `DRAFT_FIN_ENDED`, `PADDLE_BURST_ENDED`. Broken
/// (`items/engine.ts:268,289`): `{broken, consumedSeconds, autoReason?}`.
/// Natural (`:445-450`): `{consumedSeconds, natural, startProgress?, startRank?}`
/// where `startProgress`/`startRank` are the duck's last Nitro start, if any.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct SpeedBoostEndedMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub broken: Option<bool>,
    pub consumed_seconds: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub natural: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub start_progress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub start_rank: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
}

/// `SPEED_BOOST_QUEUED` (`items/engine.ts:414,420`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct SpeedBoostQueuedMeta {
    pub item_id: RaceItemId,
    pub duration_seconds: f64,
    pub multiplier: f64,
    pub replaced_previous: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub replaced_item_id: Option<RaceItemId>,
}

/// `MOMENTUM_STOLEN` (`items/engine.ts:322`). Source = attacker, target = victim.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct MomentumStolenMeta {
    pub stolen_item_id: RaceItemId,
    pub broke_boost: bool,
    pub multiplier: f64,
    pub duration_seconds: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
}

/// `GUARD_SURGE`. Counter (`items/engine.ts:339`): `{defenseItemId, blocked,
/// multiplier, durationSeconds}`. Feather glide (`:836`): `{defenseItemId:
/// FEATHER, glide: true, multiplier, durationSeconds}`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct GuardSurgeMeta {
    pub defense_item_id: GuardDefenseItem,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub blocked: Option<IncomingAttack>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub glide: Option<bool>,
    pub multiplier: f64,
    pub duration_seconds: f64,
}

/// `BUBBLE_SHIELD_ACTIVATED` (`items/engine.ts:356-360`; reflex `:368`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct BubbleShieldActivatedMeta {
    pub duration_seconds: f64,
    pub until_tick: u32,
    pub auto_reason: AutoUseReason,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub reflex: Option<ReflexThreat>,
}

/// `PREDATOR_RUSH_STARTED` (`items/engine.ts:382-387`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct PredatorRushStartedMeta {
    pub trigger: PredatorRushTrigger,
    pub multiplier: f64,
    pub duration_seconds: f64,
    pub until_tick: u32,
}

/// `ROCKET_FIRED` (`items/engine.ts:559` with `auto-use/arbiter.ts:118-122`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RocketFiredMeta {
    pub auto_reason: AutoUseReason,
    /// Target chosen at decision time, or `null`.
    pub decision_target_id: Option<PlayerId>,
    /// Target at execute time, or `null`.
    pub execute_target_id: Option<PlayerId>,
    pub retargeted_at_execute: bool,
}

/// `ROCKET_HIT`, `MINI_ROCKET_HIT` (`items/engine.ts:662`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RocketHitMeta {
    pub shock_absorbed: bool,
}

/// `ROCKET_BLOCKED`, `MINI_ROCKET_BLOCKED`, `BANANA_BLOCKED`,
/// `WILD_BANANA_BLOCKED` (`items/engine.ts:669,673,676,759,763,767,772,774`).
/// Rocket blocks never carry `blocked`; banana blocks carry `blocked: true`
/// except the Feather and immunity paths.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct ProjectileBlockedMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub blocked: Option<bool>,
    pub defense: BlockDefense,
}

/// `BANANA_DROPPED` (`auto-use/execute.ts:132`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct BananaDroppedMeta {
    pub progress: f64,
    pub lateral_offset: f64,
    pub aim_offset: f64,
    pub auto_reason: AutoUseReason,
}

/// `BANANA_HIT`, `WILD_BANANA_HIT` (`items/engine.ts:753`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct BananaHitMeta {
    pub lateral_slip: f64,
    pub shock_absorbed: bool,
}

/// `BANANA_EXPIRED`, `WILD_BANANA_EXPIRED` (`items/engine.ts:686`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct BananaExpiredMeta {
    pub id: u32,
}

/// `SHOCK_ABSORBER_PROC` (`items/engine.ts:610,710`; `auto-use/execute.ts:177`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct ShockAbsorberProcMeta {
    pub mitigated: IncomingAttack,
}

/// `HORN_USED` (`auto-use/execute.ts:206-214`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct HornUsedMeta {
    pub targets: Vec<PlayerId>,
    pub auto_reason: AutoUseReason,
    pub slipstream_charge_destroyed_ticks: u32,
    pub slipstream_charge_destroyed_seconds: f64,
    pub ducks_hit: u32,
    pub side: HornSide,
    pub silenced_seconds: f64,
}

/// `ITEM_SILENCED` (`auto-use/execute.ts:191-195`, `pickups/engine.ts:461`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct ItemSilencedMeta {
    pub duration_seconds: f64,
    pub until_tick: u32,
    pub source: SilenceSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
}

/// `FEATHER_DODGED` (`items/engine.ts:770` banana: `{}`;
/// `auto-use/execute.ts:161` horn: `{blocked: QUACK_HORN}`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct FeatherDodgedMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub blocked: Option<IncomingAttack>,
}

/// `BUBBLE_POPPED` (`items/engine.ts:672,762`; `auto-use/execute.ts:155`
/// adds `intact: true`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct BubblePoppedMeta {
    pub blocked: IncomingAttack,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub intact: Option<bool>,
}

/// `MINI_BUBBLE_BLOCKED` (`items/engine.ts:668,758`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct MiniBubbleBlockedMeta {
    pub blocked: IncomingAttack,
}

/// `{untilTick, autoReason?}`: `MINI_BUBBLE_ACTIVATED` (`pickups/engine.ts:418`),
/// `WILD_FEATHER_USED` (`:473`), `TAILWIND_STARTED` (`:281`), `MAGNET_STARTED`
/// (`:285`). `autoReason` is added when an auto-used wild item emits it
/// (`auto-use/execute.ts:256`); Tailwind and Magnet never carry it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct UntilTickMeta {
    pub until_tick: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
}

/// `MINI_BUBBLE_EXPIRED` (`pickups/engine.ts:500`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct MiniBubbleExpiredMeta {
    pub expiry_boost: bool,
}

/// `{autoReason?}`: `MINI_ROCKET_FIRED` (`pickups/engine.ts:434`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct AutoReasonMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
}

/// `WILD_BANANA_DROPPED` (`pickups/engine.ts:441`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct WildBananaDroppedMeta {
    pub id: u32,
    pub progress: f64,
    pub lateral_offset: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
}

/// `WILD_HORN_USED` (`pickups/engine.ts:467`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct WildHornUsedMeta {
    pub targets: Vec<PlayerId>,
    pub side: HornSide,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub auto_reason: Option<AutoUseReason>,
}

/// `WILD_FEATHER_DODGED`: banana (`items/engine.ts:766`) `{}`; hazard
/// (`pickups/engine.ts:361`) `{hazardId, hazardType}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct WildFeatherDodgedMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub hazard_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub hazard_type: Option<HazardType>,
}

/// `HAZARD_SPAWNED` (`pickups/engine.ts:216-218`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct HazardSpawnedMeta {
    pub hazard_id: String,
    pub zone_id: String,
    pub hazard_type: HazardType,
    pub progress: f64,
    pub lateral_offset: f64,
    pub radius: f64,
}

/// `HAZARD_HIT`, `HAZARD_DODGED` (`pickups/engine.ts:362,369`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct HazardMeta {
    pub hazard_id: String,
    pub hazard_type: HazardType,
}

/// `PICKUP_SPAWNED`, `GOLDEN_BOX_SPAWNED` (`pickups/engine.ts:211-213`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct PickupSpawnedMeta {
    pub pickup_id: String,
    pub zone_id: String,
    pub pickup_type: PickupSpawnType,
    pub progress: f64,
    pub lateral_offset: f64,
}

/// `PICKUP_COLLECTED` (`pickups/engine.ts:330`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct PickupCollectedMeta {
    pub pickup_id: String,
    pub pickup_type: PickupSpawnType,
    pub progress: f64,
    pub lateral_offset: f64,
}

/// `GOLDEN_BOX_COLLECTED` (`pickups/engine.ts:333`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct GoldenBoxCollectedMeta {
    pub pickup_id: String,
}

/// `PICKUP_ZONE_ACTIVATED` (`pickups/engine.ts:347`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct PickupZoneActivatedMeta {
    pub zone_id: String,
}

/// `PICKUP_SKIPPED_SLOT_FULL` (`pickups/engine.ts:315`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct PickupSkippedSlotFullMeta {
    pub pickup_id: String,
    pub item_id: WildItemId,
}

/// `WILD_ITEM_GRANTED`, `INSTANT_PICKUP_TRIGGERED` (`pickups/engine.ts:273,287`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct WildItemGrantedMeta {
    pub pickup_id: String,
    pub instance_id: String,
    pub item_id: WildItemId,
    pub rank: u32,
}

/// `WILD_ITEM_USED` (`pickups/engine.ts:491`, manual mode).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct WildItemUsedMeta {
    pub instance_id: String,
    pub item_id: WildItemId,
}

/// `WILD_ITEM_AUTO_USED`: use (`pickups/engine.ts:491` plus `autoReason` from
/// `auto-use/execute.ts:256`) or discard (`auto-use/execute.ts:239-245`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct WildItemAutoUsedMeta {
    pub instance_id: String,
    pub item_id: WildItemId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub discarded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub forfeited: Option<bool>,
    pub auto_reason: AutoUseReason,
}

/// `WILD_ITEM_MANUAL_INPUT` (`pickups/engine.ts:514-520`). Consumed manual
/// inputs live only here (D9: no separate inputs digest).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct WildItemManualInputMeta {
    pub instance_id: String,
    pub client_action_id: ClientActionId,
    pub action: WildItemAction,
    pub applied: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub reason: Option<WildUseFailure>,
}

/// `AI_INTENT` (`auto-use/arbiter.ts:49`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct AiIntentMeta {
    pub intent: AiIntent,
    pub item_id: ItemKey,
    pub temperament: Temperament,
}

/// `CHAOS_RESOLVED`, server meta (`lib/season3-race.ts:319-322`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct ChaosResolvedMeta {
    pub chaos_type: ChaosType,
    pub loser_player_ids: Vec<PlayerId>,
}

/// `QP_TRACK_REWARD_GRANTED`, server meta (`lib/season3-race.ts:454`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct QpTrackRewardGrantedMeta {
    pub pickup_id: String,
    pub amount: u32,
    pub reason: QpRewardReason,
}

// ---------------------------------------------------------------------------
// EventKind
// ---------------------------------------------------------------------------

macro_rules! event_kinds {
    ($( $(#[$vmeta:meta])* $variant:ident($meta:ty) => $wire:literal ),+ $(,)?) => {
        /// Event type plus its typed metadata. Serialises adjacently tagged as
        /// `"type": "<WIRE>", "metadata": {...}`.
        #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
        #[serde(tag = "type", content = "metadata")]
        #[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
        pub enum EventKind {
            $( $(#[$vmeta])* #[serde(rename = $wire)] $variant($meta) ),+
        }

        impl EventKind {
            /// Every wire type literal, in `raceEventTypeSchema` order.
            pub const TYPE_NAMES: &'static [&'static str] = &[$($wire),+];

            /// The wire `type` literal.
            pub const fn type_name(&self) -> &'static str {
                match self {
                    $(Self::$variant(_) => $wire),+
                }
            }
        }
    };
}

event_kinds! {
    RaceStarted(RaceStartedMeta) => "RACE_STARTED",
    DuckCollision(EmptyMeta) => "DUCK_COLLISION",
    /// Declared in `raceEventTypeSchema` but never emitted.
    ItemActivated(EmptyMeta) => "ITEM_ACTIVATED",
    RocketFired(RocketFiredMeta) => "ROCKET_FIRED",
    RocketHit(RocketHitMeta) => "ROCKET_HIT",
    RocketBlocked(ProjectileBlockedMeta) => "ROCKET_BLOCKED",
    RocketExpired(EmptyMeta) => "ROCKET_EXPIRED",
    BananaDropped(BananaDroppedMeta) => "BANANA_DROPPED",
    BananaHit(BananaHitMeta) => "BANANA_HIT",
    BananaBlocked(ProjectileBlockedMeta) => "BANANA_BLOCKED",
    BananaExpired(BananaExpiredMeta) => "BANANA_EXPIRED",
    NitroStarted(SpeedBoostStartedMeta) => "NITRO_STARTED",
    NitroEnded(SpeedBoostEndedMeta) => "NITRO_ENDED",
    DraftFinStarted(SpeedBoostStartedMeta) => "DRAFT_FIN_STARTED",
    DraftFinEnded(SpeedBoostEndedMeta) => "DRAFT_FIN_ENDED",
    PaddleBurstStarted(SpeedBoostStartedMeta) => "PADDLE_BURST_STARTED",
    PaddleBurstEnded(SpeedBoostEndedMeta) => "PADDLE_BURST_ENDED",
    PredatorRushStarted(PredatorRushStartedMeta) => "PREDATOR_RUSH_STARTED",
    /// Declared in `raceEventTypeSchema` but never emitted.
    PredatorRushEnded(EmptyMeta) => "PREDATOR_RUSH_ENDED",
    BoostBroken(BoostBrokenMeta) => "BOOST_BROKEN",
    SpeedBoostQueued(SpeedBoostQueuedMeta) => "SPEED_BOOST_QUEUED",
    ShockAbsorberProc(ShockAbsorberProcMeta) => "SHOCK_ABSORBER_PROC",
    HornUsed(HornUsedMeta) => "HORN_USED",
    ItemSilenced(ItemSilencedMeta) => "ITEM_SILENCED",
    FeatherDodged(FeatherDodgedMeta) => "FEATHER_DODGED",
    BubbleShieldActivated(BubbleShieldActivatedMeta) => "BUBBLE_SHIELD_ACTIVATED",
    BubbleShieldExpired(EmptyMeta) => "BUBBLE_SHIELD_EXPIRED",
    BubblePopped(BubblePoppedMeta) => "BUBBLE_POPPED",
    DuckFinished(DuckFinishedMeta) => "DUCK_FINISHED",
    RaceFinished(EmptyMeta) => "RACE_FINISHED",
    /// Server meta event; excluded from `eventsSha256`.
    ChaosResolved(ChaosResolvedMeta) => "CHAOS_RESOLVED",
    PickupZoneActivated(PickupZoneActivatedMeta) => "PICKUP_ZONE_ACTIVATED",
    PickupSpawned(PickupSpawnedMeta) => "PICKUP_SPAWNED",
    PickupCollected(PickupCollectedMeta) => "PICKUP_COLLECTED",
    PickupSkippedSlotFull(PickupSkippedSlotFullMeta) => "PICKUP_SKIPPED_SLOT_FULL",
    WildItemGranted(WildItemGrantedMeta) => "WILD_ITEM_GRANTED",
    WildItemUsed(WildItemUsedMeta) => "WILD_ITEM_USED",
    WildItemAutoUsed(WildItemAutoUsedMeta) => "WILD_ITEM_AUTO_USED",
    WildItemManualInput(WildItemManualInputMeta) => "WILD_ITEM_MANUAL_INPUT",
    InstantPickupTriggered(WildItemGrantedMeta) => "INSTANT_PICKUP_TRIGGERED",
    TailwindStarted(UntilTickMeta) => "TAILWIND_STARTED",
    TailwindEnded(EmptyMeta) => "TAILWIND_ENDED",
    MagnetStarted(UntilTickMeta) => "MAGNET_STARTED",
    MagnetEnded(EmptyMeta) => "MAGNET_ENDED",
    MiniBubbleActivated(UntilTickMeta) => "MINI_BUBBLE_ACTIVATED",
    MiniBubbleBlocked(MiniBubbleBlockedMeta) => "MINI_BUBBLE_BLOCKED",
    MiniBubbleExpired(MiniBubbleExpiredMeta) => "MINI_BUBBLE_EXPIRED",
    MiniRocketFired(AutoReasonMeta) => "MINI_ROCKET_FIRED",
    MiniRocketHit(RocketHitMeta) => "MINI_ROCKET_HIT",
    MiniRocketBlocked(ProjectileBlockedMeta) => "MINI_ROCKET_BLOCKED",
    MiniRocketExpired(EmptyMeta) => "MINI_ROCKET_EXPIRED",
    WildBananaDropped(WildBananaDroppedMeta) => "WILD_BANANA_DROPPED",
    WildBananaHit(BananaHitMeta) => "WILD_BANANA_HIT",
    WildBananaBlocked(ProjectileBlockedMeta) => "WILD_BANANA_BLOCKED",
    WildBananaExpired(BananaExpiredMeta) => "WILD_BANANA_EXPIRED",
    WildHornUsed(WildHornUsedMeta) => "WILD_HORN_USED",
    WildFeatherUsed(UntilTickMeta) => "WILD_FEATHER_USED",
    WildFeatherDodged(WildFeatherDodgedMeta) => "WILD_FEATHER_DODGED",
    HazardSpawned(HazardSpawnedMeta) => "HAZARD_SPAWNED",
    HazardHit(HazardMeta) => "HAZARD_HIT",
    HazardDodged(HazardMeta) => "HAZARD_DODGED",
    GoldenBoxSpawned(PickupSpawnedMeta) => "GOLDEN_BOX_SPAWNED",
    GoldenBoxCollected(GoldenBoxCollectedMeta) => "GOLDEN_BOX_COLLECTED",
    /// Server meta event; excluded from `eventsSha256`.
    QpTrackRewardGranted(QpTrackRewardGrantedMeta) => "QP_TRACK_REWARD_GRANTED",
    BoostGatePassed(BoostGatePassedMeta) => "BOOST_GATE_PASSED",
    MomentumStolen(MomentumStolenMeta) => "MOMENTUM_STOLEN",
    GuardSurge(GuardSurgeMeta) => "GUARD_SURGE",
    DuckTemperament(DuckTemperamentMeta) => "DUCK_TEMPERAMENT",
    AiIntent(AiIntentMeta) => "AI_INTENT",
}

impl EventKind {
    /// Server meta events (D7): written by the season layer, never by the
    /// engine, and excluded from `eventsSha256` and replay comparisons.
    pub const META_TYPE_NAMES: &'static [&'static str] =
        &["CHAOS_RESOLVED", "QP_TRACK_REWARD_GRANTED"];

    /// Declared in the TS schema but never emitted by any TS code.
    pub const UNEMITTED_TYPE_NAMES: &'static [&'static str] =
        &["ITEM_ACTIVATED", "PREDATOR_RUSH_ENDED"];

    /// `true` for `CHAOS_RESOLVED` and `QP_TRACK_REWARD_GRANTED`.
    pub const fn is_meta(&self) -> bool {
        matches!(self, Self::ChaosResolved(_) | Self::QpTrackRewardGranted(_))
    }
}

/// One race event on the wire (D7): today's TS shape plus `seq`.
///
/// `seq` is the per-race emission index (0-based). It is excluded from
/// `eventsSha256` because the order already encodes it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RaceEvent {
    pub race_id: RaceId,
    pub tick: u32,
    pub timestamp_within_race_ms: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub source_player_id: Option<PlayerId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-export", ts(optional))]
    pub target_player_id: Option<PlayerId>,
    #[serde(flatten)]
    pub kind: EventKind,
    pub seq: u32,
}

impl RaceEvent {
    /// The wire `type` literal.
    pub const fn type_name(&self) -> &'static str {
        self.kind.type_name()
    }

    /// See [`EventKind::is_meta`].
    pub const fn is_meta(&self) -> bool {
        self.kind.is_meta()
    }
}

/// A manual wild-item command from a player (`wildItemUseCommandSchema`,
/// `index.ts:39-45`). `wildItemInstanceId` keeps the TS 1-160 bound because
/// it is engine-generated (`wild:<raceId>:<pickupId>:<playerId>`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct WildItemUseCommand {
    pub race_id: RaceId,
    pub player_id: PlayerId,
    pub wild_item_instance_id: String,
    pub action: WildItemAction,
    pub client_action_id: ClientActionId,
}

/// Maximum `wildItemInstanceId` length (`index.ts:42`).
pub const WILD_ITEM_INSTANCE_ID_MAX_LEN: usize = 160;

impl WildItemUseCommand {
    /// `true` when `wildItemInstanceId` is 1-160 characters (`index.ts:42`).
    pub fn has_valid_instance_id(&self) -> bool {
        let len = self.wild_item_instance_id.chars().count();
        (1..=WILD_ITEM_INSTANCE_ID_MAX_LEN).contains(&len)
    }
}

/// A manual input with the tick the server applies it at
/// (`RecordedWildItemInput`, `index.ts:48-50`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
pub struct RecordedWildItemInput {
    pub race_id: RaceId,
    pub player_id: PlayerId,
    pub wild_item_instance_id: String,
    pub action: WildItemAction,
    pub client_action_id: ClientActionId,
    pub authoritative_tick: u32,
}
