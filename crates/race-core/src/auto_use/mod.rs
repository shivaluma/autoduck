//! The auto-use AI: `packages/race-core/src/auto-use/*` (S3.15).
//!
//! # Hooks the core calls (M1 contract)
//!
//! | Rust | TS | Status |
//! |---|---|---|
//! | [`create_duck_brains`] | `createDuckBrains` (`brain.ts:82`) | ported (`DUCK_TEMPERAMENT` needs it) |
//! | [`note_brain_event`] | `noteBrainEvent` (`brain.ts:120`) | ported; `sim::Emitter::emit` calls it for every event, recorded or not |
//! | [`build_race_objective_context`] | `buildRaceObjectiveContext` (`objective.ts:20`) | ported except the `ChaosUtility` internals (**M3**) |
//! | [`tick_auto_use_execute`] | `tickAutoUseExecute` (`arbiter.ts:271`) | **M3** (exact no-op while no item is in play) |
//! | [`tick_auto_use_decide`] | `tickAutoUseDecide` (`arbiter.ts:278`) | **M3** (exact no-op while no item is in play) |
//! | [`director::read_race`] | `readRace` (`director.ts:27`) | ported, memo = `Simulation::director` |
//!
//! **Left for M3**: `evaluate.ts`, `execute.ts`, the rest of `arbiter.ts`,
//! `chaos-utility.ts` (beyond the constructor). `Math.exp`/`Math.pow` go
//! through `sim::EngineMath` (`emit.math`).

pub mod arbiter;
pub mod brain;
pub mod chaos_utility;
pub mod config;
pub mod director;
pub mod objective;
pub mod types;

pub use arbiter::{AutoUseTickInput, tick_auto_use_decide, tick_auto_use_execute};
pub use brain::{
    Brains, DuckBrain, Grudge, TemperamentTraits, create_duck_brains, grudge_weight, new_brain,
    note_brain_event, note_neighbours,
};
pub use chaos_utility::ChaosUtility;
pub use director::{DirectorCache, DirectorRead, read_race};
pub use objective::{RaceObjectiveContext, build_race_objective_context};
pub use types::{AutoUseCandidate, CandidateAction, CandidateSource};
