import type { RaceEvent, StateSnapshotMessage } from '@/src/engine/protocol'
import type { SnapshotSink } from './types'

/** Engine events the snapshot view plays as FX (the server streams everything). */
export const SNAPSHOT_VISUAL_EVENT_TYPES = new Set<RaceEvent['type']>([
  'ROCKET_FIRED', 'ROCKET_HIT', 'ROCKET_BLOCKED', 'BANANA_DROPPED', 'BANANA_HIT', 'BANANA_BLOCKED',
  'NITRO_STARTED', 'HORN_USED', 'FEATHER_DODGED', 'BUBBLE_POPPED', 'PICKUP_COLLECTED', 'PICKUP_SKIPPED_SLOT_FULL',
  'WILD_ITEM_GRANTED', 'INSTANT_PICKUP_TRIGGERED', 'MINI_ROCKET_FIRED', 'MINI_ROCKET_HIT', 'MINI_ROCKET_BLOCKED',
  'WILD_BANANA_DROPPED', 'WILD_BANANA_HIT', 'WILD_BANANA_BLOCKED', 'MINI_BUBBLE_ACTIVATED', 'MINI_BUBBLE_BLOCKED',
  'WILD_HORN_USED', 'WILD_FEATHER_USED', 'WILD_FEATHER_DODGED', 'HAZARD_HIT', 'HAZARD_DODGED', 'GOLDEN_BOX_COLLECTED', 'DUCK_FINISHED',
  'AI_INTENT', 'MOMENTUM_STOLEN', 'GUARD_SURGE',
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
