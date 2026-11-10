//! Phase 6: S3.16 keeps every item id of S3.15.
//!
//! Loadouts, stored configs, events and the Season meta name items by these
//! strings, so a balance version may retune an item but never drop or rename
//! one. The lists are the S3.15 `raceItemIdSchema` and `wildItemIdSchema`
//! (`packages/race-protocol/src/index.ts:14-36`), frozen here on purpose: do
//! not edit them to make this test pass.

use race_core::catalog::{RACE_ITEM_CATALOG, get_race_item};
use race_core::pickups::get_wild_item;
use race_protocol::ids::{RaceItemId, WildItemId};

const S3_15_RACE_ITEM_IDS: [&str; 9] = [
    "NITRO",
    "DRAFT_FIN",
    "PADDLE_BURST",
    "BUBBLE_SHIELD",
    "FEATHER",
    "SHOCK_ABSORBER",
    "HOMING_ROCKET",
    "BANANA",
    "QUACK_HORN",
];

const S3_15_WILD_ITEM_IDS: [&str; 8] = [
    "MINI_NITRO",
    "TAILWIND",
    "MINI_BUBBLE",
    "MINI_ROCKET",
    "BANANA",
    "QUACK_HORN",
    "FEATHER",
    "SLIPSTREAM_MAGNET",
];

#[test]
fn every_s3_15_race_item_id_still_parses_and_has_a_catalog_entry() {
    for id in S3_15_RACE_ITEM_IDS {
        let parsed: RaceItemId = serde_json::from_str(&format!("\"{id}\""))
            .unwrap_or_else(|error| panic!("S3.15 race item {id} no longer parses: {error}"));
        assert_eq!(parsed.as_str(), id, "{id} must round-trip unchanged");
        assert_eq!(get_race_item(parsed).id, parsed, "{id} catalog entry");
        assert!(
            RACE_ITEM_CATALOG.iter().any(|item| item.id == parsed),
            "{id} is missing from RACE_ITEM_CATALOG"
        );
    }
}

#[test]
fn every_s3_15_wild_item_id_still_parses_and_has_a_catalog_entry() {
    for id in S3_15_WILD_ITEM_IDS {
        let parsed: WildItemId = serde_json::from_str(&format!("\"{id}\""))
            .unwrap_or_else(|error| panic!("S3.15 wild item {id} no longer parses: {error}"));
        assert_eq!(parsed.as_str(), id, "{id} must round-trip unchanged");
        assert_eq!(get_wild_item(parsed).id, parsed, "{id} catalog entry");
    }
}
