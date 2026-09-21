/** Matched-seed, rotating-slot audit. All opponents stay identical across loadout treatments. */
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { simulateRace } from '../packages/race-core/src'
import { FULL_LOADOUTS, createRaceConfig, loadoutKey } from './lib/balance-sim-core'
import { RACE_BALANCE_VERSION, pickupConfigSchema, type RaceEvent } from '../packages/race-protocol/src'
const arg = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback
const seeds = Number(arg('--seeds', '400'))
const start = Number(arg('--start', '1'))
const players = Number(arg('--players', '8'))
const out = arg('--out', '/tmp/balance-audit.json')
const pickups = process.argv.includes('--pickups')
if (!Number.isInteger(seeds) || seeds < 1 || !Number.isInteger(start) || start < 1 || !Number.isInteger(players) || players < 2 || players > 16) throw Error('Invalid seeds/start/players')
const started = performance.now()
const rows = FULL_LOADOUTS.map(loadout => ({ loadout: loadoutKey(loadout), ranks: [] as number[], wins: 0, bottom2: 0, top3: 0, silenceSeconds: 0, silences: 0, rocketFired: 0, rocketHit: 0 }))
for (let s = start; s < start + seeds; s++) {
  const focusSlot = (s - 1) % players
  // Multiplicative hash avoids cycling slot/opponent assignment in lockstep.
  const config = createRaceConfig(s, players)
  if (pickups) config.pickupConfig = pickupConfigSchema.parse({})
  const opponents = config.players.map((p, slot) => ({ playerId: p.playerId, itemIds: [...FULL_LOADOUTS[((Math.imul(s, 2654435761) >>> 0) + slot * 7) % FULL_LOADOUTS.length]!], source: 'PLAYER' as const }))
  for (let i = 0; i < FULL_LOADOUTS.length; i++) {
    const row = rows[i]!
    const focusId = config.players[focusSlot]!.playerId
    const loadouts = opponents.map((lo, slot) => slot === focusSlot ? { ...lo, itemIds: [...FULL_LOADOUTS[i]!] } : lo)
    const result = simulateRace({ ...config, loadouts }, { recordEvents: false, onEvent(event: RaceEvent) {
      if (event.type === 'ITEM_SILENCED') { row.silences++; row.silenceSeconds += Number(event.metadata.durationSeconds ?? 0) }
      if (event.sourcePlayerId === focusId && event.type === 'ROCKET_FIRED') row.rocketFired++
      if (event.sourcePlayerId === focusId && event.type === 'ROCKET_HIT') row.rocketHit++
    } })
    const rank = result.standings.find(entry => entry.playerId === focusId)!.rank
    row.ranks.push(rank)
    row.wins += Number(rank === 1)
    row.top3 += Number(rank <= 3)
    row.bottom2 += Number(rank > players - 2)
  }
  if ((s - start + 1) % 100 === 0) console.error(`${s - start + 1}/${seeds} seeds`)
}
const summary = rows.map(row => ({ ...row, winPct: row.wins / seeds * 100, top3Pct: row.top3 / seeds * 100, bottom2Pct: row.bottom2 / seeds * 100, avgRank: row.ranks.reduce((a,b) => a+b,0) / seeds }))
const report = { balanceVersion: RACE_BALANCE_VERSION, pickups, seeds, start, players, races: seeds * FULL_LOADOUTS.length, wallSeconds: (performance.now() - started) / 1000, rows: summary }
writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.table(summary.map(({loadout,winPct,bottom2Pct,avgRank}) => ({loadout,winPct,bottom2Pct,avgRank})))
console.log(JSON.stringify({out,races:report.races,seconds:report.wallSeconds}))
