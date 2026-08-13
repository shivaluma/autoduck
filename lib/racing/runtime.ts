import { performance } from 'node:perf_hooks'
import { raceEventBus, RACE_EVENTS } from '@/lib/event-bus'
import {
  createSimulation,
  resultFromSimulation,
  snapshotSimulation,
  stepSimulation,
} from '@/packages/race-core/src'
import type { DuckSnapshot, RaceConfig, RaceEvent, RaceResult } from '@/packages/race-protocol/src'
import { stateSnapshotMessageSchema } from '@/packages/race-protocol/src'

export interface RaceRuntimeOptions {
  realtime?: boolean
  snapshotRate?: number
  persistenceRate?: number
  onSnapshot?: (snapshot: { raceId: string; protocolVersion: string; tick: number; ducks: DuckSnapshot[] }) => void | Promise<void>
  onEvents?: (events: RaceEvent[]) => void | Promise<void>
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function runAuthoritativeRace(config: RaceConfig, options: RaceRuntimeOptions = {}): Promise<RaceResult> {
  const realtime = options.realtime !== false
  const snapshotRate = options.snapshotRate ?? 12
  const snapshotEveryTicks = Math.max(1, Math.round(config.tickRate / snapshotRate))
  const persistenceEveryTicks = Math.max(1, Math.round(config.tickRate / (options.persistenceRate ?? 2)))
  const state = createSimulation(config)
  let emittedEventCount = 0
  let persistedEventCount = 0
  const startedAt = performance.now()

  while (!state.finished) {
    stepSimulation(state)

    if (state.tick % snapshotEveryTicks === 0 || state.finished) {
      const snapshot = stateSnapshotMessageSchema.parse({
        type: 'STATE_SNAPSHOT',
        raceId: config.raceId,
        protocolVersion: config.protocolVersion,
        tick: state.tick,
        ducks: snapshotSimulation(state),
      })
      raceEventBus.emit(RACE_EVENTS.SNAPSHOT, snapshot)
      if (options.onSnapshot && (state.tick % persistenceEveryTicks === 0 || state.finished)) await options.onSnapshot(snapshot)
    }

    const newEvents = state.events.slice(emittedEventCount)
    emittedEventCount = state.events.length
    for (const raceEvent of newEvents as RaceEvent[]) raceEventBus.emit(RACE_EVENTS.ENGINE_EVENT, raceEvent)
    if (options.onEvents && (state.tick % persistenceEveryTicks === 0 || state.finished)) {
      const pendingEvents = state.events.slice(persistedEventCount)
      persistedEventCount = state.events.length
      if (pendingEvents.length > 0) await options.onEvents(pendingEvents)
    }

    if (realtime) {
      const targetElapsed = state.tick * (1000 / config.tickRate)
      const remaining = targetElapsed - (performance.now() - startedAt)
      if (remaining > 0) await wait(remaining)
    }
  }

  return resultFromSimulation(state)
}
