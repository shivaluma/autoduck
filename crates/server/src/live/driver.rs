//! The sim driver: one dedicated OS thread per race (plan Phase 5, D1, D21).
//!
//! The thread runs the whole simulation inside `catch_unwind`; the release profile unwinds
//! (`panic = "unwind"`) and race-core has overflow checks on, so an engine bug becomes a caught
//! panic: the driver reports the tick and the message, and the race task marks the race failed.
//! The process and every other race keep running.
//!
//! Pacing is `sleep_until(start + tick × 1/60 s)` on the thread itself ([`Pacing::RealTime`]),
//! so a slow tick is caught up without drift. Tests use [`Pacing::Unpaced`].
//!
//! Per tick the driver, in order: steps the [`RaceRun`] (sim, finish ticks, motion fold, DTRK
//! recorder), logs `engine-event` frames for the new events (snapshot subscribers only),
//! logs a `clock` frame every 3 ticks (with the `state_hash` every 60th tick, D16) and the final
//! tick, and publishes a snapshot every [`super::LiveOptions::snapshot_every_ticks`] ticks.

use std::io::Write as _;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::time::{Duration, Instant};

use race_core::digest::to_hex;
use race_core::replay::{EncodedTrack, RaceOutcome, RaceRun, encode_and_check, rust_track_meta};
use race_core::sim::{SimOptions, snapshot_world};
use race_protocol::config::ResolvedRaceConfig;
use race_protocol::snapshot::{StateSnapshotMessage, StateSnapshotType};
use serde_json::json;

use super::session::LiveSession;
use crate::cosmetics::js::stringify;

/// How the driver paces ticks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pacing {
    /// `tick_rate` ticks per second of wall time.
    RealTime,
    /// As fast as the CPU allows (tests, tooling).
    Unpaced,
}

/// `clock` frames every this many ticks (D16).
pub const CLOCK_EVERY_TICKS: u32 = 3;
/// `clock.hash` (the `state_hash` after stepping the tick) every this many ticks (D16).
pub const HASH_EVERY_TICKS: u32 = 60;

pub(crate) struct DriverInput {
    pub config: ResolvedRaceConfig,
    pub session: Arc<LiveSession>,
    pub pacing: Pacing,
    pub snapshot_every_ticks: u32,
    pub record_track: bool,
    /// Test hook: panic right before stepping to this tick.
    pub panic_at_tick: Option<u32>,
}

/// A finished simulation.
pub(crate) struct DriverOutput {
    pub outcome: RaceOutcome,
    /// The final tick (`durationTicks`).
    pub final_tick: u32,
    /// `None` when recording was off or failed (logged; never fails the race).
    pub track: Option<StoredTrack>,
}

/// A Rust-recorded DTRK/1 track, gzipped for `RaceReplayTrack.bytes`.
#[derive(Debug, Clone)]
pub struct StoredTrack {
    pub gzip: Vec<u8>,
    pub encoded: EncodedTrack,
}

/// Why the driver did not produce a result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriverFailure {
    /// The last tick the sim completed.
    pub tick: u32,
    pub message: String,
    pub panicked: bool,
}

impl std::fmt::Display for DriverFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let kind = if self.panicked { "panic" } else { "error" };
        write!(f, "sim {kind} after tick {}: {}", self.tick, self.message)
    }
}

/// Starts the driver thread. The result arrives on the returned channel; a thread that could not
/// be spawned reports a failure there too.
pub(crate) fn spawn(
    race_id: i64,
    input: DriverInput,
) -> tokio::sync::oneshot::Receiver<Result<DriverOutput, DriverFailure>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let session = Arc::clone(&input.session);
    let spawned = std::thread::Builder::new()
        .name(format!("race-{race_id}"))
        .stack_size(8 * 1024 * 1024)
        .spawn(move || {
            let outcome = catch_unwind(AssertUnwindSafe(|| run(input))).unwrap_or_else(|payload| {
                let message = payload
                    .downcast_ref::<&str>()
                    .map(|text| (*text).to_owned())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "non-string panic payload".to_owned());
                Err(DriverFailure {
                    tick: session.server_tick(),
                    message,
                    panicked: true,
                })
            });
            let _ = sender.send(outcome);
        });
    if let Err(error) = spawned {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let _ = sender.send(Err(DriverFailure {
            tick: 0,
            message: format!("cannot spawn the driver thread: {error}"),
            panicked: false,
        }));
        return receiver;
    }
    receiver
}

fn run(input: DriverInput) -> Result<DriverOutput, DriverFailure> {
    let DriverInput {
        config,
        session,
        pacing,
        snapshot_every_ticks,
        record_track,
        panic_at_tick,
    } = input;
    let tick_rate = config.tick_rate.max(1);
    let protocol_version = config.protocol_version.clone();
    let race_id = config.race_id.clone();
    let tick_nanos = 1_000_000_000_u64 / u64::from(tick_rate);
    let fail = |tick: u32, message: String| DriverFailure {
        tick,
        message,
        panicked: false,
    };

    let mut run = RaceRun::new(config, SimOptions::default(), record_track);
    let mut emitted = run.events().len();
    let started = Instant::now();

    while !run.finished() {
        if run.tick() >= run.max_ticks() {
            return Err(fail(
                run.tick(),
                format!("race did not finish within {} ticks", run.max_ticks()),
            ));
        }
        if panic_at_tick == Some(run.tick() + 1) {
            panic!("injected sim panic at tick {}", run.tick() + 1);
        }
        run.step();
        let tick = run.tick();
        let finished = run.finished();
        session.set_server_tick(tick);

        let events = run.events();
        for event in &events[emitted..] {
            if let Ok(value) = serde_json::to_value(event) {
                session.push("engine-event", stringify(&value), true);
            }
        }
        emitted = events.len();

        if tick.is_multiple_of(CLOCK_EVERY_TICKS) || finished {
            let mut clock = json!({ "tick": tick });
            if tick > 0 && tick.is_multiple_of(HASH_EVERY_TICKS) {
                clock["hash"] = json!(to_hex(&run.state_hash()));
            }
            session.push_json("clock", &clock);
        }
        if tick.is_multiple_of(snapshot_every_ticks.max(1)) || finished {
            let message = StateSnapshotMessage {
                message_type: StateSnapshotType::StateSnapshot,
                protocol_version: protocol_version.clone(),
                race_id: race_id.clone(),
                tick,
                world: snapshot_world(run.simulation()),
            };
            if let Ok(value) = serde_json::to_value(&message) {
                session.set_snapshot(stringify(&value));
            }
        }

        if pacing == Pacing::RealTime && !finished {
            let deadline = started + Duration::from_nanos(tick_nanos * u64::from(tick));
            let now = Instant::now();
            if deadline > now {
                std::thread::sleep(deadline - now);
            }
        }
    }

    let final_tick = run.tick();
    let outcome = run.outcome().map_err(|error| fail(final_tick, error))?;
    let track = match run.take_recording() {
        None => None,
        Some(recording) => match recording.and_then(|recording| {
            let meta = rust_track_meta(
                &outcome.result,
                Some(outcome.result_digest.clone()),
                engine_commit(),
            );
            let encoded = encode_and_check(&recording, &meta, &outcome.result, final_tick)?;
            let gzip = gzip(&encoded.payload).map_err(|error| format!("gzip: {error}"))?;
            Ok(StoredTrack { gzip, encoded })
        }) {
            Ok(track) => Some(track),
            Err(reason) => {
                tracing::error!(race = %race_id, %reason, "[replay-track] no track stored");
                None
            }
        },
    };
    Ok(DriverOutput {
        outcome,
        final_tick,
        track,
    })
}

/// `SOURCE_COMMIT` or `GIT_SHA` (as the TS recorder's `replayTrackEngineCommit`).
fn engine_commit() -> Option<String> {
    ["SOURCE_COMMIT", "GIT_SHA"]
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty()))
}

fn gzip(payload: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(payload)?;
    encoder.finish()
}
