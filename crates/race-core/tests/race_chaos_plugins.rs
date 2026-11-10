//! Port of `tests/race-chaos-plugins.test.ts`: the Chaos rules
//! (`prepareChaosRule`, `resolveChaosRule`) on an 8-duck raw ranking.
//!
//! The ids `p1`..`p8` order the same under the ICU `localeCompare` model and
//! byte order, so this file runs with and without `ts-compat`.

#![allow(clippy::float_cmp)]

use race_core::chaos::{
    ChaosError, ChaosMetadata, ChaosPreparedState, ChaosResult, ChaosRuleId, RawChaosEntry,
    prepare_chaos_rule, resolve_chaos_rule,
};

/// `const raw = Array.from({ length: 8 }, ...)`: `p1`..`p8`, rank = index + 1.
fn raw_ids() -> Vec<String> {
    (1..=8).map(|index| format!("p{index}")).collect()
}

fn raw(ids: &[String]) -> Vec<RawChaosEntry<'_>> {
    ids.iter()
        .enumerate()
        .map(|(index, id)| RawChaosEntry {
            player_id: id,
            rank: u32::try_from(index + 1).unwrap(),
        })
        .collect()
}

fn groups(groups: &[&[&str]]) -> ChaosPreparedState {
    ChaosPreparedState {
        target_player_id: None,
        groups: Some(
            groups
                .iter()
                .map(|group| group.iter().map(|id| (*id).to_owned()).collect())
                .collect(),
        ),
    }
}

fn target(id: &str) -> ChaosPreparedState {
    ChaosPreparedState {
        target_player_id: Some(id.to_owned()),
        groups: None,
    }
}

fn resolve(
    id: ChaosRuleId,
    count: usize,
    prepared: &ChaosPreparedState,
) -> Result<ChaosResult, ChaosError> {
    let ids = raw_ids();
    resolve_chaos_rule(id, &raw(&ids)[..count], prepared)
}

/// `losers(type, prepared = {})`.
fn losers(id: ChaosRuleId, prepared: &ChaosPreparedState) -> Result<Vec<String>, ChaosError> {
    resolve(id, 8, prepared).map(|result| result.loser_player_ids)
}

fn strs(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

fn none() -> ChaosPreparedState {
    ChaosPreparedState::default()
}

#[test]
fn normal_reverse_triple_and_cut_line_resolve_from_the_immutable_raw_ranking() {
    assert_eq!(
        losers(ChaosRuleId::Normal, &none()).unwrap(),
        strs(&["p7", "p8"])
    );
    assert_eq!(
        losers(ChaosRuleId::Reverse, &none()).unwrap(),
        strs(&["p2", "p1"])
    );
    assert_eq!(
        losers(ChaosRuleId::TripleElimination, &none()).unwrap(),
        strs(&["p6", "p7", "p8"])
    );
    assert_eq!(
        losers(ChaosRuleId::CutLine, &none()).unwrap(),
        strs(&["p5", "p6", "p7", "p8"])
    );
}

#[test]
fn duo_uses_average_rank_then_deterministic_tie_breaks() {
    let result = resolve(
        ChaosRuleId::Duo,
        8,
        &groups(&[&["p1", "p8"], &["p3", "p6"], &["p2", "p4"], &["p5", "p7"]]),
    )
    .unwrap();
    assert_eq!(result.loser_player_ids, strs(&["p5", "p7"]));
    // `Array.isArray(result.metadata.scores)`.
    assert!(matches!(result.metadata, ChaosMetadata::Duo { .. }));

    let tied = resolve(
        ChaosRuleId::Duo,
        4,
        &groups(&[&["p1", "p4"], &["p2", "p3"]]),
    )
    .unwrap();
    assert_eq!(tied.loser_player_ids, strs(&["p1", "p4"]));

    // Odd lobby (trio vs pair): the trio with the better average is safe
    // despite a higher total.
    let trio_test = resolve(
        ChaosRuleId::Duo,
        5,
        &groups(&[&["p1", "p2", "p5"], &["p3", "p4"]]),
    )
    .unwrap();
    assert_eq!(trio_test.loser_player_ids, strs(&["p3", "p4"]));
}

fn constructors_tie(result: &ChaosResult) -> bool {
    match &result.metadata {
        ChaosMetadata::Constructors { tie, .. } => *tie,
        other => panic!("expected Constructors metadata, got {other:?}"),
    }
}

#[test]
fn constructors_makes_every_duck_on_the_worse_team_lose_and_handles_odd_lobbies_fairly() {
    assert_eq!(
        losers(
            ChaosRuleId::Constructors,
            &groups(&[&["p1", "p2", "p3", "p8"], &["p4", "p5", "p6", "p7"]])
        )
        .unwrap(),
        strs(&["p4", "p5", "p6", "p7"])
    );

    let tie = resolve(
        ChaosRuleId::Constructors,
        4,
        &groups(&[&["p1", "p4"], &["p2", "p3"]]),
    )
    .unwrap();
    assert_eq!(tie.loser_player_ids, strs(&["p1", "p2", "p3", "p4"]));
    assert!(constructors_tie(&tie));

    // 7-player odd lobby (4 vs 3): both averages are 4.0, an exact tie.
    let odd_tie = resolve(
        ChaosRuleId::Constructors,
        7,
        &groups(&[&["p2", "p3", "p4", "p7"], &["p1", "p5", "p6"]]),
    )
    .unwrap();
    assert_eq!(
        odd_tie.loser_player_ids,
        strs(&["p1", "p2", "p3", "p4", "p5", "p6", "p7"])
    );
    assert!(constructors_tie(&odd_tie));

    // Team A avg 3.25 vs Team B avg 5.0: Team B loses.
    let odd_decisive = resolve(
        ChaosRuleId::Constructors,
        7,
        &groups(&[&["p1", "p2", "p3", "p7"], &["p4", "p5", "p6"]]),
    )
    .unwrap();
    assert_eq!(odd_decisive.loser_player_ids, strs(&["p4", "p5", "p6"]));
}

#[test]
fn bounty_hunt_falls_back_to_raw_bottom_2_when_wanted_escapes_top_50() {
    let result = resolve(ChaosRuleId::BountyHunt, 8, &target("p4")).unwrap();
    assert_eq!(result.loser_player_ids, strs(&["p7", "p8"]));
    match result.metadata {
        ChaosMetadata::BountyHunt { escaped, .. } => assert!(escaped),
        other => panic!("expected BountyHunt metadata, got {other:?}"),
    }
}

#[test]
fn bounty_hunt_makes_wanted_and_every_duck_behind_lose_when_wanted_misses_top_50() {
    assert_eq!(
        losers(ChaosRuleId::BountyHunt, &target("p6")).unwrap(),
        strs(&["p6", "p7", "p8"])
    );
    assert_eq!(
        losers(ChaosRuleId::BountyHunt, &target("p8")).unwrap(),
        strs(&["p8"])
    );
}

/// `prepareChaosRule(type, players, () => sequence[cursor++ % length])`.
fn prepare_with_sequence(id: ChaosRuleId, players: &[String]) -> ChaosPreparedState {
    const SEQUENCE: [f64; 7] = [0.91, 0.14, 0.72, 0.31, 0.55, 0.03, 0.44];
    let mut cursor = 0;
    prepare_chaos_rule(id, players, &mut || {
        let value = SEQUENCE[cursor % SEQUENCE.len()];
        cursor += 1;
        value
    })
}

/// `[...groups.flat()].sort()`.
fn flat_sorted(prepared: &ChaosPreparedState) -> Vec<String> {
    let mut flat: Vec<String> = prepared
        .groups
        .as_ref()
        .expect("groups")
        .iter()
        .flatten()
        .cloned()
        .collect();
    flat.sort();
    flat
}

#[test]
fn chaos_preparation_is_deterministic_and_persists_every_player_exactly_once() {
    let players = raw_ids();
    let prepare = |id| prepare_with_sequence(id, &players);

    assert_eq!(prepare(ChaosRuleId::Duo), prepare(ChaosRuleId::Duo));
    assert_eq!(
        prepare(ChaosRuleId::Constructors),
        prepare(ChaosRuleId::Constructors)
    );
    assert_eq!(
        prepare(ChaosRuleId::BountyHunt),
        prepare(ChaosRuleId::BountyHunt)
    );
    let mut sorted_players = players.clone();
    sorted_players.sort();
    assert_eq!(flat_sorted(&prepare(ChaosRuleId::Duo)), sorted_players);
    assert_eq!(
        flat_sorted(&prepare(ChaosRuleId::Constructors)),
        sorted_players
    );
}

#[test]
fn duo_uses_one_trio_for_an_odd_lobby_instead_of_giving_one_duck_a_free_singleton_group() {
    let players: Vec<String> = raw_ids().into_iter().take(7).collect();
    let prepared = prepare_chaos_rule(ChaosRuleId::Duo, &players, &mut || 0.4);
    let mut sizes: Vec<usize> = prepared
        .groups
        .expect("groups")
        .iter()
        .map(Vec::len)
        .collect();
    sizes.sort();
    assert_eq!(sizes, vec![2, 2, 3]);
}

#[test]
fn chaos_rejects_incomplete_persisted_group_data() {
    let duo = losers(ChaosRuleId::Duo, &none()).unwrap_err();
    assert!(duo.to_string().contains("persisted pairs"), "{duo}");
    let constructors = losers(ChaosRuleId::Constructors, &groups(&[&["p1"]])).unwrap_err();
    assert!(
        constructors.to_string().contains("two persisted teams"),
        "{constructors}"
    );
    let bounty = losers(ChaosRuleId::BountyHunt, &target("missing")).unwrap_err();
    assert!(bounty.to_string().contains("valid Wanted"), "{bounty}");
}
