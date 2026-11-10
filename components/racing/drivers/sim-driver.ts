import type { RaceConfig, RaceEvent, RecordedWildItemInput } from '@/src/engine/protocol'
import { createSimulation, queueWildItemInput, snapshotRaceWorld, stepSimulation, type RaceSimulationState } from '@/src/engine/sim'
import type { DriverFrame, TimelineDriver } from './types'

export interface SimDriver extends TimelineDriver {
  /** The running simulation (live inputs are queued into it). */
  simulation(): RaceSimulationState
  queueInput(input: Omit<RecordedWildItemInput, 'authoritativeTick'>, authoritativeTick: number): void
}

/**
 * Re-simulates a config in the browser. The engine's version guard throws for anything but the current
 * engine/balance pair, so callers only pick this driver for current-version races without a track.
 * Creation events (tick 0) are never emitted, matching what the canvas has always shown.
 */
export function createSimDriver(
  config: RaceConfig,
  options: { manualInputs?: readonly RecordedWildItemInput[]; endTick?: number | null; kind?: 'sim' | 'live'; allowVersion?: boolean } = {},
): SimDriver {
  let state: RaceSimulationState
  let eventCount = 0
  const reset = () => {
    state = createSimulation(config, { manualInputs: [...(options.manualInputs ?? [])], allowVersion: options.allowVersion })
    eventCount = state.events.length
  }
  reset()

  return {
    kind: options.kind ?? 'sim',
    tickRate: config.tickRate,
    endTick: options.endTick ?? null,
    seekable: (options.kind ?? 'sim') === 'sim',
    tick: () => state.tick,
    finished: () => state.finished,
    reset,
    simulation: () => state,
    queueInput(input, authoritativeTick) {
      queueWildItemInput(state, input, authoritativeTick)
    },
    advanceTo(targetTick: number): DriverFrame {
      while (state.tick < targetTick && !state.finished) stepSimulation(state)
      const events = state.events.slice(eventCount) as RaceEvent[]
      eventCount = state.events.length
      return { tick: state.tick, finished: state.finished, world: snapshotRaceWorld(state), events }
    },
  }
}
