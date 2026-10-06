/**
 * Temperament fairness audit: win %, loser % (Chaos-accurate) and average rank per Duck Brain temperament,
 * over every duck in mixed-loadout races with the official pickup config. Fair = 1/players win rate.
 *
 *   node --import tsx scripts/balance-temperaments.ts --races 2000 --workers 8 [--mode NORMAL] [--out file.json]
 */
import { fork } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolveChaosRule, simulateRace, type ChaosRuleId } from '../packages/race-core/src'
import { createDuckBrains, TEMPERAMENTS } from '../packages/race-core/src/auto-use/brain'
import { createRaceRng } from '../packages/race-core/src/rng'
import { pickupConfigSchema } from '../packages/race-protocol/src'
import { FULL_LOADOUTS, createRaceConfig } from './lib/balance-sim-core'
import { PRODUCTION_PICKUPS } from './balance-matrix-config'

interface Cell { wins: number; losses: number; rankSum: number; n: number }
type Result = Record<string, Cell>
const arg = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback
const players = Number(arg('--players', '8'))
const mode = arg('--mode', 'NORMAL') as ChaosRuleId

function chaosConfig(seedIndex: number, ids: string[]) {
  const rng = createRaceRng(`${seedIndex}`, 'balance-temperaments:chaos')
  const shuffled = [...ids].sort((left, right) => left.localeCompare(right)).map((id) => ({ id, key: rng.next() })).sort((a, b) => a.key - b.key).map((entry) => entry.id)
  if (mode === 'BOUNTY_HUNT') return { type: mode, targetPlayerId: shuffled[0]!, groups: undefined }
  if (mode === 'DUO') return { type: mode, targetPlayerId: null, groups: Array.from({ length: Math.ceil(shuffled.length / 2) }, (_, index) => shuffled.slice(index * 2, index * 2 + 2)) }
  if (mode === 'CONSTRUCTORS') return { type: mode, targetPlayerId: null, groups: [shuffled.slice(0, Math.ceil(shuffled.length / 2)), shuffled.slice(Math.ceil(shuffled.length / 2))] }
  return { type: mode, targetPlayerId: null, groups: undefined }
}

function runShard(start: number, count: number): Result {
  const result: Result = Object.fromEntries(TEMPERAMENTS.map((temperament) => [temperament, { wins: 0, losses: 0, rankSum: 0, n: 0 }]))
  for (let s = start; s < start + count; s++) {
    const config = createRaceConfig(s, players)
    config.pickupConfig = pickupConfigSchema.parse(PRODUCTION_PICKUPS)
    const rng = createRaceRng(config.seed, 'balance-matrix:MIXED')
    config.loadouts = config.players.map((player) => ({ playerId: player.playerId, itemIds: [...FULL_LOADOUTS[rng.integer(0, FULL_LOADOUTS.length - 1)]!], source: 'PLAYER' as const }))
    if (mode !== 'NORMAL') config.chaosConfig = chaosConfig(s, config.players.map((player) => player.playerId))
    const brains = createDuckBrains(config)
    const race = simulateRace(config, { recordEvents: false })
    const chaos = resolveChaosRule(mode, race.standings.map((entry) => ({ playerId: entry.playerId, rank: entry.rank })), { targetPlayerId: config.chaosConfig?.targetPlayerId ?? null, groups: config.chaosConfig?.groups ?? [] })
    const losers = new Set(chaos.loserPlayerIds)
    for (const entry of race.standings) {
      const cell = result[brains.get(entry.playerId)!.temperament]!
      cell.n++; cell.rankSum += entry.rank; cell.wins += Number(entry.rank === 1); cell.losses += Number(losers.has(entry.playerId))
    }
  }
  return result
}

if (process.argv.includes('--worker')) {
  process.send!(runShard(Number(arg('--start', '1')), Number(arg('--count', '1'))))
} else void (async () => {
  const races = Number(arg('--races', '2000'))
  const start = Number(arg('--start', '1'))
  const workers = Math.max(1, Math.min(races, Number(arg('--workers', String(availableParallelism())))))
  const per = Math.ceil(races / workers)
  const merged: Result = Object.fromEntries(TEMPERAMENTS.map((temperament) => [temperament, { wins: 0, losses: 0, rankSum: 0, n: 0 }]))
  await Promise.all(Array.from({ length: workers }, (_, index) => ({ start: start + index * per, count: Math.max(0, Math.min(per, races - index * per)) }))
    .filter((shard) => shard.count > 0)
    .map((shard) => new Promise<void>((resolve, reject) => {
      const child = fork(__filename, ['--worker', '--start', String(shard.start), '--count', String(shard.count), '--players', String(players), '--mode', mode], { execArgv: ['--import', 'tsx'] })
      child.on('message', (message) => {
        for (const [key, cell] of Object.entries(message as Result)) {
          const into = merged[key]!
          into.wins += cell.wins; into.losses += cell.losses; into.rankSum += cell.rankSum; into.n += cell.n
        }
      })
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)))
    })))
  const rows = TEMPERAMENTS.map((temperament) => {
    const cell = merged[temperament]!
    return { temperament, ducks: cell.n, winPct: Number((cell.wins / cell.n * 100).toFixed(2)), loserPct: Number((cell.losses / cell.n * 100).toFixed(2)), avgRank: Number((cell.rankSum / cell.n).toFixed(3)) }
  })
  console.log(`mode ${mode}, ${races} races, fair win % = ${(100 / players).toFixed(2)}`)
  console.table(rows)
  if (arg('--out', '')) writeFileSync(arg('--out', ''), JSON.stringify({ mode, races, start, players, rows }, null, 2) + '\n')
})()
