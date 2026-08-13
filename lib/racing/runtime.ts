import { performance } from 'node:perf_hooks'
import { raceEventBus, RACE_EVENTS } from '@/lib/event-bus'
import {
  createSimulation,
  resultFromSimulation,
  snapshotSimulation,
  stepSimulation,
} from '@/packages/race-core/src'
import type { RaceConfig, RaceEvent, RaceResult } from '@/packages/race-protocol/src'

export interface RaceRuntimeOptions {
  realtime?: boolean
  snapshotRate?: number
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function runAuthoritativeRace(config: RaceConfig, options: RaceRuntimeOptions = {}): Promise<RaceResult> {
  const realtime = options.realtime !== false
  const snapshotRate = options.snapshotRate ?? 12
  const snapshotEveryTicks = Math.max(1, Math.round(config.tickRate / snapshotRate))
  const state = createSimulation(config)
  let emittedEventCount = 0
  const startedAt = performance.now()

  while (!state.finished) {
    stepSimulation(state)

    if (state.tick % snapshotEveryTicks === 0 || state.finished) {
      raceEventBus.emit(RACE_EVENTS.SNAPSHOT, {
        raceId: Number(config.raceId),
        protocolVersion: config.protocolVersion,
        tick: state.tick,
        ducks: snapshotSimulation(state),
      })
    }

    const newEvents = state.events.slice(emittedEventCount)
    emittedEventCount = state.events.length
    for (const raceEvent of newEvents as RaceEvent[]) raceEventBus.emit(RACE_EVENTS.ENGINE_EVENT, raceEvent)

    if (realtime) {
      const targetElapsed = state.tick * (1000 / config.tickRate)
      const remaining = targetElapsed - (performance.now() - startedAt)
      if (remaining > 0) await wait(remaining)
    }
  }

  return resultFromSimulation(state)
}
