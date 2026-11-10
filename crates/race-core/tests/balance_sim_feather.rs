//! Port of the engine parts of `tests/balance-sim-feather.test.ts`.
//!
//! Not ported: the three `Feather instrumentation ...` tests and the
//! `trackEvents` assertions of the two end-to-end tests. They exercise the
//! balance-sim tooling (`scripts/lib/balance-sim-core.ts`:
//! `trackRaceEvent`, `emptyRaceInstrumentation`), which is not part of the
//! engine. Every engine assertion (`resolveIncomingRaceEffect`,
//! `tickItemSystem` events and runtime state) is ported.

use race_core::auto_use::Brains;
use race_core::items::config::item_balance;
use race_core::items::{
    BananaRuntime, DefenseOutcome, DuckItemRuntime, IncomingRaceEffect, ItemRaceState,
    ProjectileSource, create_item_race_state, resolve_incoming_race_effect, tick_item_system,
};
use race_core::sim::{DuckPhysicsState, Emitter, EngineMath, EventLog};
use race_protocol::config::RaceConfigInput;
use race_protocol::ids::{PlayerId, RaceId};

fn pid(id: &str) -> PlayerId {
    PlayerId::new(id).unwrap()
}

/// `config(loadouts)` (`raceConfigSchema.parse`) + `createItemRaceState`.
fn item_state(loadouts: &[(&str, &[&str])]) -> ItemRaceState {
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
        r#"{{"raceId":"feather-fixture","seed":"{}","players":[{}],"loadouts":[{}]}}"#,
        "22".repeat(32),
        players.join(","),
        loadouts.join(",")
    );
    let input: RaceConfigInput = serde_json::from_str(&json).unwrap();
    create_item_race_state(&input.resolve().unwrap())
}

/// `duck(playerId, progress, lateralOffset)`: `previousProgress = progress -
/// 0.002`, `currentRank: 1`.
fn duck(id: &str, progress: f64, lateral_offset: f64) -> DuckPhysicsState {
    DuckPhysicsState {
        player_id: pid(id),
        name: id.into(),
        progress,
        previous_progress: progress - 0.002,
        lateral_offset,
        speed: 0.0,
        acceleration: 0.0,
        lateral_velocity: 0.0,
        desired_speed: 0.0,
        desired_lateral_offset: 0.0,
        current_rank: 1,
        active_effects: Vec::new(),
        next_impulse_tick: 0,
        finished: false,
        finish_time_ms: None,
        pacing_segments: Vec::new(),
    }
}

/// The TS defense literal `{bubbleAvailable, featherAvailable,
/// shockAbsorberAvailable, itemImmunityUntilTick, rocketProtectionUntilTick}`;
/// every other field is absent (falsy) in TS.
fn defense(feather: bool, item_immunity_until_tick: i64) -> DuckItemRuntime {
    let state = item_state(&[("x", &[]), ("y", &[])]);
    let mut runtime = state.runtime("x").clone();
    runtime.item_ids = Vec::new();
    runtime.loadout_combo = None;
    runtime.bubble_available = false;
    runtime.bubble_until_tick = 0;
    runtime.feather_available = feather;
    runtime.shock_absorber_available = false;
    runtime.item_immunity_until_tick = item_immunity_until_tick;
    runtime.rocket_protection_until_tick = 0;
    runtime
}

/// The prep banana both end-to-end tests push.
fn banana() -> BananaRuntime {
    BananaRuntime {
        id: 1,
        source_player_id: pid("B"),
        progress: 0.5,
        lateral_offset: 0.0,
        armed_at_tick: 1,
        expires_at_tick: 600,
        kind: ProjectileSource::Prep,
        hit_progress_radius: item_balance::banana::HIT_PROGRESS_RADIUS,
        hit_lateral_radius: item_balance::banana::HIT_LATERAL_RADIUS,
        progress_knockback: None,
        lateral_slip: item_balance::banana::LATERAL_SLIP,
    }
}

/// `tickItemSystem(state, ducks, 60, 60, emit)`, returning the event types.
fn tick_at_60(state: &mut ItemRaceState, ducks: &mut [DuckPhysicsState]) -> Vec<&'static str> {
    let mut log = EventLog::new(true);
    let mut brains = Brains::new();
    let race_id = RaceId::new("feather-fixture").unwrap();
    let mut emit = Emitter {
        log: &mut log,
        sink: None,
        brains: &mut brains,
        race_id: &race_id,
        tick: 60,
        tick_rate: 60,
        math: EngineMath::default(),
    };
    tick_item_system(state, ducks, 60, 60, &mut emit);
    log.events.iter().map(|event| event.type_name()).collect()
}

#[test]
fn resolve_incoming_race_effect_feather_rocket_does_not_dodge() {
    let mut runtime = defense(true, 0);
    assert_eq!(
        resolve_incoming_race_effect(&mut runtime, IncomingRaceEffect::Rocket, 10, 60),
        DefenseOutcome::Hit
    );
    assert!(runtime.feather_available);
}

#[test]
fn resolve_incoming_race_effect_feather_banana_immunity_counts_as_immunity_not_feather_proc() {
    let mut runtime = defense(true, 100);
    assert_eq!(
        resolve_incoming_race_effect(&mut runtime, IncomingRaceEffect::Banana, 10, 60),
        DefenseOutcome::Immune
    );
    assert!(runtime.feather_available);
}

#[test]
fn deterministic_banana_collision_dodges_feather_end_to_end() {
    let mut state = item_state(&[("A", &["FEATHER"]), ("B", &["BANANA"])]);
    let mut ducks = [duck("A", 0.5, 0.0), duck("B", 0.45, 0.0)];
    state.bananas.push(banana());

    let types = tick_at_60(&mut state, &mut ducks);
    assert!(types.contains(&"FEATHER_DODGED"), "{types:?}");
    assert!(!types.contains(&"BANANA_HIT"), "{types:?}");
    assert!(!state.runtime("A").feather_available);
}

#[test]
fn consumed_feather_second_banana_records_exposure_without_proc() {
    let mut state = item_state(&[("A", &["FEATHER"]), ("B", &["BANANA"])]);
    state.runtime_mut("A").feather_available = false;
    let mut ducks = [duck("A", 0.5, 0.0), duck("B", 0.45, 0.0)];
    state.bananas.push(banana());

    let types = tick_at_60(&mut state, &mut ducks);
    assert!(types.contains(&"BANANA_HIT"), "{types:?}");
    assert!(!types.contains(&"FEATHER_DODGED"), "{types:?}");
}
