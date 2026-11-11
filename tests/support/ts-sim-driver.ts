import { createSimulation, queueWildItemInput, snapshotRaceWorld, stepSimulation, type RaceSimulationState } from '../../packages/race-core/src'
import type { RaceConfig, RaceEvent, RecordedWildItemInput } from '../../packages/race-protocol/src'
import type { DriverFrame, TimelineDriver } from '../../components/racing/drivers/types'

/**
 * Test-only: the synchronous TS-engine SimDriver the browser used before Phase 5 (the browser now
 * re-simulates with the WASM engine in a Web Worker, components/racing/drivers/sim-driver.ts). The viewer
 * tests use it to compare TS-era recordings and playback against a re-simulation of the same TS race.
 */
export function createTsSimDriver(
  config: RaceConfig,
  options: { manualInputs?: readonly RecordedWildItemInput[]; endTick?: number | null } = {},
): TimelineDriver & { queueInput(input: Omit<RecordedWildItemInput, 'authoritativeTick'>, authoritativeTick: number): void } {
  let state: RaceSimulationState
  let eventCount = 0
  const reset = () => {
    state = createSimulation(config, { manualInputs: [...(options.manualInputs ?? [])] })
    eventCount = state.events.length
  }
  reset()
  return {
    kind: 'sim',
    tickRate: config.tickRate,
    endTick: options.endTick ?? null,
    seekable: true,
    tick: () => state.tick,
    finished: () => state.finished,
    reset,
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
