//! `SimulationOptions` (`simulation.ts:82-91`) and the engine maths switch.

use alloc::sync::Arc;
use alloc::vec::Vec;
use core::fmt;

use race_protocol::events::RecordedWildItemInput;
use race_protocol::ids::{PlayerId, WildItemId};

/// What a loot override hands a duck that opens a regular box
/// (`WildLootOverride`, `pickups/engine.ts:62-63`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LootPick {
    /// Grant this item.
    Item(WildItemId),
    /// `'NONE'`: an empty box.
    Empty,
}

/// Balance tooling only (never set for official races): overrides the loot a
/// duck rolls from regular boxes. Returning `None` rolls normally.
///
/// An `Arc<dyn Fn + Send + Sync>` (not `Rc`) so a [`super::Simulation`]
/// stays `Send`: the server driver moves live simulations between threads
/// (Phase 2 review 2 MINOR 5).
#[derive(Clone)]
pub struct WildLootOverride(pub Arc<LootFn>);

/// The override callback: `None` rolls normally.
pub type LootFn = dyn Fn(&PlayerId) -> Option<LootPick> + Send + Sync;

impl fmt::Debug for WildLootOverride {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("WildLootOverride(..)")
    }
}

/// `Math.exp`, `Math.pow` and `Math.hypot` as the engine computes them.
///
/// With `ts-compat` they reproduce V8 on the oracle host (`js_math`, D3): the
/// host comes from the trace header via `race-cli oracle diff`. Without it
/// they are the soft-float libm wrappers in [`crate::math`] (Phase B).
/// Engine code must use these, never `math::exp`/`js_math::exp` directly.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EngineMath {
    /// The V8 host the TS oracle ran on.
    #[cfg(feature = "ts-compat")]
    pub host: crate::js_math::OracleHost,
}

impl Default for EngineMath {
    /// With `ts-compat`: linux-x64 with V8's default `--use-std-math-pow`
    /// (the production host).
    fn default() -> Self {
        Self {
            #[cfg(feature = "ts-compat")]
            host: crate::js_math::OracleHost {
                target: crate::js_math::V8Target::DEFAULT,
                use_std_math_pow: true,
            },
        }
    }
}

impl EngineMath {
    /// The maths of a specific oracle host.
    #[cfg(feature = "ts-compat")]
    #[must_use]
    pub const fn oracle(host: crate::js_math::OracleHost) -> Self {
        Self { host }
    }

    /// `Math.exp(x)`.
    #[inline]
    #[must_use]
    pub fn exp(self, x: f64) -> f64 {
        #[cfg(feature = "ts-compat")]
        {
            self.host.exp(x)
        }
        #[cfg(not(feature = "ts-compat"))]
        {
            crate::math::exp(x)
        }
    }

    /// `Math.pow(x, y)` (and `x ** y`).
    #[inline]
    #[must_use]
    pub fn pow(self, x: f64, y: f64) -> f64 {
        #[cfg(feature = "ts-compat")]
        {
            self.host.pow(x, y)
        }
        #[cfg(not(feature = "ts-compat"))]
        {
            crate::math::pow(x, y)
        }
    }

    /// `Math.hypot(a, b)`.
    #[inline]
    #[must_use]
    pub fn hypot2(self, a: f64, b: f64) -> f64 {
        #[cfg(feature = "ts-compat")]
        {
            self.host.hypot2(a, b)
        }
        #[cfg(not(feature = "ts-compat"))]
        {
            crate::math::hypot(a, b)
        }
    }
}

/// `SimulationOptions` (`simulation.ts:82-91`).
///
/// - `recordEvents` defaults to `true`, as in TS (`options.recordEvents !==
///   false`).
/// - `onEvent` is not stored here: pass an [`super::EventSink`] to
///   `create_simulation` / `step_simulation` instead (no `'static` or `Send`
///   bound on callers).
/// - `phaseProfile` is not supported (no clock in a no_std engine).
#[derive(Clone, Debug)]
pub struct SimOptions {
    /// `simulateRace`'s tick budget; `None` means
    /// `CORE_BALANCE.maximumDurationSeconds * tickRate`.
    pub max_ticks: Option<u32>,
    /// Keep every emitted event in `Simulation::log` (TS `state.events`).
    pub record_events: bool,
    /// `manualInputs`: pre-recorded wild-item inputs (replays).
    pub manual_inputs: Vec<RecordedWildItemInput>,
    /// `aiAblationPlayerIds` (balance tooling): these ducks play with the
    /// Chaos-blind, personality-free brain.
    pub ai_ablation: Vec<PlayerId>,
    /// `lootOverride` (balance tooling).
    pub loot_override: Option<WildLootOverride>,
    /// The engine's transcendental functions (see [`EngineMath`]).
    pub math: EngineMath,
}

impl Default for SimOptions {
    fn default() -> Self {
        Self {
            max_ticks: None,
            record_events: true,
            manual_inputs: Vec::new(),
            ai_ablation: Vec::new(),
            loot_override: None,
            math: EngineMath::default(),
        }
    }
}

/// Simulation errors (the TS `throw`s of `resultFromSimulation` and
/// `simulateRace`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SimError {
    /// `resultFromSimulation` on a race that has not finished.
    NotFinished,
    /// `simulateRace`: the race did not finish within `max_ticks` ticks.
    /// `custom_budget` is set when `SimOptions::max_ticks` overrode the TS
    /// budget (`maximumDurationSeconds * tickRate`).
    DidNotFinish { max_ticks: u32, custom_budget: bool },
}

impl fmt::Display for SimError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFinished => f.write_str("Race has not finished"),
            // The TS message (`simulation.ts:683`) names the default budget
            // in seconds; a Rust-only `max_ticks` override names its ticks.
            Self::DidNotFinish {
                max_ticks,
                custom_budget: true,
            } => write!(f, "Race did not finish within {max_ticks} ticks"),
            Self::DidNotFinish {
                custom_budget: false,
                ..
            } => write!(
                f,
                "Race did not finish within {}s",
                crate::config::core_balance::MAXIMUM_DURATION_SECONDS
            ),
        }
    }
}

impl core::error::Error for SimError {}
