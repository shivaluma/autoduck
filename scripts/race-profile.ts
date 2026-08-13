import { performance } from 'node:perf_hooks'
import { createSimulation, resultFromSimulation, stepSimulation } from '../packages/race-core/src'
import {
  DEFAULT_TRACK_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  type RaceConfig,
  type RaceItemId,
} from '../packages/race-protocol/src'

const LOADOUTS: readonly (readonly [RaceItemId, RaceItemId])[] = [
  ['BUBBLE_SHIELD', 'BANANA'],
  ['HOMING_ROCKET', 'FEATHER'],
  ['NITRO', 'QUACK_HORN'],
]

function argument(name: string, fallback: number) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function config(raceIndex: number, playerCount: number): RaceConfig {
  return {
    raceId: `profile-${playerCount}-${raceIndex}`,
    seed: raceIndex.toString(16).padStart(64, '0'),
    protocolVersion: RACE_PROTOCOL_VERSION,
    engineVersion: RACE_ENGINE_VERSION,
    balanceVersion: RACE_BALANCE_VERSION,
    trackVersion: DEFAULT_TRACK_VERSION,
    tickRate: RACE_TICK_RATE,
    players: Array.from({ length: playerCount }, (_, index) => ({ playerId: `duck-${index + 1}`, name: `Duck ${index + 1}` })),
    loadouts: Array.from({ length: playerCount }, (_, index) => ({
      playerId: `duck-${index + 1}`,
      itemIds: [...LOADOUTS[(raceIndex + index) % LOADOUTS.length]],
      source: 'AUTO' as const,
    })),
  }
}

function profile(playerCount: number, raceCount: number) {
  const wallTimes: number[] = []
  let totalTicks = 0
  let maximumDynamicObjects = 0
  let maximumEventCount = 0
  let maximumRaceDurationMs = 0
  const startedAt = performance.now()

  for (let raceIndex = 1; raceIndex <= raceCount; raceIndex += 1) {
    const raceStartedAt = performance.now()
    const state = createSimulation(config(raceIndex, playerCount))
    while (!state.finished) {
      stepSimulation(state)
      maximumDynamicObjects = Math.max(maximumDynamicObjects, state.itemState.rockets.length + state.itemState.bananas.length)
    }
    const result = resultFromSimulation(state)
    wallTimes.push(performance.now() - raceStartedAt)
    totalTicks += state.tick
    maximumEventCount = Math.max(maximumEventCount, result.events.length)
    maximumRaceDurationMs = Math.max(maximumRaceDurationMs, result.durationMs)
  }

  wallTimes.sort((left, right) => left - right)
  const elapsedMs = performance.now() - startedAt
  return {
    ducks: playerCount,
    items: playerCount * 2,
    races: raceCount,
    simulationsPerSecond: Number((raceCount / elapsedMs * 1000).toFixed(1)),
    averageWallMs: Number((elapsedMs / raceCount).toFixed(2)),
    p95WallMs: Number(wallTimes[Math.floor(wallTimes.length * 0.95)].toFixed(2)),
    averageTicks: Math.round(totalTicks / raceCount),
    maximumDynamicObjects,
    maximumEventCount,
    maximumRaceDurationMs: Number(maximumRaceDurationMs.toFixed(2)),
  }
}

const raceCount = argument('--races', 250)
const memoryBefore = process.memoryUsage().heapUsed
const rows = [profile(8, raceCount), profile(16, raceCount)]
const memoryAfter = process.memoryUsage().heapUsed
console.table(rows)
console.log(`Heap delta: ${((memoryAfter - memoryBefore) / 1024 / 1024).toFixed(2)} MiB`)
