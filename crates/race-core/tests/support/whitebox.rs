//! Shared helpers for the white-box ports of the TS item tests
//! (`race_items.rs`, `race_item_passives.rs`, `race_nitro_v2.rs`,
//! `race_aim.rs`, `race_counter_loop.rs`, `race_auto_use_guards.rs`).
//! Each test file includes this with `#[path]`.
//!
//! Mapping of the TS test scaffolding:
//! - `raceConfigSchema.parse(...)` is [`parse_config`]; a TS object literal
//!   typed `RaceConfig` (never parsed) is [`literal_config`], which keeps the
//!   literal's version labels. With `ts-compat` both resolve exactly as the
//!   TS oracle does (`resolve_ts_compat`); without it the engine resolver
//!   is used and the labels are set afterwards (they never change behaviour).
//! - `itemState.brains` (`createDuckBrains(config)`) lives beside the item
//!   state in Rust: [`Harness::for_config`] seeds the same brains, and its
//!   [`Emitter`] carries them into the auto-use code.
//! - The `readRace` memo is a `WeakMap` keyed by the `ducks` array, so each
//!   TS `ducks` array maps to one [`DirectorCache`] kept by the test.
//! - A TS test `emit` callback records `(type, source, target, metadata)`;
//!   [`Harness`] records the full events. Unlike that callback, an
//!   [`Emitter`] also feeds every event to `noteBrainEvent` (grudges); the
//!   ported assertions do not depend on it.

#![allow(dead_code)]

use race_core::auto_use::evaluate::EvalCtx;
use race_core::auto_use::execute::{ExecuteEnv, execute_auto_item_action};
use race_core::auto_use::{
    AutoUseCandidate, AutoUseTickInput, Brains, CandidateAction, CandidateSource, DirectorCache,
    RaceObjectiveContext, build_race_objective_context, create_duck_brains, tick_auto_use_ai,
    tick_auto_use_decide, tick_auto_use_execute,
};
use race_core::items::{DuckItemRuntime, ItemRaceState, tick_item_system};
use race_core::pickups::create_pickup_race_state;
use race_core::sim::{DuckPhysicsState, Emitter, EngineMath, EventLog};
use race_core::track::{RaceTrack, create_river_track};
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::AutoUseReason;
use race_protocol::events::RaceEvent;
use race_protocol::ids::ItemKey;
use race_protocol::ids::{PlayerId, RaceId, RaceItemId};

pub fn pid(id: &str) -> PlayerId {
    PlayerId::new(id).unwrap()
}

/// `raceConfigSchema.parse(json)`.
pub fn parse_config(json: &str) -> ResolvedRaceConfig {
    let mut input: RaceConfigInput = serde_json::from_str(json).unwrap();
    resolve(&mut input)
}

#[cfg(feature = "ts-compat")]
fn resolve(input: &mut RaceConfigInput) -> ResolvedRaceConfig {
    input.resolve_ts_compat().unwrap()
}

/// Without `ts-compat` the engine resolver refuses the TS (1.x) labels; drop
/// them so it fills in its own (labels never change the simulation).
#[cfg(not(feature = "ts-compat"))]
fn resolve(input: &mut RaceConfigInput) -> ResolvedRaceConfig {
    input.protocol_version = None;
    input.engine_version = None;
    input.balance_version = None;
    input.track_version = None;
    input.pickup_spawn_version = None;
    input.hazard_balance_version = None;
    input.resolve().unwrap()
}

/// The `{protocolVersion, engineVersion, balanceVersion, trackVersion}` of a
/// TS `RaceConfig` literal.
pub struct Labels {
    pub protocol: &'static str,
    pub engine: &'static str,
    pub balance: &'static str,
    pub track: &'static str,
}

/// The labels most TS literals use.
pub const S3_11: Labels = Labels {
    protocol: "1.0.0",
    engine: "1.2.0",
    balance: "S3.11",
    track: "river-01-v2",
};

/// A TS `RaceConfig` object literal (not schema-parsed): `players` are
/// `(playerId, name)`, `loadouts` are `(playerId, itemIds)` with source
/// `PLAYER`, `chaos` is the raw `chaosConfig` JSON when present.
pub fn literal_config(
    race_id: &str,
    seed: &str,
    labels: &Labels,
    players: &[(&str, &str)],
    loadouts: &[(&str, &[&str])],
    chaos: Option<&str>,
) -> ResolvedRaceConfig {
    let players: Vec<String> = players
        .iter()
        .map(|(id, name)| format!(r#"{{"playerId":"{id}","name":"{name}"}}"#))
        .collect();
    let mut json = format!(
        r#"{{"raceId":"{race_id}","seed":"{seed}","tickRate":60,"players":[{}],"loadouts":[{}]"#,
        players.join(","),
        loadouts_json(loadouts),
    );
    if let Some(chaos) = chaos {
        json.push_str(&format!(r#","chaosConfig":{chaos}"#));
    }
    json.push('}');
    let mut config = parse_config(&json);
    config.protocol_version = labels.protocol.into();
    config.engine_version = labels.engine.into();
    config.balance_version = labels.balance.into();
    config.track_version = labels.track.into();
    config
}

/// `loadouts.map(({playerId, itemIds}) => ({playerId, itemIds, source: 'PLAYER'}))`.
pub fn loadouts_json(loadouts: &[(&str, &[&str])]) -> String {
    loadouts
        .iter()
        .map(|(id, items)| {
            let items: Vec<String> = items.iter().map(|item| format!("\"{item}\"")).collect();
            format!(
                r#"{{"playerId":"{id}","itemIds":[{}],"source":"PLAYER"}}"#,
                items.join(",")
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// An `ItemDuckState` literal `{playerId, progress, currentRank,
/// lateralOffset, lateralVelocity, finished: false}`. TS leaves
/// `previousProgress` undefined, which `bananaTouches` reads as `progress`.
pub fn item_duck(
    id: &str,
    progress: f64,
    rank: u32,
    lateral_offset: f64,
    lateral_velocity: f64,
) -> DuckPhysicsState {
    DuckPhysicsState {
        player_id: pid(id),
        name: id.into(),
        progress,
        previous_progress: progress,
        lateral_offset,
        speed: 0.0,
        acceleration: 0.0,
        lateral_velocity,
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

/// The `DuckItemRuntime` object literal the TS tests build by hand
/// (`defense`, `createTestRuntime`, `runtime`): every flag off, every tick 0,
/// the optional fields absent.
pub fn literal_runtime(items: &[RaceItemId]) -> DuckItemRuntime {
    DuckItemRuntime {
        item_ids: items.to_vec(),
        loadout_combo: None,
        used_items: Vec::new(),
        bubble_available: false,
        bubble_until_tick: 0,
        silenced_until_tick: 0,
        silence_immune_until_tick: 0,
        feather_available: false,
        shock_absorber_available: false,
        item_immunity_until_tick: 0,
        rocket_protection_until_tick: 0,
        slow_multiplier: 1.0,
        slow_until_tick: 0,
        recovery_slow_multiplier: None,
        recovery_slow_until_tick: None,
        boost_multiplier: 1.0,
        boost_until_tick: 0,
        wild_item: None,
        regular_pickup_count: 0,
        wild_bubble_available: false,
        wild_bubble_until_tick: 0,
        wild_feather_available: false,
        wild_feather_until_tick: 0,
        tailwind_until_tick: 0,
        magnet_until_tick: 0,
        last_item_use_tick: 0,
        next_auto_decision_tick: 0,
        next_auto_action_tick: 0,
        pending_auto_action: None,
        pending_auto_action_execute_tick: 0,
        last_offensive_use_tick: 0,
        draft_slipstream_ticks: 0,
        draft_target_player_id: None,
        active_speed_item_id: None,
        queued_speed_boost: None,
        boost_started_at_tick: 0,
        continuous_boost_started_at_tick: None,
        nitro_ignition_ticks: None,
        nitro_overdrive_ticks: None,
        nitro_decay_ticks: None,
        nitro_start_progress: None,
        nitro_start_rank: None,
        reactive_rocket_visible_since_tick: None,
        reactive_banana_visible_since_tick: None,
        queued_guard_surge_tick: None,
        queued_guard_surge_source: None,
        queued_guard_surge_blocked: None,
        speed_drained: false,
    }
}

/// What a TS `EvaluationContext` literal shares across calls: its
/// `objective` (Chaos memos), `itemState.brains`, and the `readRace` memo of
/// its `ducks` array.
pub struct EvalEnv {
    pub objective: RaceObjectiveContext,
    pub brains: Brains,
    pub director: DirectorCache,
}

impl EvalEnv {
    /// `{objective: buildRaceObjectiveContext(config), itemState:
    /// createItemRaceState(config)}`.
    pub fn new(config: &ResolvedRaceConfig) -> Self {
        Self {
            objective: build_race_objective_context(config),
            brains: create_duck_brains(config),
            director: DirectorCache::default(),
        }
    }

    /// `{tick, tickRate: 60, objective, itemState, pickupState: {hazards:
    /// []}, ducks, playerId, secondsUntilNextPickupZone: 999,
    /// prepAutoUseEnabled: true, wildAutoUseEnabled, ghostPlayerIds: new
    /// Set()}`.
    pub fn ctx<'a>(
        &'a mut self,
        tick: u32,
        item_state: &'a ItemRaceState,
        ducks: &'a [DuckPhysicsState],
        player_id: &'a PlayerId,
        wild_auto_use_enabled: bool,
    ) -> EvalCtx<'a> {
        EvalCtx {
            tick,
            tick_rate: 60,
            objective: &mut self.objective,
            item_state,
            hazards: &[],
            ducks,
            player_id,
            seconds_until_next_pickup_zone: 999.0,
            prep_auto_use_enabled: true,
            wild_auto_use_enabled,
            ghost_player_ids: &[],
            brains: &mut self.brains,
            director: &mut self.director,
            math: EngineMath::default(),
        }
    }
}

/// `{playerId, itemKey: 'prep:<item>', itemId, source: 'PREP', action:
/// 'USE', score, reason}`.
pub fn prep_candidate(
    player_id: &str,
    item_id: RaceItemId,
    score: f64,
    reason: AutoUseReason,
) -> AutoUseCandidate {
    AutoUseCandidate {
        player_id: pid(player_id),
        item_key: format!("prep:{}", item_id.as_str()),
        item_id: ItemKey::from(item_id),
        source: CandidateSource::Prep,
        action: CandidateAction::Use,
        score,
        target_player_id: None,
        reason,
        bypass_threshold: None,
        wild_item_instance_id: None,
        intent: None,
        aim_lateral: None,
        horn_side: None,
    }
}

/// `executePrepAction(candidate, itemState, duck, ducks, tick, 60, emit,
/// undefined, raceConfig)`. `config` only feeds the rocket target
/// re-resolution (the TS `raceConfig` branch); `director` is the `readRace`
/// memo of `ducks`.
#[allow(clippy::too_many_arguments)]
pub fn execute_prep(
    candidate: &AutoUseCandidate,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    harness: &mut Harness,
    config: &ResolvedRaceConfig,
    director: &mut DirectorCache,
) -> bool {
    let mut candidate = candidate.clone();
    assert_eq!(candidate.source, CandidateSource::Prep);
    execute_auto_item_action(
        &mut candidate,
        item_state,
        ducks,
        tick,
        60,
        &mut harness.emitter(tick),
        None,
        &mut ExecuteEnv { config, director },
    )
}

/// A recording `emit` plus the brains of one item state.
pub struct Harness {
    pub log: EventLog,
    pub brains: Brains,
    pub race_id: RaceId,
}

impl Harness {
    /// An `emit` for code that never reads brains.
    pub fn new() -> Self {
        Self {
            log: EventLog::new(true),
            brains: Brains::new(),
            race_id: RaceId::new("test").unwrap(),
        }
    }

    /// `createItemRaceState(config).brains` plus a recording `emit`.
    pub fn for_config(config: &ResolvedRaceConfig) -> Self {
        Self {
            log: EventLog::new(true),
            brains: create_duck_brains(config),
            race_id: config.race_id.clone(),
        }
    }

    pub fn emitter(&mut self, tick: u32) -> Emitter<'_> {
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

    pub fn events(&self) -> &[RaceEvent] {
        &self.log.events
    }

    pub fn types(&self) -> Vec<&'static str> {
        self.events().iter().map(RaceEvent::type_name).collect()
    }

    pub fn has(&self, type_name: &str) -> bool {
        self.events()
            .iter()
            .any(|event| event.type_name() == type_name)
    }

    pub fn find(&self, type_name: &str) -> Option<&RaceEvent> {
        self.events()
            .iter()
            .find(|event| event.type_name() == type_name)
    }

    pub fn count(&self, type_name: &str) -> usize {
        self.events()
            .iter()
            .filter(|event| event.type_name() == type_name)
            .count()
    }
}

/// `tickItemsWithAutoAI(raceConfig, itemState, ducks, tick, 60, emit)`
/// (`race-items.test.ts:68-93`): a fresh pickup state each call, then the
/// auto-use AI, then the item system. `director` is the `readRace` memo of
/// this `ducks` array.
pub fn tick_items_with_auto_ai(
    config: &ResolvedRaceConfig,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    harness: &mut Harness,
    director: &mut DirectorCache,
) {
    let track: RaceTrack = create_river_track(&config.track_version);
    let mut pickup_state = create_pickup_race_state(config, &track, None);
    let wild_auto_use_enabled = pickup_state.config.auto_items_enabled;
    let mut emit = harness.emitter(tick);
    tick_auto_use_ai(&mut AutoUseTickInput {
        config,
        track: &track,
        item_state,
        pickup_state: &mut pickup_state,
        ducks,
        tick,
        tick_rate: 60,
        prep_auto_use_enabled: true,
        wild_auto_use_enabled,
        director,
        emit: &mut emit,
    });
    tick_item_system(item_state, ducks, tick, 60, &mut emit);
}

/// [`tick_items_with_auto_ai`] for a TS `emit` that mutates the ducks when
/// it sees an event. An [`Emitter`] cannot reach the ducks, so `hook` runs
/// at the next phase boundary instead (after the auto-use execute phase,
/// after the decide phase, after the item system) with the events of that
/// phase. `tickAutoUseAI` is exactly execute + decide on a fresh objective.
pub fn tick_items_with_auto_ai_hooked(
    config: &ResolvedRaceConfig,
    item_state: &mut ItemRaceState,
    ducks: &mut [DuckPhysicsState],
    tick: u32,
    harness: &mut Harness,
    director: &mut DirectorCache,
    hook: &mut dyn FnMut(&[RaceEvent], &mut [DuckPhysicsState]),
) {
    let track: RaceTrack = create_river_track(&config.track_version);
    let mut pickup_state = create_pickup_race_state(config, &track, None);
    let wild_auto_use_enabled = pickup_state.config.auto_items_enabled;
    let mut objective = build_race_objective_context(config);
    for phase in 0..3 {
        let start = harness.log.events.len();
        {
            let mut emit = harness.emitter(tick);
            if phase == 2 {
                tick_item_system(item_state, ducks, tick, 60, &mut emit);
            } else {
                let mut input = AutoUseTickInput {
                    config,
                    track: &track,
                    item_state: &mut *item_state,
                    pickup_state: &mut pickup_state,
                    ducks: &mut *ducks,
                    tick,
                    tick_rate: 60,
                    prep_auto_use_enabled: true,
                    wild_auto_use_enabled,
                    director: &mut *director,
                    emit: &mut emit,
                };
                if phase == 0 {
                    tick_auto_use_execute(&mut input, &mut objective);
                } else {
                    tick_auto_use_decide(&mut input, &mut objective);
                }
            }
        }
        hook(&harness.log.events[start..], ducks);
    }
}
