//! Drama director: `readRace` (`packages/race-core/src/auto-use/director.ts`).
//!
//! TS memoises the read in a module `WeakMap` keyed by the `ducks` array.
//! The engine always passes `state.ducks`, so that is one memo per
//! simulation: [`DirectorCache`], a plain field on `Simulation`.
//!
//! - `ts-compat` (S3.15): hit/miss is exactly the TS fingerprint test
//!   (`===`, so a NaN fingerprint never hits); two different races can share
//!   a fingerprint and reuse a stale read.
//! - **F4 (S3.16):** the memo is keyed by the exact inputs of the read (each
//!   duck's progress bits and finished flag, in `ducks` order), so a hit is
//!   only ever the read the same ducks would compute. Within a tick the
//!   inputs do not change, so it is a per-tick cache.

use alloc::vec::Vec;

use race_protocol::ids::PlayerId;

use crate::js_sort::v8_sort_by;
use crate::math::cmp_f64_js;
use crate::sim::{DuckPhysicsState, id_cmp};

/// `DIRECTOR_CONFIG` (`director.ts:16-23`).
pub mod director_config {
    pub const RUNAWAY_GAP: f64 = 0.025;
    pub const RUNAWAY_MIN_PROGRESS: f64 = 0.35;
    pub const DUEL_GAP: f64 = 0.012;
    pub const DUEL_MIN_PROGRESS: f64 = 0.82;
    pub const DESPERATION_PROGRESS: f64 = 0.7;
    pub const DESPERATION_RISK: f64 = 0.55;
}

/// The literal `2.718` of the fingerprint (`director.ts:29`); not `E`.
#[allow(clippy::approx_constant)]
const DIRECTOR_FINGERPRINT_STEP: f64 = 2.718;

/// `DirectorRead` (`director.ts:8-14`).
#[derive(Clone, Debug, PartialEq)]
pub struct DirectorRead {
    pub leader_id: Option<PlayerId>,
    /// Progress gap between first and second place.
    pub leader_gap: f64,
    pub runaway_leader_id: Option<PlayerId>,
    pub duel_ids: Vec<PlayerId>,
}

/// The `cacheByDucks` entry for one simulation.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DirectorCache {
    entry: Option<(f64, DirectorRead)>,
    /// F4: the exact inputs of `entry` (progress bits, finished).
    key: Vec<(u64, bool)>,
}

/// `readRace(ducks)` (`director.ts:27-45`).
pub fn read_race<'c>(cache: &'c mut DirectorCache, ducks: &[DuckPhysicsState]) -> &'c DirectorRead {
    #[allow(clippy::cast_precision_loss)] // lobby sizes are tiny
    let mut fingerprint = ducks.len() as f64;
    for (index, duck) in ducks.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let position = index as f64;
        fingerprint += duck.progress * (position + DIRECTOR_FINGERPRINT_STEP)
            + if duck.finished { 11.0 } else { 0.0 };
    }
    let hit = if crate::TS_COMPAT {
        matches!(&cache.entry, Some((cached, _)) if *cached == fingerprint)
    } else {
        cache.entry.is_some()
            && cache.key.len() == ducks.len()
            && cache
                .key
                .iter()
                .zip(ducks)
                .all(|(&(bits, finished), duck)| {
                    bits == duck.progress.to_bits() && finished == duck.finished
                })
    };
    if !hit {
        if !crate::TS_COMPAT {
            cache.key.clear();
            cache.key.extend(
                ducks
                    .iter()
                    .map(|duck| (duck.progress.to_bits(), duck.finished)),
            );
        }
        let mut racing: Vec<&DuckPhysicsState> =
            ducks.iter().filter(|duck| !duck.finished).collect();
        v8_sort_by(&mut racing, |left, right| {
            cmp_f64_js(right.progress, left.progress)
                .then_with(|| id_cmp(left.player_id.as_str(), right.player_id.as_str()))
        });
        let first = racing.first().copied();
        let second = racing.get(1).copied();
        let leader_gap = match (first, second) {
            (Some(first), Some(second)) => first.progress - second.progress,
            _ => 0.0,
        };
        let any_finished = ducks.iter().any(|duck| duck.finished);
        let runaway_leader_id = first
            .filter(|first| {
                !any_finished
                    && leader_gap > director_config::RUNAWAY_GAP
                    && first.progress >= director_config::RUNAWAY_MIN_PROGRESS
            })
            .map(|first| first.player_id.clone());
        let duel_ids = match (first, second) {
            (Some(first), Some(second))
                if !any_finished
                    && leader_gap <= director_config::DUEL_GAP
                    && first.progress >= director_config::DUEL_MIN_PROGRESS =>
            {
                Vec::from([first.player_id.clone(), second.player_id.clone()])
            }
            _ => Vec::new(),
        };
        cache.entry = Some((
            fingerprint,
            DirectorRead {
                leader_id: first.map(|first| first.player_id.clone()),
                leader_gap,
                runaway_leader_id,
                duel_ids,
            },
        ));
    }
    &cache.entry.as_ref().expect("cache filled above").1
}
