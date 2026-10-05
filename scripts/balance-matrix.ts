/**
 * Matched-seed loadout balance + counter-loop matrix.
 *
 * For every seed, the 7 opponents and the focus slot are fixed; only the focus duck's loadout changes
 * (paired design, same as balance-audit.ts). Lobbies:
 *   MIXED   — opponents drawn from all 18 loadouts (overall power).
 *   SPEED / DEFENSE / ATTACK — opponents drawn only from loadouts whose Major has that class
 *            (counter loop: DEFENSE should beat ATTACK lobbies, SPEED beat DEFENSE, ATTACK beat SPEED).
 * In a lobby of 8, a fair loadout wins 12.5%.
 *
 *   node --import tsx scripts/balance-matrix.ts --seeds 400 --workers 8 [--pickups] [--lobbies MIXED,SPEED] [--out file.json]
 */
import { fork } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { performance } from 'node:perf_hooks'
import { simulateRace } from '../packages/race-core/src'
import { createRaceRng } from '../packages/race-core/src/rng'
import { FULL_LOADOUTS, createRaceConfig, loadoutArchetype, loadoutKey, type FullLoadout } from './lib/balance-sim-core'
import { RACE_BALANCE_VERSION, pickupConfigSchema } from '../packages/race-protocol/src'
import type { ItemClass } from '../packages/race-core/src/items/classes'
import { PRODUCTION_PICKUPS } from './balance-matrix-config'

type Lobby = 'MIXED' | ItemClass
const ALL_LOBBIES: Lobby[] = ['MIXED', 'SPEED', 'DEFENSE', 'ATTACK']

interface Cell { wins: number; top3: number; bottom2: number; rankSum: number; n: number }
type Result = Record<string, Record<string, Cell>>

const arg = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback

function pool(lobby: Lobby): readonly FullLoadout[] {
  return lobby === 'MIXED' ? FULL_LOADOUTS : FULL_LOADOUTS.filter((loadout) => loadoutArchetype(loadout) === lobby)
}

function runShard(start: number, count: number, players: number, pickups: boolean, lobbies: Lobby[]): Result {
  const result: Result = {}
  for (const lobby of lobbies) {
    result[lobby] = Object.fromEntries(FULL_LOADOUTS.map((loadout) => [loadoutKey(loadout), { wins: 0, top3: 0, bottom2: 0, rankSum: 0, n: 0 }]))
    const opponentPool = pool(lobby)
    for (let s = start; s < start + count; s++) {
      const focusSlot = (s - 1) % players
      const config = createRaceConfig(s, players)
      if (pickups) config.pickupConfig = pickupConfigSchema.parse(PRODUCTION_PICKUPS)
      const rng = createRaceRng(config.seed, `balance-matrix:${lobby}`)
      const base = config.players.map((player) => ({
        playerId: player.playerId,
        itemIds: [...opponentPool[rng.integer(0, opponentPool.length - 1)]!],
        source: 'PLAYER' as const,
      }))
      const focusId = config.players[focusSlot]!.playerId
      for (const loadout of FULL_LOADOUTS) {
        const loadouts = base.map((entry, slot) => slot === focusSlot ? { ...entry, itemIds: [...loadout] } : entry)
        const race = simulateRace({ ...config, loadouts }, { recordEvents: false })
        const rank = race.standings.find((entry) => entry.playerId === focusId)!.rank
        const cell = result[lobby]![loadoutKey(loadout)]!
        cell.n++
        cell.rankSum += rank
        cell.wins += Number(rank === 1)
        cell.top3 += Number(rank <= 3)
        cell.bottom2 += Number(rank > players - 2)
      }
    }
  }
  return result
}

function merge(target: Result, source: Result) {
  for (const [lobby, cells] of Object.entries(source)) {
    target[lobby] ??= {}
    for (const [key, cell] of Object.entries(cells)) {
      const into = target[lobby]![key] ??= { wins: 0, top3: 0, bottom2: 0, rankSum: 0, n: 0 }
      into.wins += cell.wins; into.top3 += cell.top3; into.bottom2 += cell.bottom2; into.rankSum += cell.rankSum; into.n += cell.n
    }
  }
}

const pct = (part: number, whole: number) => whole === 0 ? 0 : part / whole * 100

function report(result: Result, lobbies: Lobby[]) {
  const rows = FULL_LOADOUTS.map((loadout) => {
    const key = loadoutKey(loadout)
    const row: Record<string, string | number> = { loadout: key }
    for (const lobby of lobbies) row[lobby] = Number(pct(result[lobby]![key]!.wins, result[lobby]![key]!.n).toFixed(1))
    if (result.MIXED) row.mixedRank = Number((result.MIXED[key]!.rankSum / result.MIXED[key]!.n).toFixed(2))
    if (result.MIXED) row.mixedBot2 = Number(pct(result.MIXED[key]!.bottom2, result.MIXED[key]!.n).toFixed(1))
    return row
  })
  console.table(rows)
  const classes: ItemClass[] = ['SPEED', 'DEFENSE', 'ATTACK']
  const matrix = classes.map((focus) => {
    const row: Record<string, string | number> = { focus }
    for (const lobby of lobbies) {
      let wins = 0, n = 0
      for (const loadout of FULL_LOADOUTS.filter((entry) => loadoutArchetype(entry) === focus)) {
        wins += result[lobby]![loadoutKey(loadout)]!.wins; n += result[lobby]![loadoutKey(loadout)]!.n
      }
      row[lobby] = Number(pct(wins, n).toFixed(1))
    }
    return row
  })
  console.log('Win % by focus Major class (rows) × lobby (columns); fair = 12.5')
  console.table(matrix)
  if (result.MIXED) {
    const wins = FULL_LOADOUTS.map((loadout) => pct(result.MIXED![loadoutKey(loadout)]!.wins, result.MIXED![loadoutKey(loadout)]!.n))
    const mean = wins.reduce((a, b) => a + b, 0) / wins.length
    const sd = Math.sqrt(wins.reduce((a, b) => a + (b - mean) ** 2, 0) / wins.length)
    console.log(`MIXED win% spread: min ${Math.min(...wins).toFixed(1)} max ${Math.max(...wins).toFixed(1)} sd ${sd.toFixed(2)} mean ${mean.toFixed(2)}`)
  }
}

const isWorker = process.argv.includes('--worker')
const players = Number(arg('--players', '8'))
const pickups = process.argv.includes('--pickups')
const lobbies = arg('--lobbies', ALL_LOBBIES.join(',')).split(',') as Lobby[]

if (isWorker) {
  const start = Number(arg('--start', '1'))
  const count = Number(arg('--count', '1'))
  process.send!(runShard(start, count, players, pickups, lobbies))
} else void (async () => {
  const seeds = Number(arg('--seeds', '200'))
  const start = Number(arg('--start', '1'))
  const workers = Math.max(1, Math.min(seeds, Number(arg('--workers', String(availableParallelism())))))
  const out = arg('--out', '')
  const started = performance.now()
  const self = __filename
  const per = Math.ceil(seeds / workers)
  const shards = Array.from({ length: workers }, (_, index) => ({ start: start + index * per, count: Math.max(0, Math.min(per, seeds - index * per)) })).filter((shard) => shard.count > 0)
  const merged: Result = {}
  await Promise.all(shards.map((shard) => new Promise<void>((resolve, reject) => {
    const child = fork(self, ['--worker', '--start', String(shard.start), '--count', String(shard.count), '--players', String(players), '--lobbies', lobbies.join(','), ...(pickups ? ['--pickups'] : [])], { execArgv: ['--import', 'tsx'] })
    child.on('message', (message) => { merge(merged, message as Result) })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)))
  })))
  report(merged, lobbies)
  const seconds = (performance.now() - started) / 1000
  console.log(JSON.stringify({ balanceVersion: RACE_BALANCE_VERSION, seeds, start, pickups, races: seeds * lobbies.length * FULL_LOADOUTS.length, seconds: Number(seconds.toFixed(1)) }))
  if (out) writeFileSync(out, JSON.stringify({ balanceVersion: RACE_BALANCE_VERSION, seeds, start, players, pickups, lobbies, result: merged }, null, 2) + '\n')
})()
