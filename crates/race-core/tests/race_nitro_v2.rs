//! Port of `tests/race-nitro-v2.test.ts` (S3.15): same tests, same
//! assertions. TS scaffolding is mapped in `support/whitebox.rs`.

#![allow(clippy::float_cmp, clippy::too_many_lines)]

#[path = "support/whitebox.rs"]
mod whitebox;

use race_core::auto_use::build_race_objective_context;
use race_core::items::config::item_balance;
use race_core::items::{
    DuckItemRuntime, ProjectileSource, RocketRuntime, SpeedStartExtras, break_active_speed_boost,
    create_item_race_state, item_speed_multiplier, try_apply_prep_speed_boost,
};
use race_core::math::js_round;
use race_protocol::config::ChaosType;
use race_protocol::events::{BoostBreakSource, EventKind};
use race_protocol::ids::{ItemKey, RaceItemId};
use whitebox::{EvalEnv, Harness, Labels, item_duck, literal_config, literal_runtime, pid};

/// `createTestRuntime(itemIds = ['NITRO'])`.
fn create_test_runtime(item_ids: &[RaceItemId]) -> DuckItemRuntime {
    literal_runtime(item_ids)
}

/// `Number(x.toFixed(digits))` for the small positive values compared here.
fn to_fixed(value: f64, digits: i32) -> f64 {
    let scale = [1.0, 10.0, 100.0, 1000.0][usize::try_from(digits).unwrap()];
    js_round(value * scale) / scale
}

/// `tryApplyPrepSpeedBoost(runtime, duckId, 'NITRO', 1.25, 1.70, 100, tickRate, emit)`.
fn start_nitro(runtime: &mut DuckItemRuntime, duck_id: &str, harness: &mut Harness) {
    try_apply_prep_speed_boost(
        runtime,
        &pid(duck_id),
        RaceItemId::Nitro,
        1.25,
        1.70,
        100,
        60,
        &mut harness.emitter(100),
        SpeedStartExtras::default(),
    );
}

#[test]
fn nitro_follows_3_phase_acceleration_curve_ignition_overdrive_decay() {
    let mut runtime = create_test_runtime(&[RaceItemId::Nitro]);
    let mut harness = Harness::new();

    start_nitro(&mut runtime, "duck-1", &mut harness);

    assert_eq!(runtime.active_speed_item_id, Some(RaceItemId::Nitro));
    assert_eq!(runtime.boost_multiplier, 1.25);

    // 1. Ignition phase (0.18s = 11 ticks): ticks 100..111
    // At tick 100 (elapsed 0): boost is 1.00
    let boost_start = item_speed_multiplier(&runtime, 100);
    assert_eq!(to_fixed(boost_start, 3), 1.000);

    // Mid ignition at tick 105 (elapsed 5/11): boost is ~1.114
    let boost_mid_ignition = item_speed_multiplier(&runtime, 105);
    assert!(boost_mid_ignition > 1.05 && boost_mid_ignition < 1.25);

    // 2. Overdrive phase (peak hold): ticks 112..187
    let boost_overdrive = item_speed_multiplier(&runtime, 140);
    assert_eq!(to_fixed(boost_overdrive, 2), 1.25);

    // 3. Decay phase (0.25s = 15 ticks): ticks 188..202
    // Mid decay at tick 195 (elapsed 8/15): boost is declining from 1.25 to 1.00
    let boost_mid_decay = item_speed_multiplier(&runtime, 195);
    assert!(boost_mid_decay > 1.00 && boost_mid_decay < 1.25);

    // After boost ends at tick 203: returns to 1.00
    let boost_ended = item_speed_multiplier(&runtime, 203);
    assert_eq!(boost_ended, 1.0);
}

#[test]
fn nitro_does_not_cleanse_slow_effects_and_combines_smoothly() {
    let mut runtime = create_test_runtime(&[RaceItemId::Nitro]);
    let mut harness = Harness::new();

    // Apply a 0.8x slow for 3 seconds
    runtime.slow_multiplier = 0.80;
    runtime.slow_until_tick = 300;

    // Trigger Nitro at tick 100 during slow
    start_nitro(&mut runtime, "duck-1", &mut harness);

    // During overdrive, speed multiplier is peak (1.25) * slow (0.80) = 1.00
    let combined_overdrive = item_speed_multiplier(&runtime, 140);
    assert_eq!(to_fixed(combined_overdrive, 2), 1.00);

    // Slow remains active throughout and after Nitro ends
    let slow_after_nitro = item_speed_multiplier(&runtime, 205);
    assert_eq!(to_fixed(slow_after_nitro, 2), 0.80);
}

#[test]
fn attack_interactions_prep_attacks_fully_break_boosts_mini_rocket_50_wild_banana_30_wild_horn_spares_nitro()
 {
    let mut harness = Harness::new();
    let attacker = pid("attacker");
    let break_boost = |runtime: &mut DuckItemRuntime,
                       harness: &mut Harness,
                       victim: &str,
                       source: BoostBreakSource| {
        break_active_speed_boost(
            runtime,
            130,
            60,
            &mut harness.emitter(130),
            &attacker,
            &pid(victim),
            source,
        )
    };

    // 1. Prep Rocket: 100% Boost Break
    let mut rocket_victim = create_test_runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut rocket_victim, "duck-1", &mut harness);
    break_boost(
        &mut rocket_victim,
        &mut harness,
        "duck-1",
        BoostBreakSource::Rocket,
    );
    assert_eq!(rocket_victim.boost_multiplier, 1.0);
    assert_eq!(rocket_victim.active_speed_item_id, None);
    let rocket_break = harness.events().iter().find_map(|event| match &event.kind {
        EventKind::BoostBroken(meta) if meta.break_source == BoostBreakSource::Rocket => {
            Some(meta.partial)
        }
        _ => None,
    });
    assert_eq!(rocket_break, Some(false));

    // 2. Mini Rocket: 50% partial break
    let mut mini_rocket_victim = create_test_runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut mini_rocket_victim, "duck-2", &mut harness);
    let remaining_before_mini = mini_rocket_victim.boost_until_tick - 130;
    break_boost(
        &mut mini_rocket_victim,
        &mut harness,
        "duck-2",
        BoostBreakSource::MiniRocket,
    );
    let remaining_after_mini = mini_rocket_victim.boost_until_tick - 130;
    assert_eq!(
        remaining_after_mini as f64,
        js_round(remaining_before_mini as f64 * 0.5)
    );
    assert_eq!(
        mini_rocket_victim.active_speed_item_id,
        Some(RaceItemId::Nitro)
    ); // Still running remaining duration

    // 3. Prep Banana: full break (ATTACK > SPEED); Wild Banana keeps the 30% partial disruption
    let mut banana_victim = create_test_runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut banana_victim, "duck-3", &mut harness);
    assert_eq!(
        break_boost(
            &mut banana_victim,
            &mut harness,
            "duck-3",
            BoostBreakSource::Banana
        ),
        Some(RaceItemId::Nitro)
    );
    assert_eq!(banana_victim.active_speed_item_id, None);
    let mut wild_banana_victim = create_test_runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut wild_banana_victim, "duck-5", &mut harness);
    let remaining_before_banana = wild_banana_victim.boost_until_tick - 130;
    break_boost(
        &mut wild_banana_victim,
        &mut harness,
        "duck-5",
        BoostBreakSource::WildBanana,
    );
    let remaining_after_banana = wild_banana_victim.boost_until_tick - 130;
    assert_eq!(
        remaining_after_banana as f64,
        remaining_before_banana as f64 - js_round(remaining_before_banana as f64 * 0.30)
    );
    assert_eq!(
        wild_banana_victim.active_speed_item_id,
        Some(RaceItemId::Nitro)
    ); // Continues running underneath

    // 4. Prep Horn breaks Nitro; Wild Horn still cannot
    let mut horn_victim = create_test_runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut horn_victim, "duck-4", &mut harness);
    assert_eq!(
        break_boost(
            &mut horn_victim,
            &mut harness,
            "duck-4",
            BoostBreakSource::QuackHorn
        ),
        Some(RaceItemId::Nitro)
    );
    let mut wild_horn_victim = create_test_runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut wild_horn_victim, "duck-6", &mut harness);
    let boost_until_before_horn = wild_horn_victim.boost_until_tick;
    break_boost(
        &mut wild_horn_victim,
        &mut harness,
        "duck-6",
        BoostBreakSource::WildHorn,
    );
    assert_eq!(wild_horn_victim.boost_until_tick, boost_until_before_horn);
    assert_eq!(
        wild_horn_victim.active_speed_item_id,
        Some(RaceItemId::Nitro)
    );
}

#[test]
fn nitro_ai_utility_scoring_overtakes_loser_zone_safety_finish_conversion_and_rocket_threat_avoidance()
 {
    let labels = Labels {
        protocol: "1.0.0",
        engine: "1.2.0",
        balance: "S3.12",
        track: "river-01-v2",
    };
    let base_config = literal_config(
        "nitro-ai-eval",
        &"11".repeat(32),
        &labels,
        &[
            ("duck-1", "Thanh"),
            ("duck-2", "Huy"),
            ("duck-3", "Minh"),
            ("duck-4", "Bao"),
            ("duck-5", "Long"),
            ("duck-6", "Khoa"),
            ("duck-7", "Nam"),
            ("duck-8", "An"),
        ],
        &[("duck-6", &["NITRO", "DRAFT_FIN"])],
        None,
    );

    let mut item_state = create_item_race_state(&base_config);
    let ducks = vec![
        item_duck("duck-1", 0.85, 1, 0.0, 0.0),
        item_duck("duck-2", 0.84, 2, 0.0, 0.0),
        item_duck("duck-3", 0.70, 3, 0.0, 0.0),
        item_duck("duck-4", 0.65, 4, 0.0, 0.0),
        item_duck("duck-5", 0.506, 5, 0.0, 0.0),
        item_duck("duck-6", 0.500, 6, 0.0, 0.0),
        item_duck("duck-7", 0.40, 7, 0.0, 0.0),
        item_duck("duck-8", 0.38, 8, 0.0, 0.0),
    ];
    let me = pid("duck-6");
    let mut env = EvalEnv::new(&base_config);
    let nitro = |candidates: Vec<race_core::auto_use::AutoUseCandidate>| {
        candidates
            .into_iter()
            .find(|candidate| candidate.item_id == ItemKey::Nitro)
    };

    // 1. Duck-6 is in position to overtake Duck-5 (gap 0.006 is well within expected gain ~0.0094)
    let nitro_candidate = nitro(
        env.ctx(500, &item_state, &ducks, &me, true)
            .evaluate_prep_candidates(),
    );
    assert!(
        nitro_candidate.is_some(),
        "Nitro candidate should be evaluated"
    );
    assert!(
        nitro_candidate.unwrap().score >= 42.0,
        "Nitro score should be high for clean overtake"
    );

    // 2. Incoming Rocket threat: AI holds Nitro when Rocket is inbound without shield
    item_state.rockets.push(RocketRuntime {
        id: 99,
        source_player_id: pid("duck-7"),
        target_player_id: pid("duck-6"),
        progress: 0.45,
        spawned_at_tick: 480,
        launch_at_tick: 480,
        expires_at_tick: 700,
        kind: ProjectileSource::Prep,
        speed_per_second: item_balance::rocket::PROJECTILE_SPEED,
        hit_radius: item_balance::rocket::HIT_RADIUS,
        slow_multiplier: 0.30,
        slow_duration_seconds: 1.20,
        retargeted: false,
    });

    let threatened_nitro = nitro(
        env.ctx(500, &item_state, &ducks, &me, true)
            .evaluate_prep_candidates(),
    );
    assert!(
        threatened_nitro
            .as_ref()
            .is_none_or(|candidate| candidate.score < 30.0),
        "Nitro should be held when incoming rocket threatens boost break"
    );

    // 3. Reverse Mode: AI avoids using Nitro because moving forward gives negative utility
    let mut reverse_config = base_config.clone();
    reverse_config.chaos_config.chaos_type = ChaosType::Reverse;
    // `{...normalCtx, objective: buildRaceObjectiveContext(reverseConfig)}`.
    env.objective = build_race_objective_context(&reverse_config);
    item_state.rockets.clear(); // clear rockets
    let reverse_nitro = nitro(
        env.ctx(500, &item_state, &ducks, &me, true)
            .evaluate_prep_candidates(),
    );
    assert_eq!(
        reverse_nitro, None,
        "AI should avoid auto-using Nitro in Reverse mode"
    );
}
