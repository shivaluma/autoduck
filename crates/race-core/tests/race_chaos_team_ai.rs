//! Port of `tests/race-chaos-team-ai.test.ts`: the auto-use AI never targets
//! a teammate in Duo / Constructors (rocket targeting, banana drops, horn
//! sides, wild mini rocket, in-flight retargeting, and a full race).
//!
//! The TS fixture config is a plain object with `engineVersion: '1.2.0'`
//! (never Zod-parsed), so it resolves with `resolve_ts_compat`: this file
//! needs `ts-compat`.
//!
//! Mapping of the TS `ctx` literal to [`EvalCtx`]: `itemState.brains`
//! (`createDuckBrains(config)`) is [`EvalCtx::brains`], the `readRace` memo
//! is [`EvalCtx::director`], and `pickupState: { hazards: [] }` is an empty
//! `hazards` slice. The TS tests reuse one `ctx` object across calls, so the
//! objective, brains and director memo persist across calls here too.

#![cfg(feature = "ts-compat")]

use race_core::auto_use::evaluate::EvalCtx;
use race_core::auto_use::{
    AutoUseCandidate, Brains, CandidateAction, CandidateSource, DirectorCache,
    RaceObjectiveContext, build_race_objective_context, create_duck_brains,
};
use race_core::items::{
    HeldWildItem, ItemRaceState, ProjectileSource, RocketRuntime, create_item_race_state,
    tick_item_system,
};
use race_core::sim::{DuckPhysicsState, Emitter, EngineMath, EventLog, SimOptions, simulate_race};
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::{EventKind, HornSide};
use race_protocol::ids::{PlayerId, RaceId, WildItemId};

fn pid(id: &str) -> PlayerId {
    PlayerId::new(id).unwrap()
}

/// The `pickupConfig` literal of `createTeamRaceConfig`.
const DEFAULT_PICKUP_CONFIG: &str = r#"{"enabled":true,"goldenBoxEnabled":false,"goldenBoxProbability":0,"hazardsEnabled":false,"positionAwareLoot":false,"spawnMultiplier":1,"regularPickupCap":3,"manualItemsEnabled":false,"autoItemsEnabled":true,"chaosBoxEnabled":false,"forceGoldenBox":false,"disabledItems":[],"idealManualPlayerIds":[]}"#;

/// Optional overrides of `createTeamRaceConfig(groups, overrides)`.
#[derive(Default)]
struct Overrides<'a> {
    /// `chaosConfig.type` (default `'DUO'`).
    chaos_type: Option<&'a str>,
    /// `(playerId, itemIds)` (default: everyone `HOMING_ROCKET + QUACK_HORN`).
    loadouts: Option<Vec<(String, [&'a str; 2])>>,
    /// Raw `pickupConfig` JSON.
    pickup_config: Option<&'a str>,
}

fn json_strs(items: &[&str]) -> String {
    items
        .iter()
        .map(|item| format!("\"{item}\""))
        .collect::<Vec<_>>()
        .join(",")
}

/// `createTeamRaceConfig(groups, overrides)`.
fn team_config(groups: &[&[&str]], overrides: Overrides<'_>) -> ResolvedRaceConfig {
    let all: Vec<&str> = groups
        .iter()
        .flat_map(|group| group.iter().copied())
        .collect();
    let players: Vec<String> = all
        .iter()
        .map(|id| format!(r#"{{"playerId":"{id}","name":"Player {id}"}}"#))
        .collect();
    let loadouts = overrides.loadouts.unwrap_or_else(|| {
        all.iter()
            .map(|id| ((*id).to_owned(), ["HOMING_ROCKET", "QUACK_HORN"]))
            .collect()
    });
    let loadouts: Vec<String> = loadouts
        .iter()
        .map(|(id, items)| {
            format!(
                r#"{{"playerId":"{id}","itemIds":[{}],"source":"PLAYER"}}"#,
                json_strs(items)
            )
        })
        .collect();
    let groups_json: Vec<String> = groups
        .iter()
        .map(|group| format!("[{}]", json_strs(group)))
        .collect();
    let json = format!(
        r#"{{"raceId":"test-team-race","seed":"{seed}","protocolVersion":"1.0.0","engineVersion":"1.2.0","balanceVersion":"S3.11","trackVersion":"river-01-v2","tickRate":60,"players":[{players}],"loadouts":[{loadouts}],"chaosConfig":{{"type":"{chaos}","groups":[{groups}]}},"pickupConfig":{pickup}}}"#,
        seed = "cc".repeat(32),
        players = players.join(","),
        loadouts = loadouts.join(","),
        chaos = overrides.chaos_type.unwrap_or("DUO"),
        groups = groups_json.join(","),
        pickup = overrides.pickup_config.unwrap_or(DEFAULT_PICKUP_CONFIG),
    );
    let input: RaceConfigInput = serde_json::from_str(&json).expect("config JSON");
    input.resolve_ts_compat().expect("config resolves")
}

/// An `ItemDuckState` literal. `previousProgress` is absent in TS, which
/// reads as `progress`.
fn duck(
    id: &str,
    progress: f64,
    lateral_offset: f64,
    rank: u32,
    finished: bool,
) -> DuckPhysicsState {
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
        finished,
        finish_time_ms: None,
        pacing_segments: Vec::new(),
    }
}

/// The objects behind one TS `ctx` literal.
struct Fixture {
    item_state: ItemRaceState,
    objective: RaceObjectiveContext,
    brains: Brains,
    director: DirectorCache,
    ducks: Vec<DuckPhysicsState>,
    player_id: PlayerId,
}

/// `ctx` fields that differ between tests.
struct CtxSpec {
    tick: u32,
    seconds_until_next_pickup_zone: f64,
    prep_auto_use_enabled: bool,
    wild_auto_use_enabled: bool,
}

const PREP_CTX: CtxSpec = CtxSpec {
    tick: 500,
    seconds_until_next_pickup_zone: 999.0,
    prep_auto_use_enabled: true,
    wild_auto_use_enabled: false,
};

impl Fixture {
    fn new(config: &ResolvedRaceConfig, ducks: Vec<DuckPhysicsState>) -> Self {
        Self {
            item_state: create_item_race_state(config),
            objective: build_race_objective_context(config),
            brains: create_duck_brains(config),
            director: DirectorCache::default(),
            ducks,
            player_id: pid("duck-1"),
        }
    }

    fn ctx(&mut self, spec: &CtxSpec) -> EvalCtx<'_> {
        EvalCtx {
            tick: spec.tick,
            tick_rate: 60,
            objective: &mut self.objective,
            item_state: &self.item_state,
            hazards: &[],
            ducks: &self.ducks,
            player_id: &self.player_id,
            seconds_until_next_pickup_zone: spec.seconds_until_next_pickup_zone,
            prep_auto_use_enabled: spec.prep_auto_use_enabled,
            wild_auto_use_enabled: spec.wild_auto_use_enabled,
            ghost_player_ids: &[],
            brains: &mut self.brains,
            director: &mut self.director,
            math: EngineMath::default(),
        }
    }
}

fn find<'c>(candidates: &'c [AutoUseCandidate], item: &str) -> Option<&'c AutoUseCandidate> {
    candidates
        .iter()
        .find(|candidate| candidate.item_id.as_str() == item)
}

fn nitro_fin_loadouts(first: [&'static str; 2]) -> Vec<(String, [&'static str; 2])> {
    vec![
        ("duck-1".to_owned(), first),
        ("duck-2".to_owned(), ["NITRO", "DRAFT_FIN"]),
        ("duck-3".to_owned(), ["NITRO", "DRAFT_FIN"]),
        ("duck-4".to_owned(), ["NITRO", "DRAFT_FIN"]),
    ]
}

const DUO_4: &[&[&str]] = &[&["duck-1", "duck-2"], &["duck-3", "duck-4"]];

#[test]
fn homing_rocket_ai_skips_teammate_ahead_and_locks_onto_enemy_ahead() {
    let config = team_config(DUO_4, Overrides::default());
    let mut fixture = Fixture::new(
        &config,
        vec![
            duck("duck-1", 0.40, 0.0, 3, false),
            duck("duck-2", 0.45, 0.0, 2, false), // teammate ahead
            duck("duck-3", 0.50, 0.0, 1, false), // enemy ahead
            duck("duck-4", 0.35, 0.0, 4, false),
        ],
    );
    let mut ctx = fixture.ctx(&PREP_CTX);

    let target = ctx.resolve_rocket_target(CandidateSource::Prep, None);
    assert_eq!(
        target.as_ref().map(PlayerId::as_str),
        Some("duck-3"),
        "Homing Rocket should target enemy duck-3, skipping allied duck-2"
    );

    let candidates = ctx.evaluate_prep_candidates();
    let rocket = find(&candidates, "HOMING_ROCKET").expect("Should create rocket candidate");
    assert_eq!(
        rocket.target_player_id.as_ref().map(PlayerId::as_str),
        Some("duck-3"),
        "Candidate target must be duck-3"
    );
}

#[test]
fn homing_rocket_ai_does_not_fire_if_all_ducks_ahead_are_teammates() {
    let groups: &[&[&str]] = &[&["duck-1", "duck-2", "duck-3"], &["duck-4", "duck-5"]];
    let config = team_config(
        groups,
        Overrides {
            chaos_type: Some("CONSTRUCTORS"),
            ..Overrides::default()
        },
    );
    let mut fixture = Fixture::new(
        &config,
        vec![
            duck("duck-1", 0.40, 0.0, 3, false),
            duck("duck-2", 0.50, 0.0, 1, false), // teammate
            duck("duck-3", 0.46, 0.0, 2, false), // teammate
            duck("duck-4", 0.30, 0.0, 4, false), // enemy behind
            duck("duck-5", 0.25, 0.0, 5, false), // enemy behind
        ],
    );
    let mut ctx = fixture.ctx(&PREP_CTX);

    let target = ctx.resolve_rocket_target(CandidateSource::Prep, None);
    assert_eq!(target, None, "No valid enemy target ahead");

    let candidates = ctx.evaluate_prep_candidates();
    assert!(
        find(&candidates, "HOMING_ROCKET").is_none(),
        "Must not fire rocket when only allies are ahead"
    );
}

#[test]
fn wild_mini_rocket_skips_teammate_and_discards_under_pressure_if_only_allies_ahead() {
    let config = team_config(DUO_4, Overrides::default());
    let mut fixture = Fixture::new(
        &config,
        vec![
            duck("duck-1", 0.85, 0.0, 2, false),
            duck("duck-2", 0.90, 0.0, 1, false), // teammate ahead
            duck("duck-3", 0.40, 0.0, 3, false),
            duck("duck-4", 0.35, 0.0, 4, false),
        ],
    );
    fixture.item_state.runtime_mut("duck-1").wild_item = Some(HeldWildItem {
        instance_id: "wild-mini-rocket-1".to_owned(),
        item_id: WildItemId::MiniRocket,
        acquired_at_tick: 100,
    });
    let mut ctx = fixture.ctx(&CtxSpec {
        tick: 1000,
        seconds_until_next_pickup_zone: 1.5,
        prep_auto_use_enabled: false,
        wild_auto_use_enabled: true,
    });

    let candidates = ctx.evaluate_wild_candidates();
    let is_mini = |candidate: &&AutoUseCandidate, action| {
        candidate.item_id.as_str() == "MINI_ROCKET" && candidate.action == action
    };
    assert!(
        !candidates
            .iter()
            .any(|candidate| is_mini(&candidate, CandidateAction::Use)),
        "Must not use Mini Rocket on teammate ahead"
    );
    assert!(
        candidates
            .iter()
            .any(|candidate| is_mini(&candidate, CandidateAction::Discard)),
        "Must discard Mini Rocket when forced to burn in endgame with no enemies ahead"
    );
}

#[test]
fn banana_ai_does_not_drop_trap_when_teammate_is_directly_behind_in_drop_zone() {
    let config = team_config(
        DUO_4,
        Overrides {
            loadouts: Some(nitro_fin_loadouts(["HOMING_ROCKET", "BANANA"])),
            ..Overrides::default()
        },
    );
    let mut fixture = Fixture::new(
        &config,
        vec![
            duck("duck-1", 0.50, 0.0, 1, false),
            duck("duck-2", 0.48, 0.0, 2, false), // teammate directly behind
            duck("duck-3", 0.30, 0.5, 3, false),
            duck("duck-4", 0.25, -0.5, 4, false),
        ],
    );
    let candidates = fixture.ctx(&PREP_CTX).evaluate_prep_candidates();
    assert!(
        find(&candidates, "BANANA").is_none(),
        "Must not drop banana when teammate is directly behind"
    );
}

#[test]
fn banana_ai_drops_trap_when_enemy_is_behind_and_teammate_is_in_different_lane_or_ahead() {
    let config = team_config(
        DUO_4,
        Overrides {
            loadouts: Some(nitro_fin_loadouts(["HOMING_ROCKET", "BANANA"])),
            ..Overrides::default()
        },
    );
    let mut fixture = Fixture::new(
        &config,
        vec![
            duck("duck-1", 0.50, 0.0, 2, false),
            duck("duck-2", 0.55, 0.0, 1, false), // teammate ahead
            duck("duck-3", 0.47, 0.0, 3, false), // enemy behind
            duck("duck-4", 0.25, -0.5, 4, false),
        ],
    );
    let candidates = fixture.ctx(&PREP_CTX).evaluate_prep_candidates();
    assert!(
        find(&candidates, "BANANA").is_some(),
        "Should drop banana to hit chasing enemy duck-3 when teammate is safe ahead"
    );
}

#[test]
fn quack_horn_ai_never_blasts_a_side_with_a_teammate_on_it_and_aims_away_from_the_teammate_when_it_can()
 {
    let config = team_config(
        DUO_4,
        Overrides {
            loadouts: Some(nitro_fin_loadouts(["HOMING_ROCKET", "QUACK_HORN"])),
            ..Overrides::default()
        },
    );
    let mut fixture = Fixture::new(
        &config,
        vec![
            duck("duck-1", 0.50, 0.0, 3, false),
            duck("duck-2", 0.51, 0.1, 2, false), // teammate in blast radius
            duck("duck-3", 0.52, 0.2, 1, false), // enemy on the teammate's side
            duck("duck-4", 0.30, 0.0, 4, false),
        ],
    );
    {
        let runtime3 = fixture.item_state.runtime_mut("duck-3");
        runtime3.boost_multiplier = 1.25;
        runtime3.boost_until_tick = 600;
    }

    let candidates = fixture.ctx(&PREP_CTX).evaluate_prep_candidates();
    assert!(
        find(&candidates, "QUACK_HORN").is_none(),
        "Quack Horn must NOT be used when the only enemy shares a side with the teammate"
    );

    // Enemy on the other side: the horn blasts away from the teammate.
    fixture.ducks[2].lateral_offset = -0.2;
    let candidates = fixture.ctx(&PREP_CTX).evaluate_prep_candidates();
    let aimed =
        find(&candidates, "QUACK_HORN").expect("Horn should fire at the enemy on the far side");
    assert_eq!(aimed.horn_side, Some(HornSide::Left));
}

#[test]
fn quack_horn_ai_activates_when_only_enemy_is_in_blast_radius_and_teammate_is_far_away() {
    let config = team_config(
        DUO_4,
        Overrides {
            loadouts: Some(nitro_fin_loadouts(["HOMING_ROCKET", "QUACK_HORN"])),
            ..Overrides::default()
        },
    );
    let mut fixture = Fixture::new(
        &config,
        vec![
            duck("duck-1", 0.50, 0.0, 2, false),
            duck("duck-2", 0.80, 0.0, 1, false), // teammate far ahead
            duck("duck-3", 0.52, 0.1, 3, false), // enemy in radius
            duck("duck-4", 0.30, 0.0, 4, false),
        ],
    );
    let candidates = fixture.ctx(&PREP_CTX).evaluate_prep_candidates();
    assert!(
        find(&candidates, "QUACK_HORN").is_some(),
        "Quack Horn should activate on enemy when teammate is far away"
    );
}

#[test]
fn in_flight_wild_rocket_retargeting_skips_teammates_when_original_target_finishes_or_is_lost() {
    let config = team_config(DUO_4, Overrides::default());
    let mut item_state = create_item_race_state(&config);
    item_state.rockets.push(RocketRuntime {
        id: 1,
        source_player_id: pid("duck-1"),
        target_player_id: pid("duck-3"),
        progress: 0.50,
        spawned_at_tick: 100,
        launch_at_tick: 100,
        expires_at_tick: 500,
        kind: ProjectileSource::Wild,
        speed_per_second: 0.25,
        hit_radius: 0.02,
        retargeted: false,
    });
    let mut ducks = vec![
        duck("duck-1", 0.40, 0.0, 4, false),
        duck("duck-2", 0.60, 0.0, 2, false), // teammate ahead
        duck("duck-3", 1.00, 0.0, 1, true),  // original target finished
        duck("duck-4", 0.70, 0.0, 3, false), // enemy ahead
    ];

    // The TS emit only records events; brains are untouched.
    let mut log = EventLog::new(true);
    let mut brains = Brains::new();
    let race_id = RaceId::new("test-team-race").unwrap();
    let mut emit = Emitter {
        log: &mut log,
        sink: None,
        brains: &mut brains,
        race_id: &race_id,
        tick: 105,
        tick_rate: 60,
        math: EngineMath::default(),
    };
    tick_item_system(&mut item_state, &mut ducks, 105, 60, &mut emit);

    let rocket = item_state
        .rockets
        .first()
        .expect("Rocket should still be active");
    assert_eq!(
        rocket.target_player_id.as_str(),
        "duck-4",
        "Wild Rocket must retarget to enemy duck-4 and NOT allied duck-2"
    );
}

#[test]
fn full_simulation_in_duo_and_constructors_has_zero_friendly_fire_incidents() {
    let groups: &[&[&str]] = &[
        &["duck-1", "duck-2"],
        &["duck-3", "duck-4"],
        &["duck-5", "duck-6"],
        &["duck-7", "duck-8"],
    ];
    let loadouts = (0..8)
        .map(|i| {
            let items = if i % 2 == 0 {
                ["HOMING_ROCKET", "QUACK_HORN"]
            } else {
                ["HOMING_ROCKET", "BANANA"]
            };
            (format!("duck-{}", i + 1), items)
        })
        .collect();
    let config = team_config(
        groups,
        Overrides {
            loadouts: Some(loadouts),
            pickup_config: Some(
                r#"{"enabled":true,"goldenBoxEnabled":true,"goldenBoxProbability":0.2,"hazardsEnabled":true,"positionAwareLoot":true,"spawnMultiplier":1.25,"regularPickupCap":3,"manualItemsEnabled":false,"autoItemsEnabled":true,"chaosBoxEnabled":false,"forceGoldenBox":false,"disabledItems":[],"idealManualPlayerIds":[]}"#,
            ),
            ..Overrides::default()
        },
    );
    let teammates = |source: &str, target: &str| {
        groups
            .iter()
            .any(|group| group.contains(&source) && group.contains(&target) && source != target)
    };

    let options = SimOptions {
        record_events: true,
        ..SimOptions::default()
    };
    let result = simulate_race(config, options, None).expect("race finishes");
    assert!(!result.events.is_empty());

    for event in &result.events {
        let source = event.source_player_id.as_ref().map(PlayerId::as_str);
        match &event.kind {
            EventKind::RocketFired(_) | EventKind::MiniRocketFired(_) => {
                let target = event.target_player_id.as_ref().map(PlayerId::as_str);
                if let (Some(source), Some(target)) = (source, target) {
                    assert!(
                        !teammates(source, target),
                        "Friendly fire detected! {source} fired rocket at teammate {target}"
                    );
                }
            }
            EventKind::HornUsed(meta) => {
                if let Some(source) = source {
                    for target in &meta.targets {
                        assert!(
                            !teammates(source, target.as_str()),
                            "Friendly horn blast! {source} hit teammate {target:?} with horn"
                        );
                    }
                }
            }
            EventKind::WildHornUsed(meta) => {
                if let Some(source) = source {
                    for target in &meta.targets {
                        assert!(
                            !teammates(source, target.as_str()),
                            "Friendly horn blast! {source} hit teammate {target:?} with horn"
                        );
                    }
                }
            }
            _ => {}
        }
    }
}
