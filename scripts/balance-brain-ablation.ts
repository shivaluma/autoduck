/**
 * Duck Brain ablation: does the Chaos-aware, personality-driven brain make better decisions?
 * For every seed one focus duck plays twice on the identical lobby — once with its brain, once ablated
 * (neutral traits, no memory, rank-cutoff objectives that ignore bounty/team scoring). Everyone else
 * keeps their brain. Lower focus loser % with the brain = better decisions under that Chaos card.
 *
 *   node --import tsx scripts/balance-brain-ablation.ts --seeds 600 --workers 8 [--modes NORMAL,BOUNTY_HUNT,DUO]
 */
import { fork } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { resolveChaosRule, simulateRace, type ChaosRuleId } from '../packages/race-core/src'
import { createRaceRng } from '../packages/race-core/src/rng'
import { pickupConfigSchema } from '../packages/race-protocol/src'
import { FULL_LOADOUTS, createRaceConfig } from './lib/balance-sim-core'
import { PRODUCTION_PICKUPS } from './balance-matrix-config'

interface Cell { n: number; brainLoss: number; ablatedLoss: number; brainWins: number; ablatedWins: number; lossDiff: number[] }
type Result = Record<string, Cell>
const arg = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback
const players = 8
const modes = arg('--modes', 'NORMAL,BOUNTY_HUNT,DUO,CONSTRUCTORS,CUT_LINE,TRIPLE_ELIMINATION,REVERSE').split(',') as ChaosRuleId[]

function chaosConfig(mode: ChaosRuleId, seedIndex: number, ids: string[]) {
  const rng = createRaceRng(`${seedIndex}`, `brain-ablation:${mode}`)
  const shuffled = ids.map((id) => ({ id, key: rng.next() })).sort((a, b) => a.key - b.key).map((entry) => entry.id)
  if (mode === 'BOUNTY_HUNT') return { type: mode, targetPlayerId: shuffled[0]!, groups: undefined }
  if (mode === 'DUO') return { type: mode, targetPlayerId: null, groups: Array.from({ length: players / 2 }, (_, index) => shuffled.slice(index * 2, index * 2 + 2)) }
  if (mode === 'CONSTRUCTORS') return { type: mode, targetPlayerId: null, groups: [shuffled.slice(0, players / 2), shuffled.slice(players / 2)] }
  return { type: mode, targetPlayerId: null, groups: undefined }
}

function runShard(start: number, count: number): Result {
  const result: Result = {}
  for (const mode of modes) {
    const cell: Cell = result[mode] = { n: 0, brainLoss: 0, ablatedLoss: 0, brainWins: 0, ablatedWins: 0, lossDiff: [] }
    for (let s = start; s < start + count; s++) {
      const config = createRaceConfig(s, players)
      config.pickupConfig = pickupConfigSchema.parse(PRODUCTION_PICKUPS)
      const rng = createRaceRng(config.seed, 'balance-matrix:MIXED')
      config.loadouts = config.players.map((player) => ({ playerId: player.playerId, itemIds: [...FULL_LOADOUTS[rng.integer(0, FULL_LOADOUTS.length - 1)]!], source: 'PLAYER' as const }))
      const ids = config.players.map((player) => player.playerId)
      if (mode !== 'NORMAL') config.chaosConfig = chaosConfig(mode, s, ids)
      const focusId = ids[(s - 1) % players]!
      const prepared = { targetPlayerId: config.chaosConfig?.targetPlayerId ?? null, groups: config.chaosConfig?.groups ?? [] }
      const outcome = (ablate: boolean) => {
        const race = simulateRace(config, { recordEvents: false, aiAblationPlayerIds: ablate ? [focusId] : [] })
        const losers = new Set(resolveChaosRule(mode, race.standings.map((entry) => ({ playerId: entry.playerId, rank: entry.rank })), prepared).loserPlayerIds)
        return { lost: losers.has(focusId), won: race.standings[0]!.playerId === focusId }
      }
      const brain = outcome(false)
      const ablated = outcome(true)
      cell.n++
      cell.brainLoss += Number(brain.lost); cell.ablatedLoss += Number(ablated.lost)
      cell.brainWins += Number(brain.won); cell.ablatedWins += Number(ablated.won)
      cell.lossDiff.push(Number(brain.lost) - Number(ablated.lost))
    }
  }
  return result
}

if (process.argv.includes('--worker')) {
  process.send!(runShard(Number(arg('--start', '1')), Number(arg('--count', '1'))))
} else void (async () => {
  const seeds = Number(arg('--seeds', '600'))
  const start = Number(arg('--start', '1'))
  const workers = Math.max(1, Math.min(seeds, Number(arg('--workers', String(availableParallelism())))))
  const per = Math.ceil(seeds / workers)
  const merged: Result = {}
  await Promise.all(Array.from({ length: workers }, (_, index) => ({ start: start + index * per, count: Math.max(0, Math.min(per, seeds - index * per)) }))
    .filter((shard) => shard.count > 0)
    .map((shard) => new Promise<void>((resolve, reject) => {
      const child = fork(__filename, ['--worker', '--start', String(shard.start), '--count', String(shard.count), '--modes', modes.join(',')], { execArgv: ['--import', 'tsx'] })
      child.on('message', (message) => {
        for (const [mode, cell] of Object.entries(message as Result)) {
          const into = merged[mode] ??= { n: 0, brainLoss: 0, ablatedLoss: 0, brainWins: 0, ablatedWins: 0, lossDiff: [] }
          into.n += cell.n; into.brainLoss += cell.brainLoss; into.ablatedLoss += cell.ablatedLoss
          into.brainWins += cell.brainWins; into.ablatedWins += cell.ablatedWins; into.lossDiff.push(...cell.lossDiff)
        }
      })
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)))
    })))
  const rows = modes.map((mode) => {
    const cell = merged[mode]!
    const mean = cell.lossDiff.reduce((a, b) => a + b, 0) / cell.n
    const sd = Math.sqrt(cell.lossDiff.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, cell.n - 1))
    const ci = 1.96 * sd / Math.sqrt(cell.n)
    return {
      mode,
      races: cell.n,
      loserPctBrain: Number((cell.brainLoss / cell.n * 100).toFixed(1)),
      loserPctAblated: Number((cell.ablatedLoss / cell.n * 100).toFixed(1)),
      deltaPts: Number((mean * 100).toFixed(1)),
      ci95Pts: `[${((mean - ci) * 100).toFixed(1)}, ${((mean + ci) * 100).toFixed(1)}]`,
      winPctBrain: Number((cell.brainWins / cell.n * 100).toFixed(1)),
      winPctAblated: Number((cell.ablatedWins / cell.n * 100).toFixed(1)),
    }
  })
  console.log('Focus duck loser % with its brain vs ablated (paired seeds). Negative delta = the brain loses less.')
  console.table(rows)
  if (arg('--out', '')) writeFileSync(arg('--out', ''), JSON.stringify({ seeds, start, rows }, null, 2) + '\n')
})()
