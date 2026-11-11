//! `TrackRecorder`: the Rust DTRK/1 live recorder (plan D10, §4.2, risk R2),
//! a port of `lib/racing/replay-track/recorder.ts`.
//!
//! It only reads world snapshots. [`TrackRecorder::push`] never panics and
//! never fails the race: the first error disables the recorder and is kept in
//! [`TrackRecorder::error`]; later pushes are ignored. [`TrackRecorder::finalize`]
//! then refuses, and the caller stores no track.
//!
//! Duck fields go into sample-major arrays (f64 progress and speed, f32
//! lateral, u8 rank); wild items, effects, regular pickup counts and
//! entities are diffed, exactly like the TS recorder, so a Rust recording
//! of the same worlds encodes to the same bytes.

use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use race_protocol::ids::{HazardType, PickupSpawnType, PlayerId, WildItemId};
use race_protocol::replay_track::NO_SOURCE_DUCK;
use race_protocol::snapshot::{ActiveEffect, HeldWildItem, PickupState, ProjectileKind, RaceWorld};

use crate::sim::{Simulation, snapshot_world};

/// Entity classes of section 3.
pub const ENTITY_PICKUP: u8 = 0;
pub const ENTITY_HAZARD: u8 = 1;
pub const ENTITY_BANANA: u8 = 2;

/// Section 3 pickup states (`ACTIVE=0, COLLECTED=1, EXPIRED=2`).
pub const fn pickup_state_index(state: PickupState) -> u8 {
    match state {
        PickupState::Active => 0,
        PickupState::Collected => 1,
        PickupState::Expired => 2,
    }
}

/// Projectile kinds of sections 3 and 4 (`PREP=0, WILD=1`).
pub const fn projectile_kind_index(kind: ProjectileKind) -> u8 {
    match kind {
        ProjectileKind::Prep => 0,
        ProjectileKind::Wild => 1,
    }
}

/// One section 2 record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DuckChange {
    WildItemSet {
        tick: u32,
        duck: u8,
        item: u8,
        acquired_at_tick: u32,
        instance_id: String,
    },
    WildItemClear {
        tick: u32,
        duck: u8,
    },
    RegularPickupCount {
        tick: u32,
        duck: u8,
        count: u8,
    },
    EffectsSet {
        tick: u32,
        duck: u8,
        effects: Vec<u8>,
    },
}

/// A section 3 entity id: pickups and hazards have string ids, bananas
/// numeric ones.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum EntityId {
    Text(String),
    Number(u32),
}

/// One section 3 record (an entity lifetime).
#[derive(Clone, Debug, PartialEq)]
pub struct EntityRecord {
    pub class: u8,
    pub id: EntityId,
    pub type_index: u8,
    pub source: u8,
    pub progress: f64,
    pub lateral: f64,
    /// `NaN` except for hazards.
    pub radius: f64,
    pub first_tick: u32,
    pub last_tick: u32,
    pub initial_state: u8,
    pub state_changes: Vec<(u32, u8)>,
    pub moving: bool,
    /// Only when moving: `[progress, lateral]` per tick from `first_tick` to
    /// `last_tick`.
    pub samples: Vec<f64>,
}

/// One section 4 record.
#[derive(Clone, Debug, PartialEq)]
pub struct RocketRecord {
    pub id: u32,
    pub kind: u8,
    pub source: u8,
    pub target: u8,
    pub first_tick: u32,
    pub last_tick: u32,
    pub progress: Vec<f64>,
    pub retargets: Vec<(u32, u8)>,
}

/// A finalized recording, ready for [`super::encode_track`].
#[derive(Clone, Debug, PartialEq)]
pub struct TrackRecording {
    pub ducks: Vec<PlayerId>,
    pub sample_count: u32,
    /// Sample-major: index = sample * duckCount + duck.
    pub progress: Vec<f64>,
    pub speed: Vec<f64>,
    pub lateral: Vec<f32>,
    pub rank: Vec<u8>,
    pub effects: Vec<String>,
    pub wild_items: Vec<String>,
    pub pickup_types: Vec<String>,
    pub hazard_types: Vec<String>,
    pub changes: Vec<DuckChange>,
    pub entities: Vec<EntityRecord>,
    pub rockets: Vec<RocketRecord>,
    pub moving_entities: u32,
    pub order_violations: u32,
}

/// A value table whose index is stored in the payload (`Interner` in TS).
#[derive(Clone, Debug, Default)]
struct Interner {
    values: Vec<String>,
}

impl Interner {
    fn seeded<'a>(seed: impl IntoIterator<Item = &'a str>) -> Self {
        let mut interner = Self::default();
        for value in seed {
            // A protocol enum has far fewer than 255 values.
            let _ = interner.id(value);
        }
        interner
    }

    fn id(&mut self, value: &str) -> Result<u8, String> {
        if let Some(found) = self.values.iter().position(|known| known == value) {
            return u8::try_from(found).map_err(|_| String::from("DTRK table overflow"));
        }
        let next = self.values.len();
        if next >= 0xff {
            return Err(String::from("DTRK table overflow"));
        }
        self.values.push(String::from(value));
        u8::try_from(next).map_err(|_| String::from("DTRK table overflow"))
    }
}

/// The live DTRK/1 recorder. See the module docs.
#[derive(Clone, Debug)]
pub struct TrackRecorder {
    error: Option<String>,
    expected_tick: u32,
    ducks: Vec<PlayerId>,
    progress: Vec<f64>,
    speed: Vec<f64>,
    lateral: Vec<f32>,
    rank: Vec<u8>,
    effects: Interner,
    wild_items: Interner,
    pickup_types: Interner,
    hazard_types: Interner,
    changes: Vec<DuckChange>,
    last_effects: Vec<Vec<ActiveEffect>>,
    last_wild: Vec<Option<HeldWildItem>>,
    last_pickup_count: Vec<u32>,
    entities: Vec<EntityRecord>,
    live_pickups: BTreeMap<String, u32>,
    live_hazards: BTreeMap<String, u32>,
    live_bananas: BTreeMap<u32, u32>,
    rockets: Vec<RocketRecord>,
    live_rockets: BTreeMap<u32, u32>,
    order_violations: u32,
}

impl TrackRecorder {
    /// A recorder for ducks in simulation order (`state.ducks`, the header's
    /// `ducks`).
    #[must_use]
    pub fn new(ducks: Vec<PlayerId>) -> Self {
        let count = ducks.len();
        let mut recorder = Self {
            error: None,
            expected_tick: 0,
            ducks,
            progress: Vec::new(),
            speed: Vec::new(),
            lateral: Vec::new(),
            rank: Vec::new(),
            effects: Interner::default(),
            wild_items: Interner::seeded(WildItemId::ALL.iter().map(|id| id.as_str())),
            pickup_types: Interner::seeded(PickupSpawnType::ALL.iter().map(|id| id.as_str())),
            hazard_types: Interner::seeded(HazardType::ALL.iter().map(|id| id.as_str())),
            changes: Vec::new(),
            last_effects: alloc::vec![Vec::new(); count],
            last_wild: alloc::vec![None; count],
            last_pickup_count: alloc::vec![0; count],
            entities: Vec::new(),
            live_pickups: BTreeMap::new(),
            live_hazards: BTreeMap::new(),
            live_bananas: BTreeMap::new(),
            rockets: Vec::new(),
            live_rockets: BTreeMap::new(),
            order_violations: 0,
        };
        if count == 0 || count > 0xfe {
            recorder.error = Some(format!("DTRK duck count {count} out of range"));
        } else if (1..count).any(|i| recorder.ducks[..i].contains(&recorder.ducks[i])) {
            recorder.error = Some(String::from("DTRK duplicate playerId"));
        }
        recorder
    }

    /// A recorder for `sim`'s ducks.
    #[must_use]
    pub fn for_simulation(sim: &Simulation) -> Self {
        Self::new(
            sim.ducks
                .iter()
                .map(|duck| duck.player_id.clone())
                .collect(),
        )
    }

    /// `true` once a push failed.
    #[must_use]
    pub fn disabled(&self) -> bool {
        self.error.is_some()
    }

    /// The first failure, if any.
    #[must_use]
    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    /// Ticks recorded so far.
    #[must_use]
    pub fn sample_count(&self) -> u32 {
        self.expected_tick
    }

    /// Records `sim` at its current tick (tick 0 right after creation, then
    /// after every step). Never panics; a failure disables the recorder.
    pub fn push_simulation(&mut self, sim: &Simulation) {
        if self.disabled() || sim.tick < self.expected_tick {
            return;
        }
        let world = snapshot_world(sim);
        self.push(sim.tick, &world);
    }

    /// Records `world` as the state at `tick`. Ticks must arrive in order
    /// from 0; a repeated earlier tick is ignored, a gap disables the
    /// recorder.
    pub fn push(&mut self, tick: u32, world: &RaceWorld) {
        if self.disabled() || tick < self.expected_tick {
            return;
        }
        let result = if tick == self.expected_tick {
            self.record_ducks(tick, world)
                .and_then(|()| self.record_entities(tick, world))
        } else {
            Err(format!(
                "DTRK expected tick {}, got {tick}",
                self.expected_tick
            ))
        };
        match result {
            Ok(()) => self.expected_tick += 1,
            Err(message) => {
                self.error = Some(format!(
                    "recorder disabled at tick {}: {message}",
                    self.expected_tick
                ));
            }
        }
    }

    fn duck_of(&self, player_id: &PlayerId) -> u8 {
        self.ducks
            .iter()
            .position(|id| id == player_id)
            .and_then(|index| u8::try_from(index).ok())
            .unwrap_or(NO_SOURCE_DUCK)
    }

    fn record_ducks(&mut self, tick: u32, world: &RaceWorld) -> Result<(), String> {
        let count = self.ducks.len();
        if world.ducks.len() != count {
            return Err(String::from("DTRK duck count changed"));
        }
        let base = self.progress.len();
        self.progress.resize(base + count, 0.0);
        self.speed.resize(base + count, 0.0);
        self.lateral.resize(base + count, 0.0);
        self.rank.resize(base + count, 0);
        for index in 0..count {
            let duck = world
                .ducks
                .iter()
                .find(|duck| duck.player_id == self.ducks[index])
                .ok_or_else(|| String::from("DTRK duck order changed"))?;
            self.progress[base + index] = duck.progress;
            self.speed[base + index] = duck.speed;
            // `Float32Array` storage, as in TS.
            #[allow(clippy::cast_possible_truncation)]
            {
                self.lateral[base + index] = duck.lateral_offset as f32;
            }
            self.rank[base + index] = u8::try_from(duck.rank)
                .ok()
                .filter(|rank| *rank >= 1)
                .ok_or_else(|| format!("DTRK rank {} out of range", duck.rank))?;
            let duck_index = u8::try_from(index).map_err(|_| String::from("DTRK duck index"))?;

            if duck.active_effects != self.last_effects[index] {
                if duck.active_effects.len() > 0xff {
                    return Err(String::from("DTRK too many effects"));
                }
                let mut effects = Vec::with_capacity(duck.active_effects.len());
                for effect in &duck.active_effects {
                    effects.push(self.effects.id(effect.as_str())?);
                }
                self.changes.push(DuckChange::EffectsSet {
                    tick,
                    duck: duck_index,
                    effects,
                });
                self.last_effects[index].clone_from(&duck.active_effects);
            }

            match (&duck.wild_item, &self.last_wild[index]) {
                (Some(wild), previous) if previous.as_ref() != Some(wild) => {
                    let item = self.wild_items.id(wild.item_id.as_str())?;
                    self.changes.push(DuckChange::WildItemSet {
                        tick,
                        duck: duck_index,
                        item,
                        acquired_at_tick: wild.acquired_at_tick,
                        instance_id: wild.instance_id.clone(),
                    });
                    self.last_wild[index] = Some(wild.clone());
                }
                (None, Some(_)) => {
                    self.changes.push(DuckChange::WildItemClear {
                        tick,
                        duck: duck_index,
                    });
                    self.last_wild[index] = None;
                }
                _ => {}
            }

            if duck.regular_pickup_count != self.last_pickup_count[index] {
                let count = u8::try_from(duck.regular_pickup_count)
                    .map_err(|_| String::from("DTRK pickup count out of range"))?;
                self.changes.push(DuckChange::RegularPickupCount {
                    tick,
                    duck: duck_index,
                    count,
                });
                self.last_pickup_count[index] = duck.regular_pickup_count;
            }
        }
        Ok(())
    }

    /// `observeEntity`: returns the record's ordinal.
    #[allow(clippy::too_many_arguments)]
    fn observe(
        entities: &mut Vec<EntityRecord>,
        live_index: Option<u32>,
        tick: u32,
        progress: f64,
        lateral: f64,
        create: impl FnOnce() -> EntityRecord,
    ) -> Result<u32, String> {
        if let Some(ordinal) = live_index {
            let record = entities
                .get_mut(ordinal as usize)
                .ok_or_else(|| String::from("DTRK entity index"))?;
            if record.moving {
                record.samples.push(progress);
                record.samples.push(lateral);
            } else if record.progress != progress || record.lateral != lateral {
                // `!==` in TS: equal values (including -0 vs 0) are static.
                record.moving = true;
                let mut samples = Vec::new();
                for _ in record.first_tick..tick {
                    samples.push(record.progress);
                    samples.push(record.lateral);
                }
                samples.push(progress);
                samples.push(lateral);
                record.samples = samples;
            }
            record.last_tick = tick;
            return Ok(ordinal);
        }
        let ordinal =
            u32::try_from(entities.len()).map_err(|_| String::from("DTRK too many entities"))?;
        entities.push(create());
        Ok(ordinal)
    }

    #[allow(clippy::too_many_lines)]
    fn record_entities(&mut self, tick: u32, world: &RaceWorld) -> Result<(), String> {
        let mut last_ordinal: Option<u32> = None;
        for pickup in &world.pickups {
            let state = pickup_state_index(pickup.state);
            let type_index = self.pickup_types.id(pickup.pickup_type.as_str())?;
            let live = self.live_pickups.get(&pickup.id).copied();
            let ordinal = Self::observe(
                &mut self.entities,
                live,
                tick,
                pickup.progress,
                pickup.lateral_offset,
                || {
                    new_entity(
                        ENTITY_PICKUP,
                        EntityId::Text(pickup.id.clone()),
                        type_index,
                        NO_SOURCE_DUCK,
                        f64::NAN,
                        state,
                        tick,
                        pickup.progress,
                        pickup.lateral_offset,
                    )
                },
            )?;
            if live.is_none() {
                self.live_pickups.insert(pickup.id.clone(), ordinal);
            }
            self.note_order(&mut last_ordinal, ordinal);
            let record = &mut self.entities[ordinal as usize];
            let current = record
                .state_changes
                .last()
                .map_or(record.initial_state, |change| change.1);
            if current != state {
                record.state_changes.push((tick, state));
            }
        }
        close(&mut self.live_pickups, &self.entities, tick);

        last_ordinal = None;
        for hazard in &world.hazards {
            let type_index = self.hazard_types.id(hazard.hazard_type.as_str())?;
            let live = self.live_hazards.get(&hazard.id).copied();
            let ordinal = Self::observe(
                &mut self.entities,
                live,
                tick,
                hazard.progress,
                hazard.lateral_offset,
                || {
                    new_entity(
                        ENTITY_HAZARD,
                        EntityId::Text(hazard.id.clone()),
                        type_index,
                        NO_SOURCE_DUCK,
                        hazard.radius,
                        0,
                        tick,
                        hazard.progress,
                        hazard.lateral_offset,
                    )
                },
            )?;
            if live.is_none() {
                self.live_hazards.insert(hazard.id.clone(), ordinal);
            }
            self.note_order(&mut last_ordinal, ordinal);
            if self.entities[ordinal as usize].radius != hazard.radius {
                return Err(format!("DTRK hazard {} radius changed", hazard.id));
            }
        }
        close(&mut self.live_hazards, &self.entities, tick);

        last_ordinal = None;
        for banana in &world.bananas {
            let source = self.duck_of(&banana.source_player_id);
            let kind = projectile_kind_index(banana.kind);
            let live = self.live_bananas.get(&banana.id).copied();
            let ordinal = Self::observe(
                &mut self.entities,
                live,
                tick,
                banana.progress,
                banana.lateral_offset,
                || {
                    new_entity(
                        ENTITY_BANANA,
                        EntityId::Number(banana.id),
                        kind,
                        source,
                        f64::NAN,
                        0,
                        tick,
                        banana.progress,
                        banana.lateral_offset,
                    )
                },
            )?;
            if live.is_none() {
                self.live_bananas.insert(banana.id, ordinal);
            }
            self.note_order(&mut last_ordinal, ordinal);
        }
        close(&mut self.live_bananas, &self.entities, tick);

        last_ordinal = None;
        for rocket in &world.rockets {
            let target = self.duck_of(&rocket.target_player_id);
            let ordinal = if let Some(ordinal) = self.live_rockets.get(&rocket.id).copied() {
                let record = &mut self.rockets[ordinal as usize];
                record.progress.push(rocket.progress);
                record.last_tick = tick;
                let current = record
                    .retargets
                    .last()
                    .map_or(record.target, |change| change.1);
                if current != target {
                    record.retargets.push((tick, target));
                }
                ordinal
            } else {
                let ordinal = u32::try_from(self.rockets.len())
                    .map_err(|_| String::from("DTRK too many rockets"))?;
                self.rockets.push(RocketRecord {
                    id: rocket.id,
                    kind: projectile_kind_index(rocket.kind),
                    source: self.duck_of(&rocket.source_player_id),
                    target,
                    first_tick: tick,
                    last_tick: tick,
                    progress: alloc::vec![rocket.progress],
                    retargets: Vec::new(),
                });
                self.live_rockets.insert(rocket.id, ordinal);
                ordinal
            };
            self.note_order(&mut last_ordinal, ordinal);
        }
        let rockets = &self.rockets;
        self.live_rockets
            .retain(|_, ordinal| rockets[*ordinal as usize].last_tick == tick);
        Ok(())
    }

    fn note_order(&mut self, last: &mut Option<u32>, ordinal: u32) {
        if last.is_some_and(|last| ordinal < last) {
            self.order_violations += 1;
        }
        *last = Some(ordinal);
    }

    /// The recording, after the race. Fails when the recorder is disabled or
    /// empty, or an entity's sample count is inconsistent (the static-position
    /// assertion).
    ///
    /// # Errors
    /// See above; the caller stores no track and logs the message.
    pub fn finalize(self) -> Result<TrackRecording, String> {
        if let Some(error) = self.error {
            return Err(format!("replay-track recorder is disabled: {error}"));
        }
        if self.expected_tick == 0 {
            return Err(String::from("replay-track recorder captured no samples"));
        }
        for entity in &self.entities {
            let expected = (u64::from(entity.last_tick) - u64::from(entity.first_tick) + 1) * 2;
            if entity.moving && entity.samples.len() as u64 != expected {
                return Err(format!("DTRK entity {:?} sample count mismatch", entity.id));
            }
        }
        for rocket in &self.rockets {
            let expected = u64::from(rocket.last_tick) - u64::from(rocket.first_tick) + 1;
            if rocket.progress.len() as u64 != expected {
                return Err(format!("DTRK rocket {} sample count mismatch", rocket.id));
            }
        }
        let moving_entities = u32::try_from(self.entities.iter().filter(|e| e.moving).count())
            .map_err(|_| "DTRK too many entities".to_string())?;
        Ok(TrackRecording {
            ducks: self.ducks,
            sample_count: self.expected_tick,
            progress: self.progress,
            speed: self.speed,
            lateral: self.lateral,
            rank: self.rank,
            effects: self.effects.values,
            wild_items: self.wild_items.values,
            pickup_types: self.pickup_types.values,
            hazard_types: self.hazard_types.values,
            changes: self.changes,
            entities: self.entities,
            rockets: self.rockets,
            moving_entities,
            order_violations: self.order_violations,
        })
    }
}

#[allow(clippy::too_many_arguments)]
fn new_entity(
    class: u8,
    id: EntityId,
    type_index: u8,
    source: u8,
    radius: f64,
    initial_state: u8,
    tick: u32,
    progress: f64,
    lateral: f64,
) -> EntityRecord {
    EntityRecord {
        class,
        id,
        type_index,
        source,
        progress,
        lateral,
        radius,
        first_tick: tick,
        last_tick: tick,
        initial_state,
        state_changes: Vec::new(),
        moving: false,
        samples: Vec::new(),
    }
}

/// `closeEntities`: forget entities not seen this tick.
fn close<K: Ord>(live: &mut BTreeMap<K, u32>, entities: &[EntityRecord], tick: u32) {
    live.retain(|_, ordinal| entities[*ordinal as usize].last_tick == tick);
}
