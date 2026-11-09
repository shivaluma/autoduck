//! White-box ports of the item-level TS tests (M2). Only the tests that
//! drive `items/*` directly are here; the ones that go through
//! `tickAutoUseAI` / `executePrepAction` / `simulateRace` need the auto-use
//! port (M3) and live with it.
//!
//! Sources: `tests/race-items.test.ts`, `tests/race-counter-loop.test.ts`,
//! `tests/race-nitro-v2.test.ts`, `tests/race-aim.test.ts`.

#![allow(clippy::float_cmp, clippy::too_many_lines)]

use race_core::auto_use::Brains;
use race_core::items::config::item_balance;
use race_core::items::interactions::{InteractionRule, item_interaction_matrix};
use race_core::items::{BananaRuntime, ProjectileSource};
use race_core::items::{
    DefenseOutcome, DuckItemRuntime, IncomingRaceEffect, ItemRaceState, MOMENTUM_STEAL_DEFAULTS,
    SpeedStartExtras, aimed_banana_lateral, apply_item_slow, apply_staged_slow,
    break_active_speed_boost, create_item_race_state, default_horn_side, fire_prep_rocket,
    horn_side_targets, item_activation_for_event, item_active_effects, item_speed_multiplier,
    resolve_incoming_race_effect, tick_item_system, try_activate_bubble_shield,
    try_apply_prep_speed_boost,
};
use race_core::sim::{DuckPhysicsState, Emitter, EngineMath, EventLog};
use race_protocol::config::RaceConfigInput;
use race_protocol::events::{
    AutoUseReason, BoostBreakSource, EventKind, HornSide, RaceEvent, RocketFiredMeta,
};
use race_protocol::ids::{PlayerId, RaceId, RaceItemId};
use race_protocol::snapshot::ActiveEffect;

fn pid(id: &str) -> PlayerId {
    PlayerId::new(id).unwrap()
}

/// `raceConfigSchema.parse({raceId, seed, players, loadouts})` +
/// `createItemRaceState`.
fn item_state(race_id: &str, seed: &str, loadouts: &[(&str, &[&str])]) -> ItemRaceState {
    let players: Vec<String> = loadouts
        .iter()
        .map(|(id, _)| format!(r#"{{"playerId":"{id}","name":"{id}"}}"#))
        .collect();
    let loadouts: Vec<String> = loadouts
        .iter()
        .filter(|(_, items)| !items.is_empty())
        .map(|(id, items)| {
            let items: Vec<String> = items.iter().map(|item| format!("\"{item}\"")).collect();
            format!(
                r#"{{"playerId":"{id}","itemIds":[{}],"source":"PLAYER"}}"#,
                items.join(",")
            )
        })
        .collect();
    let json = format!(
        r#"{{"raceId":"{race_id}","seed":"{}","players":[{}],"loadouts":[{}]}}"#,
        seed.repeat(32),
        players.join(","),
        loadouts.join(",")
    );
    let input: RaceConfigInput = serde_json::from_str(&json).unwrap();
    create_item_race_state(&input.resolve().unwrap())
}

/// The TS `duck(playerId, progress, rank, lateralOffset)` helper. TS leaves
/// `previousProgress` undefined, which `bananaTouches` reads as `progress`.
fn duck(id: &str, progress: f64, rank: u32, lateral_offset: f64) -> DuckPhysicsState {
    DuckPhysicsState {
        player_id: pid(id),
        name: id.into(),
        progress,
        previous_progress: progress,
        lateral_offset,
        speed: 0.0,
        acceleration: 0.0,
        lateral_velocity: 0.0,
        desired_speed: 0.0,
        desired_lateral_offset: 0.0,
        current_rank: rank,
        active_effects: Vec::new(),
        next_impulse_tick: 0,
        finished: false,
        finish_time_ms: None,
        pacing_segments: Vec::new(),
    }
}

/// The TS `defense(items)` / `createTestRuntime(items)` literal.
fn runtime(items: &[RaceItemId]) -> DuckItemRuntime {
    let state = item_state("rt", "11", &[("x", &[]), ("y", &[])]);
    let mut runtime = state.runtime("x").clone();
    runtime.item_ids = items.to_vec();
    runtime.loadout_combo = None;
    runtime.bubble_available = items.contains(&RaceItemId::BubbleShield);
    runtime.bubble_until_tick = if runtime.bubble_available { 1000 } else { 0 };
    runtime.feather_available = items.contains(&RaceItemId::Feather);
    runtime.shock_absorber_available = items.contains(&RaceItemId::ShockAbsorber);
    runtime
}

/// An `emit` that records every event.
struct Harness {
    log: EventLog,
    brains: Brains,
    race_id: RaceId,
}

impl Harness {
    fn new() -> Self {
        Self {
            log: EventLog::new(true),
            brains: Brains::new(),
            race_id: RaceId::new("items").unwrap(),
        }
    }

    fn emitter(&mut self, tick: u32) -> Emitter<'_> {
        Emitter {
            log: &mut self.log,
            sink: None,
            brains: &mut self.brains,
            race_id: &self.race_id,
            tick,
            tick_rate: 60,
            math: EngineMath::default(),
        }
    }

    fn events(&self) -> &[RaceEvent] {
        &self.log.events
    }

    fn has(&self, type_name: &str) -> bool {
        self.events()
            .iter()
            .any(|event| event.type_name() == type_name)
    }

    fn find(&self, type_name: &str) -> Option<&RaceEvent> {
        self.events()
            .iter()
            .find(|event| event.type_name() == type_name)
    }
}

fn rocket_meta() -> RocketFiredMeta {
    RocketFiredMeta {
        auto_reason: AutoUseReason::Opportunity,
        decision_target_id: None,
        execute_target_id: None,
        retargeted_at_execute: false,
    }
}

/// `flyRocket` (`race-counter-loop.test.ts:35-40`).
fn fly_rocket(
    state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    harness: &mut Harness,
    from_tick: u32,
) -> u32 {
    for tick in from_tick..from_tick + 240 {
        tick_item_system(state, ducks, tick, 60, &mut harness.emitter(tick));
        if harness.has("ROCKET_HIT") || harness.has("ROCKET_BLOCKED") {
            return tick;
        }
    }
    panic!("rocket never resolved");
}

// --- tests/race-items.test.ts -------------------------------------------

#[test]
fn central_interaction_matrix_keeps_race_and_season_shields_distinct() {
    assert_eq!(
        item_interaction_matrix(IncomingRaceEffect::Rocket).bubble_shield,
        InteractionRule::Block
    );
    assert_eq!(
        item_interaction_matrix(IncomingRaceEffect::Rocket).feather,
        InteractionRule::No
    );
    assert_eq!(
        item_interaction_matrix(IncomingRaceEffect::Banana).bubble_shield,
        InteractionRule::Block
    );
    assert_eq!(
        item_interaction_matrix(IncomingRaceEffect::Banana).feather,
        InteractionRule::Dodge
    );
    assert_eq!(
        item_interaction_matrix(IncomingRaceEffect::DuckCollision).bubble_shield,
        InteractionRule::No
    );
}

#[test]
fn bubble_shield_blocks_one_rocket_is_consumed_and_a_later_rocket_hits() {
    let mut target = runtime(&[RaceItemId::BubbleShield]);
    let rocket = IncomingRaceEffect::Rocket;
    assert_eq!(
        resolve_incoming_race_effect(&mut target, rocket, 10, 60),
        DefenseOutcome::BlockedBubble
    );
    assert!(!target.bubble_available);
    assert_eq!(
        resolve_incoming_race_effect(&mut target, rocket, 20, 60),
        DefenseOutcome::Immune
    );
    assert_eq!(
        resolve_incoming_race_effect(&mut target, rocket, 41, 60),
        DefenseOutcome::Hit
    );
}

#[test]
fn feather_dodges_banana_but_never_blocks_rocket() {
    let mut target = runtime(&[RaceItemId::Feather]);
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::Banana, 1, 60),
        DefenseOutcome::DodgedFeather
    );
    assert!(!target.feather_available);
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::Rocket, 2, 60),
        DefenseOutcome::Hit
    );
}

#[test]
fn wild_feather_dodges_both_bananas_and_minor_hazards_but_not_rocket() {
    for incoming in [
        IncomingRaceEffect::Banana,
        IncomingRaceEffect::WildBanana,
        IncomingRaceEffect::MinorHazard,
    ] {
        let mut target = runtime(&[]);
        target.wild_feather_available = true;
        target.wild_feather_until_tick = 300;
        assert_eq!(
            resolve_incoming_race_effect(&mut target, incoming, 60, 60),
            DefenseOutcome::DodgedWildFeather
        );
        assert!(!target.wild_feather_available);
    }
    let mut target = runtime(&[]);
    target.wild_feather_available = true;
    target.wild_feather_until_tick = 300;
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::MiniRocket, 60, 60),
        DefenseOutcome::Hit
    );
    assert!(target.wild_feather_available);
}

#[test]
fn post_hit_immunity_and_two_second_rocket_protection() {
    let mut target = runtime(&[]);
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::Rocket, 10, 60),
        DefenseOutcome::Hit
    );
    assert_eq!(target.item_immunity_until_tick, 70);
    assert_eq!(target.rocket_protection_until_tick, 130);
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::Banana, 69, 60),
        DefenseOutcome::Immune
    );
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::Banana, 70, 60),
        DefenseOutcome::Hit
    );
}

#[test]
fn slow_effects_use_the_strongest_value_without_weaker_extension() {
    let mut rt = runtime(&[]);
    apply_item_slow(&mut rt, 0.6, 2.0, 10, 60);
    let first_expiry = rt.slow_until_tick;
    apply_item_slow(&mut rt, 0.7, 1.5, 20, 60);
    assert_eq!(rt.slow_multiplier, 0.6);
    assert_eq!(rt.slow_until_tick, first_expiry);
    rt.boost_multiplier = 1.5;
    rt.boost_until_tick = 100;
    let speed = item_speed_multiplier(&rt, 30);
    assert!(speed >= item_balance::MINIMUM_SPEED_MULTIPLIER);
    assert!(speed <= item_balance::MAXIMUM_SPEED_MULTIPLIER);
}

#[test]
fn rocket_applies_two_stage_stagger_then_recovery_slow() {
    let mut rt = runtime(&[RaceItemId::Feather]);
    apply_staged_slow(
        &mut rt,
        item_balance::rocket::STAGGER_MULTIPLIER,
        item_balance::rocket::STAGGER_DURATION_SECONDS,
        item_balance::rocket::RECOVERY_SLOW_MULTIPLIER,
        item_balance::rocket::RECOVERY_DURATION_SECONDS,
        100,
        60,
    );
    assert_eq!(rt.slow_multiplier, item_balance::rocket::STAGGER_MULTIPLIER);
    assert_eq!(rt.slow_until_tick, 157);
    assert_eq!(
        item_speed_multiplier(&rt, 110),
        item_balance::rocket::STAGGER_MULTIPLIER
    );
    assert_eq!(
        item_speed_multiplier(&rt, 157),
        item_balance::rocket::RECOVERY_SLOW_MULTIPLIER
    );
    assert_eq!(item_speed_multiplier(&rt, 196), 1.0);
}

/// Second half of "Banana stays in-lane and applies slipout and slow without
/// backward teleport": the banana is placed directly instead of by the AI.
#[test]
fn banana_applies_slipout_and_slow_without_backward_teleport() {
    let mut state = item_state("items", "11", &[("1", &[]), ("2", &["NITRO", "BANANA"])]);
    let mut ducks = vec![duck("1", 0.74, 2, 0.0), duck("2", 0.78, 1, 0.0)];
    let banana = BananaRuntime {
        id: 1,
        source_player_id: pid("2"),
        progress: 0.768,
        lateral_offset: 0.0,
        armed_at_tick: 12,
        expires_at_tick: 12 + 840,
        kind: ProjectileSource::Prep,
        hit_progress_radius: item_balance::banana::HIT_PROGRESS_RADIUS,
        hit_lateral_radius: item_balance::banana::HIT_LATERAL_RADIUS,
        progress_knockback: None,
        lateral_slip: item_balance::banana::LATERAL_SLIP,
    };
    state.bananas.push(banana.clone());
    state.next_object_id = 2;
    ducks[0].previous_progress = banana.progress - 0.02;
    ducks[0].progress = banana.progress + 0.002;
    ducks[0].lateral_offset = banana.lateral_offset;
    let progress_before_hit = ducks[0].progress;
    let mut harness = Harness::new();
    for tick in 12..=14 {
        tick_item_system(&mut state, &mut ducks, tick, 60, &mut harness.emitter(tick));
        if harness.has("BANANA_HIT") {
            break;
        }
    }
    assert!(harness.has("BANANA_HIT"));
    assert_eq!(ducks[0].progress, progress_before_hit);
    assert_ne!(ducks[0].lateral_velocity, 0.0);
    assert_eq!(
        state.runtime("1").slow_multiplier,
        item_balance::banana::STAGGER_MULTIPLIER
    );
    assert!(state.bananas.is_empty());
}

#[test]
fn expired_bubble_shield_does_not_block_subsequent_rockets() {
    let mut state = item_state(
        "items",
        "11",
        &[
            ("1", &["BUBBLE_SHIELD", "FEATHER"]),
            ("2", &["HOMING_ROCKET", "QUACK_HORN"]),
        ],
    );
    let mut ducks = vec![duck("1", 0.5, 1, 0.0), duck("2", 0.45, 2, 0.0)];
    let mut harness = Harness::new();
    let one = pid("1");
    let two = pid("2");

    let runtime1 = state.runtime_mut("1");
    try_activate_bubble_shield(
        runtime1,
        &one,
        100,
        60,
        &mut harness.emitter(100),
        AutoUseReason::Opportunity,
        None,
    );
    assert!(runtime1.bubble_available);
    assert_eq!(runtime1.bubble_until_tick, 370);

    tick_item_system(&mut state, &mut ducks, 400, 60, &mut harness.emitter(400));
    let runtime1 = state.runtime_mut("1");
    assert!(!runtime1.bubble_available);

    assert_eq!(
        resolve_incoming_race_effect(runtime1, IncomingRaceEffect::Rocket, 400, 60),
        DefenseOutcome::Hit
    );
    break_active_speed_boost(
        runtime1,
        400,
        60,
        &mut harness.emitter(400),
        &two,
        &one,
        BoostBreakSource::Rocket,
    );
    apply_item_slow(
        runtime1,
        item_balance::rocket::SLOW_MULTIPLIER,
        item_balance::rocket::SLOW_DURATION_SECONDS,
        400,
        60,
    );
    assert_eq!(
        runtime1.slow_multiplier,
        item_balance::rocket::SLOW_MULTIPLIER
    );
    assert_eq!(runtime1.slow_until_tick, 490);
    assert_eq!(
        item_speed_multiplier(runtime1, 400),
        item_balance::rocket::SLOW_MULTIPLIER
    );
    assert_eq!(
        resolve_incoming_race_effect(runtime1, IncomingRaceEffect::Rocket, 430, 60),
        DefenseOutcome::Immune
    );
    assert_eq!(
        resolve_incoming_race_effect(runtime1, IncomingRaceEffect::Rocket, 550, 60),
        DefenseOutcome::Hit
    );
    assert!(!item_active_effects(runtime1, 550).contains(&ActiveEffect::BubbleShield));
}

// --- tests/race-counter-loop.test.ts ------------------------------------

fn counter_loop(loadouts: &[(&str, &[&str])]) -> ItemRaceState {
    item_state("counter-loop", "22", loadouts)
}

#[test]
fn attack_beats_speed_rocket_on_nitro_holder_steals_and_drains() {
    let mut state = counter_loop(&[
        ("atk", &["HOMING_ROCKET", "FEATHER"]),
        ("spd", &["NITRO", "PADDLE_BURST"]),
    ]);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("spd", 0.44, 1, 0.0)];
    let mut harness = Harness::new();
    assert!(fire_prep_rocket(
        &mut state,
        &pid("atk"),
        ducks[0].progress,
        &pid("spd"),
        100,
        60,
        &mut harness.emitter(100),
        rocket_meta(),
    ));
    let hit_tick = fly_rocket(&mut state, &mut ducks, &mut harness, 101);

    let steal = harness.find("MOMENTUM_STOLEN").expect("attacker steals");
    assert_eq!(steal.source_player_id.as_ref().unwrap().as_str(), "atk");
    let EventKind::MomentumStolen(meta) = &steal.kind else {
        unreachable!()
    };
    assert_eq!(meta.stolen_item_id, RaceItemId::Nitro);
    assert_eq!(
        item_speed_multiplier(state.runtime("atk"), hit_tick + 1),
        item_balance::counter::MOMENTUM_STEAL_MULTIPLIER
    );

    let victim = state.runtime_mut("spd");
    assert!(victim.speed_drained);
    try_apply_prep_speed_boost(
        victim,
        &pid("spd"),
        RaceItemId::Nitro,
        1.25,
        item_balance::nitro::DURATION_SECONDS,
        400,
        60,
        &mut harness.emitter(400),
        SpeedStartExtras::default(),
    );
    assert_eq!(victim.boost_until_tick - 400, 54);
}

#[test]
fn attack_vs_non_speed_duck_gives_no_momentum() {
    let mut state = counter_loop(&[
        ("atk", &["HOMING_ROCKET", "FEATHER"]),
        ("def", &["BUBBLE_SHIELD", "DRAFT_FIN"]),
    ]);
    state.runtime_mut("def").mark_used(RaceItemId::BubbleShield);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("def", 0.44, 1, 0.0)];
    let mut harness = Harness::new();
    fire_prep_rocket(
        &mut state,
        &pid("atk"),
        0.40,
        &pid("def"),
        100,
        60,
        &mut harness.emitter(100),
        rocket_meta(),
    );
    fly_rocket(&mut state, &mut ducks, &mut harness, 101);
    assert!(harness.has("ROCKET_HIT"));
    assert!(!harness.has("MOMENTUM_STOLEN"));
}

#[test]
fn defense_beats_attack_packed_bubble_reflexes_into_guard_surge() {
    let mut state = counter_loop(&[
        ("atk", &["HOMING_ROCKET", "BANANA"]),
        ("def", &["BUBBLE_SHIELD", "FEATHER"]),
    ]);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("def", 0.44, 1, 0.0)];
    let mut harness = Harness::new();
    fire_prep_rocket(
        &mut state,
        &pid("atk"),
        0.40,
        &pid("def"),
        100,
        60,
        &mut harness.emitter(100),
        rocket_meta(),
    );
    let tick = fly_rocket(&mut state, &mut ducks, &mut harness, 101);
    assert!(harness.events().iter().any(|event| matches!(
        &event.kind,
        EventKind::BubbleShieldActivated(meta)
            if meta.reflex.is_some_and(|reflex| reflex.as_str() == "ROCKET")
    )));
    assert!(harness.has("ROCKET_BLOCKED"));
    assert!(!harness.has("PREDATOR_RUSH_STARTED"));
    let surge = harness.find("GUARD_SURGE").unwrap();
    let EventKind::GuardSurge(meta) = &surge.kind else {
        unreachable!()
    };
    assert_eq!(meta.defense_item_id.as_str(), "BUBBLE_SHIELD");
    assert_eq!(
        item_speed_multiplier(state.runtime("def"), tick + 1),
        item_balance::counter::guard_surge::BUBBLE_SHIELD_MULTIPLIER
    );
}

#[test]
fn a_silenced_duck_cannot_reflex_its_bubble() {
    let mut state = counter_loop(&[
        ("atk", &["HOMING_ROCKET", "BANANA"]),
        ("def", &["BUBBLE_SHIELD", "FEATHER"]),
    ]);
    state.runtime_mut("def").silenced_until_tick = 10_000;
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("def", 0.44, 1, 0.0)];
    let mut harness = Harness::new();
    fire_prep_rocket(
        &mut state,
        &pid("atk"),
        0.40,
        &pid("def"),
        100,
        60,
        &mut harness.emitter(100),
        rocket_meta(),
    );
    fly_rocket(&mut state, &mut ducks, &mut harness, 101);
    assert!(harness.has("ROCKET_HIT"));
    // MENACE attacker: a clean prep hit starts the predator rush.
    assert!(harness.has("PREDATOR_RUSH_STARTED"));
}

#[test]
fn shock_absorber_softens_a_rocket_but_a_packed_nitro_is_still_stolen() {
    let mut state = counter_loop(&[
        ("atk", &["HOMING_ROCKET", "BANANA"]),
        ("spd", &["NITRO", "SHOCK_ABSORBER"]),
    ]);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("spd", 0.44, 1, 0.0)];
    let mut harness = Harness::new();
    fire_prep_rocket(
        &mut state,
        &pid("atk"),
        0.40,
        &pid("spd"),
        100,
        60,
        &mut harness.emitter(100),
        rocket_meta(),
    );
    let tick = fly_rocket(&mut state, &mut ducks, &mut harness, 101);
    assert!(harness.has("SHOCK_ABSORBER_PROC"));
    assert!(harness.has("MOMENTUM_STOLEN"));
    assert!(!harness.has("PREDATOR_RUSH_STARTED"));
    let victim = state.runtime("spd");
    assert_eq!(
        victim.slow_multiplier,
        item_balance::shock_absorber::STAGGER_MULTIPLIER
    );
    let surge_tick = victim.queued_guard_surge_tick.unwrap();
    assert_eq!(Some(surge_tick), victim.recovery_slow_until_tick);
    for t in tick + 1..=u32::try_from(surge_tick).unwrap() {
        tick_item_system(&mut state, &mut ducks, t, 60, &mut harness.emitter(t));
    }
    assert!(harness.events().iter().any(|event| matches!(
        &event.kind,
        EventKind::GuardSurge(meta) if meta.defense_item_id.as_str() == "SHOCK_ABSORBER"
    )));
}

// --- tests/race-nitro-v2.test.ts ----------------------------------------

fn start_nitro(rt: &mut DuckItemRuntime, id: &str, harness: &mut Harness) {
    try_apply_prep_speed_boost(
        rt,
        &pid(id),
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
fn nitro_follows_the_three_phase_curve() {
    let mut harness = Harness::new();
    let mut rt = runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut rt, "duck-1", &mut harness);
    assert_eq!(rt.active_speed_item_id, Some(RaceItemId::Nitro));
    assert_eq!(rt.boost_multiplier, 1.25);
    assert_eq!(item_speed_multiplier(&rt, 100), 1.0);
    let mid_ignition = item_speed_multiplier(&rt, 105);
    assert!(mid_ignition > 1.05 && mid_ignition < 1.25);
    assert_eq!(item_speed_multiplier(&rt, 140), 1.25);
    let mid_decay = item_speed_multiplier(&rt, 195);
    assert!(mid_decay > 1.0 && mid_decay < 1.25);
    assert_eq!(item_speed_multiplier(&rt, 203), 1.0);
}

#[test]
fn nitro_does_not_cleanse_slow_effects() {
    let mut harness = Harness::new();
    let mut rt = runtime(&[RaceItemId::Nitro]);
    rt.slow_multiplier = 0.80;
    rt.slow_until_tick = 300;
    start_nitro(&mut rt, "duck-1", &mut harness);
    assert!((item_speed_multiplier(&rt, 140) - 1.0).abs() < 0.005);
    assert!((item_speed_multiplier(&rt, 205) - 0.80).abs() < 0.005);
}

#[test]
fn attack_interactions_full_and_partial_breaks() {
    let mut harness = Harness::new();
    let attacker = pid("attacker");

    // 1. Prep Rocket: 100% boost break.
    let mut victim = runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut victim, "duck-1", &mut harness);
    break_active_speed_boost(
        &mut victim,
        130,
        60,
        &mut harness.emitter(130),
        &attacker,
        &pid("duck-1"),
        BoostBreakSource::Rocket,
    );
    assert_eq!(victim.boost_multiplier, 1.0);
    assert_eq!(victim.active_speed_item_id, None);
    let EventKind::BoostBroken(meta) = &harness.find("BOOST_BROKEN").unwrap().kind else {
        unreachable!()
    };
    assert!(!meta.partial);

    // 2. Mini Rocket: 50% partial break.
    let mut victim = runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut victim, "duck-2", &mut harness);
    let before = victim.boost_until_tick - 130;
    break_active_speed_boost(
        &mut victim,
        130,
        60,
        &mut harness.emitter(130),
        &attacker,
        &pid("duck-2"),
        BoostBreakSource::MiniRocket,
    );
    // `Math.round(remainingBeforeMini * 0.5)` of the remaining 72 ticks.
    assert_eq!(victim.boost_until_tick - 130, before / 2);
    assert_eq!(victim.active_speed_item_id, Some(RaceItemId::Nitro));

    // 3. Prep Banana: full break; Wild Banana: 30% partial.
    let mut victim = runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut victim, "duck-3", &mut harness);
    assert_eq!(
        break_active_speed_boost(
            &mut victim,
            130,
            60,
            &mut harness.emitter(130),
            &attacker,
            &pid("duck-3"),
            BoostBreakSource::Banana,
        ),
        Some(RaceItemId::Nitro)
    );
    assert_eq!(victim.active_speed_item_id, None);
    let mut victim = runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut victim, "duck-5", &mut harness);
    let before = victim.boost_until_tick - 130;
    break_active_speed_boost(
        &mut victim,
        130,
        60,
        &mut harness.emitter(130),
        &attacker,
        &pid("duck-5"),
        BoostBreakSource::WildBanana,
    );
    // 72 remaining: Math.round(21.6) = 22 lost.
    assert_eq!(before, 72);
    assert_eq!(victim.boost_until_tick - 130, 72 - 22);
    assert_eq!(victim.active_speed_item_id, Some(RaceItemId::Nitro));

    // 4. Prep Horn breaks Nitro; Wild Horn cannot.
    let mut victim = runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut victim, "duck-4", &mut harness);
    assert_eq!(
        break_active_speed_boost(
            &mut victim,
            130,
            60,
            &mut harness.emitter(130),
            &attacker,
            &pid("duck-4"),
            BoostBreakSource::QuackHorn,
        ),
        Some(RaceItemId::Nitro)
    );
    let mut victim = runtime(&[RaceItemId::Nitro]);
    start_nitro(&mut victim, "duck-6", &mut harness);
    let until = victim.boost_until_tick;
    break_active_speed_boost(
        &mut victim,
        130,
        60,
        &mut harness.emitter(130),
        &attacker,
        &pid("duck-6"),
        BoostBreakSource::WildHorn,
    );
    assert_eq!(victim.boost_until_tick, until);
    assert_eq!(victim.active_speed_item_id, Some(RaceItemId::Nitro));
}

// --- extra white-box checks of M2 quirks ---------------------------------

#[test]
fn queued_speed_boost_priority_and_drain() {
    let mut harness = Harness::new();
    let mut rt = runtime(&[RaceItemId::DraftFin, RaceItemId::Nitro]);
    let id = pid("q");
    let paddle = try_apply_prep_speed_boost(
        &mut rt,
        &id,
        RaceItemId::PaddleBurst,
        1.15,
        1.8,
        10,
        60,
        &mut harness.emitter(10),
        SpeedStartExtras::default(),
    );
    assert_eq!(paddle, race_core::items::PrepSpeedOutcome::Applied);
    let draft = try_apply_prep_speed_boost(
        &mut rt,
        &id,
        RaceItemId::DraftFin,
        1.21,
        1.6,
        20,
        60,
        &mut harness.emitter(20),
        SpeedStartExtras::default(),
    );
    assert_eq!(draft, race_core::items::PrepSpeedOutcome::Queued);
    // Lower priority than the queued Draft Fin: ignored, but a pending
    // drain is still consumed.
    rt.speed_drained = true;
    let ignored = try_apply_prep_speed_boost(
        &mut rt,
        &id,
        RaceItemId::PaddleBurst,
        1.15,
        1.8,
        30,
        60,
        &mut harness.emitter(30),
        SpeedStartExtras::default(),
    );
    assert_eq!(ignored, race_core::items::PrepSpeedOutcome::Ignored);
    assert!(!rt.speed_drained);
    // A non-speed item returns 'applied' without touching anything.
    let before = rt.clone();
    assert_eq!(
        try_apply_prep_speed_boost(
            &mut rt,
            &id,
            RaceItemId::Banana,
            2.0,
            9.0,
            40,
            60,
            &mut harness.emitter(40),
            SpeedStartExtras::default(),
        ),
        race_core::items::PrepSpeedOutcome::Applied
    );
    assert_eq!(rt, before);
    let queued: Vec<_> = harness
        .events()
        .iter()
        .filter(|event| event.type_name() == "SPEED_BOOST_QUEUED")
        .collect();
    assert_eq!(queued.len(), 1);
    let _ = MOMENTUM_STEAL_DEFAULTS;
}

#[test]
fn rocket_fired_and_telemetry_credit() {
    let mut state = counter_loop(&[("atk", &["HOMING_ROCKET", "FEATHER"]), ("v", &[])]);
    let mut harness = Harness::new();
    assert!(fire_prep_rocket(
        &mut state,
        &pid("atk"),
        0.4,
        &pid("v"),
        5,
        60,
        &mut harness.emitter(5),
        rocket_meta(),
    ));
    // Second fire: already used.
    assert!(!fire_prep_rocket(
        &mut state,
        &pid("atk"),
        0.4,
        &pid("v"),
        6,
        60,
        &mut harness.emitter(6),
        rocket_meta(),
    ));
    assert_eq!(state.rockets.len(), 1);
    assert_eq!(state.rockets[0].id, 1);
    assert_eq!(state.rockets[0].expires_at_tick, 5 + 210);
    assert_eq!(state.next_object_id, 2);
    let fired = harness.find("ROCKET_FIRED").unwrap();
    let credit = item_activation_for_event(fired).unwrap();
    assert_eq!(credit.player_id.as_str(), "atk");
    assert_eq!(credit.item_id, RaceItemId::HomingRocket);
}

#[test]
fn rocket_expires_when_its_target_finishes() {
    let mut state = counter_loop(&[("atk", &["HOMING_ROCKET", "FEATHER"]), ("v", &[])]);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("v", 0.9, 1, 0.0)];
    let mut harness = Harness::new();
    fire_prep_rocket(
        &mut state,
        &pid("atk"),
        0.40,
        &pid("v"),
        100,
        60,
        &mut harness.emitter(100),
        rocket_meta(),
    );
    tick_item_system(&mut state, &mut ducks, 101, 60, &mut harness.emitter(101));
    assert_eq!(state.rockets.len(), 1);
    ducks[1].finished = true;
    tick_item_system(&mut state, &mut ducks, 102, 60, &mut harness.emitter(102));
    assert!(state.rockets.is_empty());
    let expired = harness.find("ROCKET_EXPIRED").unwrap();
    assert_eq!(expired.target_player_id.as_ref().unwrap().as_str(), "v");
}

// --- tests/race-aim.test.ts ---------------------------------------------

#[test]
fn banana_toss_is_limited_to_the_aim_reach() {
    assert_eq!(aimed_banana_lateral(0.1, None, 0.22), 0.1);
    assert_eq!(aimed_banana_lateral(0.1, Some(0.25), 0.22), 0.25);
    assert!((aimed_banana_lateral(0.1, Some(0.9), 0.22) - 0.32).abs() < 1e-9);
    assert_eq!(aimed_banana_lateral(0.9, Some(1.5), 0.22), 0.95);
    assert_eq!(aimed_banana_lateral(0.1, Some(f64::NAN), 0.22), 0.1);
}

#[test]
fn directional_horn_catches_one_side_plus_a_centre_band() {
    let horner = duck("h", 0.5, 2, 0.0);
    let ducks = vec![
        horner.clone(),
        duck("l", 0.5, 3, -0.3),
        duck("r", 0.51, 1, 0.3),
        duck("c", 0.49, 4, 0.05),
        duck("far", 0.6, 5, 0.3),
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
    assert_eq!(
        default_horn_side(&duck("h", 0.5, 2, 0.4), &ducks, 0.055, 0.55, 0.08, |_| {
            false
        }),
        HornSide::Left
    );
}
