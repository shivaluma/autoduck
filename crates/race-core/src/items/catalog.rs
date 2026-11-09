//! `packages/race-core/src/items/catalog.ts` lives in [`crate::catalog`]
//! (D19: the Rust catalog is the single source). Re-exported here so the
//! module tree mirrors the TS one.

pub use crate::catalog::{
    AUTO_LOADOUT_PRESETS, ItemCategory, ItemClass, RACE_ITEM_CATALOG, RaceItemDefinition,
    get_race_item, item_class,
};
