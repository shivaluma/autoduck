//! Loadout combos: `loadoutComboLabel` / `loadoutComboBadge`
//! (`packages/race-core/src/items/classes.ts`, S3.15). `ITEM_CLASS_BY_ID` is
//! `crate::catalog::item_class`.

use race_protocol::ids::RaceItemId;

use crate::catalog::{ItemClass, item_class};

/// `LoadoutComboLabel` values `loadoutComboLabel` can return
/// (`classes.ts:17-25`; the other four literals are never produced).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum LoadoutCombo {
    SpeedDemon,
    Fortress,
    Menace,
    MadDuck,
}

impl LoadoutCombo {
    /// The TS literal.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SpeedDemon => "SPEED DEMON",
            Self::Fortress => "FORTRESS",
            Self::Menace => "MENACE",
            Self::MadDuck => "MAD DUCK",
        }
    }
}

/// `loadoutComboLabel(itemIds)` (`classes.ts:27-37`).
#[must_use]
pub fn loadout_combo_label(item_ids: &[RaceItemId]) -> Option<LoadoutCombo> {
    if item_ids.len() != 2 {
        return None;
    }
    let first = item_class(item_ids[0]);
    if item_class(item_ids[1]) == first {
        return Some(match first {
            ItemClass::Speed => LoadoutCombo::SpeedDemon,
            ItemClass::Defense => LoadoutCombo::Fortress,
            ItemClass::Attack => LoadoutCombo::Menace,
        });
    }
    Some(LoadoutCombo::MadDuck)
}

/// `loadoutComboBadge(itemIds)` (`classes.ts:39-49`).
#[must_use]
pub fn loadout_combo_badge(item_ids: &[RaceItemId]) -> Option<&'static str> {
    if item_ids.len() != 2 {
        return None;
    }
    let first = item_class(item_ids[0]);
    if item_class(item_ids[1]) == first {
        return Some(match first {
            ItemClass::Speed => "⚡ SPEED COMBO",
            ItemClass::Defense => "🛡️ DEFENSE COMBO",
            ItemClass::Attack => "💥 ATTACK COMBO",
        });
    }
    Some("🧪 HYBRID")
}
