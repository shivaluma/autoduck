/**
 * DTRK/1: a compact, recorded race track (positions, ranks, effects, items, entities per tick).
 *
 * Layout and rules are documented in docs/replay-tracks.md. This module holds only the constants,
 * the header shape and tiny byte helpers shared by the encoder and the browser-safe decoder.
 * It must not import node-only modules.
 */

export const DTRK_MAGIC = 'DTRK'
export const DTRK_VERSION = 1
export const DTRK_FORMAT = 'dtrk/1'

/** File-level flags (u16). None are defined in version 1. */
export const DTRK_FLAGS_NONE = 0

export const DTRK_SECTION = {
  DUCK_COLUMNS: 1,
  DUCK_CHANGES: 2,
  ENTITIES: 3,
  ROCKETS: 4,
} as const

/** Quantisation scales. progress/speed use js-round(x * 2^24); lateral uses js-round(x * 32767). */
export const DTRK_Q = {
  progress: 16777216,
  speed: 16777216,
  lateral: 32767,
} as const

export const DUCK_CHANGE_KIND = {
  WILD_ITEM_SET: 1,
  WILD_ITEM_CLEAR: 2,
  REGULAR_PICKUP_COUNT: 3,
  EFFECTS_SET: 4,
} as const

export const ENTITY_CLASS = {
  PICKUP: 0,
  HAZARD: 1,
  BANANA: 2,
} as const

/** Entity flag bit 0: positions are not static; per-sample f64 positions follow. */
export const ENTITY_FLAG_MOVING = 1

export const PICKUP_STATES = ['ACTIVE', 'COLLECTED', 'EXPIRED'] as const
export const PROJECTILE_KINDS = ['PREP', 'WILD'] as const

/** Duck / source index meaning "none". */
export const NO_DUCK = 0xff

export type ReplayTrackSource = 'LIVE_TS' | 'BACKFILL' | 'LIVE_RUST'
export type ReplayTrackFidelity = 'RECORDED' | 'VERIFIED_DIGEST' | 'VERIFIED_EVENTS' | 'UNAVAILABLE'

export interface ReplayTrackHeader {
  raceId: string
  tickRate: number
  firstTick: 0
  lastTick: number
  stride: 1
  trackVersion: string
  /** "<trackVersion>@<sha8>", or null until geometry files exist (plan step 0.5). */
  trackGeometry: string | null
  /** playerIds in simulation order (the order of state.ducks). Indices in sections refer to this list. */
  ducks: string[]
  effects: string[]
  wildItems: string[]
  pickupTypes: string[]
  hazardTypes: string[]
  q: { progress: number; speed: number; lateral: number }
  engine: { impl: 'ts' | 'rust'; engineVersion: string; balanceVersion: string; commit: string | null; build: string | null }
  source: ReplayTrackSource
  fidelity: ReplayTrackFidelity
  resultDigest: string | null
}

/** JSON with recursively sorted object keys; undefined values are rejected so the header is canonical. */
export function canonicalHeaderJson(value: unknown): string {
  if (value === undefined) throw new Error('DTRK header must not contain undefined')
  if (Array.isArray(value)) return `[${value.map(canonicalHeaderJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalHeaderJson(record[key])}`).join(',')}}`
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('DTRK header numbers must be finite')
  return JSON.stringify(value)
}

/** js-round progress quantisation. An unfinished duck (p < 1) never quantises to exactly 1.0. */
export function quantiseProgress(progress: number) {
  const q = Math.round(progress * DTRK_Q.progress)
  return progress < 1 && q >= DTRK_Q.progress ? DTRK_Q.progress - 1 : q
}

export function quantiseSpeed(speed: number) {
  return Math.round(speed * DTRK_Q.speed)
}

export function quantiseLateral(lateral: number) {
  const q = Math.round(lateral * DTRK_Q.lateral)
  return q > DTRK_Q.lateral ? DTRK_Q.lateral : q < -DTRK_Q.lateral ? -DTRK_Q.lateral : q
}
