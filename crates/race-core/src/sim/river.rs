//! River events (S3.17): two race-wide, telegraphed events per race.
//!
//! Every race rolls one event for the middle of the race and a different one
//! for the final stretch, from the seed alone (stream `river-events`). An
//! event is announced when the leader reaches its trigger progress
//! ([`RiverPhase::Warning`], `WARNING_SECONDS` long) and then runs for a
//! fixed time. While it runs it scales how far each duck moves per tick, on
//! top of the track current and item effects; it never stops, reverses or
//! teleports a duck, and it does not touch items or pickups.
//!
//! | Event | Effect |
//! |---|---|
//! | Flash flood | every duck gains speed in proportion to its gap to the leader, so the field closes up |
//! | Whirlpool | the three ducks in front when it opens are dragged back |
//! | Gust | every duck gets its own random push or headwind |
//! | Bread rain | the back half of the field (when it starts) sprints |
//!
//! The rules are public and identical for every duck: nothing here reads a
//! player's identity, loadout or history. `ts-compat` builds (S3.15) have no
//! river events.

use alloc::vec::Vec;

use race_protocol::events::{
    EventKind, RiverEventEffect, RiverEventEndedMeta, RiverEventKind, RiverEventStartedMeta,
    RiverEventWarningMeta,
};

use super::events::Emitter;
use super::state::DuckPhysicsState;
use crate::math::{js_max, js_min, js_round};
use crate::rng::create_race_rng;

/// Tuning of the river events.
pub mod river_balance {
    /// Seconds between the announcement and the start.
    pub const WARNING_SECONDS: f64 = 2.5;
    /// The middle event is announced when the leader's progress reaches a point in this range.
    pub const MID_TRIGGER: (f64, f64) = (0.36, 0.54);
    /// The final-stretch event is announced in this range.
    pub const LATE_TRIGGER: (f64, f64) = (0.74, 0.84);

    pub mod flash_flood {
        pub const DURATION_SECONDS: f64 = 4.0;
        /// Extra speed per unit of progress behind the leader.
        pub const GAIN_PER_PROGRESS: f64 = 4.0;
        pub const MAXIMUM_BONUS: f64 = 0.18;
    }

    pub mod whirlpool {
        pub const DURATION_SECONDS: f64 = 2.2;
        /// Speed multiplier of the ducks ranked 1, 2 and 3 when it opens.
        pub const DRAG: [f64; 3] = [0.78, 0.84, 0.90];
    }

    pub mod gust {
        pub const DURATION_SECONDS: f64 = 3.0;
        pub const MINIMUM_MULTIPLIER: f64 = 0.86;
        pub const MAXIMUM_MULTIPLIER: f64 = 1.13;
    }

    pub mod bread_rain {
        pub const DURATION_SECONDS: f64 = 3.0;
        /// Speed multiplier of the last duck; it fades linearly to 1 at the middle of the field.
        pub const MAXIMUM_MULTIPLIER: f64 = 1.13;
    }
}

/// Where an event is in its life.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RiverPhase {
    /// Not announced yet.
    Pending,
    /// Announced; starts at `start_tick`.
    Warning,
    Active,
    Over,
}

/// One scheduled event.
#[derive(Clone, Debug, PartialEq)]
pub struct RiverEvent {
    pub kind: RiverEventKind,
    /// The leader's progress at which the event is announced.
    pub trigger_progress: f64,
    pub phase: RiverPhase,
    /// First active tick (set at the announcement).
    pub start_tick: u32,
    /// First tick after the event.
    pub end_tick: u32,
    /// Per-duck speed multiplier, indexed like `Simulation::ducks`; fixed at
    /// the start for every kind except the flash flood, which is computed
    /// from the live gaps. Empty until the event starts.
    pub multipliers: Vec<f64>,
    /// Per-duck draws of the gust, taken from the seed at creation.
    gust_draws: Vec<f64>,
}

/// What happened to an event on this tick (for the event stream).
#[derive(Clone, Debug, PartialEq)]
pub enum RiverTransition {
    Warned { index: usize },
    Started { index: usize },
    Ended { index: usize },
}

/// The river events of one race.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RiverState {
    pub events: Vec<RiverEvent>,
    /// The leader's progress at the start of the current tick.
    leader_progress: f64,
}

const KINDS: [RiverEventKind; 4] = [
    RiverEventKind::FlashFlood,
    RiverEventKind::Whirlpool,
    RiverEventKind::Gust,
    RiverEventKind::BreadRain,
];

fn duration_seconds(kind: RiverEventKind) -> f64 {
    match kind {
        RiverEventKind::FlashFlood => river_balance::flash_flood::DURATION_SECONDS,
        RiverEventKind::Whirlpool => river_balance::whirlpool::DURATION_SECONDS,
        RiverEventKind::Gust => river_balance::gust::DURATION_SECONDS,
        RiverEventKind::BreadRain => river_balance::bread_rain::DURATION_SECONDS,
    }
}

fn seconds_to_ticks(seconds: f64, tick_rate: u32) -> u32 {
    let ticks = js_round(seconds * f64::from(tick_rate));
    assert!(
        (0.0..=f64::from(u32::MAX)).contains(&ticks),
        "river event duration out of range"
    );
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let ticks = ticks as u32;
    ticks
}

/// Rolls the race's two events from the seed. `duck_count` is the lobby size.
#[must_use]
pub fn create_river_state(seed: &str, duck_count: usize) -> RiverState {
    if crate::TS_COMPAT || duck_count < 2 {
        return RiverState::default();
    }
    let mut rng = create_race_rng(seed, "river-events");
    let first = rng.index(KINDS.len());
    // A different kind for the second event.
    let second = (first + 1 + rng.index(KINDS.len() - 1)) % KINDS.len();
    let mut events = Vec::with_capacity(2);
    for (kind_index, range) in [
        (first, river_balance::MID_TRIGGER),
        (second, river_balance::LATE_TRIGGER),
    ] {
        let trigger_progress = rng.range(range.0, range.1);
        let gust_draws = (0..duck_count)
            .map(|_| {
                rng.range(
                    river_balance::gust::MINIMUM_MULTIPLIER,
                    river_balance::gust::MAXIMUM_MULTIPLIER,
                )
            })
            .collect();
        events.push(RiverEvent {
            kind: KINDS[kind_index],
            trigger_progress,
            phase: RiverPhase::Pending,
            start_tick: 0,
            end_tick: 0,
            multipliers: Vec::new(),
            gust_draws,
        });
    }
    RiverState {
        events,
        leader_progress: 0.0,
    }
}

/// The multipliers an event fixes when it starts (all 1 for the flash flood).
fn start_multipliers(event: &RiverEvent, ducks: &[DuckPhysicsState]) -> Vec<f64> {
    let count = ducks.len();
    ducks
        .iter()
        .enumerate()
        .map(|(index, duck)| {
            if duck.finished {
                return 1.0;
            }
            let rank = duck.current_rank as usize;
            match event.kind {
                RiverEventKind::FlashFlood => 1.0,
                RiverEventKind::Whirlpool => river_balance::whirlpool::DRAG
                    .get(rank.saturating_sub(1))
                    .copied()
                    .unwrap_or(1.0),
                RiverEventKind::Gust => event.gust_draws[index],
                RiverEventKind::BreadRain => {
                    // Ranks in the back half: the last duck gets the full
                    // multiplier, fading to 1 at the middle of the field.
                    let half = count / 2;
                    if rank <= half || count <= half {
                        1.0
                    } else {
                        let steps =
                            f64::from(u32::try_from(count - half).expect("lobby fits in u32"));
                        let depth =
                            f64::from(u32::try_from(rank - half).expect("rank fits in u32"));
                        1.0 + (river_balance::bread_rain::MAXIMUM_MULTIPLIER - 1.0) * depth / steps
                    }
                }
            }
        })
        .collect()
}

/// Advances the events at the start of tick `tick` (before the ducks move)
/// and returns what changed, in schedule order.
pub fn tick_river(
    state: &mut RiverState,
    ducks: &[DuckPhysicsState],
    tick: u32,
    tick_rate: u32,
) -> Vec<RiverTransition> {
    let mut transitions = Vec::new();
    if state.events.is_empty() {
        return transitions;
    }
    state.leader_progress = ducks.iter().map(|duck| duck.progress).fold(0.0, js_max);
    let warning_ticks = seconds_to_ticks(river_balance::WARNING_SECONDS, tick_rate);
    // One event at a time: a later event waits for the earlier one to end.
    let mut busy = false;
    for index in 0..state.events.len() {
        let leader_progress = state.leader_progress;
        let event = &mut state.events[index];
        match event.phase {
            RiverPhase::Pending => {
                if !busy && leader_progress >= event.trigger_progress {
                    event.phase = RiverPhase::Warning;
                    event.start_tick = tick.saturating_add(warning_ticks);
                    event.end_tick = event
                        .start_tick
                        .saturating_add(seconds_to_ticks(duration_seconds(event.kind), tick_rate));
                    transitions.push(RiverTransition::Warned { index });
                }
            }
            RiverPhase::Warning => {
                if tick >= event.start_tick {
                    event.phase = RiverPhase::Active;
                    event.multipliers = start_multipliers(event, ducks);
                    transitions.push(RiverTransition::Started { index });
                }
            }
            RiverPhase::Active => {
                if tick >= event.end_tick {
                    event.phase = RiverPhase::Over;
                    transitions.push(RiverTransition::Ended { index });
                }
            }
            RiverPhase::Over => {}
        }
        busy = busy || matches!(event.phase, RiverPhase::Warning | RiverPhase::Active);
    }
    transitions
}

/// The river's speed multiplier for duck `index` on this tick.
#[must_use]
pub fn river_speed_multiplier(state: &RiverState, duck: &DuckPhysicsState, index: usize) -> f64 {
    let mut multiplier = 1.0;
    for event in &state.events {
        if event.phase != RiverPhase::Active {
            continue;
        }
        multiplier *= match event.kind {
            RiverEventKind::FlashFlood => {
                let gap = js_max(0.0, state.leader_progress - duck.progress);
                1.0 + js_min(
                    river_balance::flash_flood::MAXIMUM_BONUS,
                    gap * river_balance::flash_flood::GAIN_PER_PROGRESS,
                )
            }
            _ => event.multipliers.get(index).copied().unwrap_or(1.0),
        };
    }
    multiplier
}

/// Writes the event of one transition to the race's event stream.
pub fn emit_river_transition(
    state: &RiverState,
    ducks: &[DuckPhysicsState],
    transition: &RiverTransition,
    tick_rate: u32,
    emit: &mut Emitter<'_>,
) {
    let slot_of = |index: usize| u32::try_from(index).expect("slot fits in u32");
    match *transition {
        RiverTransition::Warned { index } => {
            let event = &state.events[index];
            emit.emit(
                EventKind::RiverEventWarning(RiverEventWarningMeta {
                    kind: event.kind,
                    slot: slot_of(index),
                    start_tick: event.start_tick,
                    warning_seconds: river_balance::WARNING_SECONDS,
                    duration_seconds: duration_seconds(event.kind),
                }),
                None,
                None,
            );
        }
        RiverTransition::Started { index } => {
            let event = &state.events[index];
            let effects = ducks
                .iter()
                .enumerate()
                .filter(|(_, duck)| !duck.finished)
                .map(|(duck_index, duck)| RiverEventEffect {
                    player_id: duck.player_id.clone(),
                    multiplier: river_speed_multiplier(state, duck, duck_index),
                })
                .filter(|effect| effect.multiplier != 1.0)
                .collect();
            emit.emit(
                EventKind::RiverEventStarted(RiverEventStartedMeta {
                    kind: event.kind,
                    slot: slot_of(index),
                    end_tick: event.end_tick,
                    duration_seconds: f64::from(event.end_tick - event.start_tick)
                        / f64::from(tick_rate),
                    effects,
                }),
                None,
                None,
            );
        }
        RiverTransition::Ended { index } => {
            emit.emit(
                EventKind::RiverEventEnded(RiverEventEndedMeta {
                    kind: state.events[index].kind,
                    slot: slot_of(index),
                }),
                None,
                None,
            );
        }
    }
}
