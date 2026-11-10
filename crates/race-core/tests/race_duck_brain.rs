//! White-box port of `tests/race-duck-brain.test.ts` (S3.15): seeded
//! temperaments, the Chaos utility per mode, grudges, `holdCost` patience
//! and the `DUCK_TEMPERAMENT` / `AI_INTENT` announcements. Same test names
//! (in `snake_case`) and assertions.
//!
//! Port notes:
//! - `raceConfigSchema.parse` is `RaceConfigInput::resolve_ts_compat`.
//! - `itemState.brains` is a separate [`Brains`] map seeded with
//!   `create_duck_brains` (what `createItemRaceState` does in TS); the
//!   `ctx(playerId)` closures share one objective, item state, ducks array
//!   and `readRace` memo, as the TS object literals do.
//! - `typeof metadata.intent === 'string'` holds by construction for the
//!   typed `AiIntentMeta`; the test still checks both fields are present.
//!
//! Needs `ts-compat` (the oracle's config resolution and id collation).
#![cfg(feature = "ts-compat")]
#![allow(clippy::float_cmp)]

use std::collections::BTreeSet;

use race_core::auto_use::brain::TEMPERAMENTS;
use race_core::auto_use::evaluate::EvalCtx;
use race_core::auto_use::{
    Brains, CandidateSource, ChaosUtility, DirectorCache, RaceObjectiveContext,
    build_race_objective_context, create_duck_brains, grudge_weight, new_brain, note_brain_event,
};
use race_core::items::{ItemRaceState, create_item_race_state};
use race_core::sim::{DuckPhysicsState, EngineMath, SimOptions, simulate_race};
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::{EventKind, Temperament};
use race_protocol::ids::{ItemKey, PlayerId};

fn pid(id: &str) -> PlayerId {
    PlayerId::new(id).unwrap()
}

fn math() -> EngineMath {
    EngineMath::default()
}

/// The JSON `raceConfigSchema.parse` receives in `config(chaos, players,
/// seed)`, with optional loadouts.
fn config_input(
    chaos: Option<&str>,
    players: usize,
    seed: &str,
    loadouts: &str,
) -> RaceConfigInput {
    let players: Vec<String> = (0..players)
        .map(|index| {
            format!(
                r#"{{"playerId":"d{}","name":"Duck {}"}}"#,
                index + 1,
                index + 1
            )
        })
        .collect();
    let chaos = chaos.map_or(String::new(), |chaos| format!(r#","chaosConfig":{chaos}"#));
    let json = format!(
        r#"{{"raceId":"brain","seed":"{seed}","players":[{}],"loadouts":[{loadouts}]{chaos}}}"#,
        players.join(",")
    );
    serde_json::from_str(&json).unwrap()
}

/// `config(chaos?, players = 8, seed = '33'.repeat(32))`.
fn config(chaos: Option<&str>, players: usize, seed: &str) -> ResolvedRaceConfig {
    config_input(chaos, players, seed, "")
        .resolve_ts_compat()
        .unwrap()
}

fn default_seed() -> String {
    "33".repeat(32)
}

/// `spreadDucks(players = 8, gap = 0.1)`: d1 leads … d8 last, evenly spaced
/// far apart so neighbour swaps are unlikely.
fn spread_ducks(players: usize, gap: f64) -> Vec<DuckPhysicsState> {
    (0..players)
        .map(|index| {
            #[allow(clippy::cast_precision_loss)]
            let progress = 0.9 - index as f64 * gap;
            DuckPhysicsState {
                player_id: pid(&format!("d{}", index + 1)),
                name: format!("d{}", index + 1),
                progress,
                previous_progress: progress,
                lateral_offset: 0.0,
                speed: 0.0,
                acceleration: 0.0,
                lateral_velocity: 0.0,
                desired_speed: 0.0,
                desired_lateral_offset: 0.0,
                current_rank: u32::try_from(index + 1).unwrap(),
                active_effects: Vec::new(),
                next_impulse_tick: 0,
                finished: false,
                finish_time_ms: None,
                pacing_segments: Vec::new(),
            }
        })
        .collect()
}

fn temperaments(brains: &Brains) -> Vec<(String, Temperament)> {
    brains
        .iter()
        .map(|(id, brain)| (id.as_str().to_owned(), brain.temperament))
        .collect()
}

#[test]
fn temperaments_are_seeded_deterministic_and_cover_every_type() {
    let first = create_duck_brains(&config(None, 16, &default_seed()));
    let second = create_duck_brains(&config(None, 16, &default_seed()));
    assert_eq!(temperaments(&first), temperaments(&second));
    let other = create_duck_brains(&config(None, 16, &"44".repeat(32)));
    let first_only: Vec<Temperament> = first.iter().map(|(_, brain)| brain.temperament).collect();
    let other_only: Vec<Temperament> = other.iter().map(|(_, brain)| brain.temperament).collect();
    assert_ne!(first_only, other_only);
    let mut seen: BTreeSet<&'static str> = BTreeSet::new();
    for seed in 0..20_u32 {
        let seed = format!("{seed:0>64x}");
        for (_, brain) in create_duck_brains(&config(None, 8, &seed)).iter() {
            seen.insert(brain.temperament.as_str());
        }
    }
    let mut all: Vec<&'static str> = TEMPERAMENTS.iter().map(|t| t.as_str()).collect();
    all.sort();
    assert_eq!(seen.into_iter().collect::<Vec<_>>(), all);
}

#[test]
fn chaos_utility_normal_loss_risk_follows_the_bottom_two() {
    let mut utility = ChaosUtility::new(&config(None, 8, &default_seed()).chaos_config);
    let ducks = spread_ducks(8, 0.1);
    assert!(utility.loss_risk("d8", &ducks, math()) > 0.95);
    assert!(utility.loss_risk("d1", &ducks, math()) < 0.05);
    assert!(utility.is_losing_now("d7", &ducks));
    // Climbing two places from 7th escapes the loser set.
    assert!(utility.action_value("d7", &ducks, 2.0, None, 0.0, math()) > 80.0);
}

#[test]
fn chaos_utility_cut_line_cares_about_the_half_way_line() {
    let mut utility = ChaosUtility::new(
        &config(
            Some(r#"{"type":"CUT_LINE","targetPlayerId":null}"#),
            8,
            &default_seed(),
        )
        .chaos_config,
    );
    let ducks = spread_ducks(8, 0.1);
    assert!(utility.is_losing_now("d5", &ducks));
    assert!(!utility.is_losing_now("d4", &ducks));
    // Knocking d4 below d5 saves d5.
    assert!(utility.action_value("d5", &ducks, 0.0, Some("d4"), 1.0, math()) > 80.0);
}

#[test]
fn chaos_utility_bounty_hunt_values_hits_on_the_wanted_duck_by_where_it_lands() {
    // Wanted = d4 in 4th of 8: inside the top half, so it is escaping and the bottom two lose.
    let mut utility = ChaosUtility::new(
        &config(
            Some(r#"{"type":"BOUNTY_HUNT","targetPlayerId":"d4"}"#),
            8,
            &default_seed(),
        )
        .chaos_config,
    );
    let ducks = spread_ducks(8, 0.1);
    assert!(utility.is_losing_now("d7", &ducks));
    assert!(!utility.is_losing_now("d6", &ducks));
    // A small knock makes the Wanted fail while still ahead of d6: everyone behind the Wanted loses, d6 included.
    assert!(utility.action_value("d6", &ducks, 0.0, Some("d4"), 1.0, math()) < -50.0);
    // A big knock that drops the Wanted behind d7 saves d7.
    assert!(utility.action_value("d7", &ducks, 0.0, Some("d4"), 3.0, math()) > 50.0);
    // d2 is safe either way.
    assert!(
        utility
            .action_value("d2", &ducks, 0.0, Some("d4"), 1.0, math())
            .abs()
            < 5.0
    );
}

#[test]
fn chaos_utility_duo_is_team_aware_knocking_back_your_own_partner_hurts() {
    let mut utility = ChaosUtility::new(
        &config(
            Some(
                r#"{"type":"DUO","targetPlayerId":null,"groups":[["d1","d8"],["d2","d7"],["d3","d6"],["d4","d5"]]}"#,
            ),
            8,
            &default_seed(),
        )
        .chaos_config,
    );
    let ducks = spread_ducks(8, 0.1);
    // Every pair averages 4.5 now; tie-break makes the pair with the worst member lose (d1+d8).
    assert!(utility.is_losing_now("d1", &ducks));
    assert!(utility.is_losing_now("d8", &ducks));
    // d1 wants d7 (from another pair) to fall behind d8, not its own partner to drop.
    assert!(utility.action_value("d1", &ducks, 0.0, Some("d7"), 1.0, math()) > 50.0);
    assert!(utility.action_value("d1", &ducks, 0.0, Some("d8"), 0.0, math()) == 0.0);
}

#[test]
fn grudges_come_from_hostile_events_and_fade_with_a_10s_half_life() {
    let mut brains: Brains = [
        (pid("d1"), new_brain(pid("d1"), Temperament::Aggressive)),
        (pid("d2"), new_brain(pid("d2"), Temperament::Tactician)),
    ]
    .into_iter()
    .collect();
    note_brain_event(
        &mut brains,
        "ROCKET_HIT",
        Some("d2"),
        Some("d1"),
        600,
        60,
        math(),
    );
    assert_eq!(grudge_weight(brains.get("d1"), "d2", 600, 60, math()), 1.0);
    assert!((grudge_weight(brains.get("d1"), "d2", 1200, 60, math()) - 0.5).abs() < 1e-9);
    // Silence is emitted victim → attacker.
    note_brain_event(
        &mut brains,
        "ITEM_SILENCED",
        Some("d2"),
        Some("d1"),
        600,
        60,
        math(),
    );
    assert_eq!(grudge_weight(brains.get("d2"), "d1", 600, 60, math()), 0.5);
    // Neutral events leave no grudge.
    note_brain_event(
        &mut brains,
        "DUCK_COLLISION",
        Some("d1"),
        Some("d2"),
        600,
        60,
        math(),
    );
    assert_eq!(grudge_weight(brains.get("d2"), "d1", 600, 60, math()), 0.5);
}

/// The objects every `ctx(playerId)` literal shares.
struct HoldFixture {
    objective: RaceObjectiveContext,
    item_state: ItemRaceState,
    brains: Brains,
    ducks: Vec<DuckPhysicsState>,
    director: DirectorCache,
    ghost_player_ids: Vec<PlayerId>,
}

impl HoldFixture {
    /// `holdCost(ctx(playerId), { itemId, source })`.
    fn hold_cost(&mut self, player_id: &str, item_id: ItemKey, source: CandidateSource) -> f64 {
        let player_id = pid(player_id);
        let mut ctx = EvalCtx {
            tick: 100,
            tick_rate: 60,
            objective: &mut self.objective,
            item_state: &self.item_state,
            hazards: &[],
            ducks: &self.ducks,
            player_id: &player_id,
            seconds_until_next_pickup_zone: 999.0,
            prep_auto_use_enabled: true,
            wild_auto_use_enabled: false,
            ghost_player_ids: &self.ghost_player_ids,
            brains: &mut self.brains,
            director: &mut self.director,
            math: math(),
        };
        ctx.hold_cost(item_id, source)
    }
}

#[test]
fn patient_temperaments_hold_nitro_for_their_window_danger_erases_patience() {
    let cfg = config(None, 8, &default_seed());
    let item_state = create_item_race_state(&cfg);
    let objective = build_race_objective_context(&cfg);
    let ducks: Vec<DuckPhysicsState> = spread_ducks(8, 0.01)
        .into_iter()
        .map(|mut duck| {
            duck.progress -= 0.5;
            duck.previous_progress = duck.progress;
            duck
        })
        .collect();
    let mut brains = create_duck_brains(&cfg);
    brains.insert(pid("d1"), new_brain(pid("d1"), Temperament::Tactician));
    brains.insert(pid("d2"), new_brain(pid("d2"), Temperament::Aggressive));
    brains.insert(pid("d8"), new_brain(pid("d8"), Temperament::Tactician));
    let mut fixture = HoldFixture {
        objective,
        item_state,
        brains,
        ducks,
        director: DirectorCache::default(),
        ghost_player_ids: Vec::new(),
    };
    let prep = CandidateSource::Prep;
    assert!(
        fixture.hold_cost("d1", ItemKey::Nitro, prep) > 10.0,
        "a leading Tactician saves Nitro at 40%"
    );
    assert_eq!(
        fixture.hold_cost("d2", ItemKey::Nitro, prep),
        0.0,
        "an Aggressive duck is already in its window"
    );
    let d8 = fixture.hold_cost("d8", ItemKey::Nitro, prep);
    let d1 = fixture.hold_cost("d1", ItemKey::Nitro, prep);
    assert!(d8 < d1, "a duck in the loser set is less patient");
    assert_eq!(
        fixture.hold_cost("d1", ItemKey::MiniNitro, CandidateSource::Wild),
        0.0,
        "box items are never held"
    );
}

#[test]
fn races_announce_temperaments_and_intents() {
    // `cfg.loadouts = cfg.players.map(...)` after the parse; the loadouts are
    // valid, so passing them to the parse is the same config.
    let loadouts: Vec<String> = (0..8)
        .map(|index| {
            let items = match index % 3 {
                0 => r#"["NITRO","BANANA"]"#,
                1 => r#"["HOMING_ROCKET","QUACK_HORN"]"#,
                _ => r#"["BUBBLE_SHIELD","DRAFT_FIN"]"#,
            };
            format!(
                r#"{{"playerId":"d{}","itemIds":{items},"source":"PLAYER"}}"#,
                index + 1
            )
        })
        .collect();
    let cfg = config_input(None, 8, &default_seed(), &loadouts.join(","))
        .resolve_ts_compat()
        .unwrap();
    let events = simulate_race(cfg.clone(), SimOptions::default(), None)
        .unwrap()
        .events;
    let temperament_events: Vec<_> = events
        .iter()
        .filter(|event| event.type_name() == "DUCK_TEMPERAMENT")
        .collect();
    assert_eq!(temperament_events.len(), cfg.players.len());
    let brains = create_duck_brains(&cfg);
    for event in temperament_events {
        let EventKind::DuckTemperament(meta) = &event.kind else {
            unreachable!()
        };
        let source = event.source_player_id.as_ref().unwrap();
        assert_eq!(
            meta.temperament,
            brains.get(source.as_str()).unwrap().temperament
        );
    }
    let intents: Vec<_> = events
        .iter()
        .filter(|event| event.type_name() == "AI_INTENT")
        .collect();
    assert!(!intents.is_empty());
    for intent in intents {
        let EventKind::AiIntent(meta) = &intent.kind else {
            unreachable!()
        };
        assert!(!meta.intent.as_str().is_empty() && !meta.temperament.as_str().is_empty());
    }
}
