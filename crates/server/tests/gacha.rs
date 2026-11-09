//! Shop rotation and gacha parity with the TS oracle (plan Phase 3: "Shop seededScore/rotation
//! and gacha are ported bit-exactly"), plus the ported `tests/cosmetic-gacha.test.ts`.

// Server code, not the engine: the D4(b) type bans (HashMap/HashSet, serde_json::Value) do
// not apply (see src/lib.rs).
#![allow(clippy::disallowed_types)]

mod cosmetics_fixture;

use std::collections::HashSet;

use autoduck_server::cosmetics::gacha::{
    PITY_EPIC, PITY_LEGENDARY, PITY_RARE, Pity, roll_rarity, select_gacha_result,
};
use autoduck_server::cosmetics::shop::{
    generate_rotation_pool, legendary_enabled, personalize_rotation, seeded_score, shop_week,
};
use autoduck_server::cosmetics::{CosmeticItem, Rarity, catalog};
use autoduck_server::db::DbTime;
use cosmetics_fixture::{Rolls, cases, decode_set, strings};
use serde_json::Value;

fn ids(items: &[&CosmeticItem]) -> Vec<String> {
    items.iter().map(|item| item.id.clone()).collect()
}

fn pity(value: &Value) -> Pity {
    Pity {
        rare_pity: value[0].as_i64().unwrap(),
        epic_pity: value[1].as_i64().unwrap(),
        legendary_pity: value[2].as_i64().unwrap(),
    }
}

// ---------------------------------------------------------------------------------------------
// Oracle fixtures

#[test]
fn seeded_score_matches_ts() {
    let cases = cases("seededScore");
    assert!(cases.len() >= 1000);
    for case in cases {
        let seed = case["seed"].as_str().unwrap();
        let id = case["id"].as_str().unwrap();
        assert_eq!(
            u64::from(seeded_score(seed, id)),
            case["score"].as_u64().unwrap(),
            "seededScore({seed:?}, {id:?})"
        );
    }
}

#[test]
fn shop_week_matches_ts() {
    for case in cases("shopWeek") {
        let ms = case["ms"].as_i64().unwrap();
        let week = shop_week(DbTime::from_unix_ms(ms).unwrap());
        assert_eq!(week.week_key, case["weekKey"].as_str().unwrap(), "ms {ms}");
        assert_eq!(
            week.starts_at.to_iso_string(),
            case["startsAt"].as_str().unwrap(),
            "ms {ms}"
        );
        assert_eq!(
            week.ends_at.to_iso_string(),
            case["endsAt"].as_str().unwrap(),
            "ms {ms}"
        );
    }
}

#[test]
fn rotation_pool_and_offers_match_ts() {
    let mut offers_checked = 0;
    for case in cases("rotation") {
        let season = case["seasonKey"].as_str().unwrap();
        let week = case["weekKey"].as_str().unwrap();
        let pool = strings(&case["pool"]);
        assert_eq!(
            generate_rotation_pool(season, week),
            pool,
            "pool {season:?} {week}"
        );
        assert_eq!(
            legendary_enabled(season, week),
            case["legendaryEnabled"].as_bool().unwrap(),
            "legendaryEnabled {season:?} {week}"
        );
        for offer in case["offers"].as_array().unwrap() {
            let pool_ids = offer.get("poolIds").map_or_else(|| pool.clone(), strings);
            let owned = decode_set(&offer["owned"]);
            let offered = personalize_rotation(&pool_ids, &owned, season, week);
            assert_eq!(
                ids(&offered),
                strings(&offer["offered"]),
                "offer {season:?} {week}"
            );
            offers_checked += 1;
        }
    }
    assert!(offers_checked >= 2000);
}

#[test]
fn roll_rarity_matches_ts() {
    for case in cases("rollRarity") {
        let mut rolls = Rolls::new(&case["rolls"]);
        let mut rng = || rolls.next();
        let rarity = roll_rarity(pity(&case["pity"]), &mut rng);
        assert_eq!(rarity.as_str(), case["rarity"].as_str().unwrap(), "{case}");
        // A pity guarantee (legendary ≥ 30) draws nothing; every other path draws exactly once.
        let expected_draws = usize::from(case["pity"][2].as_i64().unwrap() < PITY_LEGENDARY);
        assert_eq!(rolls.used, expected_draws, "{case}");
    }
}

#[test]
fn select_gacha_result_matches_ts() {
    let all: Vec<&CosmeticItem> = catalog().items.iter().collect();
    let mut errors = 0;
    let mut rerolls = 0;
    for (index, case) in cases("selectGacha").iter().enumerate() {
        let owned = decode_set(&case["owned"]);
        let excluded = decode_set(&case["excluded"]);
        let gacha_catalog: Vec<&CosmeticItem> = all
            .iter()
            .copied()
            .filter(|item| !excluded.contains(&item.id))
            .collect();
        let mut rolls = Rolls::new(&case["rolls"]);
        let mut rng = || rolls.next();
        let result = select_gacha_result(&owned, pity(&case["pity"]), &gacha_catalog, &mut rng);
        assert!(rolls.exhausted(), "case {index}: rng() draw count differs");
        match (&result, case["error"].as_str()) {
            (Err(error), Some(expected)) => {
                assert_eq!(error.to_string(), expected, "case {index}");
                errors += 1;
            }
            (Ok(result), None) => {
                let expected = &case["result"];
                assert_eq!(
                    result.rolled_rarity.as_str(),
                    expected["rolledRarity"].as_str().unwrap(),
                    "case {index}"
                );
                assert_eq!(
                    result.final_item.id,
                    expected["finalItem"].as_str().unwrap(),
                    "case {index}"
                );
                assert_eq!(
                    result.was_duplicate, expected["wasDuplicate"],
                    "case {index}"
                );
                assert_eq!(result.was_rerolled, expected["wasRerolled"], "case {index}");
                assert_eq!(
                    result.refund_amount, expected["refundAmount"],
                    "case {index}"
                );
                assert_eq!(
                    serde_json::to_value(result.pity_after).unwrap(),
                    expected["pityAfter"],
                    "case {index}"
                );
                rerolls += usize::from(result.was_rerolled);
            }
            (result, expected) => panic!("case {index}: Rust {result:?}, TS error {expected:?}"),
        }
    }
    assert!(errors > 0 && rerolls > 0);
}

// ---------------------------------------------------------------------------------------------
// tests/cosmetic-gacha.test.ts

const ZERO: Pity = Pity {
    rare_pity: 0,
    epic_pity: 0,
    legendary_pity: 0,
};

fn constant(value: f64) -> impl FnMut() -> f64 {
    move || value
}

#[test]
fn gacha_base_odds_map_every_roll_band_exactly() {
    assert_eq!(roll_rarity(ZERO, &mut constant(0.0)), Rarity::Common);
    assert_eq!(roll_rarity(ZERO, &mut constant(0.4)), Rarity::Uncommon);
    assert_eq!(roll_rarity(ZERO, &mut constant(0.7)), Rarity::Rare);
    assert_eq!(roll_rarity(ZERO, &mut constant(0.88)), Rarity::Epic);
    assert_eq!(roll_rarity(ZERO, &mut constant(0.97)), Rarity::Legendary);
}

#[test]
fn pity_guarantees_rare_epic_and_legendary_at_configured_counters() {
    let rare = Pity {
        rare_pity: PITY_RARE,
        ..ZERO
    };
    let epic = Pity {
        epic_pity: PITY_EPIC,
        ..ZERO
    };
    let legendary = Pity {
        legendary_pity: PITY_LEGENDARY,
        ..ZERO
    };
    assert_eq!(roll_rarity(rare, &mut constant(0.99)), Rarity::Rare);
    assert_eq!(roll_rarity(epic, &mut constant(0.99)), Rarity::Epic);
    assert_eq!(
        roll_rarity(legendary, &mut constant(0.0)),
        Rarity::Legendary
    );
}

fn full_catalog() -> Vec<&'static CosmeticItem> {
    catalog().items.iter().collect()
}

#[test]
fn duplicate_protection_rerolls_within_rarity_when_an_unowned_item_exists() {
    let common: Vec<&CosmeticItem> = catalog()
        .items
        .iter()
        .filter(|item| item.rarity == Rarity::Common && item.gacha_eligible)
        .collect();
    let owned: HashSet<String> = [common[0].id.clone()].into();
    let result = select_gacha_result(&owned, ZERO, &full_catalog(), &mut constant(0.0)).unwrap();
    assert!(result.was_duplicate);
    assert!(result.was_rerolled);
    assert_ne!(result.final_item.id, common[0].id);
    assert_eq!(result.refund_amount, 0);
}

#[test]
fn exhausted_rarity_redistributes_upward_and_never_returns_an_owned_lower_tier_item() {
    let common: HashSet<String> = catalog()
        .items
        .iter()
        .filter(|item| item.rarity == Rarity::Common)
        .map(|item| item.id.clone())
        .collect();
    let result = select_gacha_result(&common, ZERO, &full_catalog(), &mut constant(0.0)).unwrap();
    assert_ne!(result.rolled_rarity, Rarity::Common);
    assert!(!common.contains(&result.final_item.id));
}

#[test]
fn a_fully_completed_catalog_returns_the_promised_duplicate_refund() {
    let all: HashSet<String> = catalog().items.iter().map(|item| item.id.clone()).collect();
    let result = select_gacha_result(&all, ZERO, &full_catalog(), &mut constant(0.0)).unwrap();
    assert_eq!(result.refund_amount, 2);
    assert!(result.was_duplicate);
}

#[test]
fn epic_and_legendary_results_reset_every_corresponding_lower_pity_counter() {
    let epic = select_gacha_result(
        &HashSet::new(),
        Pity {
            rare_pity: 4,
            epic_pity: 12,
            legendary_pity: 9,
        },
        &full_catalog(),
        &mut constant(0.9),
    )
    .unwrap();
    assert_eq!(epic.rolled_rarity, Rarity::Epic);
    assert_eq!(
        epic.pity_after,
        Pity {
            rare_pity: 0,
            epic_pity: 0,
            legendary_pity: 10
        }
    );
    let legendary = select_gacha_result(
        &HashSet::new(),
        Pity {
            rare_pity: 4,
            epic_pity: 11,
            legendary_pity: 30,
        },
        &full_catalog(),
        &mut constant(0.0),
    )
    .unwrap();
    assert_eq!(legendary.pity_after, ZERO);
}

#[test]
fn weekly_shop_rotation_is_persisted_from_a_deterministic_pool_and_filters_owned_items() {
    let week = shop_week(DbTime::parse("2026-08-13T03:00:00Z").unwrap());
    assert_eq!(week.week_key, "2026-08-10");
    let pool = generate_rotation_pool("S3", &week.week_key);
    let unique: HashSet<&String> = pool.iter().collect();
    assert_eq!(unique.len(), pool.len());
    let first = personalize_rotation(&pool, &HashSet::new(), "S3", &week.week_key);
    let owned: HashSet<String> = first.iter().map(|item| item.id.clone()).collect();
    assert!(
        !personalize_rotation(&pool, &owned, "S3", &week.week_key)
            .iter()
            .any(|item| owned.contains(&item.id))
    );
}
