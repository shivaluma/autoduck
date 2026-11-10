//! Whole-race determinism digests for pinned fixtures (D26, Phase 2 review 2
//! MAJOR 2).
//!
//! [`digest_case`] runs one race to the end and folds the same values the TS
//! oracle trace records (`runCase` in `scripts/oracle/dump-trace.ts`): the
//! `sh1` state hash of every tick into `stateChainSha256`, the motion sample
//! into `motionSha256`, the `ev-jcs-v1` event digest, the final tick and the
//! standings by f64 bits. CI pins these per feature set and compares native,
//! wasm32-wasip1 and the shipped wasm-bindgen package
//! (`tests/determinism_pinned.rs`, `race-wasm` `runCaseDigest`).
//!
//! [`digest_corpus_line`] reads a `race-cli corpus gen` line (including the
//! `oracleManualInputs` key of an `items` corpus) and resolves it for the
//! active feature set: with `ts-compat` exactly as the TS oracle does
//! (`resolve_ts_compat`); without it, with the version labels dropped so the
//! engine resolver fills in its own (labels never change the simulation).

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::RecordedWildItemInput;
use serde::{Deserialize, Serialize};

use super::{
    EngineMath, EventsDigest, SimOptions, create_simulation, result_from_simulation,
    step_simulation,
};
use crate::config::maximum_ticks;
use crate::digest::to_hex;
use crate::hash::{HashFold, state_hash};

/// One standing of a [`CaseDigest`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestStanding {
    pub player_id: String,
    pub rank: u32,
    /// Raw f64 bits of `finishTimeMs`, big-endian hex.
    pub finish_time_bits: String,
}

/// The digest of one race, in the field names of a TS trace record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseDigest {
    pub finished: bool,
    pub final_tick: u32,
    pub state_chain_sha256: String,
    pub motion_sha256: String,
    pub event_count: u64,
    pub events_sha256: String,
    /// `None` when the race did not finish within the tick budget.
    pub standings: Option<Vec<DigestStanding>>,
}

/// Runs `config` to the end (or `options.max_ticks`, default
/// `maximumDurationSeconds * tickRate`) and digests it. `options.record_events`
/// is forced on: the event digest reads the log.
///
/// # Errors
/// A non-finite number in an event's metadata (D7) or a failed
/// `resultFromSimulation`.
pub fn digest_case(
    config: ResolvedRaceConfig,
    mut options: SimOptions,
) -> Result<CaseDigest, String> {
    let max_ticks = options
        .max_ticks
        .unwrap_or_else(|| maximum_ticks(config.tick_rate));
    options.record_events = true;
    let mut sim = create_simulation(config, options, None);
    let mut chain = HashFold::new();
    let mut motion = HashFold::new();
    let mut last = state_hash(&sim);
    chain.push(sim.tick, &last);
    while !sim.finished && sim.tick < max_ticks {
        step_simulation(&mut sim, None);
        last = state_hash(&sim);
        chain.push(sim.tick, &last);
        if HashFold::is_motion_tick(sim.tick) {
            motion.push(sim.tick, &last);
        }
    }
    motion.push_final(sim.tick, &last);
    let mut events = EventsDigest::new();
    for event in sim.events() {
        events
            .push(event)
            .map_err(|error| format!("event {}: {error}", event.seq))?;
    }
    let event_count = events.count();
    let standings = if sim.finished {
        let result = result_from_simulation(&sim).map_err(|error| error.to_string())?;
        Some(
            result
                .standings
                .iter()
                .map(|entry| DigestStanding {
                    player_id: entry.player_id.as_str().into(),
                    rank: entry.rank,
                    finish_time_bits: format!("{:016x}", entry.finish_time_ms.to_bits()),
                })
                .collect(),
        )
    } else {
        None
    };
    Ok(CaseDigest {
        finished: sim.finished,
        final_tick: sim.tick,
        state_chain_sha256: to_hex(chain.value()),
        motion_sha256: to_hex(motion.value()),
        event_count,
        events_sha256: to_hex(&events.finish()),
        standings,
    })
}

/// A parsed corpus line: the resolved config and its manual wild-item inputs.
pub struct CorpusCase {
    pub config: ResolvedRaceConfig,
    pub manual_inputs: Vec<RecordedWildItemInput>,
}

/// Parses and resolves a corpus line for the active feature set (module
/// docs).
///
/// # Errors
/// The line is not a valid config.
pub fn parse_corpus_line(line: &str) -> Result<CorpusCase, String> {
    #[derive(Deserialize)]
    struct Extras {
        #[serde(default, rename = "oracleManualInputs")]
        manual_inputs: Vec<RecordedWildItemInput>,
    }
    #[cfg_attr(feature = "ts-compat", allow(unused_mut))]
    let mut input: RaceConfigInput =
        serde_json::from_str(line).map_err(|error| format!("parse: {error}"))?;
    let extras: Extras =
        serde_json::from_str(line).map_err(|error| format!("parse oracleManualInputs: {error}"))?;
    #[cfg(feature = "ts-compat")]
    let config = input.resolve_ts_compat();
    #[cfg(not(feature = "ts-compat"))]
    let config = {
        input.protocol_version = None;
        input.engine_version = None;
        input.balance_version = None;
        input.track_version = None;
        input.pickup_spawn_version = None;
        input.wild_item_balance_version = None;
        input.hazard_balance_version = None;
        input.resolve()
    };
    Ok(CorpusCase {
        config: config.map_err(|error| format!("resolve: {error:?}"))?,
        manual_inputs: extras.manual_inputs,
    })
}

/// [`parse_corpus_line`] then [`digest_case`] with `math`.
///
/// # Errors
/// As [`parse_corpus_line`] and [`digest_case`].
pub fn digest_corpus_line(line: &str, math: EngineMath) -> Result<CaseDigest, String> {
    let CorpusCase {
        config,
        manual_inputs,
    } = parse_corpus_line(line)?;
    digest_case(
        config,
        SimOptions {
            manual_inputs,
            math,
            ..SimOptions::default()
        },
    )
}
