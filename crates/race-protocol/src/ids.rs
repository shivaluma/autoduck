//! Validated identifiers (D6) and the closed catalog id sets.
//!
//! Ids must match `^[0-9A-Za-z_:-]{1,64}$`; `clientActionId` must be 8-64
//! characters. Phase B orders ids by bytes (`Ord for str`); the `ts-compat`
//! ICU comparator lives in `race_core::collate_compat`.
//!
//! TS source: `packages/race-protocol/src/index.ts:12-55`. The TS schema
//! accepted any 1-128 character player id; D6 narrows it.

use alloc::string::String;
use core::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Maximum length of a [`PlayerId`] / [`RaceId`] (D6).
pub const ID_MAX_LEN: usize = 64;
/// Minimum length of a [`ClientActionId`] (D6).
pub const CLIENT_ACTION_ID_MIN_LEN: usize = 8;
/// Maximum length of a [`ClientActionId`] (D6).
pub const CLIENT_ACTION_ID_MAX_LEN: usize = 64;
/// Length of a race seed: 32 bytes as hex.
pub const RACE_SEED_HEX_LEN: usize = 64;

/// Why a string was rejected as an identifier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdError {
    /// Shorter than the minimum (`len` in bytes, which equals characters for valid ids).
    TooShort { min: usize, len: usize }, // usize-ok: error detail, never serialized
    /// Longer than the maximum.
    TooLong { max: usize, len: usize }, // usize-ok: error detail, never serialized
    /// A character outside the allowed set, at byte offset `index`.
    InvalidChar { index: usize, ch: char }, // usize-ok: error detail, never serialized
}

impl fmt::Display for IdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooShort { min, len } => write!(f, "id is {len} characters, minimum is {min}"),
            Self::TooLong { max, len } => write!(f, "id is {len} characters, maximum is {max}"),
            Self::InvalidChar { index, ch } => {
                write!(f, "id has invalid character {ch:?} at byte {index}")
            }
        }
    }
}

/// `true` for the D6 id alphabet `[0-9A-Za-z_:-]`.
#[inline]
pub const fn is_id_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b':' | b'-')
}

/// Checks `value` against `^[0-9A-Za-z_:-]{min,max}$`.
pub fn validate_id_chars(value: &str, min: usize, max: usize) -> Result<(), IdError> {
    if let Some((index, ch)) = value
        .char_indices()
        .find(|&(_, ch)| !ch.is_ascii() || !is_id_byte(ch as u8))
    {
        return Err(IdError::InvalidChar { index, ch });
    }
    // All characters are ASCII here, so byte length == character count.
    let len = value.len();
    if len < min {
        return Err(IdError::TooShort { min, len });
    }
    if len > max {
        return Err(IdError::TooLong { max, len });
    }
    Ok(())
}

fn validate_seed(value: &str) -> Result<(), IdError> {
    if let Some((index, ch)) = value
        .char_indices()
        .find(|&(_, ch)| !ch.is_ascii_hexdigit())
    {
        return Err(IdError::InvalidChar { index, ch });
    }
    match value.len() {
        RACE_SEED_HEX_LEN => Ok(()),
        len if len < RACE_SEED_HEX_LEN => Err(IdError::TooShort {
            min: RACE_SEED_HEX_LEN,
            len,
        }),
        len => Err(IdError::TooLong {
            max: RACE_SEED_HEX_LEN,
            len,
        }),
    }
}

macro_rules! validated_string {
    ($(#[$meta:meta])* $name:ident, $validate:expr) => {
        $(#[$meta])*
        #[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
        #[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export, type = "string"))]
        pub struct $name(String);

        impl $name {
            /// Validates and wraps `value`.
            pub fn new(value: impl Into<String>) -> Result<Self, IdError> {
                let value = value.into();
                let check: fn(&str) -> Result<(), IdError> = $validate;
                check(&value)?;
                Ok(Self(value))
            }

            /// The id as a string slice.
            pub fn as_str(&self) -> &str {
                &self.0
            }

            /// Unwraps the inner string.
            pub fn into_string(self) -> String {
                self.0
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Debug::fmt(&self.0, f)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }

        impl AsRef<str> for $name {
            fn as_ref(&self) -> &str {
                &self.0
            }
        }

        impl core::str::FromStr for $name {
            type Err = IdError;
            fn from_str(value: &str) -> Result<Self, IdError> {
                Self::new(value)
            }
        }

        impl TryFrom<String> for $name {
            type Error = IdError;
            fn try_from(value: String) -> Result<Self, IdError> {
                Self::new(value)
            }
        }

        impl TryFrom<&str> for $name {
            type Error = IdError;
            fn try_from(value: &str) -> Result<Self, IdError> {
                Self::new(value)
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> String {
                value.0
            }
        }

        impl PartialEq<str> for $name {
            fn eq(&self, other: &str) -> bool {
                self.0 == other
            }
        }

        impl PartialEq<&str> for $name {
            fn eq(&self, other: &&str) -> bool {
                self.0 == *other
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.0)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let value = String::deserialize(deserializer)?;
                Self::new(value).map_err(serde::de::Error::custom)
            }
        }
    };
}

validated_string!(
    /// A player id (D6): `^[0-9A-Za-z_:-]{1,64}$`. Season 3 uses the decimal
    /// user id; tooling uses `duck-N`. Ordered by bytes.
    PlayerId,
    |value| validate_id_chars(value, 1, ID_MAX_LEN)
);

validated_string!(
    /// A race id (D6 alphabet): `^[0-9A-Za-z_:-]{1,64}$`. Official races use
    /// the decimal `Race.id`; the lab uses `race-lab-N`.
    RaceId,
    |value| validate_id_chars(value, 1, ID_MAX_LEN)
);

validated_string!(
    /// A client action id for manual wild-item input (D6): the id alphabet,
    /// 8-64 characters. The TS schema allowed 8-160 of any character.
    ClientActionId,
    |value| validate_id_chars(value, CLIENT_ACTION_ID_MIN_LEN, CLIENT_ACTION_ID_MAX_LEN)
);

validated_string!(
    /// A race seed: 64 hex digits, either case (`index.ts:13`,
    /// `/^[a-f0-9]{64}$/i`). Kept verbatim because the RNG hashes the seed text.
    RaceSeed,
    validate_seed
);

/// Declares a closed string enum whose variants serialise as the given wire
/// literals, with `ALL`, `as_str()`, `from_wire()` and `Display`.
#[doc(hidden)]
#[macro_export]
macro_rules! wire_enum {
    (
        $(#[$meta:meta])*
        $vis:vis enum $name:ident {
            $( $(#[$vmeta:meta])* $variant:ident => $wire:literal ),+ $(,)?
        }
    ) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize)]
        #[cfg_attr(feature = "ts-export", derive(ts_rs::TS), ts(export))]
        $vis enum $name {
            $( $(#[$vmeta])* #[serde(rename = $wire)] $variant ),+
        }

        impl $name {
            /// Every variant, in declaration order.
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            /// The wire literal.
            pub const fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $wire),+
                }
            }

            /// Parses a wire literal.
            pub fn from_wire(value: &str) -> Option<Self> {
                match value {
                    $($wire => Some(Self::$variant),)+
                    _ => None,
                }
            }
        }

        impl core::fmt::Display for $name {
            fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
}

crate::wire_enum! {
    /// Prep (loadout) race items, `raceItemIdSchema` (`index.ts:14-24`).
    pub enum RaceItemId {
        Nitro => "NITRO",
        DraftFin => "DRAFT_FIN",
        PaddleBurst => "PADDLE_BURST",
        BubbleShield => "BUBBLE_SHIELD",
        Feather => "FEATHER",
        ShockAbsorber => "SHOCK_ABSORBER",
        HomingRocket => "HOMING_ROCKET",
        Banana => "BANANA",
        QuackHorn => "QUACK_HORN",
    }
}

crate::wire_enum! {
    /// Wild (box) items, `wildItemIdSchema` (`index.ts:27-36`).
    pub enum WildItemId {
        MiniNitro => "MINI_NITRO",
        Tailwind => "TAILWIND",
        MiniBubble => "MINI_BUBBLE",
        MiniRocket => "MINI_ROCKET",
        Banana => "BANANA",
        QuackHorn => "QUACK_HORN",
        Feather => "FEATHER",
        SlipstreamMagnet => "SLIPSTREAM_MAGNET",
    }
}

crate::wire_enum! {
    /// Any prep or wild item id (`RaceItemId | WildItemId`). Used where the TS
    /// engine writes either kind, e.g. `AI_INTENT.itemId` (`arbiter.ts:49`).
    pub enum ItemKey {
        Nitro => "NITRO",
        DraftFin => "DRAFT_FIN",
        PaddleBurst => "PADDLE_BURST",
        BubbleShield => "BUBBLE_SHIELD",
        Feather => "FEATHER",
        ShockAbsorber => "SHOCK_ABSORBER",
        HomingRocket => "HOMING_ROCKET",
        Banana => "BANANA",
        QuackHorn => "QUACK_HORN",
        MiniNitro => "MINI_NITRO",
        Tailwind => "TAILWIND",
        MiniBubble => "MINI_BUBBLE",
        MiniRocket => "MINI_ROCKET",
        SlipstreamMagnet => "SLIPSTREAM_MAGNET",
    }
}

impl From<RaceItemId> for ItemKey {
    fn from(value: RaceItemId) -> Self {
        match value {
            RaceItemId::Nitro => Self::Nitro,
            RaceItemId::DraftFin => Self::DraftFin,
            RaceItemId::PaddleBurst => Self::PaddleBurst,
            RaceItemId::BubbleShield => Self::BubbleShield,
            RaceItemId::Feather => Self::Feather,
            RaceItemId::ShockAbsorber => Self::ShockAbsorber,
            RaceItemId::HomingRocket => Self::HomingRocket,
            RaceItemId::Banana => Self::Banana,
            RaceItemId::QuackHorn => Self::QuackHorn,
        }
    }
}

impl From<WildItemId> for ItemKey {
    fn from(value: WildItemId) -> Self {
        match value {
            WildItemId::MiniNitro => Self::MiniNitro,
            WildItemId::Tailwind => Self::Tailwind,
            WildItemId::MiniBubble => Self::MiniBubble,
            WildItemId::MiniRocket => Self::MiniRocket,
            WildItemId::Banana => Self::Banana,
            WildItemId::QuackHorn => Self::QuackHorn,
            WildItemId::Feather => Self::Feather,
            WildItemId::SlipstreamMagnet => Self::SlipstreamMagnet,
        }
    }
}

crate::wire_enum! {
    /// Pickup box types, `pickupSpawnTypeSchema` (`index.ts:52`).
    pub enum PickupSpawnType {
        QuackBox => "QUACK_BOX",
        GoldenBox => "GOLDEN_BOX",
        ChaosBox => "CHAOS_BOX",
    }
}

crate::wire_enum! {
    /// Hazard types, `hazardTypeSchema` (`index.ts:55`).
    pub enum HazardType {
        Anchor => "ANCHOR",
        Whirlpool => "WHIRLPOOL",
        IcePatch => "ICE_PATCH",
        StickyGoo => "STICKY_GOO",
    }
}
