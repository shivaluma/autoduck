import { performance } from 'node:perf_hooks'
import { simulateRace } from '../packages/race-core/src'
import {
  DEFAULT_TRACK_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  raceConfigSchema,
} from '../packages/race-protocol/src'

function argument(name: string, fallback: number) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

const raceCount = argument('--races', 10_000)
const playerCount = argument('--players', 8)
if (playerCount < 2 || playerCount > 16) throw new Error('--players must be between 2 and 16')

const wins = Array(playerCount).fill(0) as number[]
const bottomTwo = Array(playerCount).fill(0) as number[]
const positions = Array(playerCount).fill(0) as number[]
const startedAt = performance.now()

for (let raceIndex = 1; raceIndex <= raceCount; raceIndex += 1) {
  const seed = raceIndex.toString(16).padStart(64, '0')
  const config = raceConfigSchema.parse({
    raceId: `sim-${raceIndex}`,
    seed,
    protocolVersion: RACE_PROTOCOL_VERSION,
    engineVersion: RACE_ENGINE_VERSION,
    balanceVersion: RACE_BALANCE_VERSION,
    trackVersion: DEFAULT_TRACK_VERSION,
    tickRate: RACE_TICK_RATE,
    players: Array.from({ length: playerCount }, (_, index) => ({ playerId: `duck-${index + 1}`, name: `Duck ${index + 1}` })),
  })
  const result = simulateRace(config, { recordEvents: false })
  result.standings.forEach((entry) => {
    const playerIndex = Number(entry.playerId.split('-')[1]) - 1
    positions[playerIndex] += entry.rank
  })
  wins[Number(result.standings[0].playerId.split('-')[1]) - 1] += 1
  result.standings.slice(-2).forEach((entry) => { bottomTwo[Number(entry.playerId.split('-')[1]) - 1] += 1 })
}

const elapsedSeconds = (performance.now() - startedAt) / 1000
const rows = wins.map((winCount, index) => ({
  slot: index + 1,
  winRate: `${(winCount / raceCount * 100).toFixed(2)}%`,
  bottom2Rate: `${(bottomTwo[index] / raceCount * 100).toFixed(2)}%`,
  averagePosition: (positions[index] / raceCount).toFixed(3),
}))

console.table(rows)
console.log(`Simulated ${raceCount.toLocaleString()} races in ${elapsedSeconds.toFixed(2)}s (${(raceCount / elapsedSeconds).toFixed(0)} races/s).`)
