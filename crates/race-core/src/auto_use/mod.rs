//! The auto-use AI: `packages/race-core/src/auto-use/*` (S3.15).
//!
//! | Rust | TS |
//! |---|---|
//! | [`create_duck_brains`], [`note_brain_event`], [`note_neighbours`] | `brain.ts` |
//! | [`build_race_objective_context`] | `buildRaceObjectiveContext` (`objective.ts`) |
//! | [`ChaosUtility`] | `chaos-utility.ts` (ranking and outcome memos as plain fields) |
//! | [`director::read_race`] | `readRace` (`director.ts`), memo = `Simulation::director` |
//! | [`evaluate`] | `evaluate.ts` |
//! | [`execute`] | `execute.ts` |
//! | [`tick_auto_use_execute`], [`tick_auto_use_decide`], [`tick_auto_use_ai`] | `arbiter.ts` |
//!
//! `Math.exp`/`Math.pow` go through `sim::EngineMath` (`emit.math`).

pub mod arbiter;
pub mod brain;
pub mod chaos_utility;
pub mod config;
pub mod director;
pub mod evaluate;
pub mod execute;
pub mod objective;
pub mod types;

pub use arbiter::{
    AutoUseTickInput, tick_auto_use_ai, tick_auto_use_decide, tick_auto_use_execute,
};
pub use brain::{
    Brains, DuckBrain, Grudge, TemperamentTraits, create_duck_brains, grudge_weight, new_brain,
    note_brain_event, note_neighbours,
};
pub use chaos_utility::ChaosUtility;
pub use director::{DirectorCache, DirectorRead, read_race};
pub use objective::{RaceObjectiveContext, build_race_objective_context};
pub use types::{AutoUseCandidate, CandidateAction, CandidateSource};
