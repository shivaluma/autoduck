//! The ported `tests/race-loadout.test.ts`, through the server's `season3::loadout` (which the
//! season3 routes use), plus the `itemIdsJson` column helpers.

use std::collections::BTreeSet;

use autoduck_server::season3::loadout::{
    ParseItemIdsError, auto_loadout_json, parse_item_ids, select_auto_loadout, serialize_item_ids,
    validate_loadout,
};
use race_protocol::ids::RaceItemId;

#[test]
fn loadout_enforces_budget_slots_one_major_and_no_duplicates() {
    use RaceItemId::{Banana, Feather, HomingRocket, Nitro, QuackHorn};
    assert!(validate_loadout(&[Nitro, Banana]).unwrap().ready);
    assert!(!validate_loadout(&[Feather, QuackHorn]).unwrap().ready);
    let message = |ids: &[RaceItemId]| validate_loadout(ids).unwrap_err().to_string();
    assert!(message(&[Nitro, HomingRocket]).contains("Prep Credits"));
    assert!(message(&[Banana, Banana]).contains("trùng nhau"));
    assert!(message(&[Banana, Feather, QuackHorn]).contains("Tối đa 2"));
}

#[test]
fn auto_loadout_is_deterministic_and_always_full_budget() {
    let seed = "ab".repeat(32);
    let first = select_auto_loadout(&seed, "42");
    assert_eq!(select_auto_loadout(&seed, "42"), first);
    assert!(validate_loadout(&first).unwrap().ready);
}

#[test]
fn auto_loadout_randomly_selects_across_all_major_and_minor_items() {
    let mut majors = BTreeSet::new();
    let mut minors = BTreeSet::new();
    let mut themed = false;
    let mut hybrid = false;
    for index in 0..200 {
        let loadout = select_auto_loadout(&format!("seed-{index}"), &format!("player-{index}"));
        assert!(validate_loadout(&loadout).unwrap().ready);
        let [major, minor] = loadout;
        majors.insert(major.as_str());
        minors.insert(minor.as_str());
        let pure = matches!(
            (major, minor),
            (RaceItemId::Nitro, RaceItemId::DraftFin)
                | (RaceItemId::BubbleShield, RaceItemId::Feather)
                | (RaceItemId::HomingRocket, RaceItemId::Banana)
        );
        if pure {
            themed = true;
        } else {
            hybrid = true;
        }
    }
    assert_eq!(
        majors.into_iter().collect::<Vec<_>>(),
        ["BUBBLE_SHIELD", "HOMING_ROCKET", "NITRO"]
    );
    assert_eq!(
        minors.into_iter().collect::<Vec<_>>(),
        [
            "BANANA",
            "DRAFT_FIN",
            "FEATHER",
            "PADDLE_BURST",
            "QUACK_HORN",
            "SHOCK_ABSORBER"
        ]
    );
    assert!(themed);
    assert!(hybrid);
}

#[test]
fn item_ids_json_round_trips_like_json_stringify() {
    let json = serialize_item_ids(&[RaceItemId::Nitro, RaceItemId::Banana]).unwrap();
    assert_eq!(json, r#"["NITRO","BANANA"]"#);
    assert_eq!(
        parse_item_ids(&json).unwrap(),
        [RaceItemId::Nitro, RaceItemId::Banana]
    );
    assert_eq!(serialize_item_ids(&[]).unwrap(), "[]");
    assert_eq!(parse_item_ids(" [ ] ").unwrap(), []);
    assert_eq!(parse_item_ids("{}"), Err(ParseItemIdsError::NotArray));
    assert_eq!(parse_item_ids("nope"), Err(ParseItemIdsError::NotJson));
    assert!(matches!(
        parse_item_ids(r#"["NITRO","nitro"]"#),
        Err(ParseItemIdsError::UnknownItem(_))
    ));
    assert!(matches!(
        parse_item_ids("[1]"),
        Err(ParseItemIdsError::UnknownItem(_))
    ));
    assert!(serialize_item_ids(&[RaceItemId::Banana, RaceItemId::Banana]).is_err());
}

#[test]
fn auto_loadout_json_is_what_lock_writes() {
    let seed = "ab".repeat(32);
    let [major, minor] = select_auto_loadout(&seed, "7");
    assert_eq!(
        auto_loadout_json(&seed, 7),
        format!("[\"{}\",\"{}\"]", major.as_str(), minor.as_str())
    );
}
