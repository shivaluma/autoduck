//! The deterministic race simulation: a faithful port of
//! `packages/race-core/src/simulation.ts` (S3.15, Phase A / gate G1).
//!
//! Layout (one TS concern per file):
//! - [`options`]: `SimulationOptions` ([`SimOptions`]) and the engine maths
//!   switch ([`EngineMath`]: V8-exact `exp`/`pow`/`hypot` under `ts-compat`).
//! - [`state`]: `DuckPhysicsState` and `RaceSimulationState` ([`Simulation`]).
//! - [`events`]: `emitEvent` ([`Emitter`]), the [`EventSink`] trait and the
//!   `ev-jcs-v1` event digest.
//! - [`create`]: `createSimulation`, pacing segments, impulses,
//!   `queueWildItemInput`.
//! - [`lane_ai`]: `updateIntent`, `evaluateSmartDesiredLateralOffset` and the
//!   lane tactics.
//! - [`step`]: `stepSimulation` (movement, boost gates, finishing);
//! - [`collisions`][collisions]: `resolveCollisions`;
//! - [`ranks`][ranks]: `updateRanks`;
//! - [`result`]: `resultFromSimulation`, `simulateRace`, snapshots.
//!
//! Items, pickups and the auto-use AI are separate modules
//! ([`crate::items`], [`crate::pickups`], [`crate::auto_use`]); the step calls
//! into them at the same points as the TS step.
//!
//! **Quirks kept on purpose (Phase A):** ids are ordered with the ICU model of
//! `localeCompare` under `ts-compat` ([`id_cmp`]); every JS `sort` with a
//! comparator goes through [`crate::js_sort::v8_sort_by`]; `Math.round` is
//! [`crate::math::js_round`]; `Math.max/min` keep JS NaN/-0 semantics; JS
//! `Map`s are insertion-ordered [`IdMap`]s.

pub mod collisions;
pub mod create;
pub mod events;
pub mod lane_ai;
pub mod options;
pub mod ranks;
pub mod result;
pub mod state;
pub mod step;

use alloc::vec::Vec;
use core::cmp::Ordering;

use race_protocol::ids::PlayerId;

pub use create::{
    create_simulation, evaluate_pacing_multiplier, generate_duck_pacing_segments,
    queue_wild_item_input,
};
pub use events::{Emitter, EventLog, EventSink, EventsDigest, event_jcs};
pub use options::{EngineMath, LootPick, SimError, SimOptions, WildLootOverride};
pub use result::{
    SimResult, result_from_simulation, simulate_race, snapshot_simulation, snapshot_world,
};
pub use state::{DuckPhysicsState, Simulation};
pub use step::step_simulation;

/// `left.localeCompare(right)` for ids.
///
/// With `ts-compat` this is the ICU root-collation model of V8's
/// `localeCompare` (D6, `collate_compat::compare`); without it, the Phase B
/// byte order. Ids are D6-validated, so both are total orders.
#[inline]
#[must_use]
pub fn id_cmp(left: &str, right: &str) -> Ordering {
    #[cfg(feature = "ts-compat")]
    {
        crate::collate_compat::compare(left, right)
    }
    #[cfg(not(feature = "ts-compat"))]
    {
        crate::collate_compat::byte_order(left, right)
    }
}

/// A JS `Map<string, V>` keyed by player id: insertion-ordered, with
/// `Map.set` semantics (an existing key keeps its position). Lobbies hold at
/// most 16 ducks, so lookups are linear scans.
#[derive(Clone, Debug, PartialEq)]
pub struct IdMap<V> {
    entries: Vec<(PlayerId, V)>,
}

impl<V> Default for IdMap<V> {
    fn default() -> Self {
        Self {
            entries: Vec::new(),
        }
    }
}

impl<V> IdMap<V> {
    /// An empty map.
    #[must_use]
    pub const fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// `map.get(id)`.
    #[must_use]
    pub fn get(&self, id: &str) -> Option<&V> {
        self.entries
            .iter()
            .find(|(key, _)| key.as_str() == id)
            .map(|(_, value)| value)
    }

    /// `map.get(id)` for mutation.
    pub fn get_mut(&mut self, id: &str) -> Option<&mut V> {
        self.entries
            .iter_mut()
            .find(|(key, _)| key.as_str() == id)
            .map(|(_, value)| value)
    }

    /// `map.has(id)`.
    #[must_use]
    pub fn contains_key(&self, id: &str) -> bool {
        self.entries.iter().any(|(key, _)| key.as_str() == id)
    }

    /// `map.set(id, value)`: replaces in place, or appends a new key.
    pub fn insert(&mut self, id: PlayerId, value: V) {
        match self.entries.iter_mut().find(|(key, _)| *key == id) {
            Some(entry) => entry.1 = value,
            None => self.entries.push((id, value)),
        }
    }

    /// `map.delete(id)`, keeping the order of the other keys.
    pub fn remove(&mut self, id: &str) -> Option<V> {
        let index = self
            .entries
            .iter()
            .position(|(key, _)| key.as_str() == id)?;
        Some(self.entries.remove(index).1)
    }

    /// Number of keys (`map.size`).
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// `map.size === 0`.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Entries in insertion order (`[...map]`).
    pub fn iter(&self) -> impl Iterator<Item = (&PlayerId, &V)> {
        self.entries.iter().map(|(key, value)| (key, value))
    }

    /// Mutable entries in insertion order.
    pub fn iter_mut(&mut self) -> impl Iterator<Item = (&PlayerId, &mut V)> {
        self.entries.iter_mut().map(|(key, value)| (&*key, value))
    }

    /// Keys in insertion order.
    pub fn keys(&self) -> impl Iterator<Item = &PlayerId> {
        self.entries.iter().map(|(key, _)| key)
    }

    /// `map.clear()`.
    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

impl<V> FromIterator<(PlayerId, V)> for IdMap<V> {
    /// `new Map(entries)`: a repeated key keeps its first position and its
    /// last value.
    fn from_iter<I: IntoIterator<Item = (PlayerId, V)>>(iter: I) -> Self {
        let mut map = Self::new();
        for (key, value) in iter {
            map.insert(key, value);
        }
        map
    }
}

/// An insertion-ordered JS `Set<string>` of player ids.
pub type IdSet = Vec<PlayerId>;

/// `set.add(id)` on an [`IdSet`].
pub fn id_set_add(set: &mut IdSet, id: &PlayerId) {
    if !set.contains(id) {
        set.push(id.clone());
    }
}

/// `set.has(id)` on an [`IdSet`].
#[must_use]
pub fn id_set_has(set: &[PlayerId], id: &str) -> bool {
    set.iter().any(|member| member.as_str() == id)
}

/// A live [`Simulation`] must stay `Send` (and `Sync`, it has no interior
/// mutability) so the server driver can move it into `spawn_blocking` or
/// hold it across `.await` (Phase 2 review 2 MINOR 5).
const _: () = {
    const fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<Simulation>();
};
