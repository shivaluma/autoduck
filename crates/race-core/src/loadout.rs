//! Prep loadouts: `validateLoadout` (`packages/race-core/src/items/loadout.ts`)
//! and `selectAutoLoadout` (`lib/racing/loadout.ts`), S3.15.
//!
//! `selectAutoLoadout` draws on the meta stream `auto-loadout:<playerId>`
//! (D5), which must stay identical mid-season.

use alloc::vec::Vec;
use core::fmt;

use race_protocol::ids::RaceItemId;

use crate::catalog::{ItemCategory, RACE_ITEM_CATALOG, RaceItemDefinition, get_race_item};
use crate::rng::create_race_rng;

/// `PREP_CREDITS`.
pub const PREP_CREDITS: u32 = 3;
/// `LOADOUT_SLOTS`.
pub const LOADOUT_SLOTS: usize = 2;

/// Why `validateLoadout` throws. `Display` is the TS error message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadoutError {
    /// More than [`LOADOUT_SLOTS`] items.
    TooManyItems,
    /// The same item twice.
    DuplicateItem,
    /// Cost above [`PREP_CREDITS`].
    OverBudget,
    /// More than one major item (unreachable with the S3.15 costs: two majors
    /// already exceed the budget, which is checked first).
    TooManyMajors,
}

impl fmt::Display for LoadoutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooManyItems => write!(f, "Tối đa {LOADOUT_SLOTS} items"),
            Self::DuplicateItem => f.write_str("Không được chọn item trùng nhau"),
            Self::OverBudget => write!(f, "Vượt quá {PREP_CREDITS} Prep Credits"),
            Self::TooManyMajors => f.write_str("Tối đa 1 Major Item"),
        }
    }
}

impl core::error::Error for LoadoutError {}

/// `validateLoadout`'s return value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoadoutValidation {
    pub items: Vec<&'static RaceItemDefinition>,
    pub spent: u32,
    pub ready: bool,
}

/// `validateLoadout(itemIds)`: the checks run in the TS order (slots,
/// duplicates, credits, majors), so the first failing one is reported.
///
/// # Errors
/// The [`LoadoutError`] whose message the TS function throws.
pub fn validate_loadout(item_ids: &[RaceItemId]) -> Result<LoadoutValidation, LoadoutError> {
    if item_ids.len() > LOADOUT_SLOTS {
        return Err(LoadoutError::TooManyItems);
    }
    for (index, id) in item_ids.iter().enumerate() {
        if item_ids[..index].contains(id) {
            return Err(LoadoutError::DuplicateItem);
        }
    }
    let items: Vec<&'static RaceItemDefinition> =
        item_ids.iter().map(|&id| get_race_item(id)).collect();
    let spent: u32 = items.iter().map(|item| u32::from(item.cost)).sum();
    if spent > PREP_CREDITS {
        return Err(LoadoutError::OverBudget);
    }
    if items
        .iter()
        .filter(|item| item.category == ItemCategory::Major)
        .count()
        > 1
    {
        return Err(LoadoutError::TooManyMajors);
    }
    let ready = spent == PREP_CREDITS && item_ids.len() == LOADOUT_SLOTS;
    Ok(LoadoutValidation {
        items,
        spent,
        ready,
    })
}

/// `selectAutoLoadout(seed, playerId)`: one major (`cost === 2 || category
/// === 'major'`) then one minor (`cost === 1 || category === 'minor'`), each
/// drawn with `rng.integer(0, n - 1)` on `createRaceRng(seed,
/// 'auto-loadout:' + playerId)`, in catalog order.
#[must_use]
pub fn select_auto_loadout(seed: &str, player_id: &str) -> [RaceItemId; 2] {
    let mut stream = alloc::string::String::with_capacity(13 + player_id.len());
    stream.push_str("auto-loadout:");
    stream.push_str(player_id);
    let mut rng = create_race_rng(seed, &stream);
    let major_items: Vec<RaceItemId> = RACE_ITEM_CATALOG
        .iter()
        .filter(|item| item.cost == 2 || item.category == ItemCategory::Major)
        .map(|item| item.id)
        .collect();
    let minor_items: Vec<RaceItemId> = RACE_ITEM_CATALOG
        .iter()
        .filter(|item| item.cost == 1 || item.category == ItemCategory::Minor)
        .map(|item| item.id)
        .collect();
    let major = major_items[rng.index(major_items.len())];
    let minor = minor_items[rng.index(minor_items.len())];
    [major, minor]
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::ToString;

    #[test]
    fn ts_unit_cases() {
        // tests/race-loadout.test.ts
        assert!(
            validate_loadout(&[RaceItemId::Nitro, RaceItemId::Banana])
                .unwrap()
                .ready
        );
        assert!(
            !validate_loadout(&[RaceItemId::Feather, RaceItemId::QuackHorn])
                .unwrap()
                .ready
        );
        assert_eq!(
            validate_loadout(&[RaceItemId::Nitro, RaceItemId::HomingRocket]),
            Err(LoadoutError::OverBudget)
        );
        assert_eq!(
            validate_loadout(&[RaceItemId::Banana, RaceItemId::Banana]),
            Err(LoadoutError::DuplicateItem)
        );
        assert_eq!(
            validate_loadout(&[
                RaceItemId::Banana,
                RaceItemId::Feather,
                RaceItemId::QuackHorn
            ]),
            Err(LoadoutError::TooManyItems)
        );
        assert_eq!(LoadoutError::TooManyItems.to_string(), "Tối đa 2 items");
        let first = select_auto_loadout(&"ab".repeat(32), "42");
        assert_eq!(first, select_auto_loadout(&"ab".repeat(32), "42"));
        assert!(validate_loadout(&first).unwrap().ready);
    }
}
