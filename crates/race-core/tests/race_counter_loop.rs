//! White-box port of `tests/race-counter-loop.test.ts` (S3.15): the
//! ATTACK > SPEED > DEFENSE > ATTACK counter loop through `firePrepRocket`,
//! `tickItemSystem` and `executePrepAction`. Same test names (in
//! `snake_case`) and assertions; `items_whitebox.rs` also covers the
//! item-only cases with extra checks.
//!
//! Port notes:
//! - `executePrepAction(candidate, itemState, duck, ducks, ...)` is reached
//!   through the public `execute_auto_item_action`, which finds the duck by
//!   id and dispatches `PREP` candidates to it (`executeAutoItemAction`).
//!   The TS test passes no `raceConfig`; only the Rocket branch reads it and
//!   these tests execute the Horn.
//! - The TS `firePrepRocket` takes no metadata; the Rust `RocketFiredMeta`
//!   is required, so it gets `OPPORTUNITY` and no targets. Likewise
//!   `tryActivateBubbleShield(...)` without metadata emits no `autoReason`
//!   in TS, while the Rust meta field is required. No assertion reads them.
//! - The TS test `emit` records events without touching brains; the
//!   harness's brain map is empty, so `noteBrainEvent` is a no-op too.
//!
//! Needs `ts-compat` (the oracle's config resolution and id collation).
#![cfg(feature = "ts-compat")]
#![allow(clippy::float_cmp)]

use race_core::auto_use::execute::{ExecuteEnv, execute_auto_item_action};
use race_core::auto_use::{
    AutoUseCandidate, Brains, CandidateAction, CandidateSource, DirectorCache,
};
use race_core::items::config::item_balance;
use race_core::items::{
    ItemRaceState, SpeedStartExtras, create_item_race_state, fire_prep_rocket,
    item_speed_multiplier, tick_item_system, try_activate_bubble_shield,
    try_apply_prep_speed_boost,
};
use race_core::math::js_round;
use race_core::sim::{DuckPhysicsState, Emitter, EngineMath, EventLog};
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::{AutoUseReason, EventKind, RaceEvent, ReflexThreat, RocketFiredMeta};
use race_protocol::ids::{ItemKey, PlayerId, RaceId, RaceItemId};

fn pid(id: &str) -> PlayerId {
    PlayerId::new(id).unwrap()
}

/// The test `emit`: records `{ type, source, target, metadata }`.
struct Harness {
    log: EventLog,
    brains: Brains,
    race_id: RaceId,
}

impl Harness {
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

    fn of_type(&self, type_name: &str) -> Vec<&RaceEvent> {
        self.events()
            .iter()
            .filter(|event| event.type_name() == type_name)
            .collect()
    }
}

struct Setup {
    config: ResolvedRaceConfig,
    state: ItemRaceState,
    harness: Harness,
}

/// `setup(loadouts)`.
fn setup(loadouts: &[(&str, &[&str])]) -> Setup {
    let players: Vec<String> = loadouts
        .iter()
        .map(|(id, _)| format!(r#"{{"playerId":"{id}","name":"{id}"}}"#))
        .collect();
    let loadouts: Vec<String> = loadouts
        .iter()
        .map(|(id, items)| {
            let items: Vec<String> = items.iter().map(|item| format!("\"{item}\"")).collect();
            format!(
                r#"{{"playerId":"{id}","itemIds":[{}],"source":"PLAYER"}}"#,
                items.join(",")
            )
        })
        .collect();
    let json = format!(
        r#"{{"raceId":"counter-loop","seed":"{}","players":[{}],"loadouts":[{}]}}"#,
        "22".repeat(32),
        players.join(","),
        loadouts.join(",")
    );
    let input: RaceConfigInput = serde_json::from_str(&json).unwrap();
    let config = input.resolve_ts_compat().unwrap();
    let state = create_item_race_state(&config);
    Setup {
        config,
        state,
        harness: Harness {
            log: EventLog::new(true),
            brains: Brains::new(),
            race_id: RaceId::new("counter-loop").unwrap(),
        },
    }
}

/// `duck(playerId, progress, rank, lateralOffset = 0)`. TS leaves
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

/// `firePrepRocket(state, ducks[0], targetId, tick, 60, emit)`.
fn fire(s: &mut Setup, source: &DuckPhysicsState, target: &str, tick: u32) -> bool {
    fire_prep_rocket(
        &mut s.state,
        &source.player_id,
        source.progress,
        &pid(target),
        tick,
        60,
        &mut s.harness.emitter(tick),
        RocketFiredMeta {
            auto_reason: AutoUseReason::Opportunity,
            decision_target_id: None,
            execute_target_id: None,
            retargeted_at_execute: false,
        },
    )
}

/// `flyRocket(state, ducks, emit, events, fromTick)`.
fn fly_rocket(s: &mut Setup, ducks: &mut [DuckPhysicsState], from_tick: u32) -> u32 {
    for tick in from_tick..from_tick + 240 {
        tick_item_system(&mut s.state, ducks, tick, 60, &mut s.harness.emitter(tick));
        if s.harness.has("ROCKET_HIT") || s.harness.has("ROCKET_BLOCKED") {
            return tick;
        }
    }
    panic!("rocket never resolved");
}

/// `executePrepAction({ playerId, itemKey: 'prep:QUACK_HORN', itemId:
/// 'QUACK_HORN', source: 'PREP', action: 'USE', score: 100, reason:
/// 'OPPORTUNITY' }, state, ducks[0], ducks, tick, 60, emit)`.
fn execute_horn(s: &mut Setup, ducks: &mut [DuckPhysicsState], player_id: &str, tick: u32) -> bool {
    let mut candidate = AutoUseCandidate {
        player_id: pid(player_id),
        item_key: "prep:QUACK_HORN".into(),
        item_id: ItemKey::QuackHorn,
        source: CandidateSource::Prep,
        action: CandidateAction::Use,
        score: 100.0,
        target_player_id: None,
        reason: AutoUseReason::Opportunity,
        bypass_threshold: None,
        wild_item_instance_id: None,
        intent: None,
        aim_lateral: None,
        horn_side: None,
    };
    let mut director = DirectorCache::default();
    let mut env = ExecuteEnv {
        config: &s.config,
        director: &mut director,
    };
    execute_auto_item_action(
        &mut candidate,
        &mut s.state,
        ducks,
        tick,
        60,
        &mut s.harness.emitter(tick),
        None,
        &mut env,
    )
}

#[test]
fn attack_beats_speed_a_rocket_on_a_nitro_holder_steals_momentum_and_drains_the_unspent_nitro() {
    let mut s = setup(&[
        ("atk", &["HOMING_ROCKET", "FEATHER"]),
        ("spd", &["NITRO", "PADDLE_BURST"]),
    ]);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("spd", 0.44, 1, 0.0)];
    let source = ducks[0].clone();
    assert!(fire(&mut s, &source, "spd", 100));
    let hit_tick = fly_rocket(&mut s, &mut ducks, 101);

    let steal = s
        .harness
        .of_type("MOMENTUM_STOLEN")
        .first()
        .copied()
        .expect("attacker should steal momentum")
        .clone();
    assert_eq!(steal.source_player_id.as_ref().unwrap().as_str(), "atk");
    let EventKind::MomentumStolen(meta) = &steal.kind else {
        unreachable!()
    };
    assert_eq!(meta.stolen_item_id, RaceItemId::Nitro);
    let attacker = s.state.runtime("atk");
    assert_eq!(
        item_speed_multiplier(attacker, hit_tick + 1),
        item_balance::counter::MOMENTUM_STEAL_MULTIPLIER
    );

    let victim = s.state.runtime_mut("spd");
    assert!(victim.speed_drained);
    try_apply_prep_speed_boost(
        victim,
        &pid("spd"),
        RaceItemId::Nitro,
        1.25,
        item_balance::nitro::DURATION_SECONDS,
        400,
        60,
        &mut s.harness.emitter(400),
        SpeedStartExtras::default(),
    );
    #[allow(clippy::cast_precision_loss)]
    let remaining = (victim.boost_until_tick - 400) as f64;
    assert_eq!(
        remaining,
        js_round(
            item_balance::nitro::DURATION_SECONDS
                * item_balance::counter::SPEED_DRAIN_DURATION_RATIO
                * 60.0
        )
    );
}

#[test]
fn attack_vs_non_speed_duck_a_clean_hit_gives_no_momentum() {
    let mut s = setup(&[
        ("atk", &["HOMING_ROCKET", "FEATHER"]),
        ("def", &["BUBBLE_SHIELD", "DRAFT_FIN"]),
    ]);
    s.state
        .runtime_mut("def")
        .mark_used(RaceItemId::BubbleShield);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("def", 0.44, 1, 0.0)];
    let source = ducks[0].clone();
    fire(&mut s, &source, "def", 100);
    fly_rocket(&mut s, &mut ducks, 101);
    assert!(s.harness.has("ROCKET_HIT"));
    assert!(!s.harness.has("MOMENTUM_STOLEN"));
}

#[test]
fn defense_beats_attack_a_packed_bubble_snaps_up_on_the_rocket_and_turns_it_into_a_guard_surge() {
    let mut s = setup(&[
        ("atk", &["HOMING_ROCKET", "BANANA"]),
        ("def", &["BUBBLE_SHIELD", "FEATHER"]),
    ]);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("def", 0.44, 1, 0.0)];
    let source = ducks[0].clone();
    fire(&mut s, &source, "def", 100);
    let tick = fly_rocket(&mut s, &mut ducks, 101);
    assert!(s.harness.events().iter().any(|event| matches!(
        &event.kind,
        EventKind::BubbleShieldActivated(meta) if meta.reflex == Some(ReflexThreat::Rocket)
    )));
    assert!(s.harness.has("ROCKET_BLOCKED"));
    assert!(
        !s.harness.has("PREDATOR_RUSH_STARTED"),
        "blocked hits give MENACE nothing"
    );
    let surge = s.harness.of_type("GUARD_SURGE");
    let defense_item = surge.first().map(|event| {
        let EventKind::GuardSurge(meta) = &event.kind else {
            unreachable!()
        };
        meta.defense_item_id.as_str()
    });
    assert_eq!(defense_item, Some("BUBBLE_SHIELD"));
    assert_eq!(
        item_speed_multiplier(s.state.runtime("def"), tick + 1),
        item_balance::counter::guard_surge::BUBBLE_SHIELD_MULTIPLIER
    );
}

#[test]
fn a_silenced_duck_cannot_reflex_its_bubble() {
    let mut s = setup(&[
        ("atk", &["HOMING_ROCKET", "BANANA"]),
        ("def", &["BUBBLE_SHIELD", "FEATHER"]),
    ]);
    s.state.runtime_mut("def").silenced_until_tick = 10_000;
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("def", 0.44, 1, 0.0)];
    let source = ducks[0].clone();
    fire(&mut s, &source, "def", 100);
    fly_rocket(&mut s, &mut ducks, 101);
    assert!(s.harness.has("ROCKET_HIT"));
}

#[test]
fn defense_beats_attack_raised_bubble_ignores_the_horn_feather_hops_it_and_both_surge() {
    let mut s = setup(&[
        ("horn", &["NITRO", "QUACK_HORN"]),
        ("bub", &["BUBBLE_SHIELD", "DRAFT_FIN"]),
        ("fea", &["HOMING_ROCKET", "FEATHER"]),
    ]);
    // No metadata in TS (no `autoReason` key); see the module notes.
    try_activate_bubble_shield(
        s.state.runtime_mut("bub"),
        &pid("bub"),
        90,
        60,
        &mut s.harness.emitter(90),
        AutoUseReason::Opportunity,
        None,
    );
    // Both defenders on the same side: the horn blasts one side only.
    let mut ducks = vec![
        duck("horn", 0.5, 1, 0.0),
        duck("bub", 0.5, 2, 0.2),
        duck("fea", 0.5, 3, 0.4),
    ];
    let used = execute_horn(&mut s, &mut ducks, "horn", 100);
    assert!(used);
    assert_eq!(ducks[1].lateral_velocity, 0.0);
    assert_eq!(ducks[2].lateral_velocity, 0.0);
    assert!(!s.harness.has("ITEM_SILENCED"));
    assert!(
        s.state.runtime("bub").bubble_available,
        "the horn does not pop the bubble"
    );
    assert!(!s.state.runtime("fea").feather_available);
    let mut surges: Vec<&str> = s
        .harness
        .of_type("GUARD_SURGE")
        .iter()
        .map(|event| event.source_player_id.as_ref().unwrap().as_str())
        .collect();
    surges.sort();
    assert_eq!(surges, ["bub", "fea"]);
}

#[test]
fn attack_beats_speed_the_prep_horn_breaks_nitro_and_steals_once_per_blast() {
    let mut s = setup(&[
        ("horn", &["HOMING_ROCKET", "QUACK_HORN"]),
        ("s1", &["NITRO", "DRAFT_FIN"]),
        ("s2", &["NITRO", "PADDLE_BURST"]),
    ]);
    try_apply_prep_speed_boost(
        s.state.runtime_mut("s1"),
        &pid("s1"),
        RaceItemId::Nitro,
        1.25,
        1.7,
        95,
        60,
        &mut s.harness.emitter(95),
        SpeedStartExtras::default(),
    );
    let mut ducks = vec![
        duck("horn", 0.5, 3, 0.0),
        duck("s1", 0.51, 1, 0.2),
        duck("s2", 0.505, 2, -0.2),
    ];
    execute_horn(&mut s, &mut ducks, "horn", 100);
    assert_eq!(s.state.runtime("s1").active_speed_item_id, None);
    let steals = s.harness.of_type("MOMENTUM_STOLEN");
    assert_eq!(steals.len(), 1);
    let EventKind::MomentumStolen(meta) = &steals[0].kind else {
        unreachable!()
    };
    assert_eq!(
        meta.duration_seconds,
        item_balance::counter::HORN_MOMENTUM_STEAL_SECONDS
    );
}

#[test]
fn shock_absorber_softens_a_rocket_but_a_packed_nitro_is_still_stolen() {
    let mut s = setup(&[
        ("atk", &["HOMING_ROCKET", "BANANA"]),
        ("spd", &["NITRO", "SHOCK_ABSORBER"]),
    ]);
    let mut ducks = vec![duck("atk", 0.40, 2, 0.0), duck("spd", 0.44, 1, 0.0)];
    let source = ducks[0].clone();
    fire(&mut s, &source, "spd", 100);
    let tick = fly_rocket(&mut s, &mut ducks, 101);
    assert!(s.harness.has("SHOCK_ABSORBER_PROC"));
    assert!(s.harness.has("MOMENTUM_STOLEN"));
    assert!(!s.harness.has("PREDATOR_RUSH_STARTED"));
    assert_eq!(
        s.state.runtime("spd").slow_multiplier,
        item_balance::shock_absorber::STAGGER_MULTIPLIER
    );
    // The guard surge waits until the absorbed stagger has played out.
    let victim = s.state.runtime("spd");
    let surge_tick = victim.queued_guard_surge_tick.unwrap();
    assert_eq!(Some(surge_tick), victim.recovery_slow_until_tick);
    for t in tick + 1..=u32::try_from(surge_tick).unwrap() {
        tick_item_system(&mut s.state, &mut ducks, t, 60, &mut s.harness.emitter(t));
    }
    assert!(s.harness.events().iter().any(|event| matches!(
        &event.kind,
        EventKind::GuardSurge(meta) if meta.defense_item_id.as_str() == "SHOCK_ABSORBER"
    )));
}
