//! Uncompressed DTRK/1 payload → per-tick worlds, the Rust side of
//! `src/race/replay-track/decode.ts`. Used for the recorder's self-check and
//! the TS/Rust byte-identity test; the browser keeps its TS decoder.

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use race_protocol::ids::{HazardType, PickupSpawnType, PlayerId, WildItemId};
use race_protocol::replay_track::{
    DtrkHeader, DuckChangeKind, FLAG_ENTITY_PER_SAMPLE, NO_SOURCE_DUCK, Q_LATERAL, Q_PROGRESS,
    Q_SPEED, SectionId, read_container,
};
use race_protocol::snapshot::{
    ActiveEffect, BananaSnapshot, DuckSnapshot, HazardSnapshot, HeldWildItem, PickupSnapshot,
    PickupState, ProjectileKind, RaceWorld, RocketSnapshot,
};

use super::recorder::{
    DuckChange, ENTITY_BANANA, ENTITY_HAZARD, ENTITY_PICKUP, EntityId, EntityRecord, RocketRecord,
};

/// A decoded track: quantised duck columns plus the change, entity and
/// rocket records.
#[derive(Clone, Debug, PartialEq)]
pub struct DecodedTrack {
    pub header: DtrkHeader,
    pub sample_count: u32,
    /// Duck-major: index = duck * sampleCount + sample. Absolute values.
    pub progress_q: Vec<i64>,
    pub speed_q: Vec<i64>,
    pub lateral_q: Vec<i16>,
    pub rank: Vec<u8>,
    pub changes: Vec<DuckChange>,
    pub entities: Vec<EntityRecord>,
    /// Progress values are the decoded `q / 2^24`.
    pub rockets: Vec<RocketRecord>,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize, // usize-ok: read cursor, never hashed or serialized
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self
            .at
            .checked_add(n)
            .filter(|end| *end <= self.bytes.len());
        let end = end.ok_or_else(|| format!("DTRK section truncated at {}", self.at))?;
        let out = &self.bytes[self.at..end];
        self.at = end;
        Ok(out)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, String> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }
    fn i16(&mut self) -> Result<i16, String> {
        let b = self.take(2)?;
        Ok(i16::from_le_bytes([b[0], b[1]]))
    }
    fn u32(&mut self) -> Result<u32, String> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn i32(&mut self) -> Result<i32, String> {
        let b = self.take(4)?;
        Ok(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }
    fn f64(&mut self) -> Result<f64, String> {
        let b = self.take(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(b);
        Ok(f64::from_le_bytes(a))
    }
    fn str16(&mut self) -> Result<String, String> {
        let len = self.u16()? as usize;
        let bytes = self.take(len)?;
        core::str::from_utf8(bytes)
            .map(ToString::to_string)
            .map_err(|_| String::from("DTRK string is not UTF-8"))
    }
}

/// Decodes an uncompressed DTRK/1 payload. Unknown sections are skipped.
///
/// # Errors
/// A malformed payload.
#[allow(clippy::too_many_lines)]
pub fn decode_track(payload: &[u8]) -> Result<DecodedTrack, String> {
    let container = read_container(payload).map_err(|error| format!("{error}"))?;
    let mut track = DecodedTrack {
        header: container.header,
        sample_count: 0,
        progress_q: Vec::new(),
        speed_q: Vec::new(),
        lateral_q: Vec::new(),
        rank: Vec::new(),
        changes: Vec::new(),
        entities: Vec::new(),
        rockets: Vec::new(),
    };
    for (id, body) in container.sections {
        let mut r = Reader { bytes: body, at: 0 };
        match SectionId::from_u8(id) {
            Some(SectionId::DuckColumns) => {
                let ducks = r.u16()? as usize;
                let samples = r.u32()?;
                track.sample_count = samples;
                let n = ducks * samples as usize;
                for column in 0..2 {
                    let mut out = Vec::with_capacity(n);
                    for _ in 0..ducks {
                        let mut value: i64 = 0;
                        for _ in 0..samples {
                            value += i64::from(r.i32()?);
                            out.push(value);
                        }
                    }
                    if column == 0 {
                        track.progress_q = out;
                    } else {
                        track.speed_q = out;
                    }
                }
                track.lateral_q = (0..n).map(|_| r.i16()).collect::<Result<_, _>>()?;
                track.rank = r.take(n)?.to_vec();
            }
            Some(SectionId::DuckChanges) => {
                let count = r.u32()?;
                for _ in 0..count {
                    let tick = r.u32()?;
                    let duck = r.u8()?;
                    let change = match DuckChangeKind::from_u8(r.u8()?) {
                        Some(DuckChangeKind::WildItemSet) => DuckChange::WildItemSet {
                            tick,
                            duck,
                            item: r.u8()?,
                            acquired_at_tick: r.u32()?,
                            instance_id: r.str16()?,
                        },
                        Some(DuckChangeKind::WildItemClear) => {
                            DuckChange::WildItemClear { tick, duck }
                        }
                        Some(DuckChangeKind::RegularPickupCount) => {
                            DuckChange::RegularPickupCount {
                                tick,
                                duck,
                                count: r.u8()?,
                            }
                        }
                        Some(DuckChangeKind::EffectsSet) => {
                            let n = r.u8()? as usize;
                            DuckChange::EffectsSet {
                                tick,
                                duck,
                                effects: r.take(n)?.to_vec(),
                            }
                        }
                        None => return Err(String::from("DTRK unknown change kind")),
                    };
                    track.changes.push(change);
                }
            }
            Some(SectionId::Entities) => {
                let count = r.u32()?;
                for _ in 0..count {
                    let class = r.u8()?;
                    let flags = r.u8()?;
                    let id = if class == ENTITY_BANANA {
                        EntityId::Number(r.u32()?)
                    } else {
                        EntityId::Text(r.str16()?)
                    };
                    let type_index = r.u8()?;
                    let source = r.u8()?;
                    let progress = r.f64()?;
                    let lateral = r.f64()?;
                    let radius = r.f64()?;
                    let first_tick = r.u32()?;
                    let last_tick = r.u32()?;
                    let initial_state = r.u8()?;
                    let n = r.u16()?;
                    let mut state_changes = Vec::with_capacity(n as usize);
                    for _ in 0..n {
                        state_changes.push((r.u32()?, r.u8()?));
                    }
                    let moving = u16::from(flags) & FLAG_ENTITY_PER_SAMPLE != 0;
                    let mut samples = Vec::new();
                    if moving {
                        let len = (last_tick.saturating_sub(first_tick) as usize + 1) * 2;
                        for _ in 0..len {
                            samples.push(r.f64()?);
                        }
                    }
                    track.entities.push(EntityRecord {
                        class,
                        id,
                        type_index,
                        source,
                        progress,
                        lateral,
                        radius,
                        first_tick,
                        last_tick,
                        initial_state,
                        state_changes,
                        moving,
                        samples,
                    });
                }
            }
            Some(SectionId::Rockets) => {
                let count = r.u32()?;
                for _ in 0..count {
                    let id = r.u32()?;
                    let kind = r.u8()?;
                    let source = r.u8()?;
                    let target = r.u8()?;
                    let first_tick = r.u32()?;
                    let n = r.u32()?;
                    let mut progress = Vec::with_capacity(n as usize);
                    for _ in 0..n {
                        progress.push(f64::from(r.i32()?) / f64::from(Q_PROGRESS));
                    }
                    let retarget_count = r.u16()?;
                    let mut retargets = Vec::with_capacity(retarget_count as usize);
                    for _ in 0..retarget_count {
                        retargets.push((r.u32()?, r.u8()?));
                    }
                    track.rockets.push(RocketRecord {
                        id,
                        kind,
                        source,
                        target,
                        first_tick,
                        last_tick: (first_tick + n).saturating_sub(1),
                        progress,
                        retargets,
                    });
                }
            }
            _ => {}
        }
    }
    let expected = track.header.ducks.len() * track.sample_count as usize;
    if track.progress_q.len() != expected || track.rank.len() != expected {
        return Err(String::from("DTRK duck columns missing or inconsistent"));
    }
    Ok(track)
}

fn kind_of(index: u8) -> Result<ProjectileKind, String> {
    match index {
        0 => Ok(ProjectileKind::Prep),
        1 => Ok(ProjectileKind::Wild),
        _ => Err(format!("DTRK projectile kind {index}")),
    }
}

fn state_of(index: u8) -> Result<PickupState, String> {
    match index {
        0 => Ok(PickupState::Active),
        1 => Ok(PickupState::Collected),
        2 => Ok(PickupState::Expired),
        _ => Err(format!("DTRK pickup state {index}")),
    }
}

fn table<'a>(values: &'a [String], index: u8, what: &str) -> Result<&'a str, String> {
    values
        .get(index as usize)
        .map(String::as_str)
        .ok_or_else(|| format!("DTRK {what} index {index}"))
}

impl DecodedTrack {
    /// `header.lastTick`.
    #[must_use]
    pub fn last_tick(&self) -> u32 {
        self.header.last_tick
    }

    fn player(&self, duck: u8) -> Result<PlayerId, String> {
        if duck == NO_SOURCE_DUCK {
            return Err(String::from("DTRK entity without a duck"));
        }
        self.header
            .ducks
            .get(duck as usize)
            .cloned()
            .ok_or_else(|| format!("DTRK duck index {duck}"))
    }

    /// The first tick each duck's quantised progress reaches `2^24` (the
    /// finish), in header order.
    #[must_use]
    pub fn finish_ticks(&self) -> Vec<Option<u32>> {
        let samples = self.sample_count as usize;
        (0..self.header.ducks.len())
            .map(|duck| {
                (0..samples)
                    .find(|&sample| {
                        self.progress_q[duck * samples + sample] >= i64::from(Q_PROGRESS)
                    })
                    .and_then(|sample| u32::try_from(sample).ok())
            })
            .collect()
    }

    /// The world at `tick` (`worldAt`), with ducks in header (simulation)
    /// order rather than by rank.
    ///
    /// # Errors
    /// A tick outside the track or a table index the header lacks.
    #[allow(clippy::too_many_lines, clippy::cast_precision_loss)]
    pub fn world_at(&self, tick: u32) -> Result<RaceWorld, String> {
        if tick >= self.sample_count {
            return Err(format!("DTRK tick {tick} outside the track"));
        }
        let samples = self.sample_count as usize;
        let sample = tick as usize;
        let duck_count = self.header.ducks.len();
        let mut effects: Vec<Vec<ActiveEffect>> = alloc::vec![Vec::new(); duck_count];
        let mut wild: Vec<Option<HeldWildItem>> = alloc::vec![None; duck_count];
        let mut counts: Vec<u32> = alloc::vec![0; duck_count];
        for change in &self.changes {
            match change {
                DuckChange::WildItemSet {
                    tick: at,
                    duck,
                    item,
                    acquired_at_tick,
                    instance_id,
                } if *at <= tick => {
                    let name = table(&self.header.wild_items, *item, "wild item")?;
                    let item_id = WildItemId::from_wire(name)
                        .ok_or_else(|| format!("DTRK wild item {name}"))?;
                    wild[*duck as usize] = Some(HeldWildItem {
                        instance_id: instance_id.clone(),
                        item_id,
                        acquired_at_tick: *acquired_at_tick,
                    });
                }
                DuckChange::WildItemClear { tick: at, duck } if *at <= tick => {
                    wild[*duck as usize] = None;
                }
                DuckChange::RegularPickupCount {
                    tick: at,
                    duck,
                    count,
                } if *at <= tick => counts[*duck as usize] = u32::from(*count),
                DuckChange::EffectsSet {
                    tick: at,
                    duck,
                    effects: list,
                } if *at <= tick => {
                    effects[*duck as usize] = list
                        .iter()
                        .map(|index| {
                            let name = table(&self.header.effects, *index, "effect")?;
                            ActiveEffect::from_wire(name)
                                .ok_or_else(|| format!("DTRK effect {name}"))
                        })
                        .collect::<Result<_, _>>()?;
                }
                _ => {}
            }
        }
        let ducks = (0..duck_count)
            .map(|duck| {
                let at = duck * samples + sample;
                DuckSnapshot {
                    player_id: self.header.ducks[duck].clone(),
                    progress: self.progress_q[at] as f64 / f64::from(Q_PROGRESS),
                    lateral_offset: f64::from(self.lateral_q[at]) / f64::from(Q_LATERAL),
                    speed: self.speed_q[at] as f64 / f64::from(Q_SPEED),
                    rank: u32::from(self.rank[at]),
                    active_effects: core::mem::take(&mut effects[duck]),
                    wild_item: wild[duck].take(),
                    regular_pickup_count: counts[duck],
                }
            })
            .collect();
        let mut world = RaceWorld {
            ducks,
            pickups: Vec::new(),
            hazards: Vec::new(),
            rockets: Vec::new(),
            bananas: Vec::new(),
        };
        for entity in &self.entities {
            if tick < entity.first_tick || tick > entity.last_tick {
                continue;
            }
            let (progress, lateral) = if entity.moving {
                let at = (tick - entity.first_tick) as usize * 2;
                (entity.samples[at], entity.samples[at + 1])
            } else {
                (entity.progress, entity.lateral)
            };
            match (entity.class, &entity.id) {
                (ENTITY_PICKUP, EntityId::Text(id)) => {
                    let mut state = entity.initial_state;
                    for (at, next) in &entity.state_changes {
                        if *at <= tick {
                            state = *next;
                        }
                    }
                    let name = table(&self.header.pickup_types, entity.type_index, "pickup type")?;
                    world.pickups.push(PickupSnapshot {
                        id: id.clone(),
                        pickup_type: PickupSpawnType::from_wire(name)
                            .ok_or_else(|| format!("DTRK pickup type {name}"))?,
                        progress,
                        lateral_offset: lateral,
                        state: state_of(state)?,
                    });
                }
                (ENTITY_HAZARD, EntityId::Text(id)) => {
                    let name = table(&self.header.hazard_types, entity.type_index, "hazard type")?;
                    world.hazards.push(HazardSnapshot {
                        id: id.clone(),
                        hazard_type: HazardType::from_wire(name)
                            .ok_or_else(|| format!("DTRK hazard type {name}"))?,
                        progress,
                        lateral_offset: lateral,
                        radius: entity.radius,
                    });
                }
                (ENTITY_BANANA, EntityId::Number(id)) => world.bananas.push(BananaSnapshot {
                    id: *id,
                    source_player_id: self.player(entity.source)?,
                    progress,
                    lateral_offset: lateral,
                    kind: kind_of(entity.type_index)?,
                }),
                _ => return Err(String::from("DTRK entity class/id mismatch")),
            }
        }
        for rocket in &self.rockets {
            if tick < rocket.first_tick || tick > rocket.last_tick {
                continue;
            }
            let mut target = rocket.target;
            for (at, next) in &rocket.retargets {
                if *at <= tick {
                    target = *next;
                }
            }
            world.rockets.push(RocketSnapshot {
                id: rocket.id,
                source_player_id: self.player(rocket.source)?,
                target_player_id: self.player(target)?,
                progress: rocket.progress[(tick - rocket.first_tick) as usize],
                kind: kind_of(rocket.kind)?,
            });
        }
        Ok(world)
    }
}
