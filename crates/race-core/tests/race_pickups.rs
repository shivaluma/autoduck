//! White-box port of `tests/race-pickups.test.ts` (Phase 2).
//!
//! Same test names in snake_case and the same assertions. Ducks, runtimes
//! and pickups are mutated through the public `Simulation` fields, as the TS
//! test mutates `state.ducks` / `state.itemState.byPlayer` directly.
//!
//! Emit callbacks: the TS tests pass their own `emit` (`(type) =>
//! events.push(type)` or a no-op), which never reaches `noteBrainEvent`.
//! Calls that don't involve the auto-use AI therefore emit into a scratch
//! [`Harness`] (own log, own brains). `tickAutoUseAI` reads the brains it
//! notes events into (`emit.brains` in Rust, `itemState.brains` in TS), so
//! those calls emit into the simulation's own log and brains; the only
//! difference from TS is that the brains also see the events of the call.
//!
//! Needs `ts-compat`: configs are resolved as the TS oracle's Zod parse
//! (`resolve_ts_compat`) and ids collate with the ICU model.

#![cfg(feature = "ts-compat")]
#![allow(clippy::float_cmp, clippy::too_many_lines)]

use std::collections::BTreeSet;

use race_core::auto_use::Brains;
use race_core::auto_use::arbiter::{AutoUseTickInput, tick_auto_use_ai};
use race_core::items::config::item_balance;
use race_core::items::{HeldWildItem, tick_item_system};
use race_core::pickups::config::{pickup_balance, position_category_weights};
use race_core::pickups::{
    WildUseInput, WildUseMode, WildUseResult, activate_wild_item, roll_wild_item,
    tick_pickup_system,
};
use race_core::sim::{
    Emitter, EngineMath, EventLog, SimOptions, Simulation, create_simulation, id_cmp,
    simulate_race, step_simulation,
};
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::{
    AutoUseReason, EventKind, RaceEvent, RecordedWildItemInput, WildItemAction, WildUseFailure,
};
use race_protocol::ids::{ClientActionId, PickupSpawnType, PlayerId, RaceId, WildItemId};
use race_protocol::snapshot::PickupState;

fn pid(id: &str) -> PlayerId {
    PlayerId::new(id).unwrap()
}

/// The default `pickupConfig` block of the TS `config()` helper.
const DEFAULT_PICKUP_CONFIG: &str = r#"{"enabled":true,"goldenBoxEnabled":true,"goldenBoxProbability":0.12,"hazardsEnabled":true,"positionAwareLoot":true,"spawnMultiplier":1,"regularPickupCap":2,"manualItemsEnabled":true,"autoItemsEnabled":true,"chaosBoxEnabled":false,"forceGoldenBox":false,"disabledItems":[],"idealManualPlayerIds":[]}"#;

/// `config(seed, overrides)`.
///
/// TS quirk kept: the helper builds `pickupConfig: {...defaults,
/// ...overrides.pickupConfig}` and then spreads `...overrides`, so when the
/// override has a `pickupConfig` it replaces the merged block wholesale and
/// Zod fills the rest. `pickup_override` is that raw object.
fn config_json(seed: &str, pickup_override: Option<&str>) -> String {
    let players: Vec<String> = (1..=8)
        .map(|index| format!(r#"{{"playerId":"duck-{index}","name":"Duck {index}"}}"#))
        .collect();
    format!(
        r#"{{"raceId":"pickup-{}","seed":"{seed}","players":[{}],"pickupConfig":{}}}"#,
        &seed[..8],
        players.join(","),
        pickup_override.unwrap_or(DEFAULT_PICKUP_CONFIG),
    )
}

fn resolve(json: &str) -> ResolvedRaceConfig {
    let input: RaceConfigInput = serde_json::from_str(json).unwrap();
    input.resolve_ts_compat().unwrap()
}

fn config(seed: &str, pickup_override: Option<&str>) -> ResolvedRaceConfig {
    resolve(&config_json(seed, pickup_override))
}

fn default_seed() -> String {
    "51".repeat(32)
}

fn sim(config: ResolvedRaceConfig) -> Simulation {
    create_simulation(config, SimOptions::default(), None)
}

fn race(
    config: ResolvedRaceConfig,
    manual_inputs: Vec<RecordedWildItemInput>,
) -> race_protocol::result::RaceResult {
    simulate_race(
        config,
        SimOptions {
            manual_inputs,
            ..SimOptions::default()
        },
        None,
    )
    .unwrap()
}

/// A TS-side `emit` callback: records events, never touches the
/// simulation's brains.
struct Harness {
    log: EventLog,
    brains: Brains,
    race_id: RaceId,
}

impl Harness {
    fn new(sim: &Simulation) -> Self {
        Self {
            log: EventLog::new(true),
            brains: Brains::new(),
            race_id: sim.config.race_id.clone(),
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

    fn count(&self, type_name: &str) -> usize {
        self.log
            .events
            .iter()
            .filter(|event| event.type_name() == type_name)
            .count()
    }

    fn has(&self, type_name: &str) -> bool {
        self.count(type_name) > 0
    }
}

/// `tickPickupSystem(state.config, state.track, state.pickupState,
/// state.itemState, state.ducks, tick, 60, emit)`.
fn tick_pickups(sim: &mut Simulation, harness: &mut Harness, tick: u32) {
    let Simulation {
        config,
        track,
        pickup_state,
        item_state,
        ducks,
        ..
    } = sim;
    tick_pickup_system(
        config,
        track,
        pickup_state,
        item_state,
        ducks,
        tick,
        60,
        &mut harness.emitter(tick),
    );
}

/// `tickPickupSystem` + `tickAutoUseAI` with the sim's own emitter (see the
/// module docs). With `pickups` false only `tickAutoUseAI` runs.
fn tick_with_auto_ai(sim: &mut Simulation, tick: u32, pickups: bool) {
    let wild_auto_use_enabled = sim.pickup_state.config.auto_items_enabled;
    let Simulation {
        config,
        track,
        pickup_state,
        item_state,
        ducks,
        log,
        brains,
        director,
        math,
        ..
    } = sim;
    let mut emit = Emitter {
        log,
        sink: None,
        brains,
        race_id: &config.race_id,
        tick,
        tick_rate: 60,
        math: *math,
    };
    if pickups {
        tick_pickup_system(
            config,
            track,
            pickup_state,
            item_state,
            ducks,
            tick,
            60,
            &mut emit,
        );
    }
    tick_auto_use_ai(&mut AutoUseTickInput {
        config,
        track,
        item_state,
        pickup_state,
        ducks,
        tick,
        tick_rate: 60,
        prep_auto_use_enabled: true,
        wild_auto_use_enabled,
        director,
        emit: &mut emit,
    });
}

fn hold(sim: &mut Simulation, player_id: &str, instance_id: &str, item_id: WildItemId) {
    sim.item_state
        .by_player
        .get_mut(player_id)
        .unwrap()
        .wild_item = Some(HeldWildItem {
        instance_id: instance_id.into(),
        item_id,
        acquired_at_tick: 1,
    });
}

fn held<'a>(sim: &'a Simulation, player_id: &str) -> Option<&'a HeldWildItem> {
    sim.item_state
        .by_player
        .get(player_id)
        .unwrap()
        .wild_item
        .as_ref()
}

/// `activateWildItem(state.itemState, state.ducks, {playerId,
/// wildItemInstanceId}, tick, 60, mode, emit)`. TS `'AUTO'` has no reason of
/// its own (the `executeWildAction` wrapper adds it); any reason works here.
fn activate(
    sim: &mut Simulation,
    harness: &mut Harness,
    player_id: &str,
    instance_id: &str,
    tick: u32,
    auto: bool,
) -> WildUseResult {
    let player = pid(player_id);
    let mode = if auto {
        WildUseMode::Auto(AutoUseReason::Opportunity)
    } else {
        WildUseMode::Manual
    };
    activate_wild_item(
        &mut sim.item_state,
        &mut sim.ducks,
        &WildUseInput {
            player_id: &player,
            wild_item_instance_id: instance_id,
            target_player_id: None,
            aim_lateral: None,
            horn_side: None,
        },
        tick,
        60,
        mode,
        &mut harness.emitter(tick),
    )
}

fn first_box(sim: &Simulation) -> usize {
    sim.pickup_state
        .pickups
        .iter()
        .position(|pickup| pickup.spawn_type == PickupSpawnType::QuackBox)
        .unwrap()
}

/// `recordedWildInputsFromEvents(events)` (`lib/racing/persistence.ts:42-58`).
fn recorded_wild_inputs_from_events(events: &[RaceEvent]) -> Vec<RecordedWildItemInput> {
    let mut inputs: Vec<RecordedWildItemInput> = events
        .iter()
        .filter_map(|event| match (&event.kind, &event.source_player_id) {
            (EventKind::WildItemManualInput(meta), Some(source)) => Some(RecordedWildItemInput {
                race_id: event.race_id.clone(),
                player_id: source.clone(),
                wild_item_instance_id: meta.instance_id.clone(),
                action: WildItemAction::Use,
                client_action_id: meta.client_action_id.clone(),
                authoritative_tick: event.tick,
            }),
            _ => None,
        })
        .collect();
    inputs.sort_by(|left, right| {
        left.authoritative_tick
            .cmp(&right.authoritative_tick)
            .then_with(|| {
                id_cmp(
                    left.client_action_id.as_str(),
                    right.client_action_id.as_str(),
                )
            })
    });
    inputs
}

#[test]
fn pickup_and_hazard_layout_is_seeded_unique_authored_and_bounded() {
    let first = sim(config(&default_seed(), None));
    let second = sim(config(&default_seed(), None));
    assert_eq!(first.pickup_state.pickups, second.pickup_state.pickups);
    let ids: BTreeSet<&str> = first
        .pickup_state
        .pickups
        .iter()
        .map(|pickup| pickup.id.as_str())
        .collect();
    assert_eq!(ids.len(), first.pickup_state.pickups.len());
    assert!(
        first
            .pickup_state
            .pickups
            .iter()
            .filter(|pickup| pickup.spawn_type == PickupSpawnType::QuackBox)
            .all(|pickup| pickup.progress >= 0.12
                && pickup.progress <= 0.9
                && pickup.lateral_offset.abs() <= 0.8)
    );
    assert!(first.pickup_state.hazards.len() <= 2);
    assert!(
        first
            .pickup_state
            .hazards
            .iter()
            .all(|hazard| hazard.lateral_offset.abs() + hazard.radius < 0.9)
    );
}

#[test]
fn golden_quack_box_is_deterministic_limited_to_one_and_ignores_wild_slot() {
    let mut state = sim(config(
        &"52".repeat(32),
        Some(r#"{"forceGoldenBox":true,"autoItemsEnabled":false}"#),
    ));
    let gold: Vec<usize> = state
        .pickup_state
        .pickups
        .iter()
        .enumerate()
        .filter(|(_, pickup)| pickup.spawn_type == PickupSpawnType::GoldenBox)
        .map(|(index, _)| index)
        .collect();
    assert_eq!(gold.len(), 1);
    let gold = gold[0];
    let (gold_progress, gold_lateral) = {
        let pickup = &state.pickup_state.pickups[gold];
        (pickup.progress, pickup.lateral_offset)
    };
    let player_id = state.ducks[0].player_id.clone();
    hold(
        &mut state,
        player_id.as_str(),
        "occupied",
        WildItemId::MiniRocket,
    );
    let duck = &mut state.ducks[0];
    duck.previous_progress = gold_progress - 0.001;
    duck.progress = gold_progress;
    duck.lateral_offset = gold_lateral;
    let mut harness = Harness::new(&state);
    tick_pickups(&mut state, &mut harness, 100);
    assert_eq!(
        state.pickup_state.pickups[gold]
            .collected_by_player_id
            .as_ref(),
        Some(&player_id)
    );
    assert_eq!(
        held(&state, player_id.as_str()).unwrap().instance_id,
        "occupied"
    );
    assert_eq!(harness.count("GOLDEN_BOX_COLLECTED"), 1);
}

#[test]
fn same_tick_collection_tie_resolves_by_distance_sub_tick_then_stable_player_id() {
    let mut state = sim(config(
        &"53".repeat(32),
        Some(r#"{"forceItem":"MINI_ROCKET","autoItemsEnabled":false,"hazardsEnabled":false}"#),
    ));
    let box_index = first_box(&state);
    let (box_progress, box_lateral) = {
        let pickup = &state.pickup_state.pickups[box_index];
        (pickup.progress, pickup.lateral_offset)
    };
    for duck in &mut state.ducks {
        duck.progress = 0.0;
        duck.previous_progress = 0.0;
        duck.lateral_offset = 0.9;
    }
    for duck in &mut state.ducks[..2] {
        duck.previous_progress = box_progress - 0.002;
        duck.progress = box_progress;
        duck.lateral_offset = box_lateral;
    }
    let mut harness = Harness::new(&state);
    tick_pickups(&mut state, &mut harness, 120);
    let mut pair = ["duck-1", "duck-2"];
    pair.sort();
    let collector = state.pickup_state.pickups[box_index]
        .collected_by_player_id
        .clone()
        .unwrap();
    assert_eq!(collector.as_str(), pair[0]);
    assert_eq!(
        state
            .item_state
            .by_player
            .get(collector.as_str())
            .unwrap()
            .regular_pickup_count,
        1
    );
}

#[test]
fn full_wild_slot_leaves_a_standard_box_active_for_another_duck() {
    let mut state = sim(config(
        &"54".repeat(32),
        Some(r#"{"forceItem":"MINI_ROCKET","autoItemsEnabled":false,"hazardsEnabled":false}"#),
    ));
    let box_index = first_box(&state);
    let (box_progress, box_lateral) = {
        let pickup = &state.pickup_state.pickups[box_index];
        (pickup.progress, pickup.lateral_offset)
    };
    let player_id = state.ducks[0].player_id.clone();
    hold(&mut state, player_id.as_str(), "full", WildItemId::Banana);
    let duck = &mut state.ducks[0];
    duck.previous_progress = box_progress - 0.001;
    duck.progress = box_progress;
    duck.lateral_offset = box_lateral;
    let mut harness = Harness::new(&state);
    tick_pickups(&mut state, &mut harness, 100);
    assert_eq!(
        state.pickup_state.pickups[box_index].state,
        PickupState::Active
    );
    assert_eq!(harness.count("PICKUP_SKIPPED_SLOT_FULL"), 1);
}

#[test]
fn loot_is_deterministic_respects_disabled_items_and_category_weights_normalize() {
    // `{ pickupConfig: { disabledItems: [...] } }` replaces the defaults (see
    // `config_json`).
    let race_config = config(
        &"55".repeat(32),
        Some(r#"{"disabledItems":["MINI_ROCKET","BANANA","QUACK_HORN"]}"#),
    );
    let state = sim(race_config.clone());
    let box_index = first_box(&state);
    let pickup_id = state.pickup_state.pickups[box_index].id.clone();
    let duck = &state.ducks[4];
    let first = roll_wild_item(
        &race_config,
        &state.pickup_state,
        &pickup_id,
        duck,
        &state.ducks,
    );
    let second = roll_wild_item(
        &race_config,
        &state.pickup_state,
        &pickup_id,
        duck,
        &state.ducks,
    );
    assert_eq!(first, second);
    assert!(
        ![
            WildItemId::MiniRocket,
            WildItemId::Banana,
            WildItemId::QuackHorn
        ]
        .contains(&first)
    );
    for weights in [
        position_category_weights::FRONT,
        position_category_weights::MIDDLE,
        position_category_weights::BACK,
    ] {
        assert_eq!(weights.iter().map(|(_, weight)| weight).sum::<u32>(), 100);
    }
}

#[test]
fn held_wild_items_validate_target_consume_exactly_once_and_keep_invalid_use() {
    let mut state = sim(config(
        &"56".repeat(32),
        Some(r#"{"enabled":false,"hazardsEnabled":false,"autoItemsEnabled":false}"#),
    ));
    let source = state.duck_index("duck-2").unwrap();
    let target = state.duck_index("duck-1").unwrap();
    state.ducks[source].progress = 0.4;
    state.ducks[target].progress = 0.48;
    hold(&mut state, "duck-2", "rocket-1", WildItemId::MiniRocket);
    let mut harness = Harness::new(&state);
    assert_eq!(
        activate(&mut state, &mut harness, "duck-2", "wrong", 10, false).reason,
        Some(WildUseFailure::ItemChanged)
    );
    assert_eq!(held(&state, "duck-2").unwrap().instance_id, "rocket-1");
    assert!(activate(&mut state, &mut harness, "duck-2", "rocket-1", 10, false).ok);
    assert!(held(&state, "duck-2").is_none());
    assert_eq!(state.item_state.rockets.len(), 1);
    assert_eq!(
        activate(&mut state, &mut harness, "duck-2", "rocket-1", 11, false).reason,
        Some(WildUseFailure::NoItem)
    );
}

#[test]
fn mini_rocket_skips_ducks_with_active_rocket_target_protection() {
    let mut state = sim(config(
        &"5a".repeat(32),
        Some(r#"{"enabled":false,"hazardsEnabled":false,"autoItemsEnabled":false}"#),
    ));
    state.ducks[2].progress = 0.4;
    state.ducks[1].progress = 0.45;
    state.ducks[0].progress = 0.5;
    let source = state.ducks[2].player_id.clone();
    let protected_duck = state.ducks[1].player_id.clone();
    let eligible_duck = state.ducks[0].player_id.clone();
    state
        .item_state
        .by_player
        .get_mut(protected_duck.as_str())
        .unwrap()
        .rocket_protection_until_tick = 120;
    hold(
        &mut state,
        source.as_str(),
        "protected-target",
        WildItemId::MiniRocket,
    );

    let mut harness = Harness::new(&state);
    let result = activate(
        &mut state,
        &mut harness,
        source.as_str(),
        "protected-target",
        60,
        false,
    );

    assert!(result.ok);
    assert_eq!(result.target_player_id, Some(eligible_duck));
}

#[test]
fn all_five_held_wild_item_handlers_execute_without_hard_control() {
    let held_items = [
        WildItemId::MiniBubble,
        WildItemId::MiniRocket,
        WildItemId::Banana,
        WildItemId::QuackHorn,
        WildItemId::Feather,
    ];
    for (index, item_id) in held_items.into_iter().enumerate() {
        let seed = format!("{:7<64}", format!("57{index}"));
        let mut state = sim(config(
            &seed,
            Some(r#"{"enabled":false,"hazardsEnabled":false,"autoItemsEnabled":false}"#),
        ));
        state.ducks[1].progress = 0.45;
        state.ducks[1].lateral_offset = 0.0;
        state.ducks[0].progress = if item_id == WildItemId::QuackHorn {
            0.455
        } else {
            0.5
        };
        state.ducks[0].lateral_offset = 0.05;
        let source = state.ducks[1].player_id.clone();
        let instance = format!("held-{}", item_id.as_str());
        hold(&mut state, source.as_str(), &instance, item_id);
        let mut harness = Harness::new(&state);
        let result = activate(
            &mut state,
            &mut harness,
            source.as_str(),
            &instance,
            30,
            true,
        );
        assert!(result.ok, "{item_id:?}");
        assert!(held(&state, source.as_str()).is_none());
    }
}

#[test]
fn wild_banana_drops_in_lane_behind_the_holder_so_the_chaser_can_hit_it() {
    let mut state = sim(config(
        &"57".repeat(32),
        Some(r#"{"enabled":false,"hazardsEnabled":false,"autoItemsEnabled":false}"#),
    ));
    state.ducks[0].progress = 0.5;
    state.ducks[0].lateral_offset = 0.0;
    state.ducks[1].progress = 0.497;
    state.ducks[1].lateral_offset = 0.0;
    state.ducks[1].previous_progress = 0.496;
    let source = state.ducks[0].player_id.clone();
    hold(
        &mut state,
        source.as_str(),
        "safe-banana",
        WildItemId::Banana,
    );
    let mut harness = Harness::new(&state);
    assert!(
        activate(
            &mut state,
            &mut harness,
            source.as_str(),
            "safe-banana",
            30,
            true
        )
        .ok
    );
    let banana = state.item_state.bananas[0].clone();
    assert_eq!(banana.lateral_offset, state.ducks[0].lateral_offset);
    assert!(state.ducks[0].progress - banana.progress >= 0.01);

    let chaser = &mut state.ducks[1];
    chaser.previous_progress = banana.progress - 0.02;
    chaser.progress = banana.progress + 0.002;
    chaser.lateral_offset = banana.lateral_offset;
    let before = chaser.progress;
    let armed = u32::try_from(banana.armed_at_tick).unwrap();
    for tick in armed..=armed + 2 {
        tick_item_system(
            &mut state.item_state,
            &mut state.ducks,
            tick,
            60,
            &mut harness.emitter(tick),
        );
    }
    assert!(harness.has("WILD_BANANA_HIT"));
    assert_eq!(state.ducks[1].progress, before);
    assert_ne!(state.ducks[1].lateral_velocity, 0.0);
    let victim = state
        .item_state
        .by_player
        .get(state.ducks[1].player_id.as_str())
        .unwrap();
    assert_eq!(
        victim.slow_multiplier,
        pickup_balance::banana::STAGGER_MULTIPLIER
    );
}

#[test]
fn manual_wild_input_is_persisted_in_event_stream_and_replay_deterministic() {
    let race_config = config(
        &"58".repeat(32),
        Some(
            r#"{"forceItem":"MINI_BUBBLE","autoItemsEnabled":false,"hazardsEnabled":false,"spawnMultiplier":3}"#,
        ),
    );
    let baseline = race(race_config.clone(), Vec::new());
    let grant = baseline
        .events
        .iter()
        .find(|event| event.type_name() == "WILD_ITEM_GRANTED")
        .expect("a WILD_ITEM_GRANTED event");
    let EventKind::WildItemGranted(grant_meta) = &grant.kind else {
        unreachable!()
    };
    let input = RecordedWildItemInput {
        race_id: race_config.race_id.clone(),
        player_id: grant.source_player_id.clone().unwrap(),
        wild_item_instance_id: grant_meta.instance_id.clone(),
        action: WildItemAction::Use,
        client_action_id: ClientActionId::new("manual-test-action").unwrap(),
        authoritative_tick: grant.tick + 1,
    };
    let first = race(race_config.clone(), vec![input.clone()]);
    let second = race(race_config.clone(), vec![input.clone()]);
    assert_eq!(second, first);
    let manual = first.events.iter().find_map(|event| match &event.kind {
        EventKind::WildItemManualInput(meta) => Some(meta),
        _ => None,
    });
    assert_eq!(manual.map(|meta| meta.applied), Some(true));

    let stale_input = RecordedWildItemInput {
        client_action_id: ClientActionId::new("manual-stale-action").unwrap(),
        authoritative_tick: input.authoritative_tick + 1,
        ..input.clone()
    };
    let with_rejected_input = race(
        race_config.clone(),
        vec![input.clone(), stale_input.clone()],
    );
    let rejected = with_rejected_input
        .events
        .iter()
        .find_map(|event| match &event.kind {
            EventKind::WildItemManualInput(meta)
                if meta.client_action_id == stale_input.client_action_id =>
            {
                Some(meta)
            }
            _ => None,
        });
    assert_eq!(rejected.map(|meta| meta.applied), Some(false));
    assert_eq!(
        recorded_wild_inputs_from_events(&with_rejected_input.events),
        vec![input.clone(), stale_input.clone()]
    );
    assert_eq!(
        race(race_config, vec![input, stale_input]),
        with_rejected_input
    );
}

#[test]
fn auto_use_burns_held_wild_items_before_the_finish_instead_of_carrying_them_unused() {
    let mut state = sim(config(
        &"59".repeat(32),
        Some(r#"{"enabled":false,"hazardsEnabled":false}"#),
    ));
    state.ducks[0].progress = 0.93;
    state.ducks[0].current_rank = 1;
    for duck in &mut state.ducks[1..] {
        duck.progress = 0.82;
        duck.current_rank = duck
            .player_id
            .as_str()
            .split('-')
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
    }
    state.ducks[7].progress = 0.79;
    state.ducks[7].current_rank = 8;
    let leader = state.ducks[0].player_id.clone();
    let backmarker = state.ducks[7].player_id.clone();

    hold(
        &mut state,
        leader.as_str(),
        "leader-rocket",
        WildItemId::MiniRocket,
    );
    hold(
        &mut state,
        backmarker.as_str(),
        "back-banana",
        WildItemId::Banana,
    );

    let cursor = state.events().len();
    for tick in 200..=260 {
        tick_with_auto_ai(&mut state, tick, true);
    }
    let events = &state.events()[cursor..];
    let forfeited_leader = events.iter().any(|event| match &event.kind {
        EventKind::WildItemAutoUsed(meta) => {
            event.source_player_id.as_ref() == Some(&leader) && meta.forfeited == Some(true)
        }
        _ => false,
    });

    assert!(forfeited_leader);

    assert!(held(&state, leader.as_str()).is_none());
    assert!(held(&state, backmarker.as_str()).is_none());
    assert!(
        events
            .iter()
            .any(|event| event.type_name() == "WILD_BANANA_DROPPED")
    );
}

#[test]
fn newly_collected_held_wild_items_auto_use_on_the_same_tick() {
    let mut state = sim(config(
        &"5b".repeat(32),
        Some(
            r#"{"forceItem":"FEATHER","autoItemsEnabled":true,"hazardsEnabled":false,"spawnMultiplier":2}"#,
        ),
    ));
    state.ducks[3].current_rank = 7;
    let (box_progress, box_lateral) = state
        .pickup_state
        .pickups
        .iter()
        .find(|pickup| pickup.spawn_type == PickupSpawnType::QuackBox && pickup.progress > 0.75)
        .map(|pickup| (pickup.progress, pickup.lateral_offset))
        .unwrap();
    let duck = &mut state.ducks[3];
    duck.previous_progress = box_progress - 0.002;
    duck.progress = box_progress;
    duck.lateral_offset = box_lateral;
    let player_id = duck.player_id.clone();

    let cursor = state.events().len();
    tick_with_auto_ai(&mut state, 150, true);
    for tick in 151..=220 {
        tick_with_auto_ai(&mut state, tick, false);
    }
    let events = &state.events()[cursor..];
    let has = |type_name: &str| events.iter().any(|event| event.type_name() == type_name);

    assert!(held(&state, player_id.as_str()).is_none());
    assert!(has("WILD_ITEM_GRANTED"));
    assert!(has("WILD_ITEM_AUTO_USED"));
    assert!(has("WILD_FEATHER_USED"));
}

#[test]
fn player_array_order_cannot_change_pickup_race_outcomes() {
    let players: Vec<String> = (1..=8)
        .map(|index| format!(r#"{{"playerId":"duck-{index}","name":"Duck {index}"}}"#))
        .collect();
    let reversed_players: Vec<String> = players.iter().rev().cloned().collect();
    let seed = "59".repeat(32);
    let ordered = config(&seed, None);
    // `{ ...ordered, players: reversed }`: the parsed config with only the
    // player order changed.
    let reversed =
        resolve(&config_json(&seed, None).replace(&players.join(","), &reversed_players.join(",")));
    assert_eq!(
        reversed
            .players
            .iter()
            .map(|player| player.player_id.clone())
            .collect::<Vec<_>>(),
        ordered
            .players
            .iter()
            .rev()
            .map(|player| player.player_id.clone())
            .collect::<Vec<_>>()
    );
    assert_eq!(race(reversed, Vec::new()), race(ordered, Vec::new()));
}

#[test]
fn fuzzed_pickup_races_finish_with_finite_state_no_duplicate_collection_and_bounded_speed_effects()
{
    for race_index in 1..=100_u32 {
        let mut state = sim(config(&format!("{race_index:064x}"), None));
        while !state.finished {
            step_simulation(&mut state, None);
            for duck in &state.ducks {
                assert!(
                    duck.progress.is_finite()
                        && duck.speed.is_finite()
                        && duck.lateral_offset.is_finite()
                );
                let runtime = state
                    .item_state
                    .by_player
                    .get(duck.player_id.as_str())
                    .unwrap();
                assert!(runtime.regular_pickup_count <= 3);
                assert!(
                    runtime.boost_multiplier <= item_balance::MAXIMUM_SPEED_MULTIPLIER
                        && runtime.slow_multiplier >= item_balance::MINIMUM_SPEED_MULTIPLIER
                );
            }
        }
        let collected: Vec<_> = state
            .pickup_state
            .pickups
            .iter()
            .filter(|pickup| pickup.state == PickupState::Collected)
            .collect();
        let ids: BTreeSet<&str> = collected.iter().map(|pickup| pickup.id.as_str()).collect();
        assert_eq!(ids.len(), collected.len());
        assert!(
            collected
                .iter()
                .filter(|pickup| pickup.spawn_type == PickupSpawnType::GoldenBox)
                .count()
                <= 1
        );
    }
}

#[test]
fn manual_held_items_obey_emp_silence_and_become_usable_at_its_expiry() {
    let mut state = sim(config(&default_seed(), None));
    hold(
        &mut state,
        "duck-1",
        "silenced-bubble",
        WildItemId::MiniBubble,
    );
    state
        .item_state
        .by_player
        .get_mut("duck-1")
        .unwrap()
        .silenced_until_tick = 130;
    let mut harness = Harness::new(&state);
    assert_eq!(
        activate(
            &mut state,
            &mut harness,
            "duck-1",
            "silenced-bubble",
            129,
            false
        ),
        WildUseResult::failed(WildUseFailure::Silenced)
    );
    assert!(held(&state, "duck-1").is_some());
    assert!(
        activate(
            &mut state,
            &mut harness,
            "duck-1",
            "silenced-bubble",
            130,
            false
        )
        .ok
    );
    assert!(held(&state, "duck-1").is_none());
}
