import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import {
  DTRK_FLAGS_NONE,
  DTRK_MAGIC,
  DTRK_Q,
  DTRK_SECTION,
  DTRK_VERSION,
  DUCK_CHANGE_KIND,
  ENTITY_CLASS,
  ENTITY_FLAG_MOVING,
  canonicalHeaderJson,
  quantiseLateral,
  quantiseProgress,
  quantiseSpeed,
  type ReplayTrackHeader,
} from '@/src/race/replay-track/format'
import type { ReplayTrackRecording } from './recorder'

export type ReplayTrackMeta = Pick<ReplayTrackHeader, 'raceId' | 'tickRate' | 'trackVersion' | 'trackGeometry' | 'engine' | 'source' | 'fidelity' | 'resultDigest'>

const encoder = new TextEncoder()

class ByteWriter {
  private buffer = new Uint8Array(1 << 16)
  private view = new DataView(this.buffer.buffer)
  length = 0

  private reserve(bytes: number) {
    if (this.length + bytes <= this.buffer.length) return
    let size = this.buffer.length * 2
    while (size < this.length + bytes) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buffer.subarray(0, this.length))
    this.buffer = next
    this.view = new DataView(next.buffer)
  }

  u8(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Error(`DTRK u8 out of range: ${value}`)
    this.reserve(1)
    this.view.setUint8(this.length, value)
    this.length += 1
  }

  u16(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new Error(`DTRK u16 out of range: ${value}`)
    this.reserve(2)
    this.view.setUint16(this.length, value, true)
    this.length += 2
  }

  u32(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`DTRK u32 out of range: ${value}`)
    this.reserve(4)
    this.view.setUint32(this.length, value, true)
    this.length += 4
  }

  i16(value: number) {
    if (!Number.isInteger(value) || value < -0x8000 || value > 0x7fff) throw new Error(`DTRK i16 out of range: ${value}`)
    this.reserve(2)
    this.view.setInt16(this.length, value, true)
    this.length += 2
  }

  i32(value: number) {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new Error(`DTRK i32 out of range: ${value}`)
    this.reserve(4)
    this.view.setInt32(this.length, value, true)
    this.length += 4
  }

  f64(value: number) {
    this.reserve(8)
    this.view.setFloat64(this.length, value, true)
    this.length += 8
  }

  bytes(value: Uint8Array) {
    this.reserve(value.length)
    this.buffer.set(value, this.length)
    this.length += value.length
  }

  str16(value: string) {
    const bytes = encoder.encode(value)
    this.u16(bytes.length)
    this.bytes(bytes)
  }

  finish() {
    return this.buffer.slice(0, this.length)
  }
}

function section(out: ByteWriter, id: number, write: (body: ByteWriter) => void) {
  const body = new ByteWriter()
  write(body)
  const bytes = body.finish()
  out.u8(id)
  out.u32(bytes.length)
  out.bytes(bytes)
}

export function buildReplayTrackHeader(recording: ReplayTrackRecording, meta: ReplayTrackMeta): ReplayTrackHeader {
  return {
    raceId: meta.raceId,
    tickRate: meta.tickRate,
    firstTick: 0,
    lastTick: recording.sampleCount - 1,
    stride: 1,
    trackVersion: meta.trackVersion,
    trackGeometry: meta.trackGeometry,
    ducks: recording.ducks,
    effects: recording.effects,
    wildItems: recording.wildItems,
    pickupTypes: recording.pickupTypes,
    hazardTypes: recording.hazardTypes,
    q: { progress: DTRK_Q.progress, speed: DTRK_Q.speed, lateral: DTRK_Q.lateral },
    engine: meta.engine,
    source: meta.source,
    fidelity: meta.fidelity,
    resultDigest: meta.resultDigest,
  }
}

/** Encodes a finalized recording into the uncompressed DTRK/1 payload. */
export function encodeReplayTrack(recording: ReplayTrackRecording, meta: ReplayTrackMeta): Uint8Array {
  const header = buildReplayTrackHeader(recording, meta)
  const headerBytes = encoder.encode(canonicalHeaderJson(header))
  const duckCount = recording.ducks.length
  const samples = recording.sampleCount
  const out = new ByteWriter()
  out.bytes(encoder.encode(DTRK_MAGIC))
  out.u16(DTRK_VERSION)
  out.u16(DTRK_FLAGS_NONE)
  out.u32(headerBytes.length)
  out.bytes(headerBytes)

  section(out, DTRK_SECTION.DUCK_COLUMNS, (body) => {
    body.u16(duckCount)
    body.u32(samples)
    for (const [values, quantise] of [[recording.progress, quantiseProgress], [recording.speed, quantiseSpeed]] as const) {
      for (let duck = 0; duck < duckCount; duck += 1) {
        let previous = 0
        for (let sample = 0; sample < samples; sample += 1) {
          const q = quantise(values[sample * duckCount + duck]!)
          body.i32(q - previous)
          previous = q
        }
      }
    }
    for (let duck = 0; duck < duckCount; duck += 1) {
      for (let sample = 0; sample < samples; sample += 1) body.i16(quantiseLateral(recording.lateral[sample * duckCount + duck]!))
    }
    for (let duck = 0; duck < duckCount; duck += 1) {
      for (let sample = 0; sample < samples; sample += 1) body.u8(recording.rank[sample * duckCount + duck]!)
    }
  })

  section(out, DTRK_SECTION.DUCK_CHANGES, (body) => {
    body.u32(recording.changes.length)
    for (const change of recording.changes) {
      body.u32(change.tick)
      body.u8(change.duck)
      body.u8(DUCK_CHANGE_KIND[change.kind])
      if (change.kind === 'WILD_ITEM_SET') {
        body.u8(change.item)
        body.u32(change.acquiredAtTick)
        body.str16(change.instanceId)
      } else if (change.kind === 'REGULAR_PICKUP_COUNT') {
        body.u8(change.count)
      } else if (change.kind === 'EFFECTS_SET') {
        body.u8(change.effects.length)
        for (const effect of change.effects) body.u8(effect)
      }
    }
  })

  section(out, DTRK_SECTION.ENTITIES, (body) => {
    body.u32(recording.entities.length)
    for (const entity of recording.entities) {
      body.u8(entity.cls)
      body.u8(entity.moving ? ENTITY_FLAG_MOVING : 0)
      if (entity.cls === ENTITY_CLASS.BANANA) body.u32(Number(entity.id))
      else body.str16(String(entity.id))
      body.u8(entity.type)
      body.u8(entity.src)
      body.f64(entity.progress)
      body.f64(entity.lateral)
      body.f64(entity.radius)
      body.u32(entity.firstTick)
      body.u32(entity.lastTick)
      body.u8(entity.initialState)
      body.u16(entity.stateChanges.length)
      for (const change of entity.stateChanges) {
        body.u32(change.tick)
        body.u8(change.state)
      }
      if (entity.moving) for (const value of entity.samples!) body.f64(value)
    }
  })

  section(out, DTRK_SECTION.ROCKETS, (body) => {
    body.u32(recording.rockets.length)
    for (const rocket of recording.rockets) {
      body.u32(rocket.id)
      body.u8(rocket.kind)
      body.u8(rocket.src)
      body.u8(rocket.tgt)
      body.u32(rocket.firstTick)
      body.u32(rocket.progress.length)
      for (const value of rocket.progress) body.i32(Math.round(value * DTRK_Q.progress))
      body.u16(rocket.retargets.length)
      for (const retarget of rocket.retargets) {
        body.u32(retarget.tick)
        body.u8(retarget.tgt)
      }
    }
  })

  return out.finish()
}

/** gzip for storage; byteSha256 always covers the UNCOMPRESSED payload. */
export function packReplayTrack(payload: Uint8Array) {
  return {
    gzip: new Uint8Array(gzipSync(payload, { level: 9 })),
    byteSha256: createHash('sha256').update(payload).digest('hex'),
    rawBytes: payload.length,
  }
}
