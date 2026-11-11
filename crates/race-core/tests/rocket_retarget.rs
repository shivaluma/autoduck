//! White-box test for the wild-rocket retarget branch of `updateRockets`
//! (`items/engine.ts:563-580`), which the G1 corpus and 480 rocket-heavy
//! adversarial races never reach (Phase 2 review 1, finding 4). The
//! expectations are derived by hand from the TS source:
//!
//! - a `WILD` rocket whose target is missing or finished, not yet
//!   retargeted and not expired, picks the nearest duck *ahead of the rocket*
//!   that is unfinished, not the source, not a ghost, not a teammate of the
//!   source and not rocket-protected (`tick >= rocketProtectionUntilTick`),
//!   ordered by progress then `localeCompare`;
//! - a failed search leaves `target` undefined, so the rocket expires
//!   (`MINI_ROCKET_EXPIRED`) with its original `targetPlayerId`;
//! - a rocket retargets at most once; a `PREP` rocket never retargets.

#![allow(clippy::float_cmp)]

#[path = "support/whitebox.rs"]
mod whitebox;

use race_core::items::create_item_race_state;
use race_core::items::projectiles::update_rockets;
use race_core::items::state::{ItemRaceState, ProjectileSource, RocketRuntime};
use race_core::sim::DuckPhysicsState;
use race_protocol::config::ResolvedRaceConfig;
use whitebox::{Harness, item_duck, parse_config, pid};

const TICK: u32 = 100;

/// Source `s`; original target `t`; `m` is `s`'s DUO teammate; `g` a ghost.
fn config() -> ResolvedRaceConfig {
    let ids = ["s", "t", "a", "B", "c", "g", "m", "f", "z"];
    let players: Vec<String> = ids
        .iter()
        .map(|id| {
            let ghost = if *id == "g" { r#","isGhost":true"# } else { "" };
            format!(r#"{{"playerId":"{id}","name":"Duck {id}"{ghost}}}"#)
        })
        .collect();
    parse_config(&format!(
        r#"{{"raceId":"retarget","seed":"{}","players":[{}],"chaosConfig":{{"type":"DUO","groups":[["s","m"],["t","a"],["B","c"],["f","z"]]}}}}"#,
        "22".repeat(32),
        players.join(","),
    ))
}

/// Ducks: the original target `t` has finished; `a` and `B` tie at 0.50
/// (the eligible pair); everyone nearer the rocket (0.40) is excluded:
/// `s` (source, 0.44), `c` (protected, 0.45), `g` (ghost, 0.42), `m`
/// (teammate, 0.43), `f` (finished, 0.41), `z` (behind the rocket, 0.39).
fn ducks() -> Vec<DuckPhysicsState> {
    let mut ducks = vec![
        item_duck("s", 0.44, 7, 0.0, 0.0),
        item_duck("t", 1.0, 1, 0.0, 0.0),
        item_duck("a", 0.50, 2, 0.0, 0.0),
        item_duck("B", 0.50, 3, 0.0, 0.0),
        item_duck("c", 0.45, 4, 0.0, 0.0),
        item_duck("g", 0.42, 5, 0.0, 0.0),
        item_duck("m", 0.43, 6, 0.0, 0.0),
        item_duck("f", 0.41, 8, 0.0, 0.0),
        item_duck("z", 0.39, 9, 0.0, 0.0),
    ];
    for id in ["t", "f"] {
        ducks
            .iter_mut()
            .find(|duck| duck.player_id.as_str() == id)
            .unwrap()
            .finished = true;
    }
    ducks
}

fn rocket(kind: ProjectileSource, retargeted: bool) -> RocketRuntime {
    RocketRuntime {
        id: 1,
        source_player_id: pid("s"),
        target_player_id: pid("t"),
        progress: 0.40,
        spawned_at_tick: 90,
        expires_at_tick: 400,
        kind,
        speed_per_second: 0.1,
        hit_radius: 0.01,
        retargeted,
        launch_at_tick: 90,
    }
}

fn state(config: &ResolvedRaceConfig, rocket: RocketRuntime) -> ItemRaceState {
    let mut state = create_item_race_state(config);
    state.runtime_mut("c").rocket_protection_until_tick = i64::from(TICK) + 1;
    state.rockets.push(rocket);
    state
}

fn run(
    state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    config: &ResolvedRaceConfig,
) -> Harness {
    let mut harness = Harness::for_config(config);
    update_rockets(state, ducks, TICK, 60, &mut harness.emitter(TICK));
    harness
}

/// `localeCompare` puts `a` before `B` (ICU, `ts-compat`); the Phase B byte
/// order puts `B` first.
fn expected_tie_winner() -> &'static str {
    if cfg!(feature = "ts-compat") {
        "a"
    } else {
        "B"
    }
}

#[test]
fn wild_rocket_retargets_to_nearest_eligible_duck_ahead() {
    let config = config();
    let mut state = state(&config, rocket(ProjectileSource::Wild, false));
    let mut ducks = ducks();
    let harness = run(&mut state, &mut ducks, &config);

    assert_eq!(
        harness.count("MINI_ROCKET_EXPIRED"),
        0,
        "{:?}",
        harness.types()
    );
    assert_eq!(state.rockets.len(), 1);
    let rocket = &state.rockets[0];
    assert!(rocket.retargeted);
    assert_eq!(rocket.target_player_id.as_str(), expected_tie_winner());
    assert_eq!(rocket.progress, 0.40 + 0.1 / 60.0);
}

#[test]
fn protection_expiring_this_tick_makes_a_duck_eligible() {
    let config = config();
    let mut state = state(&config, rocket(ProjectileSource::Wild, false));
    // `tick >= rocketProtectionUntilTick`: protection until this very tick
    // no longer protects.
    state.runtime_mut("c").rocket_protection_until_tick = i64::from(TICK);
    let mut ducks = ducks();
    run(&mut state, &mut ducks, &config);
    assert_eq!(state.rockets[0].target_player_id.as_str(), "c");
    assert!(state.rockets[0].retargeted);
}

#[test]
fn failed_retarget_expires_with_the_original_target() {
    let config = config();
    let mut state = state(&config, rocket(ProjectileSource::Wild, false));
    let mut ducks = ducks();
    for duck in &mut ducks {
        if ["a", "B"].contains(&duck.player_id.as_str()) {
            duck.finished = true;
        }
    }
    let harness = run(&mut state, &mut ducks, &config);
    assert!(state.rockets.is_empty());
    let expired = harness.find("MINI_ROCKET_EXPIRED").expect("rocket expires");
    assert_eq!(
        expired.source_player_id.as_ref().map(|id| id.as_str()),
        Some("s")
    );
    assert_eq!(
        expired.target_player_id.as_ref().map(|id| id.as_str()),
        Some("t")
    );
}

#[test]
fn missing_target_retargets_like_a_finished_one() {
    let config = config();
    let mut state = state(&config, rocket(ProjectileSource::Wild, false));
    // `ducks.find(...)` returns undefined: the target is not in this array.
    let mut ducks: Vec<DuckPhysicsState> = ducks()
        .into_iter()
        .filter(|duck| duck.player_id.as_str() != "t")
        .collect();
    run(&mut state, &mut ducks, &config);
    assert_eq!(
        state.rockets[0].target_player_id.as_str(),
        expected_tie_winner()
    );
}

#[test]
fn rocket_retargets_at_most_once() {
    let config = config();
    let mut state = state(&config, rocket(ProjectileSource::Wild, true));
    let mut ducks = ducks();
    let harness = run(&mut state, &mut ducks, &config);
    assert!(state.rockets.is_empty());
    assert_eq!(harness.count("MINI_ROCKET_EXPIRED"), 1);
}

#[test]
fn prep_rocket_never_retargets() {
    let config = config();
    let mut state = state(&config, rocket(ProjectileSource::Prep, false));
    let mut ducks = ducks();
    let harness = run(&mut state, &mut ducks, &config);
    assert!(state.rockets.is_empty());
    assert_eq!(harness.count("ROCKET_EXPIRED"), 1);
    assert_eq!(harness.count("MINI_ROCKET_EXPIRED"), 0);
}

#[test]
fn expired_wild_rocket_does_not_retarget() {
    let config = config();
    let mut expiring = rocket(ProjectileSource::Wild, false);
    expiring.expires_at_tick = i64::from(TICK);
    let mut state = state(&config, expiring);
    let mut ducks = ducks();
    let harness = run(&mut state, &mut ducks, &config);
    assert!(state.rockets.is_empty());
    let expired = harness.find("MINI_ROCKET_EXPIRED").expect("rocket expires");
    assert_eq!(
        expired.target_player_id.as_ref().map(|id| id.as_str()),
        Some("t")
    );
}
