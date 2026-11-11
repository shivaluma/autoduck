/**
 * Gate G3, TS side (docs/rewrite-plan.md Phase 6): runs the frozen TS engine
 * (S3.15) on every config of a G3 corpus (`race-cli balance g3-corpus`) and
 * writes the per-race outcomes in the shape of race-cli's `MixedRun`
 * (crates/race-cli/src/modes.rs). The Rust side is
 * `race-cli balance mixed --corpus <same file> --out rs.json`; then
 * `race-cli compare ts.json rs.json`.
 *
 *   node --no-use-std-math-pow --import tsx scripts/oracle/g3-balance.ts --corpus g3.jsonl --out ts.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { CORE_BALANCE, createSimulation, resolveChaosRule, resultFromSimulation, stepSimulation } from '../../packages/race-core/src'
import { RACE_BALANCE_VERSION, RACE_ENGINE_VERSION, raceConfigSchema, type RaceEvent } from '../../packages/race-protocol/src'

const arg = (key: string) => {
  const index = process.argv.indexOf(key)
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${key}`)
  return process.argv[index + 1]!
}

const lines = readFileSync(arg('--corpus'), 'utf8').split('\n').filter((line) => line.trim().length > 0)
const races = lines.map((line, index) => {
  const config = raceConfigSchema.parse(JSON.parse(line))
  const wildGrants: Record<string, number> = {}
  const duckGrants = new Map<string, number>()
  const duckPickups = new Map<string, number>()
  const state = createSimulation(config, {
    recordEvents: false,
    onEvent(event: RaceEvent) {
      if (event.type === 'PICKUP_COLLECTED' && event.sourcePlayerId) duckPickups.set(event.sourcePlayerId, (duckPickups.get(event.sourcePlayerId) ?? 0) + 1)
      if (event.type !== 'WILD_ITEM_GRANTED') return
      const itemId = String((event.metadata as { itemId?: string } | undefined)?.itemId)
      wildGrants[itemId] = (wildGrants[itemId] ?? 0) + 1
      if (event.sourcePlayerId) duckGrants.set(event.sourcePlayerId, (duckGrants.get(event.sourcePlayerId) ?? 0) + 1)
    },
  })
  const maxTicks = CORE_BALANCE.maximumDurationSeconds * config.tickRate
  let leader: string | undefined
  let leadChanges = 0
  while (!state.finished && state.tick < maxTicks) {
    stepSimulation(state)
    const now = state.ducks.find((duck) => duck.currentRank === 1)?.playerId
    if (leader !== undefined && now !== leader) leadChanges++
    leader = now
  }
  const chaosType = config.chaosConfig?.type ?? 'NORMAL'
  const standings = state.finished ? resultFromSimulation(state).standings : []
  const losers = new Set(state.finished
    ? resolveChaosRule(chaosType, standings.map((entry) => ({ playerId: entry.playerId, rank: entry.rank })), {
      targetPlayerId: config.chaosConfig?.targetPlayerId ?? null,
      groups: config.chaosConfig?.groups ?? [],
    }).loserPlayerIds
    : [])
  return {
    index,
    chaos: chaosType,
    finalTick: state.tick,
    finished: state.finished,
    leadChanges,
    wildGrants: Object.fromEntries(Object.entries(wildGrants).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    ducks: standings.map((entry) => ({
      playerId: entry.playerId,
      rank: entry.rank,
      items: config.loadouts?.find((loadout) => loadout.playerId === entry.playerId)?.itemIds ?? [],
      temperament: state.itemState?.brains?.get(entry.playerId)?.temperament ?? '',
      finishTimeMs: entry.finishTimeMs,
      wildGrants: duckGrants.get(entry.playerId) ?? 0,
      pickups: duckPickups.get(entry.playerId) ?? 0,
      chaosLoser: losers.has(entry.playerId),
    })),
  }
})

writeFileSync(arg('--out'), JSON.stringify({
  engine: 'ts',
  engineVersion: RACE_ENGINE_VERSION,
  balanceVersion: RACE_BALANCE_VERSION,
  corpus: `g3-v1/${races.length}`,
  races,
}) + '\n')
console.error(`g3-balance: ${races.length} races (TS ${RACE_BALANCE_VERSION}) -> ${arg('--out')}`)
