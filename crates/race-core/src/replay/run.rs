//! [`RaceRun`]: one race stepped tick by tick with everything an
//! authoritative or verifying run needs on the side (D9, D10, D16):
//! per-duck finish ticks, the `motionSha256` fold, an optional DTRK
//! recorder, and at the end the `DigestEnvelope`, `resultDigest` and
//! `engineConfigJson`.
//!
//! The server's live driver, `race-wasm`'s `SimHandle`/`simulate`/
//! `verifyIntegrity` and the boot golden self-test all go through this type,
//! so they cannot disagree on what the digest covers.

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use race_protocol::config::ResolvedRaceConfig;
use race_protocol::events::{RaceEvent, RecordedWildItemInput, WildItemUseCommand};
use race_protocol::result::{DigestEnvelope, DigestStanding, RaceResult};
use race_protocol::versions;

use super::recorder::{TrackRecorder, TrackRecording};
use super::track_def::track_def_sha256;
use crate::config::maximum_ticks;
use crate::digest::{Sha256Bytes, sha256_hex, to_hex};
use crate::hash::{HashFold, state_hash};
use crate::serde_jcs::to_jcs_string;
use crate::sim::{
    EventsDigest, SimError, SimOptions, Simulation, create_simulation, queue_wild_item_input,
    result_from_simulation, step_simulation,
};

/// `engineConfigJson = JCS(resolved config)` (D9).
///
/// # Errors
/// A non-finite number in the config (impossible after `resolve`).
pub fn engine_config_json(config: &ResolvedRaceConfig) -> Result<String, String> {
    to_jcs_string(config).map_err(|error| error.to_string())
}

/// Everything a finished run produces.
#[derive(Clone, Debug)]
pub struct RaceOutcome {
    /// `JCS(resolved config)`; `seedCommit = configCommit = sha256` of it.
    pub engine_config_json: String,
    pub result: RaceResult,
    pub envelope: DigestEnvelope,
    /// `sha256(JCS(envelope))`.
    pub result_digest: String,
    /// The envelope's JCS text (what `result_digest` hashes).
    pub envelope_jcs: String,
}

/// A race being stepped. See the module docs.
#[derive(Clone, Debug)]
pub struct RaceRun {
    sim: Simulation,
    motion: HashFold,
    finish_ticks: Vec<Option<u32>>,
    recorder: Option<TrackRecorder>,
    max_ticks: u32,
}

impl RaceRun {
    /// Creates the simulation (events are always recorded: the digest reads
    /// them) and, with `record_track`, a DTRK recorder that samples tick 0
    /// now and every tick after each step.
    #[must_use]
    pub fn new(config: ResolvedRaceConfig, mut options: SimOptions, record_track: bool) -> Self {
        options.record_events = true;
        let max_ticks = options
            .max_ticks
            .unwrap_or_else(|| maximum_ticks(config.tick_rate));
        let sim = create_simulation(config, options, None);
        let recorder = record_track.then(|| {
            let mut recorder = TrackRecorder::for_simulation(&sim);
            recorder.push_simulation(&sim);
            recorder
        });
        Self {
            finish_ticks: alloc::vec![None; sim.ducks.len()],
            sim,
            motion: HashFold::new(),
            recorder,
            max_ticks,
        }
    }

    /// The simulation (read-only: step through [`Self::step`]).
    #[must_use]
    pub fn simulation(&self) -> &Simulation {
        &self.sim
    }

    /// The current tick (0 before the first step).
    #[must_use]
    pub fn tick(&self) -> u32 {
        self.sim.tick
    }

    /// `true` once every duck has finished.
    #[must_use]
    pub fn finished(&self) -> bool {
        self.sim.finished
    }

    /// The tick budget (`maximumDurationSeconds * tickRate` by default).
    #[must_use]
    pub fn max_ticks(&self) -> u32 {
        self.max_ticks
    }

    /// Every event emitted so far (creation events included).
    #[must_use]
    pub fn events(&self) -> &[RaceEvent] {
        self.sim.events()
    }

    /// The finish tick of each duck in simulation order, once known.
    #[must_use]
    pub fn finish_ticks(&self) -> &[Option<u32>] {
        &self.finish_ticks
    }

    /// The `sh1` state hash of the current tick (D16 `stateHash`).
    #[must_use]
    pub fn state_hash(&self) -> Sha256Bytes {
        state_hash(&self.sim)
    }

    /// The recorder, when recording.
    #[must_use]
    pub fn recorder(&self) -> Option<&TrackRecorder> {
        self.recorder.as_ref()
    }

    /// Advances one tick. A no-op once finished or at the tick budget.
    pub fn step(&mut self) {
        if self.sim.finished || self.sim.tick >= self.max_ticks {
            return;
        }
        step_simulation(&mut self.sim, None);
        let tick = self.sim.tick;
        for (slot, duck) in self.finish_ticks.iter_mut().zip(&self.sim.ducks) {
            if duck.finished && slot.is_none() {
                *slot = Some(tick);
            }
        }
        if HashFold::is_motion_tick(tick) {
            self.motion.push(tick, &state_hash(&self.sim));
        }
        if let Some(recorder) = &mut self.recorder {
            recorder.push_simulation(&self.sim);
        }
    }

    /// Steps until `tick`, the finish or the budget, whichever comes first.
    pub fn step_to(&mut self, tick: u32) {
        while self.sim.tick < tick && !self.sim.finished && self.sim.tick < self.max_ticks {
            self.step();
        }
    }

    /// Runs to the finish.
    ///
    /// # Errors
    /// [`SimError::DidNotFinish`] at the tick budget.
    pub fn run_to_end(&mut self) -> Result<(), SimError> {
        self.step_to(u32::MAX);
        if self.sim.finished {
            Ok(())
        } else {
            Err(SimError::DidNotFinish {
                max_ticks: self.max_ticks,
                custom_budget: false,
            })
        }
    }

    /// `queueWildItemInput`: the input applies no earlier than the next tick.
    pub fn queue_input(
        &mut self,
        input: WildItemUseCommand,
        authoritative_tick: Option<u32>,
    ) -> RecordedWildItemInput {
        queue_wild_item_input(&mut self.sim, input, authoritative_tick)
    }

    /// The digest of a finished race, without consuming the run.
    ///
    /// # Errors
    /// The race has not finished, or a value can't be written as JCS.
    pub fn outcome(&self) -> Result<RaceOutcome, String> {
        let result = result_from_simulation(&self.sim).map_err(|error| error.to_string())?;
        let engine_config_json = engine_config_json(&self.sim.config)?;
        let mut events = EventsDigest::new();
        for event in self.sim.events() {
            events
                .push(event)
                .map_err(|error| format!("event {}: {error}", event.seq))?;
        }
        let mut motion = self.motion.clone();
        motion.push_final(self.sim.tick, &state_hash(&self.sim));
        let standings = result
            .standings
            .iter()
            .map(|entry| {
                let index = self
                    .sim
                    .duck_index(entry.player_id.as_str())
                    .ok_or_else(|| format!("no duck {}", entry.player_id))?;
                let finish_tick = self.finish_ticks[index]
                    .ok_or_else(|| format!("duck {} has no finish tick", entry.player_id))?;
                Ok(DigestStanding {
                    player_id: entry.player_id.clone(),
                    rank: entry.rank,
                    finish_tick,
                    finish_time_ms: entry.finish_time_ms,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let config = &self.sim.config;
        let envelope = DigestEnvelope {
            digest_version: versions::DIGEST_VERSION.into(),
            config_commit: sha256_hex(engine_config_json.as_bytes()),
            engine_version: config.engine_version.clone(),
            balance_version: config.balance_version.clone(),
            protocol_version: config.protocol_version.clone(),
            rng_version: versions::RNG_VERSION.into(),
            track_version: config.track_version.clone(),
            track_def_sha256: track_def_sha256(&self.sim.track).map_err(|e| e.to_string())?,
            duration_ticks: self.sim.tick,
            standings,
            events_sha256: to_hex(&events.finish()),
            motion_sha256: to_hex(motion.value()),
        };
        let envelope_jcs = to_jcs_string(&envelope).map_err(|error| error.to_string())?;
        Ok(RaceOutcome {
            result_digest: sha256_hex(envelope_jcs.as_bytes()),
            engine_config_json,
            result,
            envelope,
            envelope_jcs,
        })
    }

    /// Finishes the recording: `None` when not recording, otherwise the
    /// recording or why there is none (the caller then stores no track).
    #[must_use]
    pub fn take_recording(&mut self) -> Option<Result<TrackRecording, String>> {
        self.recorder.take().map(TrackRecorder::finalize)
    }
}
