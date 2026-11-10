//! Port of `tests/race-loadout.test.ts`: `validateLoadout` and
//! `selectAutoLoadout` (`lib/racing/loadout.ts`, ported into
//! `race_core::loadout`).

use std::collections::BTreeSet;

use race_core::loadout::{select_auto_loadout, validate_loadout};
use race_protocol::ids::RaceItemId;

#[test]
fn loadout_enforces_budget_slots_one_major_and_no_duplicates() {
    use RaceItemId::{Banana, Feather, HomingRocket, Nitro, QuackHorn};
    assert!(validate_loadout(&[Nitro, Banana]).unwrap().ready);
    assert!(!validate_loadout(&[Feather, QuackHorn]).unwrap().ready);
    let over_budget = validate_loadout(&[Nitro, HomingRocket]).unwrap_err();
    assert!(
        over_budget.to_string().contains("Prep Credits"),
        "{over_budget}"
    );
    let duplicate = validate_loadout(&[Banana, Banana]).unwrap_err();
    assert!(duplicate.to_string().contains("trùng nhau"), "{duplicate}");
    let too_many = validate_loadout(&[Banana, Feather, QuackHorn]).unwrap_err();
    assert!(too_many.to_string().contains("Tối đa 2"), "{too_many}");
}

#[test]
fn auto_loadout_is_deterministic_and_always_full_budget() {
    let first = select_auto_loadout(&"ab".repeat(32), "42");
    let second = select_auto_loadout(&"ab".repeat(32), "42");
    assert_eq!(second, first);
    assert!(validate_loadout(&first).unwrap().ready);
}

#[test]
fn auto_loadout_randomly_selects_across_all_available_2_cost_major_and_1_cost_minor_items() {
    let mut selected_majors: BTreeSet<&'static str> = BTreeSet::new();
    let mut selected_minors: BTreeSet<&'static str> = BTreeSet::new();
    let mut generated_hybrid = false;
    let mut generated_themed = false;

    for i in 0..200 {
        let loadout = select_auto_loadout(&format!("seed-{i}"), &format!("player-{i}"));
        assert!(validate_loadout(&loadout).unwrap().ready);
        assert_eq!(loadout.len(), 2);

        let [major, minor] = loadout;
        selected_majors.insert(major.as_str());
        selected_minors.insert(minor.as_str());

        let themed = matches!(
            (major, minor),
            (RaceItemId::Nitro, RaceItemId::DraftFin)
                | (RaceItemId::BubbleShield, RaceItemId::Feather)
                | (RaceItemId::HomingRocket, RaceItemId::Banana)
        );
        if themed {
            generated_themed = true;
        } else {
            generated_hybrid = true;
        }
    }

    // `[...set].sort()`: UTF-16 order, the same as byte order for these ids.
    assert_eq!(
        selected_majors.into_iter().collect::<Vec<_>>(),
        ["BUBBLE_SHIELD", "HOMING_ROCKET", "NITRO"]
    );
    assert_eq!(
        selected_minors.into_iter().collect::<Vec<_>>(),
        [
            "BANANA",
            "DRAFT_FIN",
            "FEATHER",
            "PADDLE_BURST",
            "QUACK_HORN",
            "SHOCK_ABSORBER"
        ]
    );
    assert!(generated_themed);
    assert!(generated_hybrid);
}
