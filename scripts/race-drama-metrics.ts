/**
 * Drama + decision-quality metrics for the auto-use AI on identical seeds and lobbies, so two engine
 * versions can be compared (run once per checkout). Official pickup config, mixed loadouts.
 *
 *   node --import tsx scripts/race-drama-metrics.ts --races 400 [--mode BOUNTY_HUNT] [--start 1]
 */
import { createSimulation, resolveChaosRule, resultFromSimulation, stepSimulation, type ChaosRuleId } from '../packages/race-core/src'
import { createRaceRng } from '../packages/race-core/src/rng'
import { pickupConfigSchema, type RaceEvent } from '../packages/race-protocol/src'
import { FULL_LOADOUTS, createRaceConfig } from './lib/balance-sim-core'
import { PRODUCTION_PICKUPS } from './balance-matrix-config'

const arg = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback
const races = Number(arg('--races', '400'))
const start = Number(arg('--start', '1'))
const mode = arg('--mode', 'NORMAL') as ChaosRuleId
const players = 8

const ATTACKS = new Set(['ROCKET_FIRED', 'MINI_ROCKET_FIRED', 'BANANA_DROPPED', 'WILD_BANANA_DROPPED', 'HORN_USED', 'WILD_HORN_USED'])
const totals = {
  leadChanges: 0, lateLeadChanges: 0, decidedLate: 0, marginMs: 0, photoFinishes: 0,
  attacks: 0, rocketsFired: 0, rocketsHit: 0, rocketsBlocked: 0, bananasDropped: 0, bananasHit: 0, bananasExpired: 0,
  hornsUsed: 0, hornTargets: 0, prepUnused: 0, intents: 0, lastStretchItemUses: 0, itemUses: 0,
  wantedHits: 0, wantedEscaped: 0,
}

for (let s = start; s < start + races; s++) {
  const config = createRaceConfig(s, players)
  config.pickupConfig = pickupConfigSchema.parse(PRODUCTION_PICKUPS)
  const rng = createRaceRng(config.seed, 'balance-matrix:MIXED')
  config.loadouts = config.players.map((player) => ({ playerId: player.playerId, itemIds: [...FULL_LOADOUTS[rng.integer(0, FULL_LOADOUTS.length - 1)]!], source: 'PLAYER' as const }))
  const ids = config.players.map((player) => player.playerId)
  if (mode === 'BOUNTY_HUNT') config.chaosConfig = { type: mode, targetPlayerId: ids[(s * 7) % players]!, groups: undefined }
  else if (mode === 'DUO') config.chaosConfig = { type: mode, targetPlayerId: null, groups: [[ids[0]!, ids[5]!], [ids[1]!, ids[6]!], [ids[2]!, ids[7]!], [ids[3]!, ids[4]!]] }
  else if (mode === 'CONSTRUCTORS') config.chaosConfig = { type: mode, targetPlayerId: null, groups: [[ids[0]!, ids[2]!, ids[4]!, ids[6]!], [ids[1]!, ids[3]!, ids[5]!, ids[7]!]] }
  else if (mode !== 'NORMAL') config.chaosConfig = { type: mode, targetPlayerId: null, groups: undefined }

  const state = createSimulation(config, { recordEvents: true })
  let leader = ''
  let leaderAt90 = ''
  while (!state.finished) {
    stepSimulation(state)
    const racing = state.ducks.filter((duck) => !duck.finished)
    if (racing.length === 0 || state.ducks.some((duck) => duck.finished)) continue
    const front = [...state.ducks].sort((left, right) => right.progress - left.progress)[0]!
    if (leader && front.playerId !== leader) {
      totals.leadChanges++
      if (front.progress >= 0.85) totals.lateLeadChanges++
    }
    leader = front.playerId
    if (!leaderAt90 && front.progress >= 0.9) leaderAt90 = front.playerId
  }
  const result = resultFromSimulation(state)
  const events: RaceEvent[] = result.events
  if (leaderAt90 && result.standings[0]!.playerId !== leaderAt90) totals.decidedLate++
  const margin = (result.standings[1]?.finishTimeMs ?? 0) - (result.standings[0]?.finishTimeMs ?? 0)
  totals.marginMs += margin
  if (margin < 150) totals.photoFinishes++

  const wanted = config.chaosConfig?.targetPlayerId ?? null
  for (const event of events) {
    if (ATTACKS.has(event.type)) totals.attacks++
    if (event.type === 'ROCKET_FIRED') totals.rocketsFired++
    if (event.type === 'ROCKET_HIT') totals.rocketsHit++
    if (event.type === 'ROCKET_BLOCKED') totals.rocketsBlocked++
    if (event.type === 'BANANA_DROPPED') totals.bananasDropped++
    if (event.type === 'BANANA_HIT') totals.bananasHit++
    if (event.type === 'BANANA_EXPIRED') totals.bananasExpired++
    if (event.type === 'HORN_USED') { totals.hornsUsed++; totals.hornTargets += Number(event.metadata.ducksHit ?? 0) }
    if (event.type === 'AI_INTENT') totals.intents++
    if (['NITRO_STARTED', 'DRAFT_FIN_STARTED', 'PADDLE_BURST_STARTED', 'ROCKET_FIRED', 'BANANA_DROPPED', 'HORN_USED'].includes(event.type)) {
      totals.itemUses++
      if (event.tick / config.tickRate > 45) totals.lastStretchItemUses++
    }
    if (wanted && event.targetPlayerId === wanted && ['ROCKET_HIT', 'MINI_ROCKET_HIT', 'BANANA_HIT', 'WILD_BANANA_HIT'].includes(event.type)) {
      totals.wantedHits++
    }
  }
  if (wanted) {
    const outcome = resolveChaosRule(mode, result.standings.map((entry) => ({ playerId: entry.playerId, rank: entry.rank })), { targetPlayerId: wanted })
    totals.wantedEscaped += Number(outcome.metadata.escaped === true)
  }
  for (const runtime of state.itemState.byPlayer.values()) {
    totals.prepUnused += runtime.itemIds.filter((itemId) => !runtime.usedItems.has(itemId) && itemId !== 'FEATHER' && itemId !== 'SHOCK_ABSORBER').length
  }
}

const per = (value: number) => Number((value / races).toFixed(3))
const pct = (part: number, whole: number) => Number((whole === 0 ? 0 : part / whole * 100).toFixed(1))
console.log(JSON.stringify({
  mode, races, start,
  leadChangesPerRace: per(totals.leadChanges),
  lateLeadChangesPerRace: per(totals.lateLeadChanges),
  winnerNotLeaderAt90Pct: pct(totals.decidedLate, races),
  avgWinMarginMs: per(totals.marginMs),
  photoFinishPct: pct(totals.photoFinishes, races),
  attacksPerRace: per(totals.attacks),
  rocketHitPct: pct(totals.rocketsHit, totals.rocketsFired),
  rocketBlockedPct: pct(totals.rocketsBlocked, totals.rocketsFired),
  bananaHitPct: pct(totals.bananasHit, totals.bananasDropped),
  bananaExpiredPct: pct(totals.bananasExpired, totals.bananasDropped),
  hornTargetsPerUse: Number((totals.hornTargets / Math.max(1, totals.hornsUsed)).toFixed(2)),
  unusedPrepItemsPerRace: per(totals.prepUnused),
  lastStretchItemUsePct: pct(totals.lastStretchItemUses, totals.itemUses),
  intentsPerRace: per(totals.intents),
  ...(mode === 'BOUNTY_HUNT' ? { wantedHitsPerRace: per(totals.wantedHits), wantedEscapedPct: pct(totals.wantedEscaped, races) } : {}),
}, null, 2))
