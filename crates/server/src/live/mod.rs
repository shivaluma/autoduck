//! Live races (plan Phase 5, D16, D21–D23): the registry, the per-race driver thread, the
//! T1/T2 orchestration, crash-recovery T2 and the SSE v2 stream.
//!
//! - [`LiveHub`] (in [`crate::http::AppState`]): the registry of running races, at most
//!   [`LiveOptions::max_live_races`] at once (`MAX_LIVE_RACES = 3`). `start-race` reserves a slot
//!   ([`LiveHub::reserve`]) before its claim transaction and hands it to [`LiveHub::launch`]
//!   after the commit.
//! - [`race`]: one tokio task per race: countdown, COUNTDOWN → RACING, the driver thread
//!   ([`driver`], `catch_unwind`, `sleep_until` pacing), T1, T2 ([`resolve`]), then stats and
//!   telemetry best effort. Any failure marks the race `failed` and returns an official week to
//!   `locked` ([`race::fail_race`]).
//! - [`session`]: the in-memory frame log every SSE subscriber reads ([`sse`]).
//! - [`start`]: the admin `start-race` action.
//! - Shutdown (D21): [`LiveHub::begin_shutdown`] refuses new races; [`LiveHub::shutdown`] waits
//!   up to [`LiveOptions::shutdown_grace`] (120 s) for running ones.

pub mod driver;
pub mod post;
pub mod race;
pub mod resolve;
pub mod session;
pub mod sse;
pub mod start;

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch;

use crate::db::Db;
pub use driver::Pacing;
pub use resolve::{T2Error, T2Outcome, resolve_finished_race};
pub use session::{Frame, LiveSession};

/// `MAX_LIVE_RACES` (plan Phase 5).
pub const MAX_LIVE_RACES: usize = 3;

/// Tunables. [`LiveOptions::default`] is production.
#[derive(Debug, Clone)]
pub struct LiveOptions {
    /// Between the claim and RACING (TS: 3 s).
    pub countdown: Duration,
    pub max_live_races: usize,
    pub pacing: Pacing,
    /// How long shutdown waits for running races (D21: 120 s).
    pub shutdown_grace: Duration,
    /// `?snapshots=1` frames every this many ticks (TS live snapshots: 8 per second).
    pub snapshot_every_ticks: u32,
    /// Record the DTRK/1 track in the driver and store it in T1 (D10, D23).
    pub record_track: bool,
    /// Stats and telemetry after T2 (best effort).
    pub post_race: bool,
    /// How long a closed session stays in the registry for late `Last-Event-ID` resumes.
    pub linger: Duration,
    /// Test hook: the driver panics right before stepping to this tick.
    #[doc(hidden)]
    pub panic_at_tick: Option<u32>,
    /// Test hook: the task stops after T1, as if the process died before T2 (crash recovery).
    #[doc(hidden)]
    pub stop_after_t1: bool,
}

impl Default for LiveOptions {
    fn default() -> Self {
        Self {
            countdown: Duration::from_secs(3),
            max_live_races: MAX_LIVE_RACES,
            pacing: Pacing::RealTime,
            shutdown_grace: Duration::from_secs(120),
            snapshot_every_ticks: 8,
            record_track: true,
            post_race: true,
            linger: Duration::from_secs(5),
            panic_at_tick: None,
            stop_after_t1: false,
        }
    }
}

/// Why `start-race` cannot take a slot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartRefusal {
    /// SIGTERM received (D21).
    ShuttingDown,
    /// `MAX_LIVE_RACES` already running.
    Full,
    /// Starts are blocked (the boot golden self-test failed, ...).
    Blocked(String),
}

impl std::fmt::Display for StartRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ShuttingDown => f.write_str("Server đang tắt, không thể start race"),
            Self::Full => f.write_str("Đang có quá nhiều race chạy cùng lúc"),
            Self::Blocked(reason) => write!(f, "Start race đang bị khoá: {reason}"),
        }
    }
}

#[derive(Default)]
struct Registry {
    races: BTreeMap<i64, Arc<LiveSession>>,
    /// Slots reserved by `start-race` but not launched yet.
    reserved: usize,
    /// Race tasks still running (a closed session may linger after its task ended).
    running: usize,
}

struct HubInner {
    db: Db,
    options: LiveOptions,
    registry: Mutex<Registry>,
    shutting_down: AtomicBool,
    blocked: Mutex<Option<String>>,
    /// Reserved + running, for [`LiveHub::shutdown`].
    busy: watch::Sender<usize>,
}

/// The live race registry (module docs). Cheap to clone.
#[derive(Clone)]
pub struct LiveHub(Arc<HubInner>);

impl std::fmt::Debug for LiveHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LiveHub")
            .field("options", &self.0.options)
            .finish_non_exhaustive()
    }
}

/// A reserved race slot; dropping it unused releases it.
pub struct Slot {
    hub: LiveHub,
    armed: bool,
}

impl Drop for Slot {
    fn drop(&mut self) {
        if self.armed {
            self.hub.update(|registry| registry.reserved -= 1);
        }
    }
}

/// What [`LiveHub::launch`] needs to run a race.
#[derive(Debug, Clone)]
pub struct LaunchSpec {
    pub race_id: i64,
    pub week_id: i64,
    pub is_test: bool,
    pub config: race_protocol::config::ResolvedRaceConfig,
    /// `Race.engineConfigJson` (JCS), revealed in the `start` frame.
    pub engine_config_json: String,
}

impl LiveHub {
    #[must_use]
    pub fn new(db: Db, options: LiveOptions) -> Self {
        let (busy, _) = watch::channel(0);
        Self(Arc::new(HubInner {
            db,
            options,
            registry: Mutex::new(Registry::default()),
            shutting_down: AtomicBool::new(false),
            blocked: Mutex::new(None),
            busy,
        }))
    }

    #[must_use]
    pub fn options(&self) -> &LiveOptions {
        &self.0.options
    }

    #[must_use]
    pub fn db(&self) -> &Db {
        &self.0.db
    }

    fn update<R>(&self, f: impl FnOnce(&mut Registry) -> R) -> R {
        let mut registry = self
            .0
            .registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let out = f(&mut registry);
        let busy = registry.reserved + registry.running;
        drop(registry);
        self.0.busy.send_replace(busy);
        out
    }

    /// Blocks (`Some(reason)`) or unblocks `start-race` (the golden self-test uses this).
    pub fn set_start_blocked(&self, reason: Option<String>) {
        *self
            .0
            .blocked
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = reason;
    }

    /// Reserves a slot for a new race.
    ///
    /// # Errors
    /// See [`StartRefusal`].
    pub fn reserve(&self) -> Result<Slot, StartRefusal> {
        if self.0.shutting_down.load(Ordering::Acquire) {
            return Err(StartRefusal::ShuttingDown);
        }
        if let Some(reason) = self
            .0
            .blocked
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
        {
            return Err(StartRefusal::Blocked(reason));
        }
        let max = self.0.options.max_live_races;
        self.update(|registry| {
            if registry.reserved + registry.running >= max {
                Err(StartRefusal::Full)
            } else {
                registry.reserved += 1;
                Ok(())
            }
        })?;
        Ok(Slot {
            hub: self.clone(),
            armed: true,
        })
    }

    /// Registers the race and starts its task (after the claim transaction committed).
    pub fn launch(&self, mut slot: Slot, spec: LaunchSpec) -> Arc<LiveSession> {
        slot.armed = false;
        let session = LiveSession::new(
            spec.race_id,
            spec.is_test,
            spec.week_id,
            (
                &spec.config.engine_version,
                &spec.config.balance_version,
                &spec.config.protocol_version,
            ),
        );
        self.update(|registry| {
            registry.reserved -= 1;
            registry.running += 1;
            registry.races.insert(spec.race_id, Arc::clone(&session));
        });
        let hub = self.clone();
        let task_session = Arc::clone(&session);
        tokio::spawn(async move {
            use futures_util::FutureExt as _;
            // A panic in the async part (T1/T2/post-race) must still fail the race, end the SSE
            // stream and free the slot. `fail_race` only touches `pending`/`running` rows, so a
            // panic after T2 committed changes nothing in the DB.
            let ran = std::panic::AssertUnwindSafe(race::run(&hub, &task_session, spec))
                .catch_unwind()
                .await;
            if ran.is_err() {
                tracing::error!(race = task_session.race_id, "race task panicked");
                race::fail_race(hub.db(), task_session.race_id, task_session.is_test).await;
                if !task_session.is_closed() {
                    task_session.failed();
                }
            }
            hub.update(|registry| registry.running -= 1);
            let linger = hub.0.options.linger;
            if linger.is_zero() {
                hub.forget(task_session.race_id);
            } else {
                tokio::spawn(async move {
                    tokio::time::sleep(linger).await;
                    hub.forget(task_session.race_id);
                });
            }
        });
        session
    }

    /// Registers a session without a race task (tests of the SSE layer).
    #[doc(hidden)]
    pub fn register_for_test(
        &self,
        race_id: i64,
        versions: (&str, &str, &str),
    ) -> Arc<LiveSession> {
        let session = LiveSession::new(race_id, true, 0, versions);
        self.update(|registry| {
            registry.races.insert(race_id, Arc::clone(&session));
        });
        session
    }

    fn forget(&self, race_id: i64) {
        self.update(|registry| {
            if registry
                .races
                .get(&race_id)
                .is_some_and(|session| session.is_closed())
            {
                registry.races.remove(&race_id);
            }
        });
    }

    /// The live session of `race_id`, while it runs (and briefly after it ended).
    #[must_use]
    pub fn session(&self, race_id: i64) -> Option<Arc<LiveSession>> {
        self.update(|registry| registry.races.get(&race_id).cloned())
    }

    /// `engine.liveTick` of the race detail: the driver's tick while the race is live.
    #[must_use]
    pub fn live_tick(&self, race_id: i64) -> Option<u32> {
        self.session(race_id)
            .filter(|session| !session.is_closed())
            .map(|session| session.server_tick())
    }

    /// Race ids with a running task.
    #[must_use]
    pub fn running(&self) -> usize {
        self.update(|registry| registry.running)
    }

    /// D21: refuse new races from now on.
    pub fn begin_shutdown(&self) {
        self.0.shutting_down.store(true, Ordering::Release);
    }

    #[must_use]
    pub fn is_shutting_down(&self) -> bool {
        self.0.shutting_down.load(Ordering::Acquire)
    }

    /// D21: refuses new races and waits up to `shutdown_grace` for the running ones. Returns
    /// `true` when none is left. Sessions still open afterwards are closed so their SSE streams
    /// end.
    pub async fn shutdown(&self) -> bool {
        self.begin_shutdown();
        let mut busy = self.0.busy.subscribe();
        let grace = self.0.options.shutdown_grace;
        let drained = tokio::time::timeout(grace, busy.wait_for(|count| *count == 0))
            .await
            .is_ok_and(|result| result.is_ok());
        if !drained {
            tracing::error!(
                running = self.running(),
                grace_secs = grace.as_secs(),
                "races still running after the shutdown grace period; crash recovery will fail them at next boot"
            );
        }
        let sessions: Vec<Arc<LiveSession>> =
            self.update(|registry| registry.races.values().cloned().collect());
        for session in sessions {
            session.close();
        }
        drained
    }
}
