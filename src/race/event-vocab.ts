/**
 * Stored race events → what the viewer consumes.
 *
 * GET /api/races/:id returns RaceEngineEvent rows ORDER BY id. Two kinds share that table:
 * - engine events: the simulation's own stream, in emission order. Their ticks never decrease.
 * - meta events: written by Season meta after the race (CHAOS_RESOLVED, QP_TRACK_REWARD_GRANTED). They are
 *   inserted later but can carry an earlier tick, and the canvas never plays them.
 *
 * The normalisers are tolerant of historical shapes (null source/target, missing or string metadata), so
 * an old row never throws in the viewer. Plan step 0.6 extends them per engine commit if needed.
 */
import type { RaceEvent, RaceEventType, RecordedWildItemInput } from '@/src/engine/protocol'

export const META_EVENT_TYPES: ReadonlySet<string> = new Set(['CHAOS_RESOLVED', 'QP_TRACK_REWARD_GRANTED'])

export function isMetaEvent(event: Pick<RaceEvent, 'type'>) {
  return META_EVENT_TYPES.has(event.type)
}

/** Events the canvas plays: engine events after tick 0 (creation events at tick 0 are never shown). */
export function isSceneEvent(event: Pick<RaceEvent, 'type' | 'tick'>) {
  return event.tick > 0 && !isMetaEvent(event)
}

type LooseEvent = {
  raceId?: unknown
  type?: unknown
  tick?: unknown
  timestampWithinRaceMs?: unknown
  sourcePlayerId?: unknown
  targetPlayerId?: unknown
  metadata?: unknown
  metadataJson?: unknown
}

function parseMetadata(value: LooseEvent): Record<string, unknown> {
  let metadata: unknown = value.metadata
  if (metadata === undefined && typeof value.metadataJson === 'string') {
    try { metadata = JSON.parse(value.metadataJson) } catch { metadata = {} }
  }
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata) } catch { metadata = {} }
  }
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}
}

/** One stored event (API JSON or a DB row with metadataJson) → RaceEvent. Absent source/target become undefined. */
export function normalizeRaceEvent(value: LooseEvent, raceId?: string): RaceEvent {
  const tick = Number(value.tick)
  return {
    raceId: typeof value.raceId === 'string' ? value.raceId : String(raceId ?? value.raceId ?? ''),
    type: String(value.type) as RaceEventType,
    tick: Number.isFinite(tick) ? tick : 0,
    timestampWithinRaceMs: Number(value.timestampWithinRaceMs ?? 0),
    ...(typeof value.sourcePlayerId === 'string' ? { sourcePlayerId: value.sourcePlayerId } : {}),
    ...(typeof value.targetPlayerId === 'string' ? { targetPlayerId: value.targetPlayerId } : {}),
    metadata: parseMetadata(value),
  }
}

export class EventOrderError extends Error {
  constructor(readonly index: number, readonly previousTick: number, readonly tick: number) {
    super(`Stored engine events go back in time at #${index}: tick ${tick} after ${previousTick}`)
    this.name = 'EventOrderError'
  }
}

export interface StoredRaceEvents {
  /** Engine events in id order. */
  engine: RaceEvent[]
  /** Meta events in id order. */
  meta: RaceEvent[]
  /** Every event, stable-sorted by tick (meta events slot in at their tick), for timelines and stats. */
  timeline: RaceEvent[]
}

/**
 * Splits id-ordered stored events. Throws EventOrderError if an engine event's tick is lower than the one
 * before it: the id order is then not the emission order and the stream must not drive the canvas.
 */
export function splitStoredEvents(events: readonly RaceEvent[]): StoredRaceEvents {
  const engine: RaceEvent[] = []
  const meta: RaceEvent[] = []
  let previousTick = -Infinity
  events.forEach((event, index) => {
    if (isMetaEvent(event)) {
      meta.push(event)
      return
    }
    if (event.tick < previousTick) throw new EventOrderError(index, previousTick, event.tick)
    previousTick = event.tick
    engine.push(event)
  })
  const timeline = events
    .map((event, order) => ({ event, order }))
    .sort((left, right) => left.event.tick - right.event.tick || left.order - right.order)
    .map(({ event }) => event)
  return { engine, meta, timeline }
}

/** splitStoredEvents that never throws: on an ordering failure `engine` is null and `timeline` still sorts by tick. */
export function readStoredEvents(events: readonly RaceEvent[]): StoredRaceEvents & { usable: boolean; error: string | null } {
  try {
    return { ...splitStoredEvents(events), usable: true, error: null }
  } catch (error) {
    const timeline = events
      .map((event, order) => ({ event, order }))
      .sort((left, right) => left.event.tick - right.event.tick || left.order - right.order)
      .map(({ event }) => event)
    return { engine: [], meta: events.filter(isMetaEvent), timeline, usable: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** A comparable form of an event after a JSON round trip (null and undefined source/target are equal). */
export function eventFingerprint(event: RaceEvent) {
  return JSON.stringify([
    event.type,
    event.tick,
    event.timestampWithinRaceMs,
    event.sourcePlayerId ?? null,
    event.targetPlayerId ?? null,
    JSON.parse(JSON.stringify(event.metadata ?? {})),
  ])
}

/**
 * Manual wild-item inputs recorded in the event stream, sorted by tick then clientActionId: the same
 * inputs, in the same order, that the server's replay feeds the engine (recordedWildInputsFromEvents in the server persistence module).
 */
export function manualInputsFromEvents(events: readonly RaceEvent[]): RecordedWildItemInput[] {
  return events.filter((raceEvent) => raceEvent.type === 'WILD_ITEM_MANUAL_INPUT')
    .flatMap((raceEvent) => {
      const instanceId = raceEvent.metadata.instanceId
      const clientActionId = raceEvent.metadata.clientActionId
      if (!raceEvent.sourcePlayerId || typeof instanceId !== 'string' || typeof clientActionId !== 'string') return []
      return [{
        raceId: raceEvent.raceId,
        playerId: raceEvent.sourcePlayerId,
        wildItemInstanceId: instanceId,
        action: 'USE' as const,
        clientActionId,
        authoritativeTick: raceEvent.tick,
      }]
    })
    .sort((left, right) => left.authoritativeTick - right.authoritativeTick || left.clientActionId.localeCompare(right.clientActionId))
}

/** The finish tick from a stored stream (RACE_FINISHED), when present. */
export function raceFinishedTick(events: readonly RaceEvent[]): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]!.type === 'RACE_FINISHED') return events[index]!.tick
  }
  return null
}

/** Engine major version, or null when unparseable. Majors ≥ 2 are Rust-era configs: never parsed or simulated here. */
export function engineMajor(engineVersion: unknown): number | null {
  const major = Number.parseInt(String(engineVersion ?? ''), 10)
  return Number.isFinite(major) ? major : null
}
