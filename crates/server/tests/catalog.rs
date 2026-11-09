//! The embedded catalog and legacy tables: the ported `tests/cosmetic-catalog-v2.test.ts`, plus
//! parity with the TS oracle fixtures (`planLegacyInventory`, `remapAppearance`).

// Server code, not the engine: the D4(b) type bans (HashMap/HashSet, serde_json::Value) do
// not apply (see src/lib.rs).
#![allow(clippy::disallowed_types)]

mod cosmetics_fixture;

use std::collections::HashSet;

use autoduck_server::cosmetics::inventory::{
    LegacyGrant, LegacyInventoryPlan, appearance_json, plan_legacy_inventory, remap_appearance,
};
use autoduck_server::cosmetics::shop::shop_price;
use autoduck_server::cosmetics::{Rarity, catalog, legacy};
use cosmetics_fixture::{cases, decode_set, strings};
use serde_json::json;

const CLOSET_SLOTS: [&str; 8] = [
    "bodyColor",
    "bodySkin",
    "face",
    "head",
    "outfit",
    "pet",
    "aura",
    "trail",
];

#[test]
fn plan_legacy_inventory_matches_ts() {
    for case in cases("planLegacyInventory") {
        let owned = strings(&case["owned"]);
        let plan = plan_legacy_inventory(&owned);
        let expected: LegacyInventoryPlan = serde_json::from_value(case["plan"].clone()).unwrap();
        assert_eq!(plan, expected, "{owned:?}");
    }
}

#[test]
fn remap_appearance_matches_ts() {
    for case in cases("remapAppearance") {
        let appearance = case["appearance"].as_object().unwrap();
        let owned = decode_set(&case["owned"]);
        let next = remap_appearance(appearance, &owned);
        assert_eq!(
            serde_json::to_string(&appearance_json(&next)).unwrap(),
            serde_json::to_string(&case["output"]).unwrap(),
            "{appearance:?}"
        );
    }
}

#[test]
fn v2_catalog_covers_every_rarity_in_every_closet_tab_and_nothing_outside_the_closet() {
    for slot in CLOSET_SLOTS {
        for rarity in Rarity::ALL {
            assert!(
                catalog()
                    .items
                    .iter()
                    .any(|item| item.slot == slot && item.rarity == rarity),
                "{slot} needs a {} item",
                rarity.as_str()
            );
        }
    }
    assert!(
        catalog()
            .items
            .iter()
            .all(|item| CLOSET_SLOTS.contains(&item.slot.as_str()))
    );
}

#[test]
fn every_legacy_remap_goes_from_a_retired_v1_id_to_a_v2_item_in_the_same_slot() {
    for (from, to) in &legacy().remap {
        let (from_slot, _) = legacy()
            .v1
            .get(from)
            .unwrap_or_else(|| panic!("{from} must be a v1 id"));
        assert!(
            !catalog().contains(from),
            "{from} is still in v2, so it should not be remapped"
        );
        let target = catalog()
            .get(to)
            .unwrap_or_else(|| panic!("{to} must exist in v2"));
        let expected = if from_slot == "bodySkin" || from.starts_with("skin-") {
            "bodySkin"
        } else {
            from_slot.as_str()
        };
        assert_eq!(target.slot, expected, "{from} → {to}");
    }
}

#[test]
fn legacy_inventory_plan_keeps_v2_items_swaps_equivalents_and_refunds_the_rest_at_v1_price() {
    let owned: Vec<String> = [
        "body-sunshine",
        "body-snoo-cosmic-abyss",
        "head-pirate-hat",
        "neck-red-scarf",
        "pet-corgi-pup",
        "pet-shiba-inu",
    ]
    .map(String::from)
    .to_vec();
    let plan = plan_legacy_inventory(&owned);
    let mut removed = plan.remove.clone();
    removed.sort();
    assert_eq!(
        removed,
        [
            "body-snoo-cosmic-abyss",
            "head-pirate-hat",
            "neck-red-scarf",
            "pet-corgi-pup"
        ]
    );
    assert_eq!(
        plan.grant,
        vec![LegacyGrant {
            cosmetic_id: "body-ink".into(),
            replaces: "body-snoo-cosmic-abyss".into()
        }]
    );
    // Corgi maps to Shiba, which is already owned → refunded instead of a silent loss.
    let mut refunded: Vec<&str> = plan
        .refund
        .iter()
        .map(|refund| refund.cosmetic_id.as_str())
        .collect();
    refunded.sort();
    assert_eq!(
        refunded,
        ["head-pirate-hat", "neck-red-scarf", "pet-corgi-pup"]
    );
    for refund in &plan.refund {
        let (_, rarity) = legacy().v1.get(&refund.cosmetic_id).unwrap();
        assert_eq!(refund.amount, shop_price(*rarity));
    }
}

#[test]
fn remapped_appearance_only_equips_owned_v2_items_and_always_keeps_a_body_color() {
    let owned: HashSet<String> = ["body-ink", "outfit-boss-blazer"].map(String::from).into();
    let next = remap_appearance(
        json!({
            "bodyColorId": "body-snoo-cosmic-abyss",
            "headId": "head-pirate-hat",
            "outfitId": "outfit-golden-tux",
            "neckId": "neck-red-scarf"
        })
        .as_object()
        .unwrap(),
        &owned,
    );
    assert_eq!(
        appearance_json(&next),
        json!({ "bodyColorId": "body-ink", "outfitId": "outfit-boss-blazer" })
    );
    let fallback = remap_appearance(
        json!({ "headId": "head-cap-red" }).as_object().unwrap(),
        &HashSet::new(),
    );
    assert_eq!(
        appearance_json(&fallback),
        json!({ "bodyColorId": "body-sunshine" })
    );
}
