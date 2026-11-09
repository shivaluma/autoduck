//! `packages/race-core/src/items/loadout.ts` (`validateLoadout`,
//! `PREP_CREDITS`, `LOADOUT_SLOTS`) lives in [`crate::loadout`] next to
//! `selectAutoLoadout`. Re-exported here so the module tree mirrors the TS one.

pub use crate::loadout::{
    LOADOUT_SLOTS, LoadoutError, LoadoutValidation, PREP_CREDITS, validate_loadout,
};
