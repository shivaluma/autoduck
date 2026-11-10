//! Port of `tests/race-items.test.ts` (S3.15): same tests, same assertions.
//! TS scaffolding is mapped in `support/whitebox.rs`.

#![allow(clippy::float_cmp, clippy::too_many_lines)]

#[path = "support/whitebox.rs"]
mod whitebox;

use race_core::auto_use::{DirectorCache, new_brain};
use race_core::items::config::item_balance;
use race_core::items::interactions::{InteractionRule, item_interaction_matrix};
use race_core::items::{
    DefenseOutcome, DuckItemRuntime, IncomingRaceEffect, apply_item_slow, apply_staged_slow,
    break_active_speed_boost, create_item_race_state, item_active_effects, item_speed_multiplier,
    resolve_incoming_race_effect, tick_item_system, try_activate_bubble_shield,
};
use race_core::math::js_round;
use race_core::sim::{DuckPhysicsState, SimOptions, simulate_race};
use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{AutoUseReason, BoostBreakSource, RaceEvent, Temperament};
use race_protocol::ids::{RaceItemId, RaceSeed};
use race_protocol::snapshot::ActiveEffect;
use whitebox::{
    Harness, item_duck, literal_runtime, parse_config, pid, tick_items_with_auto_ai,
    tick_items_with_auto_ai_hooked,
};

/// `defense(items)`.
fn defense(items: &[RaceItemId]) -> DuckItemRuntime {
    let mut runtime = literal_runtime(items);
    runtime.bubble_available = items.contains(&RaceItemId::BubbleShield);
    runtime.bubble_until_tick = if runtime.bubble_available { 1000 } else { 0 };
    runtime.feather_available = items.contains(&RaceItemId::Feather);
    runtime.shock_absorber_available = items.contains(&RaceItemId::ShockAbsorber);
    runtime
}

/// `config(loadouts)`: players `1`, `2`, then any other loadout player.
fn config(loadouts: &[(&str, &[&str])]) -> ResolvedRaceConfig {
    let mut player_ids: Vec<&str> = vec!["1", "2"];
    for (id, _) in loadouts {
        if !player_ids.contains(id) {
            player_ids.push(id);
        }
    }
    let players: Vec<String> = player_ids
        .iter()
        .map(|id| format!(r#"{{"playerId":"{id}","name":"Duck {id}"}}"#))
        .collect();
    parse_config(&format!(
        r#"{{"raceId":"items","seed":"{}","players":[{}],"loadouts":[{}]}}"#,
        "11".repeat(32),
        players.join(","),
        whitebox::loadouts_json(loadouts),
    ))
}

/// `duck(playerId, progress, rank, lateralOffset = 0)`.
fn duck(id: &str, progress: f64, rank: u32, lateral_offset: f64) -> DuckPhysicsState {
    item_duck(id, progress, rank, lateral_offset, 0.0)
}

/// `duck.progress += delta` for a duck whose TS `previousProgress` is
/// undefined (read as `progress`).
fn advance(duck: &mut DuckPhysicsState, delta: f64) {
    duck.progress += delta;
    duck.previous_progress = duck.progress;
}

fn types_starting_with<'a>(harness: &'a Harness, prefix: &str) -> Vec<&'a str> {
    harness
        .events()
        .iter()
        .map(RaceEvent::type_name)
        .filter(|name| name.starts_with(prefix))
        .collect()
}

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
    let mut target = defense(&[RaceItemId::BubbleShield]);
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::Rocket, 10, 60),
        DefenseOutcome::BlockedBubble
    );
    assert!(!target.bubble_available);
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::Rocket, 20, 60),
        DefenseOutcome::Immune
    );
    assert_eq!(
        resolve_incoming_race_effect(&mut target, IncomingRaceEffect::Rocket, 41, 60),
        DefenseOutcome::Hit
    );
}

#[test]
fn feather_dodges_banana_but_never_blocks_rocket() {
    let mut target = defense(&[RaceItemId::Feather]);
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
fn wild_feather_dodges_both_banana_variants_and_minor_hazards_but_not_rocket() {
    for incoming in [
        IncomingRaceEffect::Banana,
        IncomingRaceEffect::WildBanana,
        IncomingRaceEffect::MinorHazard,
    ] {
        let mut target = defense(&[]);
        target.wild_feather_available = true;
        target.wild_feather_until_tick = 300;
        assert_eq!(
            resolve_incoming_race_effect(&mut target, incoming, 60, 60),
            DefenseOutcome::DodgedWildFeather
        );
        assert!(!target.wild_feather_available);
    }
    let mut rocket_target = defense(&[]);
    rocket_target.wild_feather_available = true;
    rocket_target.wild_feather_until_tick = 300;
    assert_eq!(
        resolve_incoming_race_effect(&mut rocket_target, IncomingRaceEffect::MiniRocket, 60, 60),
        DefenseOutcome::Hit
    );
    assert!(rocket_target.wild_feather_available);
}

#[test]
fn post_hit_immunity_prevents_chain_hits_and_rocket_target_protection_lasts_two_seconds() {
    let mut target = defense(&[]);
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
fn slow_effects_use_the_strongest_active_value_without_weaker_duration_extension() {
    let mut runtime = defense(&[]);
    apply_item_slow(&mut runtime, 0.6, 2.0, 10, 60);
    let first_expiry = runtime.slow_until_tick;
    apply_item_slow(&mut runtime, 0.7, 1.5, 20, 60);
    assert_eq!(runtime.slow_multiplier, 0.6);
    assert_eq!(runtime.slow_until_tick, first_expiry);
    runtime.boost_multiplier = 1.5;
    runtime.boost_until_tick = 100;
    assert!(item_speed_multiplier(&runtime, 30) >= item_balance::MINIMUM_SPEED_MULTIPLIER);
    assert!(item_speed_multiplier(&runtime, 30) <= item_balance::MAXIMUM_SPEED_MULTIPLIER);
}

#[test]
fn nitro_activates_deterministically_and_ends_after_configured_duration() {
    let race_config = config(&[("2", &["NITRO", "BANANA"])]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.95, 1, 0.0), duck("2", 0.93, 2, 0.0)];
    let mut nitro_tick = 0;
    let mut tick = 1;
    while tick <= 200 && nitro_tick == 0 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
        if let Some(event) = harness.find("NITRO_STARTED") {
            nitro_tick = event.tick;
        }
        tick += 1;
    }
    let duration_ticks = js_round(item_balance::nitro::DURATION_SECONDS * 60.0) as u32;
    assert!(nitro_tick > 0);
    {
        let runtime = state.runtime("2");
        assert_eq!(
            runtime.boost_until_tick,
            i64::from(nitro_tick + duration_ticks)
        );
        assert_eq!(
            runtime.boost_multiplier,
            item_balance::nitro::SPEED_MULTIPLIER
        );
        assert_eq!(item_speed_multiplier(runtime, nitro_tick), 1.0);
        assert_eq!(
            item_speed_multiplier(runtime, nitro_tick + 30),
            item_balance::nitro::SPEED_MULTIPLIER
        );
    }

    tick_items_with_auto_ai(
        &race_config,
        &mut state,
        &mut ducks,
        nitro_tick + duration_ticks,
        &mut harness,
        &mut director,
    );
    assert_eq!(
        item_speed_multiplier(state.runtime("2"), nitro_tick + duration_ticks),
        1.0
    );
    assert_eq!(
        types_starting_with(&harness, "NITRO"),
        ["NITRO_STARTED", "NITRO_ENDED"]
    );
}

#[test]
fn rocket_targets_valuable_eligible_duck_ahead_and_expires_when_it_cannot_hit() {
    let race_config = config(&[("2", &["HOMING_ROCKET", "FEATHER"])]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.44, 1, 0.0), duck("2", 0.4, 2, 0.0)];
    let mut rocket_tick = 0;
    for tick in 1..=60 {
        // The TS `emit` sets `ducks[0].finished = true` on the first
        // ROCKET_FIRED; here that lands at the end of the emitting phase.
        tick_items_with_auto_ai_hooked(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
            &mut |events, ducks| {
                if rocket_tick == 0
                    && events
                        .iter()
                        .any(|event| event.type_name() == "ROCKET_FIRED")
                {
                    rocket_tick = tick;
                    ducks[0].finished = true;
                }
            },
        );
        if rocket_tick > 0 {
            break;
        }
    }
    let fired = harness.find("ROCKET_FIRED");
    assert!(fired.is_some());
    assert_eq!(
        fired
            .unwrap()
            .target_player_id
            .as_ref()
            .map(|id| id.as_str()),
        Some("1")
    );
    for tick in rocket_tick + 1..=rocket_tick + 3 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
    }
    assert!(harness.has("ROCKET_EXPIRED"));
}

#[test]
fn banana_expires_horn_pushes_only_laterally_and_neither_hard_stuns() {
    let race_config = config(&[("1", &["NITRO", "BANANA"]), ("3", &["NITRO", "FEATHER"])]);
    let mut banana_state = create_item_race_state(&race_config);
    let mut banana_events = Harness::for_config(&race_config);
    let mut banana_director = DirectorCache::default();
    let mut banana_ducks = vec![duck("1", 0.78, 1, 0.0), duck("3", 0.76, 2, 0.0)];
    for tick in 1..=80 {
        tick_items_with_auto_ai(
            &race_config,
            &mut banana_state,
            &mut banana_ducks,
            tick,
            &mut banana_events,
            &mut banana_director,
        );
        if banana_events.has("BANANA_DROPPED") {
            break;
        }
    }
    assert!(banana_events.has("BANANA_DROPPED"));
    let banana = banana_state.bananas.first().cloned();
    assert!(banana.is_some());
    let banana = banana.unwrap();
    banana_ducks[0].progress = 0.9;
    banana_ducks[0].previous_progress = 0.9;
    banana_ducks[1].progress = 0.5;
    banana_ducks[1].previous_progress = 0.5;
    banana_ducks[1].lateral_offset = 0.8;
    tick_items_with_auto_ai(
        &race_config,
        &mut banana_state,
        &mut banana_ducks,
        u32::try_from(banana.expires_at_tick).unwrap(),
        &mut banana_events,
        &mut banana_director,
    );
    assert!(banana_events.has("BANANA_EXPIRED"));

    let horn_config = config(&[
        ("1", &["NITRO", "SHOCK_ABSORBER"]),
        ("2", &["BUBBLE_SHIELD", "QUACK_HORN"]),
        ("3", &["NITRO", "PADDLE_BURST"]),
    ]);
    let mut horn_state = create_item_race_state(&horn_config);
    let mut horn_events = Harness::for_config(&horn_config);
    let mut horn_director = DirectorCache::default();
    let mut horn_ducks = vec![
        duck("1", 0.7, 1, 0.0),
        duck("2", 0.695, 2, 0.3),
        duck("3", 0.698, 3, -0.05),
    ];
    for tick in 1..=80 {
        tick_items_with_auto_ai(
            &horn_config,
            &mut horn_state,
            &mut horn_ducks,
            tick,
            &mut horn_events,
            &mut horn_director,
        );
    }
    assert!(horn_events.has("HORN_USED"));
    assert_ne!(horn_ducks[0].lateral_velocity, 0.0);
    assert!(horn_ducks[2].lateral_offset != -0.05 || horn_ducks[2].lateral_velocity != 0.0);
    assert!(!item_active_effects(horn_state.runtime("3"), 1).contains(&ActiveEffect::Slowed));
}

#[test]
fn rocket_hits_the_duck_ahead_and_applies_the_configured_slow() {
    let race_config = config(&[("2", &["HOMING_ROCKET", "FEATHER"])]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.48, 1, 0.0), duck("2", 0.4, 2, 0.0)];
    for tick in 1..=200 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
        if harness.has("ROCKET_HIT") {
            break;
        }
        advance(&mut ducks[0], 0.0003);
        advance(&mut ducks[1], 0.0003);
    }
    assert!(harness.has("ROCKET_FIRED"));
    assert!(harness.has("ROCKET_HIT"));
    let fired_at = harness.find("ROCKET_FIRED").unwrap().tick;
    let target = state.runtime("1");
    assert_eq!(
        target.slow_multiplier,
        item_balance::rocket::STAGGER_MULTIPLIER
    );
    assert!(target.slow_until_tick > i64::from(fired_at));
    assert_eq!(
        item_speed_multiplier(target, fired_at + 3),
        item_balance::rocket::STAGGER_MULTIPLIER
    );
}

#[test]
fn rocket_applies_two_stage_stagger_then_recovery_slow() {
    let mut runtime = defense(&[RaceItemId::Feather]);

    // Hit at tick 100 with tickRate 60
    apply_staged_slow(
        &mut runtime,
        item_balance::rocket::STAGGER_MULTIPLIER,
        item_balance::rocket::STAGGER_DURATION_SECONDS,
        item_balance::rocket::RECOVERY_SLOW_MULTIPLIER,
        item_balance::rocket::RECOVERY_DURATION_SECONDS,
        100,
        60,
    );

    // Stage 1: Stagger (0.95s = 57 ticks, from tick 100 to 157)
    assert_eq!(
        runtime.slow_multiplier,
        item_balance::rocket::STAGGER_MULTIPLIER
    );
    assert_eq!(runtime.slow_until_tick, 157);
    assert_eq!(
        item_speed_multiplier(&runtime, 110),
        item_balance::rocket::STAGGER_MULTIPLIER
    );

    // Stage 2: Recovery slow (0.65s = 39 ticks, from tick 157 to 196)
    assert_eq!(
        item_speed_multiplier(&runtime, 157),
        item_balance::rocket::RECOVERY_SLOW_MULTIPLIER
    );

    // Stage 3: Fully recovered at tick 196
    assert_eq!(item_speed_multiplier(&runtime, 196), 1.0);
}

#[test]
fn rocket_breaks_active_speed_boost_before_applying_slow() {
    let race_config = config(&[
        ("1", &["NITRO", "FEATHER"]),
        ("2", &["HOMING_ROCKET", "BANANA"]),
    ]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.48, 1, 0.0), duck("2", 0.4, 2, 0.0)];
    {
        let target = state.runtime_mut("1");
        target.boost_multiplier = item_balance::nitro::SPEED_MULTIPLIER;
        target.boost_until_tick = 500;
        target.active_speed_item_id = Some(RaceItemId::Nitro);
    }
    for tick in 1..=260 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
        advance(&mut ducks[0], 0.0003);
        advance(&mut ducks[1], 0.0003);
        if harness.has("ROCKET_HIT") {
            break;
        }
    }
    assert!(harness.has("BOOST_BROKEN"));
    let target = state.runtime("1");
    assert_eq!(target.active_speed_item_id, None);
    assert_eq!(
        target.slow_multiplier,
        item_balance::rocket::STAGGER_MULTIPLIER
    );
}

#[test]
fn shock_absorber_mitigates_the_first_rocket_hit_with_lighter_stagger_and_recovery() {
    let race_config = config(&[
        ("1", &["SHOCK_ABSORBER", "FEATHER"]),
        ("2", &["HOMING_ROCKET", "BANANA"]),
    ]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    // Pin the attacker's temperament: a patient seeded brain would (correctly) hold the rocket here.
    harness
        .brains
        .insert(pid("2"), new_brain(pid("2"), Temperament::Aggressive));
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.48, 1, 0.0), duck("2", 0.4, 2, 0.0)];
    for tick in 1..=260 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
        advance(&mut ducks[0], 0.0003);
        advance(&mut ducks[1], 0.0003);
        if harness.has("ROCKET_HIT") {
            break;
        }
    }
    let target = state.runtime("1");
    assert!(harness.has("SHOCK_ABSORBER_PROC"));
    assert!(!target.shock_absorber_available);
    assert_eq!(
        target.slow_multiplier,
        item_balance::shock_absorber::STAGGER_MULTIPLIER
    );
}

#[test]
fn rocket_applies_spinout_stall_and_triggers_menace_predator_rush() {
    let race_config = config(&[
        ("1", &["FEATHER", "DRAFT_FIN"]),
        ("2", &["HOMING_ROCKET", "BANANA"]), // MENACE combo
    ]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.48, 1, 0.0), duck("2", 0.40, 2, 0.0)];
    ducks[0].previous_progress = 0.48;
    let initial_target_progress = ducks[0].progress;
    for tick in 1..=260 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
        // ducks[0].previousProgress was set explicitly and stays 0.48.
        ducks[0].progress += 0.0001;
        advance(&mut ducks[1], 0.0001);
        if harness.has("ROCKET_HIT") {
            break;
        }
    }
    assert!(harness.has("ROCKET_HIT"));
    // Target does not teleport backward, progress moves continuously
    assert!(ducks[0].progress >= initial_target_progress);
    // Target speed is heavily stalled
    assert_eq!(
        state.runtime("1").slow_multiplier,
        item_balance::rocket::STAGGER_MULTIPLIER
    );
    // Shooter with MENACE should trigger PREDATOR_RUSH_STARTED
    assert!(harness.has("PREDATOR_RUSH_STARTED"));
    assert_eq!(
        state.runtime("2").boost_multiplier,
        item_balance::menace::PREDATOR_RUSH_MULTIPLIER
    );
}

#[test]
fn banana_stays_in_lane_and_applies_slipout_and_slow_without_backward_teleport() {
    let race_config = config(&[("2", &["NITRO", "BANANA"])]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.74, 2, 0.0), duck("2", 0.78, 1, 0.0)];
    ducks[0].previous_progress = 0.74;
    for tick in 1..=80 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
        if harness.has("BANANA_DROPPED") {
            break;
        }
    }
    assert!(harness.has("BANANA_DROPPED"));
    let banana = state.bananas[0].clone();
    assert_eq!(banana.lateral_offset, 0.0);
    assert!(
        ducks[1].progress - banana.progress >= item_balance::banana::DROP_BEHIND_PROGRESS - 0.001
    );

    ducks[0].previous_progress = banana.progress - 0.02;
    ducks[0].progress = banana.progress + 0.002;
    ducks[0].lateral_offset = banana.lateral_offset;
    let progress_before_hit = ducks[0].progress;
    let armed = u32::try_from(banana.armed_at_tick).unwrap();
    for tick in armed..=armed + 2 {
        tick_item_system(&mut state, &mut ducks, tick, 60, &mut harness.emitter(tick));
        if harness.has("BANANA_HIT") {
            break;
        }
    }
    assert!(harness.has("BANANA_HIT"));
    // No backward teleport: progress is not knocked back
    assert_eq!(ducks[0].progress, progress_before_hit);
    // Lateral slipout is applied
    assert_ne!(ducks[0].lateral_velocity, 0.0);
    // Staged slow is applied
    assert_eq!(
        state.runtime("1").slow_multiplier,
        item_balance::banana::STAGGER_MULTIPLIER
    );
}

#[test]
fn prep_items_auto_burn_near_the_finish_line_instead_of_staying_unused() {
    let race_config = config(&[("2", &["NITRO", "BANANA"])]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.95, 1, 0.0), duck("2", 0.93, 2, 0.0)];
    for tick in 1..=80 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
    }
    assert!(harness.has("NITRO_STARTED"));
    assert!(harness.has("BANANA_DROPPED"));
    assert!(state.runtime("2").used(RaceItemId::Nitro));
    assert!(state.runtime("2").used(RaceItemId::Banana));
}

#[test]
fn bubble_shield_activates_reactively_when_attacked_blocks_and_expires_if_untriggered() {
    let race_config = config(&[
        ("1", &["BUBBLE_SHIELD", "SHOCK_ABSORBER"]),
        ("2", &["HOMING_ROCKET", "BANANA"]),
    ]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut director = DirectorCache::default();
    let mut ducks = vec![duck("1", 0.45, 1, 0.0), duck("2", 0.30, 2, 0.0)];

    // Run simulation until rocket is fired and bubble shield reactively triggers
    for tick in 1..=250 {
        tick_items_with_auto_ai(
            &race_config,
            &mut state,
            &mut ducks,
            tick,
            &mut harness,
            &mut director,
        );
        advance(&mut ducks[0], 0.0002);
        advance(&mut ducks[1], 0.0002);
    }

    assert!(harness.has("ROCKET_FIRED"));
    assert!(harness.has("BUBBLE_SHIELD_ACTIVATED"));
    assert!(harness.has("ROCKET_BLOCKED"));
    assert!(harness.has("BUBBLE_POPPED"));
    assert!(state.runtime("1").used(RaceItemId::BubbleShield));
}

#[test]
fn expired_bubble_shield_does_not_block_subsequent_rockets_slow_is_properly_applied() {
    let race_config = config(&[
        ("1", &["BUBBLE_SHIELD", "FEATHER"]),
        ("2", &["HOMING_ROCKET", "QUACK_HORN"]),
    ]);
    let mut state = create_item_race_state(&race_config);
    let mut harness = Harness::for_config(&race_config);
    let mut ducks = vec![duck("1", 0.5, 1, 0.0), duck("2", 0.45, 2, 0.0)];
    let one = pid("1");
    let two = pid("2");

    // 1. Activate Bubble Shield manually at tick 100
    {
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
        assert_eq!(runtime1.bubble_until_tick, 100 + 270); // 370
    }

    // 2. Advance to tick 400 (Bubble Shield is expired in tickItemSystem)
    tick_item_system(&mut state, &mut ducks, 400, 60, &mut harness.emitter(400));
    let runtime1 = state.runtime_mut("1");
    assert!(!runtime1.bubble_available);

    // 3. Rocket hits at tick 400
    let outcome1 = resolve_incoming_race_effect(runtime1, IncomingRaceEffect::Rocket, 400, 60);
    assert_eq!(
        outcome1,
        DefenseOutcome::Hit,
        "Expired bubble shield must NOT block rocket"
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
    assert_eq!(
        runtime1.slow_until_tick,
        400 + js_round(item_balance::rocket::SLOW_DURATION_SECONDS * 60.0) as i64
    );
    assert_eq!(
        item_speed_multiplier(runtime1, 400),
        item_balance::rocket::SLOW_MULTIPLIER
    );

    // 4. Second Rocket arrives at tick 430 (during post-hit immunity)
    let outcome2 = resolve_incoming_race_effect(runtime1, IncomingRaceEffect::Rocket, 430, 60);
    assert_eq!(
        outcome2,
        DefenseOutcome::Immune,
        "Second rocket during post-hit immunity returns IMMUNE"
    );

    // 5. Third Rocket arrives at tick 550 (after slow and immunity expired)
    let outcome3 = resolve_incoming_race_effect(runtime1, IncomingRaceEffect::Rocket, 550, 60);
    assert_eq!(
        outcome3,
        DefenseOutcome::Hit,
        "Third rocket after immunity properly hits"
    );
    apply_item_slow(
        runtime1,
        item_balance::rocket::SLOW_MULTIPLIER,
        item_balance::rocket::SLOW_DURATION_SECONDS,
        550,
        60,
    );
    assert_eq!(
        item_speed_multiplier(runtime1, 550),
        item_balance::rocket::SLOW_MULTIPLIER
    );
}

fn eight_players() -> String {
    (1..=8)
        .map(|index| format!(r#"{{"playerId":"{index}","name":"Duck {index}"}}"#))
        .collect::<Vec<_>>()
        .join(",")
}

#[test]
fn full_item_race_finishes_in_target_window_with_readable_bounded_event_volume() {
    let presets: [&[&str]; 3] = [
        &["NITRO", "DRAFT_FIN"],
        &["BUBBLE_SHIELD", "FEATHER"],
        &["HOMING_ROCKET", "BANANA"],
    ];
    let names: Vec<String> = (1..=8).map(|index| index.to_string()).collect();
    let loadouts: Vec<(&str, &[&str])> = names
        .iter()
        .enumerate()
        .map(|(index, id)| (id.as_str(), presets[index % presets.len()]))
        .collect();
    let race_config = parse_config(&format!(
        r#"{{"raceId":"full-items","seed":"{}","players":[{}],"loadouts":[{}]}}"#,
        "ab".repeat(32),
        eight_players(),
        whitebox::loadouts_json(&loadouts),
    ));
    let result = simulate_race(race_config.clone(), SimOptions::default(), None).unwrap();
    let has = |name: &str| result.events.iter().any(|event| event.type_name() == name);
    assert!(result.duration_ms >= 45_000.0 && result.duration_ms <= 75_000.0);
    assert!(has("NITRO_STARTED"));
    assert!(has("ROCKET_FIRED"));
    assert!(has("BANANA_DROPPED"));
    assert!(
        result.events.len() < 1200,
        "event count {}",
        result.events.len()
    );
    // Ducks ahead may break a chaser's slipstream line, so check Draft/Paddle over a few seeds.
    let speed_minor_fired = ["ab", "cd", "ef"].iter().any(|byte| {
        let mut seeded = race_config.clone();
        seeded.seed = RaceSeed::new(byte.repeat(32)).unwrap();
        simulate_race(seeded, SimOptions::default(), None)
            .unwrap()
            .events
            .iter()
            .any(|event| {
                event.type_name() == "DRAFT_FIN_STARTED"
                    || event.type_name() == "PADDLE_BURST_STARTED"
            })
    });
    assert!(speed_minor_fired);
}

#[test]
fn headless_telemetry_observes_item_events_without_retaining_the_official_event_stream() {
    let loadouts: Vec<(String, &[&str])> = (0..8)
        .map(|index| {
            let items: &[&str] = if index % 2 == 0 {
                &["NITRO", "DRAFT_FIN"]
            } else {
                &["HOMING_ROCKET", "SHOCK_ABSORBER"]
            };
            ((index + 1).to_string(), items)
        })
        .collect();
    let loadouts: Vec<(&str, &[&str])> = loadouts
        .iter()
        .map(|(id, items)| (id.as_str(), *items))
        .collect();
    let race_config = parse_config(&format!(
        r#"{{"raceId":"telemetry-items","seed":"{}","players":[{}],"loadouts":[{}],"itemTuning":{{"nitroSpeedMultiplier":1.1,"rocketSlowMultiplier":0.9,"bananaKnockbackMultiplier":1.1}}}}"#,
        "bc".repeat(32),
        eight_players(),
        whitebox::loadouts_json(&loadouts),
    ));
    let mut observed: Vec<&'static str> = Vec::new();
    let mut on_event = |event: &RaceEvent| observed.push(event.type_name());
    let result = simulate_race(
        race_config.clone(),
        SimOptions {
            record_events: false,
            ..SimOptions::default()
        },
        Some(&mut on_event),
    )
    .unwrap();

    assert!(result.events.is_empty());
    assert!(observed.contains(&"NITRO_STARTED"));
    assert!(observed.contains(&"ROCKET_FIRED"));
    assert!(observed.contains(&"RACE_FINISHED"));
    assert_eq!(
        create_item_race_state(&race_config)
            .tuning
            .nitro_speed_multiplier,
        1.1
    );
}
