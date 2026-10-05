/**
 * Box (Wild Item) value audit. For every seed one focus duck's boxes are forced to yield item X, or
 * nothing at all (control), while every other duck rolls loot normally under the official pickup config.
 * Seeds, lobby loadouts and focus slot are identical across treatments, so
 *   value(X) = rank(control) − rank(X)   (positive = the item helped its holder)
 * is a paired difference. A balanced box has every item delivering a similar value per pickup.
 *
 *   node --import tsx scripts/balance-wild-items.ts --seeds 600 --workers 8 [--out file.json]
 */
import { fork } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { performance } from 'node:perf_hooks'
import { simulateRace } from '../packages/race-core/src'
import { createRaceRng } from '../packages/race-core/src/rng'
import { WILD_ITEM_CATALOG } from '../packages/race-core/src/pickups/catalog'
import { FULL_LOADOUTS, createRaceConfig } from './lib/balance-sim-core'
import { WILD_ITEM_BALANCE_VERSION, pickupConfigSchema, type WildItemId } from '../packages/race-protocol/src'
import { PRODUCTION_PICKUPS } from './balance-matrix-config'

type Treatment = WildItemId | 'NONE'
const TREATMENTS: Treatment[] = ['NONE', ...WILD_ITEM_CATALOG.map((item) => item.id)]
interface Cell { rankSum: number; wins: number; pickups: number; n: number; rankDelta: number[] }
type Result = Record<string, Cell>

const arg = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback
const players = Number(arg('--players', '8'))

function runShard(start: number, count: number): Result {
  const result: Result = Object.fromEntries(TREATMENTS.map((treatment) => [treatment, { rankSum: 0, wins: 0, pickups: 0, n: 0, rankDelta: [] }]))
  for (let s = start; s < start + count; s++) {
    const focusSlot = (s - 1) % players
    const config = createRaceConfig(s, players)
    config.pickupConfig = pickupConfigSchema.parse(PRODUCTION_PICKUPS)
    const rng = createRaceRng(config.seed, 'balance-matrix:MIXED')
    config.loadouts = config.players.map((player) => ({ playerId: player.playerId, itemIds: [...FULL_LOADOUTS[rng.integer(0, FULL_LOADOUTS.length - 1)]!], source: 'PLAYER' as const }))
    const focusId = config.players[focusSlot]!.playerId
    let controlRank = 0
    for (const treatment of TREATMENTS) {
      let pickups = 0
      const race = simulateRace(config, {
        recordEvents: false,
        lootOverride: (playerId) => playerId === focusId ? treatment : null,
        onEvent(event) { if (event.type === 'PICKUP_COLLECTED' && event.sourcePlayerId === focusId) pickups++ },
      })
      const rank = race.standings.find((entry) => entry.playerId === focusId)!.rank
      if (treatment === 'NONE') controlRank = rank
      const cell = result[treatment]!
      cell.n++; cell.rankSum += rank; cell.wins += Number(rank === 1); cell.pickups += pickups
      cell.rankDelta.push(controlRank - rank)
    }
  }
  return result
}

if (process.argv.includes('--worker')) {
  process.send!(runShard(Number(arg('--start', '1')), Number(arg('--count', '1'))))
} else void (async () => {
  const seeds = Number(arg('--seeds', '400'))
  const start = Number(arg('--start', '1'))
  const workers = Math.max(1, Math.min(seeds, Number(arg('--workers', String(availableParallelism())))))
  const out = arg('--out', '')
  const started = performance.now()
  const per = Math.ceil(seeds / workers)
  const merged: Result = Object.fromEntries(TREATMENTS.map((treatment) => [treatment, { rankSum: 0, wins: 0, pickups: 0, n: 0, rankDelta: [] }]))
  await Promise.all(Array.from({ length: workers }, (_, index) => ({ start: start + index * per, count: Math.max(0, Math.min(per, seeds - index * per)) }))
    .filter((shard) => shard.count > 0)
    .map((shard) => new Promise<void>((resolve, reject) => {
      const child = fork(__filename, ['--worker', '--start', String(shard.start), '--count', String(shard.count), '--players', String(players)], { execArgv: ['--import', 'tsx'] })
      child.on('message', (message) => {
        for (const [key, cell] of Object.entries(message as Result)) {
          const into = merged[key]!
          into.rankSum += cell.rankSum; into.wins += cell.wins; into.pickups += cell.pickups; into.n += cell.n; into.rankDelta.push(...cell.rankDelta)
        }
      })
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)))
    })))
  const control = merged.NONE!
  const rows = TREATMENTS.map((treatment) => {
    const cell = merged[treatment]!
    const mean = cell.rankDelta.reduce((a, b) => a + b, 0) / cell.n
    const sd = Math.sqrt(cell.rankDelta.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, cell.n - 1))
    const pickupsPerRace = control.pickups / control.n
    return {
      item: treatment,
      winPct: Number((cell.wins / cell.n * 100).toFixed(2)),
      avgRank: Number((cell.rankSum / cell.n).toFixed(3)),
      rankGain: Number(mean.toFixed(3)),
      ci95: Number((1.96 * sd / Math.sqrt(cell.n)).toFixed(3)),
      gainPerPickup: Number((mean / Math.max(1e-9, pickupsPerRace)).toFixed(3)),
    }
  })
  console.table(rows)
  const gains = rows.filter((row) => row.item !== 'NONE').map((row) => row.rankGain)
  console.log(`rankGain spread: min ${Math.min(...gains).toFixed(3)} max ${Math.max(...gains).toFixed(3)}; focus pickups/race ${(control.pickups / control.n).toFixed(2)}`)
  console.log(JSON.stringify({ wildItemBalanceVersion: WILD_ITEM_BALANCE_VERSION, seeds, start, races: seeds * TREATMENTS.length, seconds: Number(((performance.now() - started) / 1000).toFixed(1)) }))
  if (out) writeFileSync(out, JSON.stringify({ wildItemBalanceVersion: WILD_ITEM_BALANCE_VERSION, seeds, start, players, rows }, null, 2) + '\n')
})()
