import type { DuckSnapshot, StateSnapshotMessage } from '@/src/engine/protocol'
import {
  DTRK_MAGIC,
  DTRK_Q,
  DTRK_SECTION,
  DTRK_VERSION,
  DUCK_CHANGE_KIND,
  ENTITY_CLASS,
  ENTITY_FLAG_MOVING,
  NO_DUCK,
  PICKUP_STATES,
  PROJECTILE_KINDS,
  type ReplayTrackHeader,
} from './format'

/**
 * Browser-safe DTRK/1 decoder (no node imports). It takes the UNCOMPRESSED payload and yields, per tick,
 * the world shape `applyWorld` in components/racing/phaser-race-canvas.tsx consumes.
 *
 * Every field of that shape is recorded; nothing is filled from protocol defaults except a banana or
 * rocket whose source/target duck is unknown (index 0xFF), which decodes to the empty string.
 */

export type ReplayWorld = Pick<StateSnapshotMessage, 'ducks' | 'pickups' | 'hazards' | 'rockets' | 'bananas'>

interface DecodedEntity {
  cls: number
  flags: number
  id: string | number
  type: number
  src: number
  progress: number
  lateral: number
  radius: number
  firstTick: number
  lastTick: number
  initialState: number
  stateChanges: Array<{ tick: number; state: number }>
  samples: Float64Array | null
}

interface DecodedRocket {
  id: number
  kind: number
  src: number
  tgt: number
  firstTick: number
  progressQ: Int32Array
  retargets: Array<{ tick: number; tgt: number }>
}

type Timeline<T> = { ticks: number[]; values: T[] }

export interface DecodedReplayTrack {
  header: ReplayTrackHeader
  flags: number
  sampleCount: number
  firstTick: number
  lastTick: number
  /** Duck-major quantised columns (index = duck * sampleCount + sample). */
  progressQ: Int32Array
  speedQ: Int32Array
  lateralQ: Int16Array
  rank: Uint8Array
  worldAt(tick: number): ReplayWorld
  /** Per duck (header order): the first tick at which progress is exactly 1, or null. */
  finishTicks(): Array<number | null>
  /** Per duck (header order): rank at the last sample. */
  finalRanks(): number[]
}

const decoder = new TextDecoder()

class ByteReader {
  private readonly view: DataView
  offset: number
  constructor(private readonly bytes: Uint8Array, offset = 0, readonly end = bytes.length) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.offset = offset
  }
  private need(count: number) {
    if (this.offset + count > this.end) throw new Error('DTRK payload truncated')
  }
  u8() { this.need(1); const value = this.view.getUint8(this.offset); this.offset += 1; return value }
  u16() { this.need(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value }
  u32() { this.need(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value }
  i16() { this.need(2); const value = this.view.getInt16(this.offset, true); this.offset += 2; return value }
  i32() { this.need(4); const value = this.view.getInt32(this.offset, true); this.offset += 4; return value }
  f64() { this.need(8); const value = this.view.getFloat64(this.offset, true); this.offset += 8; return value }
  raw(count: number) { this.need(count); const value = this.bytes.subarray(this.offset, this.offset + count); this.offset += count; return value }
  str16() { return decoder.decode(this.raw(this.u16())) }
}

/** Index of the last entry with tick <= target, or -1. */
function lastAtOrBefore(ticks: readonly number[], target: number) {
  let low = 0
  let high = ticks.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (ticks[middle]! <= target) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

function pushTimeline<T>(timeline: Timeline<T>, tick: number, value: T) {
  timeline.ticks.push(tick)
  timeline.values.push(value)
}

export function decodeReplayTrack(payload: Uint8Array): DecodedReplayTrack {
  const reader = new ByteReader(payload)
  const magic = decoder.decode(reader.raw(4))
  if (magic !== DTRK_MAGIC) throw new Error('Not a DTRK payload')
  const version = reader.u16()
  if (version !== DTRK_VERSION) throw new Error(`Unsupported DTRK version ${version}`)
  const flags = reader.u16()
  const header = JSON.parse(decoder.decode(reader.raw(reader.u32()))) as ReplayTrackHeader
  const duckCount = header.ducks.length
  const firstTick = header.firstTick
  const sampleCount = header.lastTick - header.firstTick + 1
  if (header.stride !== 1) throw new Error(`Unsupported DTRK stride ${header.stride}`)

  let progressQ: Int32Array | null = null
  let speedQ: Int32Array | null = null
  let lateralQ: Int16Array | null = null
  let rank: Uint8Array | null = null
  const effectTimelines: Array<Timeline<string[]>> = header.ducks.map(() => ({ ticks: [], values: [] }))
  const wildTimelines: Array<Timeline<DuckSnapshot['wildItem']>> = header.ducks.map(() => ({ ticks: [], values: [] }))
  const countTimelines: Array<Timeline<number>> = header.ducks.map(() => ({ ticks: [], values: [] }))
  const entities: DecodedEntity[] = []
  const rockets: DecodedRocket[] = []

  while (reader.offset < payload.length) {
    const id = reader.u8()
    const length = reader.u32()
    const body = new ByteReader(payload, reader.offset, reader.offset + length)
    reader.offset += length
    if (id === DTRK_SECTION.DUCK_COLUMNS) {
      const ducks = body.u16()
      const samples = body.u32()
      if (ducks !== duckCount || samples !== sampleCount) throw new Error('DTRK column shape mismatch')
      progressQ = new Int32Array(duckCount * sampleCount)
      speedQ = new Int32Array(duckCount * sampleCount)
      for (const column of [progressQ, speedQ]) {
        for (let duck = 0; duck < duckCount; duck += 1) {
          let value = 0
          for (let sample = 0; sample < sampleCount; sample += 1) {
            value += body.i32()
            column[duck * sampleCount + sample] = value
          }
        }
      }
      lateralQ = new Int16Array(duckCount * sampleCount)
      for (let index = 0; index < lateralQ.length; index += 1) lateralQ[index] = body.i16()
      rank = new Uint8Array(duckCount * sampleCount)
      rank.set(body.raw(duckCount * sampleCount))
    } else if (id === DTRK_SECTION.DUCK_CHANGES) {
      const count = body.u32()
      for (let index = 0; index < count; index += 1) {
        const tick = body.u32()
        const duck = body.u8()
        const kind = body.u8()
        if (duck >= duckCount) throw new Error('DTRK change duck out of range')
        if (kind === DUCK_CHANGE_KIND.WILD_ITEM_SET) {
          const item = header.wildItems[body.u8()]
          const acquiredAtTick = body.u32()
          const instanceId = body.str16()
          if (!item) throw new Error('DTRK unknown wild item')
          pushTimeline(wildTimelines[duck]!, tick, { instanceId, itemId: item as NonNullable<DuckSnapshot['wildItem']>['itemId'], acquiredAtTick })
        } else if (kind === DUCK_CHANGE_KIND.WILD_ITEM_CLEAR) {
          pushTimeline(wildTimelines[duck]!, tick, null)
        } else if (kind === DUCK_CHANGE_KIND.REGULAR_PICKUP_COUNT) {
          pushTimeline(countTimelines[duck]!, tick, body.u8())
        } else if (kind === DUCK_CHANGE_KIND.EFFECTS_SET) {
          const size = body.u8()
          const values: string[] = []
          for (let cursor = 0; cursor < size; cursor += 1) {
            const effect = header.effects[body.u8()]
            if (effect === undefined) throw new Error('DTRK unknown effect')
            values.push(effect)
          }
          pushTimeline(effectTimelines[duck]!, tick, values)
        } else {
          throw new Error(`DTRK unknown duck change kind ${kind}`)
        }
      }
    } else if (id === DTRK_SECTION.ENTITIES) {
      const count = body.u32()
      for (let index = 0; index < count; index += 1) {
        const cls = body.u8()
        const entityFlags = body.u8()
        const entityId = cls === ENTITY_CLASS.BANANA ? body.u32() : body.str16()
        const entity: DecodedEntity = {
          cls,
          flags: entityFlags,
          id: entityId,
          type: body.u8(),
          src: body.u8(),
          progress: body.f64(),
          lateral: body.f64(),
          radius: body.f64(),
          firstTick: body.u32(),
          lastTick: body.u32(),
          initialState: body.u8(),
          stateChanges: [],
          samples: null,
        }
        const changes = body.u16()
        for (let cursor = 0; cursor < changes; cursor += 1) entity.stateChanges.push({ tick: body.u32(), state: body.u8() })
        if (entityFlags & ENTITY_FLAG_MOVING) {
          const samples = new Float64Array((entity.lastTick - entity.firstTick + 1) * 2)
          for (let cursor = 0; cursor < samples.length; cursor += 1) samples[cursor] = body.f64()
          entity.samples = samples
        }
        entities.push(entity)
      }
    } else if (id === DTRK_SECTION.ROCKETS) {
      const count = body.u32()
      for (let index = 0; index < count; index += 1) {
        const rocket: DecodedRocket = { id: body.u32(), kind: body.u8(), src: body.u8(), tgt: body.u8(), firstTick: body.u32(), progressQ: new Int32Array(0), retargets: [] }
        const samples = body.u32()
        rocket.progressQ = new Int32Array(samples)
        for (let cursor = 0; cursor < samples; cursor += 1) rocket.progressQ[cursor] = body.i32()
        const retargets = body.u16()
        for (let cursor = 0; cursor < retargets; cursor += 1) rocket.retargets.push({ tick: body.u32(), tgt: body.u8() })
        rockets.push(rocket)
      }
    }
    // Unknown section ids are skipped (forward compatibility, e.g. the reserved §5).
  }
  if (!progressQ || !speedQ || !lateralQ || !rank) throw new Error('DTRK payload has no DUCK_COLUMNS section')
  const columns = { progressQ, speedQ, lateralQ, rank }

  const playerId = (index: number) => (index === NO_DUCK ? '' : header.ducks[index] ?? '')
  const timelineValue = <T>(timeline: Timeline<T>, tick: number, fallback: T) => {
    const index = lastAtOrBefore(timeline.ticks, tick)
    return index < 0 ? fallback : timeline.values[index]!
  }

  function worldAt(tick: number): ReplayWorld {
    const clamped = Math.max(firstTick, Math.min(header.lastTick, Math.floor(tick)))
    const sample = clamped - firstTick
    const ducks: DuckSnapshot[] = []
    for (let duck = 0; duck < duckCount; duck += 1) {
      const at = duck * sampleCount + sample
      const wild = timelineValue(wildTimelines[duck]!, clamped, null)
      ducks.push({
        playerId: header.ducks[duck]!,
        progress: columns.progressQ[at]! / DTRK_Q.progress,
        lateralOffset: columns.lateralQ[at]! / DTRK_Q.lateral,
        speed: columns.speedQ[at]! / DTRK_Q.speed,
        rank: columns.rank[at]!,
        activeEffects: [...timelineValue(effectTimelines[duck]!, clamped, [] as string[])],
        wildItem: wild ? { ...wild } : null,
        regularPickupCount: timelineValue(countTimelines[duck]!, clamped, 0),
      })
    }
    ducks.sort((left, right) => left.rank - right.rank)

    const world: ReplayWorld = { ducks, pickups: [], hazards: [], rockets: [], bananas: [] }
    for (const entity of entities) {
      if (clamped < entity.firstTick || clamped > entity.lastTick) continue
      const offset = (clamped - entity.firstTick) * 2
      const progress = entity.samples ? entity.samples[offset]! : entity.progress
      const lateralOffset = entity.samples ? entity.samples[offset + 1]! : entity.lateral
      if (entity.cls === ENTITY_CLASS.PICKUP) {
        let state = entity.initialState
        for (const change of entity.stateChanges) if (change.tick <= clamped) state = change.state
        world.pickups.push({
          id: String(entity.id),
          type: header.pickupTypes[entity.type] as ReplayWorld['pickups'][number]['type'],
          progress,
          lateralOffset,
          state: PICKUP_STATES[state]!,
        })
      } else if (entity.cls === ENTITY_CLASS.HAZARD) {
        world.hazards.push({
          id: String(entity.id),
          type: header.hazardTypes[entity.type] as ReplayWorld['hazards'][number]['type'],
          progress,
          lateralOffset,
          radius: entity.radius,
        })
      } else if (entity.cls === ENTITY_CLASS.BANANA) {
        world.bananas.push({ id: Number(entity.id), sourcePlayerId: playerId(entity.src), progress, lateralOffset, kind: PROJECTILE_KINDS[entity.type]! })
      }
    }
    for (const rocket of rockets) {
      const offset = clamped - rocket.firstTick
      if (offset < 0 || offset >= rocket.progressQ.length) continue
      let target = rocket.tgt
      for (const retarget of rocket.retargets) if (retarget.tick <= clamped) target = retarget.tgt
      world.rockets.push({
        id: rocket.id,
        sourcePlayerId: playerId(rocket.src),
        targetPlayerId: playerId(target),
        progress: rocket.progressQ[offset]! / DTRK_Q.progress,
        kind: PROJECTILE_KINDS[rocket.kind]!,
      })
    }
    return world
  }

  return {
    header,
    flags,
    sampleCount,
    firstTick,
    lastTick: header.lastTick,
    ...columns,
    worldAt,
    finishTicks() {
      return header.ducks.map((_, duck) => {
        for (let sample = 0; sample < sampleCount; sample += 1) {
          if (columns.progressQ[duck * sampleCount + sample]! >= DTRK_Q.progress) return firstTick + sample
        }
        return null
      })
    },
    finalRanks() {
      return header.ducks.map((_, duck) => columns.rank[duck * sampleCount + sampleCount - 1]!)
    },
  }
}
