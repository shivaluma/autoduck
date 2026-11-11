//! One live race in memory: its frame log (the D16 `replay_log`), the latest snapshot, the
//! engine state and the server tick.
//!
//! Frames get consecutive ids from 1 (the SSE `id:`). The log keeps **every** frame of the race,
//! so a subscriber never loses one: it remembers the last id it sent and copies everything newer
//! from the log whenever the `seq` watch changes. A slow subscriber therefore never sees a
//! `Lagged` error; it just copies a longer run on its next wake-up (D16: "on `Lagged` the server
//! re-sends from `replay_log` and never drops the stream"). `Last-Event-ID` resumes the same way.
//!
//! Snapshots (`?snapshots=1`) are not logged: only the newest one is kept, in its own watch.
//!
//! The driver thread writes through `std::sync` locks (never held across an `.await`).

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use serde_json::{Value, json};
use tokio::sync::watch;
use tokio::time::Instant;

use crate::cosmetics::js::stringify;

/// One SSE frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// The SSE `id:` (from 1); `0` for frames that are not logged (snapshots).
    pub id: u64,
    pub event: &'static str,
    /// JSON text.
    pub data: String,
    /// Only sent to `?snapshots=1` subscribers (`engine-event`).
    pub snapshot_only: bool,
}

impl Frame {
    /// The SSE wire form.
    #[must_use]
    pub fn to_sse(&self) -> String {
        let mut out = String::with_capacity(self.data.len() + 32);
        if self.id > 0 {
            out.push_str("id: ");
            out.push_str(&self.id.to_string());
            out.push('\n');
        }
        out.push_str("event: ");
        out.push_str(self.event);
        out.push('\n');
        // Our JSON never contains a raw newline (`stringify` escapes them), so one data line.
        out.push_str("data: ");
        out.push_str(&self.data);
        out.push_str("\n\n");
        out
    }
}

#[derive(Debug, Clone)]
struct StateView {
    engine_state: &'static str,
    countdown_ends_at: Option<Instant>,
    /// `engineConfigJson`, revealed from RACING on (D17).
    config_jcs: Option<Arc<str>>,
    final_tick: Option<u32>,
}

/// A live race.
#[derive(Debug)]
pub struct LiveSession {
    pub race_id: i64,
    pub is_test: bool,
    /// The week this race runs for (official: the claimed week; test: the week it was started on).
    pub week_id: i64,
    engine_version: String,
    balance_version: String,
    protocol_version: String,
    state: Mutex<StateView>,
    server_tick: AtomicU32,
    log: RwLock<Vec<Arc<Frame>>>,
    seq: watch::Sender<u64>,
    snapshot: watch::Sender<Option<Arc<Frame>>>,
    closed: AtomicBool,
}

impl LiveSession {
    pub(crate) fn new(
        race_id: i64,
        is_test: bool,
        week_id: i64,
        versions: (&str, &str, &str),
    ) -> Arc<Self> {
        let (seq, _) = watch::channel(0);
        let (snapshot, _) = watch::channel(None);
        Arc::new(Self {
            race_id,
            is_test,
            week_id,
            engine_version: versions.0.to_owned(),
            balance_version: versions.1.to_owned(),
            protocol_version: versions.2.to_owned(),
            state: Mutex::new(StateView {
                engine_state: "COUNTDOWN",
                countdown_ends_at: None,
                config_jcs: None,
                final_tick: None,
            }),
            server_tick: AtomicU32::new(0),
            log: RwLock::new(Vec::new()),
            seq,
            snapshot,
            closed: AtomicBool::new(false),
        })
    }

    fn with_state<R>(&self, f: impl FnOnce(&mut StateView) -> R) -> R {
        let mut guard = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut guard)
    }

    /// The engine state the stream reports (`COUNTDOWN`, `RACING`, `FINISHED`, `RESOLVED`).
    #[must_use]
    pub fn engine_state(&self) -> &'static str {
        self.with_state(|state| state.engine_state)
    }

    /// The last tick the driver stepped (0 before the start).
    #[must_use]
    pub fn server_tick(&self) -> u32 {
        self.server_tick.load(Ordering::Acquire)
    }

    pub(crate) fn set_server_tick(&self, tick: u32) {
        self.server_tick.store(tick, Ordering::Release);
    }

    pub(crate) fn set_countdown(&self, ends_at: Instant) {
        self.with_state(|state| state.countdown_ends_at = Some(ends_at));
    }

    /// Frames logged so far (the highest id).
    #[must_use]
    pub fn high_water(&self) -> u64 {
        *self.seq.borrow()
    }

    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    /// Appends a frame to the log and wakes subscribers.
    pub(crate) fn push(&self, event: &'static str, data: String, snapshot_only: bool) -> u64 {
        let id = {
            let mut log = self
                .log
                .write()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let id = log.len() as u64 + 1;
            log.push(Arc::new(Frame {
                id,
                event,
                data,
                snapshot_only,
            }));
            id
        };
        self.seq.send_replace(id);
        id
    }

    pub(crate) fn push_json(&self, event: &'static str, value: &Value) -> u64 {
        self.push(event, stringify(value), false)
    }

    /// Replaces the latest snapshot (`?snapshots=1`).
    pub(crate) fn set_snapshot(&self, data: String) {
        self.snapshot.send_replace(Some(Arc::new(Frame {
            id: 0,
            event: "snapshot",
            data,
            snapshot_only: true,
        })));
    }

    /// COUNTDOWN → RACING: reveals the config (D17) and logs the `start` frame.
    pub(crate) fn start(&self, config_jcs: Arc<str>) {
        self.with_state(|state| {
            state.engine_state = "RACING";
            state.countdown_ends_at = None;
            state.config_jcs = Some(Arc::clone(&config_jcs));
        });
        self.push_json(
            "start",
            &json!({ "configJcs": &*config_jcs, "startTick": 0 }),
        );
    }

    /// T1 committed: logs `finished`.
    pub(crate) fn finished(&self, final_tick: u32, finished: &Value) {
        self.with_state(|state| {
            state.engine_state = "FINISHED";
            state.final_tick = Some(final_tick);
        });
        self.push_json("finished", finished);
    }

    /// T2 committed: logs `resolved` and closes the stream.
    pub(crate) fn resolved(&self, resolved: &Value) {
        self.with_state(|state| state.engine_state = "RESOLVED");
        self.push_json("resolved", resolved);
        self.close();
    }

    /// The race failed: logs `failed` and closes the stream.
    pub(crate) fn failed(&self) {
        self.push_json("failed", &json!({ "raceId": self.race_id.to_string() }));
        self.close();
    }

    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
        // Wake every subscriber so it sees `closed`.
        self.seq.send_modify(|_| {});
    }

    /// Frames with `id > after` (all of them, snapshot-only included).
    #[must_use]
    pub fn frames_after(&self, after: u64) -> Vec<Arc<Frame>> {
        let log = self
            .log
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let start = usize::try_from(after).unwrap_or(usize::MAX).min(log.len());
        log[start..].to_vec()
    }

    pub(crate) fn subscribe_seq(&self) -> watch::Receiver<u64> {
        self.seq.subscribe()
    }

    pub(crate) fn subscribe_snapshot(&self) -> watch::Receiver<Option<Arc<Frame>>> {
        self.snapshot.subscribe()
    }

    /// The per-connection `hello` frame (D16). Not logged and sent without an `id:`, so a
    /// resuming client keeps its `Last-Event-ID`.
    #[must_use]
    pub fn hello(&self) -> Frame {
        let state = self.with_state(|state| state.clone());
        let mut hello = json!({
            "protocolVersion": self.protocol_version,
            "engineVersion": self.engine_version,
            "balanceVersion": self.balance_version,
            "engineBuildId": race_core::ENGINE_BUILD_ID,
            "raceId": self.race_id.to_string(),
            "state": state.engine_state,
            "serverTick": self.server_tick(),
        });
        if let Some(ends_at) = state.countdown_ends_at {
            let remaining = ends_at.saturating_duration_since(Instant::now());
            hello["countdownEndsInMs"] = json!(u64::try_from(remaining.as_millis()).unwrap_or(0));
        }
        if let Some(config) = &state.config_jcs {
            hello["configJcs"] = json!(&**config);
        }
        if let Some(final_tick) = state.final_tick {
            hello["finalTick"] = json!(final_tick);
        }
        // Manual wild-item inputs are off (D16: the POST answers 410), so there are none.
        hello["inputs"] = json!([]);
        hello["seqHighWater"] = json!(0);
        Frame {
            id: 0,
            event: "hello",
            data: stringify(&hello),
            snapshot_only: false,
        }
    }
}
