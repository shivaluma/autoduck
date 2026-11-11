import type { RaceEvent, StateSnapshotMessage } from '@/src/engine/protocol'
import type { RaceWorld } from '@/src/race/types'
import type { SnapshotSink } from './types'

/** Engine events the snapshot view plays as FX (the server streams everything). */
export const SNAPSHOT_VISUAL_EVENT_TYPES = new Set<RaceEvent['type']>([
  'ROCKET_FIRED', 'ROCKET_HIT', 'ROCKET_BLOCKED', 'BANANA_DROPPED', 'BANANA_HIT', 'BANANA_BLOCKED',
  'NITRO_STARTED', 'HORN_USED', 'FEATHER_DODGED', 'BUBBLE_POPPED', 'PICKUP_COLLECTED', 'PICKUP_SKIPPED_SLOT_FULL',
  'WILD_ITEM_GRANTED', 'INSTANT_PICKUP_TRIGGERED', 'MINI_ROCKET_FIRED', 'MINI_ROCKET_HIT', 'MINI_ROCKET_BLOCKED',
  'WILD_BANANA_DROPPED', 'WILD_BANANA_HIT', 'WILD_BANANA_BLOCKED', 'MINI_BUBBLE_ACTIVATED', 'MINI_BUBBLE_BLOCKED',
  'WILD_HORN_USED', 'WILD_FEATHER_USED', 'WILD_FEATHER_DODGED', 'HAZARD_HIT', 'HAZARD_DODGED', 'GOLDEN_BOX_COLLECTED', 'DUCK_FINISHED',
  'AI_INTENT', 'MOMENTUM_STOLEN', 'GUARD_SURGE', 'RIVER_EVENT_WARNING', 'RIVER_EVENT_STARTED', 'RIVER_EVENT_ENDED',
])

/**
 * A live race without a visible config: draws the server's STATE_SNAPSHOT frames and plays visual events
 * from the SSE stream. Returns a closer.
 */
export function connectSnapshotDriver(raceId: number, sink: SnapshotSink) {
  const source = new EventSource(`/api/races/${raceId}/live`)
  source.addEventListener('finished', () => sink.finished())
  source.addEventListener('snapshot', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as StateSnapshotMessage
      if (payload.type !== 'STATE_SNAPSHOT' || !payload.ducks) return
      sink.world(payload, payload.tick)
    } catch {
      // Ignore malformed snapshot frames.
    }
  })
  source.addEventListener('engine-event', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as RaceEvent
      if (!payload.type || !SNAPSHOT_VISUAL_EVENT_TYPES.has(payload.type)) return
      sink.event(payload)
    } catch {
      // Ignore malformed engine events.
    }
  })
  return () => source.close()
}

/** The part of EventSource the drivers use (tests pass a fake). */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void
  close(): void
}

/** SnapshotSink plus the SSE v2 countdown (hello.countdownEndsInMs). */
export interface SnapshotSinkV2 extends SnapshotSink {
  countdown?(endsInMs: number): void
}

/**
 * The SSE v2 snapshot fallback (plan D16): `/api/races/:id/live?snapshots=1` adds `snapshot` frames to the
 * hello/clock stream, plus `engine-event` frames for FX. A snapshot is a STATE_SNAPSHOT message with the world
 * flat or under `world`. `finished`, `resolved` or `failed`, or a hello after the race ended, ends the live
 * view. Returns a closer.
 */
export function connectSnapshotDriverV2(
  raceId: number,
  sink: SnapshotSinkV2,
  options: { openStream?: (url: string) => EventSourceLike } = {},
) {
  const open = options.openStream ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike)
  const source = open(`/api/races/${raceId}/live?snapshots=1`)
  let done = false
  const finish = () => {
    if (done) return
    done = true
    sink.finished()
  }
  const read = (event: MessageEvent<string>) => {
    try {
      return JSON.parse(event.data) as Record<string, unknown>
    } catch {
      return null
    }
  }
  source.addEventListener('hello', (event) => {
    const hello = read(event)
    if (!hello) return
    if (hello.state === 'FINISHED' || hello.state === 'RESOLVED' || hello.state === 'ARCHIVED') finish()
    else if (hello.state === 'COUNTDOWN' && typeof hello.countdownEndsInMs === 'number') sink.countdown?.(hello.countdownEndsInMs)
  })
  source.addEventListener('snapshot', (event) => {
    const payload = read(event)
    if (!payload) return
    const world = (payload.world && typeof payload.world === 'object' ? payload.world : payload) as Partial<RaceWorld>
    if (!Array.isArray(world.ducks) || typeof payload.tick !== 'number') return
    sink.world({ ducks: world.ducks, pickups: world.pickups ?? [], hazards: world.hazards ?? [], rockets: world.rockets ?? [], bananas: world.bananas ?? [] }, payload.tick)
  })
  source.addEventListener('engine-event', (event) => {
    const payload = read(event) as RaceEvent | null
    if (payload?.type && SNAPSHOT_VISUAL_EVENT_TYPES.has(payload.type)) sink.event(payload)
  })
  source.addEventListener('finished', finish)
  source.addEventListener('resolved', finish)
  source.addEventListener('failed', finish)
  return () => source.close()
}
