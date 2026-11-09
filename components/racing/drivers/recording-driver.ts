import type { RaceEvent } from '@/src/engine/protocol'
import type { DecodedReplayTrack } from '@/src/race/replay-track/decode'
import { isSceneEvent } from '@/src/race/event-vocab'
import type { DriverFrame, TimelineDriver } from './types'

/**
 * Plays a recorded DTRK/1 track. Positions come from the track; FX come from the stored events
 * (engine events in id order). Nothing is simulated, so any engine version plays.
 */
export function createRecordingDriver(track: DecodedReplayTrack, storedEvents: readonly RaceEvent[]): TimelineDriver {
  const events = storedEvents.filter(isSceneEvent)
  let tick = track.firstTick
  let cursor = 0

  const reset = () => {
    tick = track.firstTick
    cursor = 0
    while (cursor < events.length && events[cursor]!.tick <= tick) cursor += 1
  }
  reset()

  return {
    kind: 'recording',
    tickRate: track.header.tickRate,
    endTick: track.lastTick,
    seekable: true,
    tick: () => tick,
    finished: () => tick >= track.lastTick,
    reset,
    advanceTo(targetTick: number): DriverFrame {
      const next = Math.max(tick, Math.min(track.lastTick, Math.floor(targetTick)))
      const emitted: RaceEvent[] = []
      while (cursor < events.length && events[cursor]!.tick <= next) {
        emitted.push(events[cursor]!)
        cursor += 1
      }
      tick = next
      return { tick, finished: tick >= track.lastTick, world: track.worldAt(tick), events: emitted }
    },
  }
}
