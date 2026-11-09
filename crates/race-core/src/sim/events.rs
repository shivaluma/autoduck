//! `emitEvent` (`simulation.ts:93-109`), the event sink, and the `ev-jcs-v1`
//! event digest (`scripts/oracle/README.md`).

use alloc::string::String;
use alloc::vec::Vec;

use race_protocol::events::{EventKind, RaceEvent};
use race_protocol::ids::{PlayerId, RaceId};
use sha2::{Digest, Sha256};

use super::options::EngineMath;
use crate::auto_use::{Brains, note_brain_event};
use crate::serde_jcs::{self, SerdeJcsError};

/// `onEvent` (`SimulationOptions.onEvent`): receives every event as it is
/// emitted, recorded or not. Any `FnMut(&RaceEvent)` is a sink.
pub trait EventSink {
    fn on_event(&mut self, event: &RaceEvent);
}

impl<F: FnMut(&RaceEvent)> EventSink for F {
    fn on_event(&mut self, event: &RaceEvent) {
        self(event);
    }
}

/// Reborrows an optional sink for a shorter-lived [`Emitter`] (the
/// trait-object lifetime only shortens through an explicit coercion, never
/// inside an `Option`).
pub fn reborrow_sink<'b>(
    sink: &'b mut Option<&mut dyn EventSink>,
) -> Option<&'b mut dyn EventSink> {
    match sink {
        Some(sink) => Some(&mut **sink),
        None => None,
    }
}

/// `state.events` + `state.recordEvents`, plus the `seq` counter (D7: the
/// per-race emission index of every event that was built).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EventLog {
    pub record: bool,
    pub events: Vec<RaceEvent>,
    pub next_seq: u32,
}

impl EventLog {
    #[must_use]
    pub fn new(record: bool) -> Self {
        Self {
            record,
            events: Vec::new(),
            next_seq: 0,
        }
    }
}

/// The `emit` callback every engine system receives
/// (`(type, sourcePlayerId?, targetPlayerId?, metadata) => emitEvent(state, ...)`).
///
/// It borrows the event log, the optional sink and the duck brains, so a
/// system can hold `&mut ItemRaceState` / `&mut PickupRaceState` and still
/// emit. Systems that need the brains (auto-use) read them through
/// [`Self::brains`].
pub struct Emitter<'a> {
    pub log: &'a mut EventLog,
    pub sink: Option<&'a mut dyn EventSink>,
    pub brains: &'a mut Brains,
    pub race_id: &'a RaceId,
    /// `state.tick` at emission time.
    pub tick: u32,
    pub tick_rate: u32,
    pub math: EngineMath,
}

impl Emitter<'_> {
    /// `emitEvent(state, {type, sourcePlayerId, targetPlayerId, metadata})`.
    ///
    /// Race memory sees every event first (`noteBrainEvent`), recorded or
    /// not; the event is only built when it is recorded or a sink listens.
    pub fn emit(&mut self, kind: EventKind, source: Option<&PlayerId>, target: Option<&PlayerId>) {
        note_brain_event(
            self.brains,
            kind.type_name(),
            source.map(PlayerId::as_str),
            target.map(PlayerId::as_str),
            self.tick,
            self.tick_rate,
            self.math,
        );
        if !self.log.record && self.sink.is_none() {
            return;
        }
        let event = RaceEvent {
            race_id: self.race_id.clone(),
            tick: self.tick,
            timestamp_within_race_ms: f64::from(self.tick) * (1000.0 / f64::from(self.tick_rate)),
            source_player_id: source.cloned(),
            target_player_id: target.cloned(),
            kind,
            seq: self.log.next_seq,
        };
        self.log.next_seq = self
            .log
            .next_seq
            .checked_add(1)
            .expect("event seq fits in u32");
        if let Some(sink) = self.sink.as_deref_mut() {
            sink.on_event(&event);
        }
        if self.log.record {
            self.log.events.push(event);
        }
    }

    /// Whether events are recorded (`state.recordEvents`; collision events
    /// are only emitted when it is set, `simulation.ts:477`).
    #[must_use]
    pub fn recording(&self) -> bool {
        self.log.record
    }
}

/// The `ev-jcs-v1` text of one event: RFC 8785 JCS over the TS wire shape
/// `{raceId, type, tick, timestampWithinRaceMs, sourcePlayerId?,
/// targetPlayerId?, metadata}` (no `seq`).
///
/// # Errors
/// On a non-finite number in the metadata (D7: the TS oracle throws too).
pub fn event_jcs(event: &RaceEvent) -> Result<String, SerdeJcsError> {
    serde_jcs::to_jcs_string_omitting(event, &["seq"])
}

/// `eventsSha256` (`ev-jcs-v1`): `sha256(concat(jcs(event) + "\n"))` over all
/// non-meta events in emission order.
#[derive(Clone, Debug, Default)]
pub struct EventsDigest {
    hasher: Sha256,
    count: u64,
}

impl EventsDigest {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Folds one event; meta events (`CHAOS_RESOLVED`,
    /// `QP_TRACK_REWARD_GRANTED`) are skipped. Returns the JCS text of a
    /// folded event.
    ///
    /// # Errors
    /// As [`event_jcs`].
    pub fn push(&mut self, event: &RaceEvent) -> Result<Option<String>, SerdeJcsError> {
        if event.is_meta() {
            return Ok(None);
        }
        let text = event_jcs(event)?;
        self.hasher.update(text.as_bytes());
        self.hasher.update(b"\n");
        self.count += 1;
        Ok(Some(text))
    }

    /// Number of folded events.
    #[must_use]
    pub fn count(&self) -> u64 {
        self.count
    }

    /// The digest.
    #[must_use]
    pub fn finish(self) -> [u8; 32] {
        let mut out = [0u8; 32];
        out.copy_from_slice(self.hasher.finalize().as_slice());
        out
    }
}
