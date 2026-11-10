//! White-box port of `tests/race-auto-use-guards.test.ts` (S3.15): the speed
//! boost queue, `BOOST_BROKEN` sources, the offensive cooldown, Rocket target
//! resolution and the objective's danger/rank scoring. Same test names (in
//! `snake_case`) and assertions.
//!
//! Port notes:
//! - The TS `RaceConfig` literals are never Zod-parsed and their version
//!   strings are not read by `createItemRaceState` /
//!   `buildRaceObjectiveContext`, so the Rust configs omit them and go
//!   through `resolve_ts_compat`.
//! - `itemState.brains` (seeded by `createItemRaceState`) is
//!   `create_duck_brains(config)`; the `readRace` memo keyed on the `ducks`
//!   array is one `DirectorCache` per fixture; `{ ...ctx, tick }` keeps the
//!   same objective (its Chaos memos are plain fields).
//! - The TS test `emit` records events without touching brains; the
//!   harness's brain map is empty, so `noteBrainEvent` is a no-op too.
//!
//! Needs `ts-compat` (the oracle's config resolution and id collation).
#![cfg(feature = "ts-compat")]
#![allow(clippy::float_cmp)]

use race_core::auto_use::config::auto_use_config;
use race_core::auto_use::evaluate::{EvalCtx, is_offensive_auto_item, offensive_cooldown_blocks};
use race_core::auto_use::{
    Brains, CandidateSource, DirectorCache, RaceObjectiveContext, build_race_objective_context,
    create_duck_brains,
};
use race_core::items::{
    DuckItemRuntime, ItemRaceState, PrepSpeedOutcome, SpeedStartExtras, break_active_speed_boost,
    create_item_race_state, try_apply_prep_speed_boost,
};
use race_core::math::js_round;
use race_core::sim::{DuckPhysicsState, Emitter, EngineMath, EventLog};
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::{BoostBreakSource, EventKind, RaceEvent};
use race_protocol::ids::{ItemKey, PlayerId, RaceId, RaceItemId};

fn pid(id: &str) -> PlayerId {
    PlayerId::new(id).unwrap()
}

/// A `RaceConfig` literal: `{ raceId, seed: <byte>.repeat(32), players,
/// loadouts: [], chaosConfig? }`.
fn race_config(
    race_id: &str,
    seed_byte: &str,
    players: &[(&str, &str)],
    chaos: Option<&str>,
) -> ResolvedRaceConfig {
    let players: Vec<String> = players
        .iter()
        .map(|(id, name)| format!(r#"{{"playerId":"{id}","name":"{name}"}}"#))
        .collect();
    let chaos = chaos.map_or(String::new(), |chaos| format!(r#","chaosConfig":{chaos}"#));
    let json = format!(
        r#"{{"raceId":"{race_id}","seed":"{}","tickRate":60,"players":[{}],"loadouts":[]{chaos}}}"#,
        seed_byte.repeat(32),
        players.join(",")
    );
    let input: RaceConfigInput = serde_json::from_str(&json).unwrap();
    input.resolve_ts_compat().unwrap()
}

/// An `ItemDuckState` literal (no `previousProgress`: `bananaTouches`
/// reads it as `progress`).
fn duck(id: &str, progress: f64, rank: u32, finished: bool) -> DuckPhysicsState {
    DuckPhysicsState {
        player_id: pid(id),
        name: id.into(),
        progress,
        previous_progress: progress,
        lateral_offset: 0.0,
        speed: 0.0,
        acceleration: 0.0,
        lateral_velocity: 0.0,
        desired_speed: 0.0,
        desired_lateral_offset: 0.0,
        current_rank: rank,
        active_effects: Vec::new(),
        next_impulse_tick: 0,
        finished,
        finish_time_ms: None,
        pacing_segments: Vec::new(),
    }
}

/// The TS `runtime(items)` literal: every flag off, no combo. Fields the
/// literal leaves `undefined` keep the fresh-runtime defaults.
fn runtime(items: &[RaceItemId]) -> DuckItemRuntime {
    let state = create_item_race_state(&race_config("rt", "11", &[("x", "x"), ("y", "y")], None));
    let mut runtime = state.runtime("x").clone();
    runtime.item_ids = items.to_vec();
    runtime.used_items = Vec::new();
    runtime.loadout_combo = None;
    runtime.bubble_available = false;
    runtime.feather_available = false;
    runtime.shock_absorber_available = false;
    runtime
}

/// The test `emit`: records `{ type, metadata }`.
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
            race_id: RaceId::new("guards").unwrap(),
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

    fn of_type(&self, type_name: &str) -> Vec<&RaceEvent> {
        self.log
            .events
            .iter()
            .filter(|event| event.type_name() == type_name)
            .collect()
    }
}

/// The TS evaluation `ctx` literal and everything it shares by reference.
struct Fixture {
    tick: u32,
    objective: RaceObjectiveContext,
    item_state: ItemRaceState,
    ducks: Vec<DuckPhysicsState>,
    player_id: PlayerId,
    prep_auto_use_enabled: bool,
    wild_auto_use_enabled: bool,
    ghost_player_ids: Vec<PlayerId>,
    brains: Brains,
    director: DirectorCache,
}

impl Fixture {
    fn new(
        config: &ResolvedRaceConfig,
        tick: u32,
        ducks: Vec<DuckPhysicsState>,
        wild_auto_use_enabled: bool,
    ) -> Self {
        Self {
            tick,
            objective: build_race_objective_context(config),
            item_state: create_item_race_state(config),
            ducks,
            player_id: pid("duck-1"),
            prep_auto_use_enabled: true,
            wild_auto_use_enabled,
            ghost_player_ids: Vec::new(),
            brains: create_duck_brains(config),
            director: DirectorCache::default(),
        }
    }

    fn ctx(&mut self) -> EvalCtx<'_> {
        EvalCtx {
            tick: self.tick,
            tick_rate: 60,
            objective: &mut self.objective,
            item_state: &self.item_state,
            hazards: &[],
            ducks: &self.ducks,
            player_id: &self.player_id,
            seconds_until_next_pickup_zone: 999.0,
            prep_auto_use_enabled: self.prep_auto_use_enabled,
            wild_auto_use_enabled: self.wild_auto_use_enabled,
            ghost_player_ids: &self.ghost_player_ids,
            brains: &mut self.brains,
            director: &mut self.director,
            math: EngineMath::default(),
        }
    }

    fn resolve_rocket_target(&mut self, preferred: Option<&str>) -> Option<String> {
        let preferred = preferred.map(pid);
        self.ctx()
            .resolve_rocket_target(CandidateSource::Prep, preferred.as_ref())
            .map(|id| id.as_str().to_owned())
    }
}

fn boost_broken_source(event: &RaceEvent) -> BoostBreakSource {
    let EventKind::BoostBroken(meta) = &event.kind else {
        unreachable!()
    };
    meta.break_source
}

#[test]
fn speed_boost_queue_keeps_at_most_one_entry_and_replaces_by_priority() {
    let mut harness = Harness::new();
    let mut state = runtime(&[
        RaceItemId::Nitro,
        RaceItemId::DraftFin,
        RaceItemId::PaddleBurst,
    ]);
    let id = pid("duck-1");

    try_apply_prep_speed_boost(
        &mut state,
        &id,
        RaceItemId::Nitro,
        1.18,
        1.5,
        10,
        60,
        &mut harness.emitter(10),
        SpeedStartExtras::default(),
    );
    assert_eq!(state.active_speed_item_id, Some(RaceItemId::Nitro));

    let draft_queued = try_apply_prep_speed_boost(
        &mut state,
        &id,
        RaceItemId::DraftFin,
        1.09,
        1.1,
        11,
        60,
        &mut harness.emitter(11),
        SpeedStartExtras::default(),
    );
    assert_eq!(draft_queued, PrepSpeedOutcome::Queued);
    assert_eq!(
        state
            .queued_speed_boost
            .as_ref()
            .map(|queued| queued.item_id),
        Some(RaceItemId::DraftFin)
    );

    let paddle_ignored = try_apply_prep_speed_boost(
        &mut state,
        &id,
        RaceItemId::PaddleBurst,
        1.08,
        1.3,
        12,
        60,
        &mut harness.emitter(12),
        SpeedStartExtras::default(),
    );
    assert_eq!(paddle_ignored, PrepSpeedOutcome::Ignored);
    assert_eq!(
        state
            .queued_speed_boost
            .as_ref()
            .map(|queued| queued.item_id),
        Some(RaceItemId::DraftFin)
    );

    let nitro_replace = try_apply_prep_speed_boost(
        &mut state,
        &id,
        RaceItemId::Nitro,
        1.18,
        1.5,
        13,
        60,
        &mut harness.emitter(13),
        SpeedStartExtras::default(),
    );
    assert_eq!(nitro_replace, PrepSpeedOutcome::Queued);
    assert_eq!(
        state
            .queued_speed_boost
            .as_ref()
            .map(|queued| queued.item_id),
        Some(RaceItemId::Nitro)
    );
    assert_eq!(harness.of_type("SPEED_BOOST_QUEUED").len(), 2);
}

#[test]
fn boost_broken_metadata_distinguishes_rocket_and_banana_sources() {
    let mut harness = Harness::new();
    let mut state = runtime(&[RaceItemId::Nitro, RaceItemId::DraftFin]);
    state.boost_multiplier = 1.18;
    state.boost_until_tick = 100;
    state.boost_started_at_tick = 40;
    state.active_speed_item_id = Some(RaceItemId::Nitro);

    break_active_speed_boost(
        &mut state,
        70,
        60,
        &mut harness.emitter(70),
        &pid("attacker"),
        &pid("victim"),
        BoostBreakSource::Rocket,
    );

    let mut banana_state = runtime(&[RaceItemId::Nitro, RaceItemId::DraftFin]);
    banana_state.boost_multiplier = 1.18;
    banana_state.boost_until_tick = 100;
    banana_state.boost_started_at_tick = 40;
    banana_state.active_speed_item_id = Some(RaceItemId::Nitro);
    break_active_speed_boost(
        &mut banana_state,
        80,
        60,
        &mut harness.emitter(80),
        &pid("attacker-2"),
        &pid("victim-2"),
        BoostBreakSource::Banana,
    );

    let breaks = harness.of_type("BOOST_BROKEN");
    assert_eq!(boost_broken_source(breaks[0]), BoostBreakSource::Rocket);
    assert_eq!(boost_broken_source(breaks[1]), BoostBreakSource::Banana);
}

#[test]
fn offensive_cooldown_blocks_chained_pending_offensive_actions() {
    let config = race_config(
        "cooldown-test",
        "aa",
        &[("duck-1", "Duck 1"), ("duck-2", "Duck 2")],
        None,
    );
    let mut fixture = Fixture::new(&config, 110, Vec::new(), true);
    fixture
        .item_state
        .runtime_mut("duck-1")
        .last_offensive_use_tick = 100;
    assert!(is_offensive_auto_item(ItemKey::Banana));
    assert!(offensive_cooldown_blocks(
        &fixture.item_state,
        "duck-1",
        fixture.tick,
        60
    ));
    // `{ ...ctx, tick: 122 }`
    assert!(!offensive_cooldown_blocks(
        &fixture.item_state,
        "duck-1",
        122,
        60
    ));
}

#[test]
fn rocket_target_revalidation_prefers_still_valid_target_at_execute_time() {
    let config = race_config(
        "rocket-target",
        "bb",
        &[("duck-1", "A"), ("duck-2", "B"), ("duck-3", "C")],
        None,
    );
    let ducks = vec![
        duck("duck-1", 0.5, 2, false),
        duck("duck-2", 0.48, 3, false),
        duck("duck-3", 0.55, 1, false),
    ];
    let mut fixture = Fixture::new(&config, 1000, ducks, false);
    assert_eq!(
        fixture.resolve_rocket_target(Some("duck-3")).as_deref(),
        Some("duck-3")
    );
    fixture.ducks[2].finished = true;
    assert_eq!(fixture.resolve_rocket_target(Some("duck-3")), None);
}

#[test]
fn reactive_defense_requires_minimum_visibility_window() {
    assert_eq!(
        js_round(auto_use_config::REACTIVE_THREAT_MIN_VISIBLE_SECONDS * 60.0),
        9.0
    );
}

#[test]
fn feather_carries_zero_penalty_for_rocket_ai_targeting() {
    let config = race_config(
        "feather-rocket-test",
        "cc",
        &[("duck-1", "A"), ("duck-2", "B")],
        None,
    );
    let ducks = vec![
        duck("duck-1", 0.5, 2, false),
        duck("duck-2", 0.55, 1, false),
    ];
    let mut fixture = Fixture::new(&config, 1000, ducks, false);

    let target_without_feather = fixture.resolve_rocket_target(None);
    assert_eq!(target_without_feather.as_deref(), Some("duck-2"));

    // Give duck-2 a feather
    fixture.item_state.runtime_mut("duck-2").feather_available = true;
    let target_with_feather = fixture.resolve_rocket_target(None);
    assert_eq!(target_with_feather.as_deref(), Some("duck-2"));
}

#[test]
fn mini_rocket_applies_50_percent_partial_boost_duration_break() {
    let mut state = runtime(&[RaceItemId::Nitro]);
    state.boost_multiplier = 1.25;
    state.boost_until_tick = 160;
    state.boost_started_at_tick = 60;
    state.active_speed_item_id = Some(RaceItemId::Nitro);
    let mut harness = Harness::new();

    // At tick 100, remaining boost ticks = 160 - 100 = 60 ticks (1.0 second)
    break_active_speed_boost(
        &mut state,
        100,
        60,
        &mut harness.emitter(100),
        &pid("attacker"),
        &pid("victim"),
        BoostBreakSource::MiniRocket,
    );

    // Should have lost 50% = 30 ticks -> new boostUntilTick = 160 - 30 = 130
    assert_eq!(state.boost_until_tick, 130);
    assert_eq!(
        state.boost_multiplier, 1.25,
        "Boost multiplier remains active after partial interrupt"
    );
    let broken = harness.of_type("BOOST_BROKEN");
    let broken_event = broken.first().expect("BOOST_BROKEN emitted");
    let EventKind::BoostBroken(meta) = &broken_event.kind else {
        unreachable!()
    };
    assert_eq!(meta.break_source, BoostBreakSource::MiniRocket);
    assert!(meta.partial);
}

#[test]
fn reverse_mode_applies_negative_utility_to_top_2_targets_for_rocket() {
    let players = [("duck-1", "A"), ("duck-2", "B")];
    let normal_config = race_config(
        "normal-rocket",
        "dd",
        &players,
        Some(r#"{"type":"NORMAL","groups":[]}"#),
    );
    let reverse_config = race_config(
        "reverse-rocket",
        "dd",
        &players,
        Some(r#"{"type":"REVERSE","groups":[]}"#),
    );

    let normal_obj = build_race_objective_context(&normal_config);
    let reverse_obj = build_race_objective_context(&reverse_config);

    // Target rank 1
    assert!(normal_obj.offensive_target_rank_bonus("duck-1", 1) > 0.0);
    assert!(reverse_obj.offensive_target_rank_bonus("duck-1", 1) < 0.0);
}

#[test]
fn rocket_ai_rejects_targets_projected_to_cross_finish_line_before_impact() {
    let config = race_config(
        "finish-line-test",
        "ee",
        &[("duck-1", "A"), ("duck-2", "B")],
        None,
    );
    // Target finishes in ~0.22s; rocket needs ~0.41s including its hit radius.
    let ducks = vec![
        duck("duck-1", 0.88, 2, false),
        duck("duck-2", 0.995, 1, false),
    ];
    let mut fixture = Fixture::new(&config, 1000, ducks, false);
    let target_runtime = fixture.item_state.runtime_mut("duck-2");
    target_runtime.boost_multiplier = 1.3;
    target_runtime.boost_until_tick = 2000;

    let target = fixture.resolve_rocket_target(None);
    assert_eq!(
        target, None,
        "Should reject target that will finish before impact"
    );
}

/// `targetContext()`.
fn target_context() -> Fixture {
    let config = race_config(
        "target-regression",
        "ab",
        &[("duck-1", "1"), ("duck-2", "2"), ("duck-3", "3")],
        None,
    );
    let ducks = vec![
        duck("duck-1", 0.5, 3, false),
        duck("duck-2", 0.55, 2, false),
        duck("duck-3", 0.57, 1, false),
    ];
    Fixture::new(&config, 100, ducks, false)
}

#[test]
fn rocket_abandons_a_preferred_target_when_a_fresh_shield_makes_another_target_materially_better() {
    let mut ctx = target_context();
    assert_eq!(ctx.resolve_rocket_target(None).as_deref(), Some("duck-2"));
    let target = ctx.item_state.runtime_mut("duck-2");
    target.bubble_available = true;
    target.bubble_until_tick = 1000;
    assert_eq!(
        ctx.resolve_rocket_target(Some("duck-2")).as_deref(),
        Some("duck-3")
    );
}

#[test]
fn rocket_treats_a_shield_expiring_before_impact_as_unprotected() {
    let mut ctx = target_context();
    let target = ctx.item_state.runtime_mut("duck-2");
    target.bubble_available = true;
    target.bubble_until_tick = 101;
    assert_eq!(ctx.resolve_rocket_target(None).as_deref(), Some("duck-2"));
}

#[test]
fn danger_uses_adjacent_rivals_rather_than_the_leader_and_last_place() {
    let ctx = target_context();
    let with = |base: &DuckPhysicsState, id: &str, progress: f64, rank: u32| {
        let mut duck = base.clone();
        duck.player_id = pid(id);
        duck.progress = progress;
        duck.previous_progress = progress;
        duck.current_rank = rank;
        duck
    };
    let ducks = vec![
        with(&ctx.ducks[0], "duck-1", 0.5, 3),
        with(&ctx.ducks[1], "duck-2", 0.505, 2),
        with(&ctx.ducks[2], "duck-3", 0.8, 1),
        with(&ctx.ducks[0], "duck-4", 0.495, 4),
        with(&ctx.ducks[0], "duck-5", 0.2, 5),
    ];
    let players: Vec<(&str, &str)> = ducks
        .iter()
        .map(|duck| (duck.player_id.as_str(), duck.player_id.as_str()))
        .collect();
    let config = race_config("danger", "ab", &players, None);
    let objective = build_race_objective_context(&config);
    assert_eq!(objective.danger_score("duck-1", 3, 0.5, &ducks), 75.0);
    assert_eq!(
        objective.position_improvement_value("duck-1", 5.0, 3.0),
        24.0
    );
}
