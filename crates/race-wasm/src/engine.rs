//! The browser engine API (plan Phase 5). JSON text in and out; see the
//! crate docs. Every function is plain Rust too, so it is tested natively.

use race_core::replay::{
    RaceOutcome, RaceRun, encode_and_check, engine_config_json, rust_track_meta,
};
use race_core::sim::SimOptions;
use race_core::stats::{self, PostRacePlayerInput, manual_inputs_from_events};
use race_protocol::config::{RaceConfigInput, ResolvedRaceConfig};
use race_protocol::events::{RaceEvent, RecordedWildItemInput, WildItemUseCommand};
use race_protocol::result::{DigestEnvelope, RaceFinishEntry};
use race_protocol::versions;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

fn json<T: Serialize + ?Sized>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn parse_config(config_json: &str) -> Result<ResolvedRaceConfig, String> {
    let input: RaceConfigInput =
        serde_json::from_str(config_json).map_err(|error| format!("config: {error}"))?;
    input.resolve().map_err(|error| format!("config: {error}"))
}

fn parse_inputs(manual_inputs_json: &str) -> Result<Vec<RecordedWildItemInput>, String> {
    if manual_inputs_json.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(manual_inputs_json).map_err(|error| format!("manualInputs: {error}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineInfo {
    engine_build_id: &'static str,
    race_engine_version: &'static str,
    race_balance_version: &'static str,
    race_protocol_version: &'static str,
    track_version: &'static str,
    race_tick_rate: u32,
    supported_balance_versions: &'static [&'static str],
}

/// `engineInfo()`: `{engineBuildId, raceEngineVersion, raceBalanceVersion,
/// raceProtocolVersion, trackVersion, raceTickRate, supportedBalanceVersions}`.
/// The live view predicts only when `engineBuildId` equals the server's
/// `hello.engineBuildId`.
#[wasm_bindgen(js_name = engineInfo)]
#[must_use]
pub fn engine_info() -> String {
    json(&EngineInfo {
        engine_build_id: race_core::ENGINE_BUILD_ID,
        race_engine_version: versions::RACE_ENGINE_VERSION,
        race_balance_version: versions::RACE_BALANCE_VERSION,
        race_protocol_version: versions::RACE_PROTOCOL_VERSION,
        track_version: versions::TRACK_VERSION,
        race_tick_rate: versions::RACE_TICK_RATE,
        supported_balance_versions: &versions::SUPPORTED_BALANCE_VERSIONS,
    })
    .unwrap_or_default()
}

/// `normalizeConfig(json)`: parses a config input (D8: Rust parses the
/// numbers), fills defaults and checks the version labels; returns the
/// resolved config JSON (the shape the engine runs and the canvas reads).
///
/// # Errors
/// An invalid config or an unsupported version label.
#[wasm_bindgen(js_name = normalizeConfig)]
pub fn normalize_config(config_json: &str) -> Result<String, String> {
    json(&parse_config(config_json)?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DigestOut<'a> {
    result_digest: &'a str,
    envelope: &'a DigestEnvelope,
    engine_config_json: &'a str,
    seed_commit: &'a str,
    standings: &'a [RaceFinishEntry],
    duration_ms: f64,
    final_tick: u32,
}

fn digest_out(outcome: &RaceOutcome, final_tick: u32) -> Result<String, String> {
    json(&DigestOut {
        result_digest: &outcome.result_digest,
        envelope: &outcome.envelope,
        engine_config_json: &outcome.engine_config_json,
        seed_commit: &outcome.envelope.config_commit,
        standings: &outcome.result.standings,
        duration_ms: outcome.result.duration_ms,
        final_tick,
    })
}

/// `simulate(configJson, manualInputsJson, includeEvents)`: runs the race
/// to the end and returns `{resultDigest, envelope, engineConfigJson,
/// seedCommit, standings, durationMs, finalTick, events?}`.
///
/// # Errors
/// An invalid config or inputs, or a race that does not finish.
#[wasm_bindgen]
pub fn simulate(
    config_json: &str,
    manual_inputs_json: &str,
    include_events: bool,
) -> Result<String, String> {
    let config = parse_config(config_json)?;
    let options = SimOptions {
        manual_inputs: parse_inputs(manual_inputs_json)?,
        ..SimOptions::default()
    };
    let mut run = RaceRun::new(config, options, false);
    run.run_to_end().map_err(|error| error.to_string())?;
    let outcome = run.outcome()?;
    let digest = digest_out(&outcome, run.tick())?;
    if !include_events {
        return Ok(digest);
    }
    // `{...digest, "events": [...]}` without re-parsing the digest JSON.
    let events = json(&outcome.result.events)?;
    Ok(format!(
        "{},\"events\":{events}}}",
        digest.strip_suffix('}').unwrap_or(&digest)
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityOut {
    ok: bool,
    /// `sha256(engineConfigJson)`.
    config_commit: String,
    seed_commit_matches: bool,
    /// The text parses as a config of this engine (supported versions).
    config_valid: bool,
    /// The text is exactly `JCS(resolve(text))`, i.e. as the server wrote it.
    canonical: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// `verifyIntegrity(engineConfigJson, seedCommit)`: the checks that need no
/// simulation (D9): the stored config text hashes to the published
/// `seedCommit`, parses as a supported config, and is canonical JCS.
#[wasm_bindgen(js_name = verifyIntegrity)]
#[must_use]
pub fn verify_integrity(engine_config_json_text: &str, seed_commit: &str) -> String {
    let config_commit = race_core::digest::sha256_hex(engine_config_json_text.as_bytes());
    let seed_commit_matches = config_commit.eq_ignore_ascii_case(seed_commit.trim());
    let (config_valid, canonical, error) = match parse_config(engine_config_json_text) {
        Ok(config) => match engine_config_json(&config) {
            Ok(text) => (true, text == engine_config_json_text, None),
            Err(error) => (true, false, Some(error)),
        },
        Err(error) => (false, false, Some(error)),
    };
    json(&IntegrityOut {
        ok: seed_commit_matches && config_valid && canonical,
        config_commit,
        seed_commit_matches,
        config_valid,
        canonical,
        error,
    })
    .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResimOut {
    ok: bool,
    result_digest: Option<String>,
    digest_matches: bool,
    /// The re-simulated engine events equal the stored ones (meta events and
    /// `seq` excluded), compared through `eventsSha256`.
    events_match: Option<bool>,
    final_tick: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn verify_resim_inner(
    engine_config_json_text: &str,
    events_json: &str,
    result_digest: &str,
) -> Result<ResimOut, String> {
    let config = parse_config(engine_config_json_text)?;
    let stored: Vec<RaceEvent> =
        serde_json::from_str(events_json).map_err(|error| format!("events: {error}"))?;
    let options = SimOptions {
        manual_inputs: manual_inputs_from_events(&stored),
        ..SimOptions::default()
    };
    let mut run = RaceRun::new(config, options, false);
    run.run_to_end().map_err(|error| error.to_string())?;
    let outcome = run.outcome()?;
    let events_match = if stored.is_empty() {
        None
    } else {
        let mut digest = race_core::sim::EventsDigest::new();
        for event in &stored {
            digest.push(event).map_err(|error| error.to_string())?;
        }
        Some(race_core::digest::to_hex(&digest.finish()) == outcome.envelope.events_sha256)
    };
    let digest_matches = outcome
        .result_digest
        .eq_ignore_ascii_case(result_digest.trim());
    Ok(ResimOut {
        ok: digest_matches && events_match != Some(false),
        result_digest: Some(outcome.result_digest),
        digest_matches,
        events_match,
        final_tick: Some(run.tick()),
        error: None,
    })
}

/// `verifyResim(engineConfigJson, eventsJson, resultDigest)` ("Xác minh
/// lại"): re-simulates the stored config with the manual inputs found in the
/// stored events and compares the recomputed `resultDigest` (and the event
/// stream) with the stored values. Only for versions this engine supports.
#[wasm_bindgen(js_name = verifyResim)]
#[must_use]
pub fn verify_resim(
    engine_config_json_text: &str,
    events_json: &str,
    result_digest: &str,
) -> String {
    let out = verify_resim_inner(engine_config_json_text, events_json, result_digest)
        .unwrap_or_else(|error| ResimOut {
            ok: false,
            result_digest: None,
            digest_matches: false,
            events_match: None,
            final_tick: None,
            error: Some(error),
        });
    json(&out).unwrap_or_default()
}

/// `postRaceStats(configJson, eventsJson, playersJson)`: `PostRaceStats`
/// (`statsJson`) with motion and no-items baseline from this engine.
///
/// # Errors
/// Invalid JSON.
#[wasm_bindgen(js_name = postRaceStats)]
pub fn post_race_stats(
    config_json: &str,
    events_json: &str,
    players_json: &str,
) -> Result<String, String> {
    let config = parse_config(config_json)?;
    let events: Vec<RaceEvent> =
        serde_json::from_str(events_json).map_err(|error| format!("events: {error}"))?;
    let players: Vec<PostRacePlayerInput> =
        serde_json::from_str(players_json).map_err(|error| format!("players: {error}"))?;
    json(&stats::build(&config, &events, &players))
}

/// A race stepped on demand (race lab, replays without a track, live view).
///
/// Events: [`SimHandle::drain_events`] returns the events emitted since the
/// last drain; creation events (tick 0) are skipped, as the canvas has always
/// done.
#[wasm_bindgen]
pub struct SimHandle {
    run: RaceRun,
    drained: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueueInput {
    #[serde(flatten)]
    command: WildItemUseCommand,
}

#[wasm_bindgen]
impl SimHandle {
    /// `new SimHandle(configJson, manualInputsJson, recordTrack)`.
    ///
    /// # Errors
    /// An invalid config or inputs.
    #[wasm_bindgen(constructor)]
    pub fn new(
        config_json: &str,
        manual_inputs_json: &str,
        record_track: bool,
    ) -> Result<SimHandle, String> {
        let config = parse_config(config_json)?;
        let options = SimOptions {
            manual_inputs: parse_inputs(manual_inputs_json)?,
            ..SimOptions::default()
        };
        let run = RaceRun::new(config, options, record_track);
        let drained = run.events().len();
        Ok(Self { run, drained })
    }

    /// The current tick.
    #[must_use]
    pub fn tick(&self) -> u32 {
        self.run.tick()
    }

    /// `true` once every duck has finished.
    #[must_use]
    pub fn finished(&self) -> bool {
        self.run.finished()
    }

    /// Steps to `min(tick, finish, budget)`; returns the new tick.
    #[wasm_bindgen(js_name = stepTo)]
    pub fn step_to(&mut self, tick: u32) -> u32 {
        self.run.step_to(tick);
        self.run.tick()
    }

    /// `snapshotRaceWorld` JSON (ducks by rank).
    ///
    /// # Errors
    /// Never in practice (serialisation of finite engine values).
    pub fn world(&self) -> Result<String, String> {
        json(&race_core::sim::snapshot_world(self.run.simulation()))
    }

    /// Events emitted since the last drain, as a JSON array.
    ///
    /// # Errors
    /// Never in practice.
    #[wasm_bindgen(js_name = drainEvents)]
    pub fn drain_events(&mut self) -> Result<String, String> {
        let events = self.run.events();
        let out = json(&events[self.drained.min(events.len())..])?;
        self.drained = events.len();
        Ok(out)
    }

    /// `queueWildItemInput`: `inputJson` is a `WildItemUseCommand`; the
    /// input applies at `max(authoritativeTick, tick + 1)`. Returns the
    /// recorded input JSON.
    ///
    /// # Errors
    /// Invalid input JSON.
    #[wasm_bindgen(js_name = queueInput)]
    pub fn queue_input(
        &mut self,
        input_json: &str,
        authoritative_tick: Option<u32>,
    ) -> Result<String, String> {
        let input: QueueInput =
            serde_json::from_str(input_json).map_err(|error| format!("input: {error}"))?;
        json(&self.run.queue_input(input.command, authoritative_tick))
    }

    /// The `sh1` state hash of the current tick, lowercase hex (D16).
    #[wasm_bindgen(js_name = stateHash)]
    #[must_use]
    pub fn state_hash(&self) -> String {
        race_core::digest::to_hex(&self.run.state_hash())
    }

    /// The digest of the finished race: `{resultDigest, envelope,
    /// engineConfigJson, seedCommit, standings, durationMs, finalTick}`.
    ///
    /// # Errors
    /// The race has not finished.
    pub fn digest(&self) -> Result<String, String> {
        digest_out(&self.run.outcome()?, self.run.tick())
    }

    /// The uncompressed DTRK/1 payload of a finished race recorded with
    /// `recordTrack` (once; the recorder is consumed). Self-checked against
    /// the standings.
    ///
    /// # Errors
    /// Not recording, not finished, or the recorder or self-check failed.
    #[wasm_bindgen(js_name = trackPayload)]
    pub fn track_payload(&mut self) -> Result<Vec<u8>, String> {
        let outcome = self.run.outcome()?;
        let recording = self
            .run
            .take_recording()
            .ok_or_else(|| String::from("this SimHandle does not record a track"))??;
        let meta = rust_track_meta(&outcome.result, Some(outcome.result_digest.clone()), None);
        encode_and_check(&recording, &meta, &outcome.result, self.run.tick())
            .map(|track| track.payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Fixture {
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        id: String,
        line: String,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Digest {
        result_digest: String,
        engine_config_json: String,
        seed_commit: String,
        final_tick: u32,
        #[serde(default)]
        events: Vec<RaceEvent>,
    }

    fn line(id: &str) -> String {
        let fixture: Fixture = serde_json::from_str(include_str!(
            "../../race-core/tests/fixtures/determinism-pinned.json"
        ))
        .unwrap();
        fixture.cases.into_iter().find(|c| c.id == id).unwrap().line
    }

    /// A pinned `full` line without its legacy version labels (the browser
    /// engine refuses other versions).
    fn config() -> String {
        let mut input: RaceConfigInput = serde_json::from_str(&line("full-0112")).unwrap();
        input.protocol_version = None;
        input.engine_version = None;
        input.balance_version = None;
        input.track_version = None;
        input.pickup_spawn_version = None;
        input.wild_item_balance_version = None;
        input.hazard_balance_version = None;
        serde_json::to_string(&input.resolve().unwrap()).unwrap()
    }

    #[test]
    fn simulate_handle_and_verifiers_agree() {
        let config = config();
        let normalized = normalize_config(&config).unwrap();
        assert_eq!(normalized, config);
        let simulated: Digest =
            serde_json::from_str(&simulate(&config, "[]", true).unwrap()).unwrap();
        assert!(!simulated.events.is_empty());

        let mut handle = SimHandle::new(&config, "[]", true).unwrap();
        assert!(handle.drain_events().unwrap() == "[]");
        assert_eq!(handle.step_to(60), 60);
        assert_eq!(handle.state_hash().len(), 64);
        assert!(handle.world().unwrap().starts_with("{\"ducks\":["));
        assert!(handle.drain_events().unwrap().len() > 2);
        assert!(handle.digest().is_err());
        handle.step_to(u32::MAX);
        assert!(handle.finished());
        let digest: Digest = serde_json::from_str(&handle.digest().unwrap()).unwrap();
        assert_eq!(digest.result_digest, simulated.result_digest);
        assert_eq!(digest.final_tick, simulated.final_tick);
        let payload = handle.track_payload().unwrap();
        assert_eq!(&payload[..4], b"DTRK");
        assert!(handle.track_payload().is_err());

        let integrity = verify_integrity(&digest.engine_config_json, &digest.seed_commit);
        assert!(integrity.starts_with("{\"ok\":true"), "{integrity}");
        assert!(verify_integrity(&digest.engine_config_json, "00").starts_with("{\"ok\":false"));
        let events = serde_json::to_string(&simulated.events).unwrap();
        let resim = verify_resim(&digest.engine_config_json, &events, &digest.result_digest);
        assert!(resim.starts_with("{\"ok\":true"), "{resim}");
        let wrong = verify_resim(&digest.engine_config_json, &events, "deadbeef");
        assert!(wrong.starts_with("{\"ok\":false"), "{wrong}");
    }

    #[test]
    fn info_and_errors() {
        assert!(engine_info().contains(race_core::ENGINE_BUILD_ID));
        assert!(normalize_config("{}").is_err());
        assert!(SimHandle::new("{", "[]", false).is_err());
        let stats = post_race_stats(
            &config(),
            &serde_json::to_string(&Vec::<RaceEvent>::new()).unwrap(),
            "[{\"playerId\":\"88\",\"name\":\"A\"}]",
        )
        .unwrap();
        assert!(stats.starts_with("{\"hasBaseline\":true"), "{stats}");
    }
}
