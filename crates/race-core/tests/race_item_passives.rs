//! Port of `tests/race-item-passives.test.ts` (S3.15): same tests, same
//! assertions. TS scaffolding is mapped in `support/whitebox.rs`.

#![allow(clippy::float_cmp, clippy::too_many_lines)]

#[path = "support/whitebox.rs"]
mod whitebox;

use race_core::auto_use::DirectorCache;
use race_core::items::config::item_balance;
use race_core::items::{
    LoadoutCombo, ProjectileSource, RocketRuntime, SpeedStartExtras, create_item_race_state,
    slipstream_ready, try_apply_prep_speed_boost,
};
use race_core::math::js_round;
use race_core::sim::{SimOptions, create_simulation, step_simulation};
use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::AutoUseReason;
use race_protocol::ids::{ItemKey, RaceItemId};
use whitebox::{
    EvalEnv, Harness, S3_11, execute_prep, item_duck, literal_config, pid, prep_candidate,
};

/// `dummyConfig(loadouts)`.
fn dummy_config(loadouts: &[(&str, &[&str])]) -> ResolvedRaceConfig {
    literal_config(
        "test-passives",
        &"0".repeat(64),
        &S3_11,
        &[
            ("duck-1", "Duck 1"),
            ("duck-2", "Duck 2"),
            ("duck-3", "Duck 3"),
            ("duck-4", "Duck 4"),
        ],
        loadouts,
        None,
    )
}

/// `{playerId, progress, lateralOffset, lateralVelocity: 0, currentRank, finished: false}`.
fn duck(
    id: &str,
    progress: f64,
    lateral_offset: f64,
    rank: u32,
) -> race_core::sim::DuckPhysicsState {
    item_duck(id, progress, rank, lateral_offset, 0.0)
}

#[test]
fn paddle_burst_is_unlocked_during_endgame_burn_even_if_rank_is_1() {
    let cfg = dummy_config(&[("duck-1", &["BUBBLE_SHIELD", "PADDLE_BURST"])]);
    let mut item_state = create_item_race_state(&cfg);
    let mut ducks = vec![duck("duck-1", 0.85, 0.0, 1), duck("duck-2", 0.8, 0.0, 2)];
    let mut env = EvalEnv::new(&cfg);
    let me = pid("duck-1");

    let candidates = env
        .ctx(100, &item_state, &ducks, &me, false)
        .evaluate_prep_candidates();
    let pb_candidate = candidates
        .iter()
        .find(|candidate| candidate.item_id == ItemKey::PaddleBurst);
    assert!(
        pb_candidate.is_some(),
        "Paddle Burst candidate should be generated at progress >= 0.78 for Rank 1"
    );

    // `{...pbCandidate, playerId: ducks[0].playerId, executionDelayTicks: 0, ...}`.
    let mut candidate_as_action = pb_candidate.unwrap().clone();
    candidate_as_action.player_id = ducks[0].player_id.clone();
    let mut harness = Harness::new();
    let executed = execute_prep(
        &candidate_as_action,
        &mut item_state,
        &mut ducks,
        100,
        &mut harness,
        &cfg,
        &mut env.director,
    );
    assert!(
        executed,
        "Paddle Burst should execute successfully during endgame sprint"
    );
}

#[test]
fn speed_demon_reduces_draft_fin_hold_requirement() {
    let cfg = dummy_config(&[
        ("duck-1", &["NITRO", "DRAFT_FIN"]),         // Speed Demon
        ("duck-2", &["BUBBLE_SHIELD", "DRAFT_FIN"]), // Mixed
    ]);
    let mut item_state = create_item_race_state(&cfg);

    assert_eq!(
        item_state.runtime("duck-1").loadout_combo,
        Some(LoadoutCombo::SpeedDemon)
    );
    assert_eq!(
        item_state.runtime("duck-2").loadout_combo,
        Some(LoadoutCombo::MadDuck)
    );

    // Normal required ticks = 0.75 * 60 = 45 ticks. Speed demon required = 0.75 * 0.8 * 60 = 36 ticks.
    item_state.runtime_mut("duck-1").draft_slipstream_ticks = 38;
    item_state.runtime_mut("duck-2").draft_slipstream_ticks = 38;

    assert!(
        slipstream_ready(item_state.runtime("duck-1"), 60, None),
        "Speed Demon should be ready at 38 ticks"
    );
    assert!(
        !slipstream_ready(item_state.runtime("duck-2"), 60, None),
        "Non-Speed-Demon should require 45 ticks"
    );
}

#[test]
fn fortress_reduces_duck_collision_push() {
    let cfg = dummy_config(&[
        ("duck-1", &["BUBBLE_SHIELD", "SHOCK_ABSORBER"]), // Fortress
        ("duck-2", &["NITRO", "DRAFT_FIN"]),              // Speed Demon
    ]);
    let mut sim = create_simulation(
        cfg,
        SimOptions {
            record_events: false,
            ..SimOptions::default()
        },
        None,
    );
    sim.ducks[0].progress = 0.5;
    sim.ducks[0].lateral_offset = 0.05;
    sim.ducks[1].progress = 0.5;
    sim.ducks[1].lateral_offset = -0.05;

    let prev_offset0 = sim.ducks[0].lateral_offset;
    let prev_offset1 = sim.ducks[1].lateral_offset;

    step_simulation(&mut sim, None);

    let delta0 = (sim.ducks[0].lateral_offset - prev_offset0).abs();
    let delta1 = (sim.ducks[1].lateral_offset - prev_offset1).abs();

    assert!(
        delta0 < delta1,
        "Fortress duck should experience less lateral displacement than non-fortress duck"
    );
}

#[test]
fn menace_reduces_arm_progress_for_offensive_items() {
    let cfg = dummy_config(&[
        ("duck-1", &["HOMING_ROCKET", "BANANA"]), // Menace
        ("duck-2", &["NITRO", "HOMING_ROCKET"]),  // Mixed
    ]);
    let item_state = create_item_race_state(&cfg);
    assert_eq!(
        item_state.runtime("duck-1").loadout_combo,
        Some(LoadoutCombo::Menace)
    );
    assert_eq!(
        item_state.runtime("duck-2").loadout_combo,
        Some(LoadoutCombo::MadDuck)
    );

    let ducks = vec![
        duck("duck-1", 0.23, 0.0, 2),
        duck("duck-2", 0.23, 0.0, 3),
        duck("duck-3", 0.3, 0.0, 1),
    ];
    let mut env = EvalEnv::new(&cfg);

    // At progress 0.23, base rocket armProgress is 0.25. Menace has 0.25 - 0.03 = 0.22.
    let one = pid("duck-1");
    let two = pid("duck-2");
    let candidates1 = env
        .ctx(100, &item_state, &ducks, &one, false)
        .evaluate_prep_candidates();
    let candidates2 = env
        .ctx(100, &item_state, &ducks, &two, false)
        .evaluate_prep_candidates();

    assert!(
        candidates1
            .iter()
            .any(|candidate| candidate.item_id == ItemKey::HomingRocket),
        "Menace should be armed at progress 0.23"
    );
    assert!(
        !candidates2
            .iter()
            .any(|candidate| candidate.item_id == ItemKey::HomingRocket),
        "Mixed should NOT be armed at progress 0.23"
    );
}

#[test]
fn quack_horn_dispels_active_speed_boost_draft_paddle_and_silences_victims_for_0_5_seconds() {
    let cfg = dummy_config(&[
        ("duck-1", &["HOMING_ROCKET", "QUACK_HORN"]),
        ("duck-2", &["NITRO", "DRAFT_FIN"]),
    ]);
    let mut item_state = create_item_race_state(&cfg);
    let mut quiet = Harness::new();

    // duck-2 has an active Draft Fin boost
    try_apply_prep_speed_boost(
        item_state.runtime_mut("duck-2"),
        &pid("duck-2"),
        RaceItemId::DraftFin,
        1.15,
        1.5,
        10,
        60,
        &mut quiet.emitter(10),
        SpeedStartExtras::default(),
    );
    assert_eq!(
        item_state.runtime("duck-2").active_speed_item_id,
        Some(RaceItemId::DraftFin)
    );
    assert!(item_state.runtime("duck-2").boost_multiplier > 1.0);

    let mut ducks = vec![duck("duck-1", 0.5, 0.0, 2), duck("duck-2", 0.51, 0.05, 1)];

    let mut emitted = Harness::new();
    let candidate = prep_candidate(
        "duck-1",
        RaceItemId::QuackHorn,
        100.0,
        AutoUseReason::Opportunity,
    );

    let executed = execute_prep(
        &candidate,
        &mut item_state,
        &mut ducks,
        20,
        &mut emitted,
        &cfg,
        &mut DirectorCache::default(),
    );
    assert!(executed);

    // duck-2's Draft Fin boost should be broken (dispelled)
    let runtime2 = item_state.runtime("duck-2");
    assert_eq!(runtime2.active_speed_item_id, None);
    assert_eq!(runtime2.boost_multiplier, 1.0);

    // duck-2 should be silenced until tick 20 + duration * 60
    assert_eq!(
        runtime2.silenced_until_tick,
        20 + js_round(item_balance::horn::SILENCE_DURATION_SECONDS * 60.0) as i64
    );
    assert!(emitted.has("BOOST_BROKEN"));
    assert!(emitted.has("ITEM_SILENCED"));
    assert!(emitted.has("PREDATOR_RUSH_STARTED")); // duck-1 is MENACE!
}

#[test]
fn silenced_ducks_cannot_evaluate_or_execute_prep_items_or_reactive_defense() {
    let cfg = dummy_config(&[("duck-1", &["BUBBLE_SHIELD", "PADDLE_BURST"])]);
    let mut item_state = create_item_race_state(&cfg);
    item_state.runtime_mut("duck-1").silenced_until_tick = 500;

    let mut ducks = vec![duck("duck-1", 0.85, 0.0, 1)];
    let mut env = EvalEnv::new(&cfg);
    let me = pid("duck-1");

    // Prep candidates should be empty while silenced
    let prep_candidates = env
        .ctx(100, &item_state, &ducks, &me, true)
        .evaluate_prep_candidates();
    assert_eq!(prep_candidates.len(), 0);

    // Reactive defense should be empty while silenced
    item_state.rockets.push(RocketRuntime {
        id: 1,
        source_player_id: pid("duck-2"),
        target_player_id: pid("duck-1"),
        progress: 0.8,
        spawned_at_tick: 90,
        launch_at_tick: 90,
        expires_at_tick: 300,
        kind: ProjectileSource::Prep,
        speed_per_second: 0.16,
        hit_radius: 0.014,
        slow_multiplier: 0.68,
        slow_duration_seconds: 1.15,
        retargeted: false,
    });
    let reactive_candidates = env
        .ctx(100, &item_state, &ducks, &me, true)
        .evaluate_reactive_defense();
    assert_eq!(reactive_candidates.len(), 0);

    // Execution should be blocked
    let candidate = prep_candidate(
        "duck-1",
        RaceItemId::BubbleShield,
        100.0,
        AutoUseReason::LateRace,
    );
    assert!(!execute_prep(
        &candidate,
        &mut item_state,
        &mut ducks,
        100,
        &mut Harness::new(),
        &cfg,
        &mut env.director,
    ));
}

#[test]
fn horn_ai_values_removable_boosts_within_configured_radius() {
    let cfg = dummy_config(&[
        ("duck-1", &["HOMING_ROCKET", "QUACK_HORN"]), // Menace
        ("duck-2", &["NITRO", "DRAFT_FIN"]),
        ("duck-3", &["BUBBLE_SHIELD", "FEATHER"]),
    ]);
    let mut item_state = create_item_race_state(&cfg);

    // Position duck-2 within the configured progress and lateral radius.
    let ducks = vec![
        duck("duck-1", 0.50, 0.0, 2),
        duck("duck-2", 0.54, 0.35, 1),
        duck("duck-3", 0.80, 0.0, 3),
    ];
    let mut env = EvalEnv::new(&cfg);
    let me = pid("duck-1");

    // Without boost on duck-2
    let candidates_without_boost = env
        .ctx(100, &item_state, &ducks, &me, true)
        .evaluate_prep_candidates();
    let horn_cand1 = candidates_without_boost
        .iter()
        .find(|candidate| candidate.item_id == ItemKey::QuackHorn);
    assert!(
        horn_cand1.is_some(),
        "Horn should detect duck-2 in configured radius"
    );

    // With a removable Draft Fin boost on duck-2
    try_apply_prep_speed_boost(
        item_state.runtime_mut("duck-2"),
        &pid("duck-2"),
        RaceItemId::DraftFin,
        1.15,
        1.5,
        90,
        60,
        &mut Harness::new().emitter(90),
        SpeedStartExtras::default(),
    );
    let candidates_with_boost = env
        .ctx(100, &item_state, &ducks, &me, true)
        .evaluate_prep_candidates();
    let horn_cand2 = candidates_with_boost
        .iter()
        .find(|candidate| candidate.item_id == ItemKey::QuackHorn);
    assert!(horn_cand2.is_some(), "Horn should detect boosting duck-2");
    assert!(
        horn_cand2.unwrap().score > horn_cand1.unwrap().score,
        "Horn score should be significantly higher when target is actively boosting"
    );
}

/// `cfgLoadouts()`.
const CFG_LOADOUTS: [(&str, &[&str]); 3] = [
    ("duck-1", &["QUACK_HORN"]),
    ("duck-2", &["QUACK_HORN"]),
    ("duck-3", &["QUACK_HORN"]),
];

#[test]
fn emp_cannot_refresh_silence_and_guarantees_two_seconds_of_recovery() {
    let cfg = dummy_config(&CFG_LOADOUTS);
    let mut state = create_item_race_state(&cfg);
    let mut ducks: Vec<_> = cfg
        .players
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let i_u32 = u32::try_from(i).unwrap();
            duck(p.player_id.as_str(), 0.5 + i as f64 * 0.001, 0.0, 4 - i_u32)
        })
        .collect();
    let mut director = DirectorCache::default();
    let mut events: Vec<u32> = Vec::new();
    let mut use_horn = |id: &str, tick: u32, state: &mut _, ducks: &mut Vec<_>| {
        // Reset geometry so only silence protection determines the outcome.
        for d in ducks.iter_mut() {
            let d: &mut race_core::sim::DuckPhysicsState = d;
            d.lateral_offset = 0.0;
        }
        let mut harness = Harness::new();
        let used = execute_prep(
            &prep_candidate(id, RaceItemId::QuackHorn, 100.0, AutoUseReason::Opportunity),
            state,
            ducks,
            tick,
            &mut harness,
            &cfg,
            &mut director,
        );
        if harness.events().iter().any(|event| {
            event.type_name() == "ITEM_SILENCED"
                && event
                    .source_player_id
                    .as_ref()
                    .is_some_and(|source| source.as_str() == "duck-4")
        }) {
            events.push(tick);
        }
        used
    };
    assert!(use_horn("duck-1", 100, &mut state, &mut ducks));
    assert_eq!(state.runtime("duck-4").silenced_until_tick, 130);
    assert_eq!(state.runtime("duck-4").silence_immune_until_tick, 250);
    assert!(use_horn("duck-2", 130, &mut state, &mut ducks));
    assert_eq!(state.runtime("duck-4").silenced_until_tick, 130);
    assert!(use_horn("duck-3", 250, &mut state, &mut ducks));
    assert_eq!(state.runtime("duck-4").silenced_until_tick, 280);
    assert_eq!(events, [100, 250]);
}

#[test]
fn emp_execution_rejects_targets_outside_the_configured_radius() {
    let cfg = dummy_config(&CFG_LOADOUTS);
    let mut state = create_item_race_state(&cfg);
    let mut ducks = vec![duck("duck-1", 0.5, 0.0, 2), duck("duck-4", 0.56, 0.0, 1)];
    assert!(!execute_prep(
        &prep_candidate(
            "duck-1",
            RaceItemId::QuackHorn,
            100.0,
            AutoUseReason::Opportunity
        ),
        &mut state,
        &mut ducks,
        100,
        &mut Harness::new(),
        &cfg,
        &mut DirectorCache::default(),
    ));
    assert!(!state.runtime("duck-1").used(RaceItemId::QuackHorn));
}
