import { performance } from 'node:perf_hooks'
import { raceEventBus, RACE_EVENTS } from '@/lib/event-bus'
import {
  createSimulation,
  resultFromSimulation,
  snapshotRaceWorld,
  stepSimulation,
  type RaceSimulationState,
} from '@/packages/race-core/src'
import type { RaceConfig, RaceEvent, RaceResult, StateSnapshotMessage } from '@/packages/race-protocol/src'
import { stateSnapshotMessageSchema } from '@/packages/race-protocol/src'

export interface RaceRuntimeOptions {
  realtime?: boolean
  snapshotRate?: number
  persistenceRate?: number
  /** When false, onSnapshot/onEvents are skipped during the loop (flush at end instead). */
  persistDuringRace?: boolean
  /** Called every snapshot tick for in-memory viewers. Never touches DB. */
  onLiveSnapshot?: (snapshot: StateSnapshotMessage) => unknown | Promise<unknown>
  onSnapshot?: (snapshot: StateSnapshotMessage) => unknown | Promise<unknown>
  onEvents?: (events: RaceEvent[]) => unknown | Promise<unknown>
  beforeTick?: (state: RaceSimulationState) => unknown | Promise<unknown>
  afterTick?: (state: RaceSimulationState, newEvents: RaceEvent[]) => unknown | Promise<unknown>
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function maybeAwait<T>(task: T | Promise<T>): T | Promise<T> {
  if (task && typeof (task as Promise<T>).then === 'function') return task
  return task
}

function fireAndForget(task: unknown) {
  if (!task || typeof (task as Promise<unknown>).then !== 'function') return
  void (task as Promise<unknown>).catch((error) => {
    console.error('race runtime background task failed', error)
  })
}

export async function runAuthoritativeRace(config: RaceConfig, options: RaceRuntimeOptions = {}): Promise<RaceResult> {
  const realtime = options.realtime !== false
  const snapshotRate = options.snapshotRate ?? 12
  const snapshotEveryTicks = Math.max(1, Math.round(config.tickRate / snapshotRate))
  const persistenceEveryTicks = Math.max(1, Math.round(config.tickRate / (options.persistenceRate ?? 1)))
  const persistDuringRace = options.persistDuringRace !== false
  const state = createSimulation(config)
  let emittedEventCount = 0
  let persistedEventCount = 0
  const startedAt = performance.now()

  while (!state.finished) {
    await maybeAwait(options.beforeTick?.(state))
    stepSimulation(state)

    const newEvents = state.events.slice(emittedEventCount) as RaceEvent[]
    emittedEventCount = state.events.length
    await maybeAwait(options.afterTick?.(state, newEvents))

    if (state.tick % snapshotEveryTicks === 0 || state.finished) {
      const world = snapshotRaceWorld(state)
      const snapshot: StateSnapshotMessage = {
        type: 'STATE_SNAPSHOT',
        raceId: config.raceId,
        protocolVersion: config.protocolVersion,
        tick: state.tick,
        ...world,
      }
      raceEventBus.emit(RACE_EVENTS.SNAPSHOT, snapshot)
      if (options.onLiveSnapshot) fireAndForget(options.onLiveSnapshot(snapshot))
      if (persistDuringRace && options.onSnapshot && (state.tick % persistenceEveryTicks === 0 || state.finished)) {
        fireAndForget(options.onSnapshot(stateSnapshotMessageSchema.parse(snapshot)))
      }
    }

    for (const raceEvent of newEvents) raceEventBus.emit(RACE_EVENTS.ENGINE_EVENT, raceEvent)
    if (persistDuringRace && options.onEvents && (state.tick % persistenceEveryTicks === 0 || state.finished)) {
      const pendingEvents = state.events.slice(persistedEventCount)
      persistedEventCount = state.events.length
      if (pendingEvents.length > 0) fireAndForget(options.onEvents(pendingEvents))
    }

    if (realtime) {
      const targetElapsed = state.tick * (1000 / config.tickRate)
      const remaining = targetElapsed - (performance.now() - startedAt)
      if (remaining > 0) await wait(remaining)
    }
  }

  return resultFromSimulation(state)
}
