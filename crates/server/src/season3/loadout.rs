//! `lib/racing/loadout.ts`: the `SeasonLoadout.itemIdsJson` column and auto-loadouts.
//!
//! `validateLoadout` and `selectAutoLoadout` are race-core's (meta-parity fixture, D5: the
//! `auto-loadout:<userId>` stream must stay identical mid-season).

use std::fmt;

use race_core::loadout::LoadoutError;
pub use race_core::loadout::{
    LOADOUT_SLOTS, LoadoutValidation, PREP_CREDITS, select_auto_loadout, validate_loadout,
};
use race_protocol::ids::RaceItemId;
use serde_json::Value;

/// Why `parseItemIds` throws. Every caller turns it into a 500.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ParseItemIdsError {
    /// `JSON.parse` failed.
    NotJson,
    /// Valid JSON but not an array (`Invalid loadout`).
    NotArray,
    /// `raceItemIdSchema.parse` rejected an element (a Zod error in TS).
    UnknownItem(String),
}

impl fmt::Display for ParseItemIdsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotJson => f.write_str("Invalid loadout JSON"),
            Self::NotArray => f.write_str("Invalid loadout"),
            Self::UnknownItem(item) => write!(f, "Invalid race item id: {item}"),
        }
    }
}

impl std::error::Error for ParseItemIdsError {}

/// `raceItemIdSchema.parse(value)`: a string naming a catalog item.
///
/// # Errors
/// [`ParseItemIdsError::UnknownItem`] for anything else.
pub fn parse_item_id(value: &Value) -> Result<RaceItemId, ParseItemIdsError> {
    value
        .as_str()
        .and_then(RaceItemId::from_wire)
        .ok_or_else(|| ParseItemIdsError::UnknownItem(crate::cosmetics::js::stringify(value)))
}

/// `parseItemIds(itemIdsJson)`.
///
/// # Errors
/// See [`ParseItemIdsError`].
pub fn parse_item_ids(value: &str) -> Result<Vec<RaceItemId>, ParseItemIdsError> {
    let parsed: Value = serde_json::from_str(value).map_err(|_| ParseItemIdsError::NotJson)?;
    let Value::Array(items) = parsed else {
        return Err(ParseItemIdsError::NotArray);
    };
    items.iter().map(parse_item_id).collect()
}

/// `serializeItemIds(itemIds)`: validated, then `JSON.stringify` (`["NITRO","BANANA"]`).
///
/// # Errors
/// The [`LoadoutError`] `validateLoadout` throws (slots, duplicates, Prep Credits, majors).
pub fn serialize_item_ids(item_ids: &[RaceItemId]) -> Result<String, LoadoutError> {
    validate_loadout(item_ids)?;
    let parts: Vec<String> = item_ids
        .iter()
        .map(|id| format!("\"{}\"", id.as_str()))
        .collect();
    Ok(format!("[{}]", parts.join(",")))
}

/// `serializeItemIds(selectAutoLoadout(seed, String(userId)))`, as `lock` and start-race write
/// it for a player without a ready loadout.
///
/// # Panics
/// Never: an auto-loadout is always one major plus one minor within budget.
#[must_use]
pub fn auto_loadout_json(seed: &str, user_id: i64) -> String {
    let items = select_auto_loadout(seed, &user_id.to_string());
    serialize_item_ids(&items).expect("auto-loadouts are always valid")
}
