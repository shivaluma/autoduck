//! Port of `tests/race-aim.test.ts` (S3.15): same tests, same assertions.
//! TS scaffolding is mapped in `support/whitebox.rs`.

#![allow(clippy::float_cmp, clippy::too_many_lines)]

#[path = "support/whitebox.rs"]
mod whitebox;

use race_core::auto_use::{build_race_objective_context, new_brain};
use race_core::items::config::item_balance;
use race_core::items::{
    BananaRuntime, ItemRaceState, ProjectileSource, aimed_banana_lateral, create_item_race_state,
    default_horn_side, horn_side_targets,
};
use race_core::rng::create_race_rng;
use race_core::sim::lane_ai::{LaneContext, evaluate_smart_desired_lateral_offset};
use race_core::sim::{DuckPhysicsState, SimOptions, create_simulation};
use race_protocol::config::{ChaosType, RaceChaosConfig, ResolvedRaceConfig};
use race_protocol::events::{AiIntent, HornSide, Temperament};
use race_protocol::ids::ItemKey;
use whitebox::{EvalEnv, Harness, execute_prep, item_duck, parse_config, pid};

/// `setup(loadouts)`: the parsed config, its item state, and an evaluation
/// env whose brains are all pinned to `AGGRESSIVE`.
fn setup(loadouts: &[(&str, &[&str])]) -> (ResolvedRaceConfig, ItemRaceState, EvalEnv) {
    let players: Vec<String> = loadouts
        .iter()
        .map(|(id, _)| format!(r#"{{"playerId":"{id}","name":"{id}"}}"#))
        .collect();
    let config = parse_config(&format!(
        r#"{{"raceId":"aim","seed":"{}","players":[{}],"loadouts":[{}]}}"#,
        "55".repeat(32),
        players.join(","),
        whitebox::loadouts_json(loadouts),
    ));
    let item_state = create_item_race_state(&config);
    let mut env = EvalEnv::new(&config);
    for (id, _) in loadouts {
        env.brains
            .insert(pid(id), new_brain(pid(id), Temperament::Aggressive));
    }
    (config, item_state, env)
}

/// `duck(playerId, progress, rank, lateralOffset = 0, lateralVelocity = 0)`.
fn duck(
    id: &str,
    progress: f64,
    rank: u32,
    lateral_offset: f64,
    lateral_velocity: f64,
) -> DuckPhysicsState {
    item_duck(id, progress, rank, lateral_offset, lateral_velocity)
}

#[test]
fn banana_toss_is_limited_to_the_aim_reach_and_defaults_to_the_dropper_lane() {
    assert_eq!(aimed_banana_lateral(0.1, None, 0.22), 0.1);
    assert_eq!(aimed_banana_lateral(0.1, Some(0.25), 0.22), 0.25);
    assert!((aimed_banana_lateral(0.1, Some(0.9), 0.22) - 0.32).abs() < 1e-9);
    assert_eq!(aimed_banana_lateral(0.9, Some(1.5), 0.22), 0.95);
}

#[test]
fn directional_horn_catches_one_side_plus_a_narrow_centre_band() {
    let horner = duck("h", 0.5, 2, 0.0, 0.0);
    let ducks = vec![
        horner.clone(),
        duck("l", 0.5, 3, -0.3, 0.0),
        duck("r", 0.51, 1, 0.3, 0.0),
        duck("c", 0.49, 4, 0.05, 0.0),
        duck("far", 0.6, 5, 0.3, 0.0),
    ];
    let ids = |side| {
        let mut ids: Vec<&str> =
            horn_side_targets(&horner, &ducks, side, 0.055, 0.55, 0.08, |_| false)
                .into_iter()
                .map(|index| ducks[index].player_id.as_str())
                .collect();
        ids.sort();
        ids
    };
    assert_eq!(ids(HornSide::Right), ["c", "r"]);
    assert_eq!(ids(HornSide::Left), ["c", "l"]);
    // Default side = more ducks; ties lean toward the middle of the river.
    assert_eq!(
        default_horn_side(
            &duck("h", 0.5, 2, 0.4, 0.0),
            &ducks,
            0.055,
            0.55,
            0.08,
            |_| false
        ),
        HornSide::Left
    );
}

#[test]
fn banana_aim_leads_the_chasers_predicted_lane() {
    let (_config, item_state, mut env) = setup(&[
        ("me", &["NITRO", "BANANA"]),
        ("chaser", &["BUBBLE_SHIELD", "DRAFT_FIN"]),
    ]);
    // The chaser is close behind and drifting right.
    let ducks = vec![
        duck("me", 0.6, 1, 0.0, 0.0),
        duck("chaser", 0.585, 2, 0.05, 0.25),
    ];
    let me = pid("me");
    let plan = env
        .ctx(600, &item_state, &ducks, &me, false)
        .plan_banana_aim(
            &ducks[0],
            item_balance::banana::AIM_MAX_OFFSET,
            item_balance::banana::DROP_BEHIND_PROGRESS,
            item_balance::banana::HIT_LATERAL_RADIUS,
            0.018,
        );
    assert!(
        plan.aim_lateral > 0.05,
        "aim {} should lead to the right",
        plan.aim_lateral
    );
    assert_eq!(
        plan.target_id.as_ref().map(|id| id.as_str()),
        Some("chaser")
    );
    assert!(plan.intersection > 50.0);
}

#[test]
fn banana_aim_refuses_a_lane_that_would_catch_a_teammate() {
    let (mut config, _item_state, mut env) = setup(&[
        ("me", &["NITRO", "BANANA"]),
        ("mate", &["NITRO", "DRAFT_FIN"]),
        ("rival", &["NITRO", "DRAFT_FIN"]),
    ]);
    config.chaos_config = RaceChaosConfig {
        chaos_type: ChaosType::Duo,
        target_player_id: None,
        groups: vec![vec![pid("me"), pid("mate")], vec![pid("rival")]],
    };
    let item_state = create_item_race_state(&config);
    // `{...env, itemState, objective: buildRaceObjectiveContext(env.config)}`
    // with every brain of the new item state pinned to AGGRESSIVE.
    env.objective = build_race_objective_context(&config);
    for id in ["me", "mate", "rival"] {
        env.brains
            .insert(pid(id), new_brain(pid(id), Temperament::Aggressive));
    }
    let ducks = vec![
        duck("me", 0.6, 1, 0.0, 0.0),
        duck("mate", 0.588, 2, -0.15, 0.0),
        duck("rival", 0.586, 3, 0.15, 0.0),
    ];
    let me = pid("me");
    let plan = env
        .ctx(600, &item_state, &ducks, &me, false)
        .plan_banana_aim(
            &ducks[0],
            item_balance::banana::AIM_MAX_OFFSET,
            item_balance::banana::DROP_BEHIND_PROGRESS,
            item_balance::banana::HIT_LATERAL_RADIUS,
            0.018,
        );
    assert!(plan.aim_lateral > 0.0, "peel goes to the rival side");
    assert_eq!(plan.target_id.as_ref().map(|id| id.as_str()), Some("rival"));
}

#[test]
fn the_brain_aims_its_horn_to_shove_a_duck_onto_a_live_peel_and_the_executed_blast_goes_that_way() {
    let (config, mut item_state, mut env) = setup(&[
        ("horn", &["HOMING_ROCKET", "QUACK_HORN"]),
        ("left", &["BUBBLE_SHIELD", "DRAFT_FIN"]),
        ("right", &["BUBBLE_SHIELD", "DRAFT_FIN"]),
    ]);
    let mut ducks = vec![
        duck("horn", 0.5, 2, 0.0, 0.0),
        duck("left", 0.505, 1, -0.3, 0.0),
        duck("right", 0.505, 3, 0.3, 0.0),
    ];
    // A peel waits just ahead of `right`, further right of its lane.
    item_state.bananas.push(BananaRuntime {
        id: 99,
        source_player_id: pid("someone"),
        progress: 0.525,
        lateral_offset: 0.75,
        armed_at_tick: 0,
        expires_at_tick: 10_000,
        kind: ProjectileSource::Prep,
        hit_progress_radius: 0.02,
        hit_lateral_radius: 0.2,
        progress_knockback: None,
        lateral_slip: 0.65,
    });
    let horn = pid("horn");
    let candidate = env
        .ctx(600, &item_state, &ducks, &horn, false)
        .evaluate_prep_candidates()
        .into_iter()
        .find(|entry| entry.item_id == ItemKey::QuackHorn);
    assert!(candidate.is_some());
    let mut candidate = candidate.unwrap();
    assert_eq!(candidate.horn_side, Some(HornSide::Right));
    assert_eq!(candidate.intent, Some(AiIntent::Shove));
    let before = ducks[2].lateral_offset;
    candidate.player_id = pid("horn");
    assert!(execute_prep(
        &candidate,
        &mut item_state,
        &mut ducks,
        600,
        &mut Harness::new(),
        &config,
        &mut env.director,
    ));
    assert!(
        ducks[2].lateral_offset > before,
        "the right-hand duck is shoved further right"
    );
    assert_eq!(
        ducks[1].lateral_offset, -0.3,
        "the left-hand duck is untouched"
    );
}

#[test]
fn lane_tactics_a_brain_steers_out_of_the_line_of_a_duck_ahead_that_still_holds_a_peel() {
    let config = parse_config(&format!(
        r#"{{"raceId":"lanes","seed":"{}","players":[{{"playerId":"a","name":"a"}},{{"playerId":"b","name":"b"}}],"loadouts":[{{"playerId":"a","itemIds":["NITRO","BANANA"],"source":"PLAYER"}},{{"playerId":"b","itemIds":["BUBBLE_SHIELD","FEATHER"],"source":"PLAYER"}}]}}"#,
        "66".repeat(32),
    ));
    let in_peel_line = |ablated: bool| {
        let mut total = 0;
        for sample in 0..60 {
            let mut state = create_simulation(
                config.clone(),
                SimOptions {
                    record_events: false,
                    ai_ablation: if ablated { vec![pid("b")] } else { Vec::new() },
                    ..SimOptions::default()
                },
                None,
            );
            let ahead = state.duck_index("a").unwrap();
            let chaser = state.duck_index("b").unwrap();
            state.ducks[ahead].progress = 0.5;
            state.ducks[ahead].lateral_offset = 0.3;
            state.ducks[chaser].progress = 0.445;
            state.ducks[chaser].lateral_offset = 0.0;
            let lane = evaluate_smart_desired_lateral_offset(
                &LaneContext {
                    config: &state.config,
                    track: &state.track,
                    ducks: &state.ducks,
                    item_state: &state.item_state,
                    brains: &state.brains,
                    pickup_state: &state.pickup_state,
                    tick: state.tick,
                },
                &state.ducks[chaser],
                &mut create_race_rng(&format!("{sample}"), "lane-test"),
            );
            if (lane - state.ducks[ahead].lateral_offset).abs()
                <= item_balance::banana::HIT_LATERAL_RADIUS
            {
                total += 1;
            }
        }
        total
    };
    let brain = in_peel_line(false);
    let legacy = in_peel_line(true);
    assert!(
        brain < legacy,
        "brain {brain} vs legacy {legacy} of 60 samples in the peel line"
    );
}
