import { performance } from 'node:perf_hooks'
import { itemActivationForEvent, itemSuccessForEvent, simulateRace } from '../packages/race-core/src'
import {
  DEFAULT_TRACK_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  type RaceConfig,
  type RaceItemId,
  type RaceLoadout,
} from '../packages/race-protocol/src'

type FullLoadout = readonly [RaceItemId, RaceItemId]

const MAJORS = ['NITRO', 'BUBBLE_SHIELD', 'HOMING_ROCKET'] as const satisfies readonly RaceItemId[]
const MINORS = ['DRAFT_FIN', 'PADDLE_BURST', 'FEATHER', 'SHOCK_ABSORBER', 'BANANA', 'QUACK_HORN'] as const satisfies readonly RaceItemId[]

const FULL_LOADOUTS: readonly FullLoadout[] = MAJORS.flatMap((major) => MINORS.map((minor) => [major, minor] as const))

interface Aggregate {
  picks: number
  wins: number
  top3: number
  bottom2: number
  positionTotal: number
  rankDeltaTotal: number
  absoluteRankDeltaTotal: number
  activations: number
  successes: number
}

interface PairwiseAggregate {
  observations: number
  leftWins: number
  rightWins: number
}

function argument(name: string, fallback: number) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function flag(name: string) {
  return process.argv.includes(name)
}

function emptyAggregate(): Aggregate {
  return { picks: 0, wins: 0, top3: 0, bottom2: 0, positionTotal: 0, rankDeltaTotal: 0, absoluteRankDeltaTotal: 0, activations: 0, successes: 0 }
}

function loadoutKey(itemIds: readonly RaceItemId[]) {
  return itemIds.join(' + ')
}

function seedFromIndex(index: number) {
  return index.toString(16).padStart(64, '0')
}

function createConfig(raceIndex: number, playerCount: number, loadouts: RaceLoadout[] = []): RaceConfig {
  return {
    raceId: `sim-${raceIndex}`,
    seed: seedFromIndex(raceIndex),
    protocolVersion: RACE_PROTOCOL_VERSION,
    engineVersion: RACE_ENGINE_VERSION,
    balanceVersion: RACE_BALANCE_VERSION,
    trackVersion: DEFAULT_TRACK_VERSION,
    tickRate: RACE_TICK_RATE,
    players: Array.from({ length: playerCount }, (_, index) => ({ playerId: `duck-${index + 1}`, name: `Duck ${index + 1}` })),
    loadouts,
  }
}

function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator * 100
}

function rounded(value: number, digits = 3) {
  return Number(value.toFixed(digits))
}

const raceCount = argument('--races', 10_000)
const startIndex = argument('--start', 1)
const playerCount = argument('--players', 8)
const strict = flag('--strict')
if (playerCount < 2 || playerCount > 16) throw new Error('--players must be between 2 and 16')

const slotStats = Array.from({ length: playerCount }, emptyAggregate)
const loadoutStats = new Map(FULL_LOADOUTS.map((loadout) => [loadoutKey(loadout), emptyAggregate()]))
const itemStats = new Map<RaceItemId, Aggregate>([
  ...MAJORS,
  ...MINORS,
].map((itemId) => [itemId, emptyAggregate()]))
const pairwise = new Map<string, PairwiseAggregate>()
let chainHitIncidents = 0
let offensiveHits = 0
const startedAt = performance.now()
const progressInterval = Math.max(1, Math.floor(raceCount / 10))

for (let offset = 0; offset < raceCount; offset += 1) {
  const raceIndex = startIndex + offset
  const baseline = simulateRace(createConfig(raceIndex, playerCount), { recordEvents: false })
  const baselineRank = new Map(baseline.standings.map((entry) => [entry.playerId, entry.rank]))
  baseline.standings.forEach((entry) => {
    const slot = Number(entry.playerId.split('-')[1]) - 1
    const stats = slotStats[slot]
    stats.picks += 1
    stats.positionTotal += entry.rank
    if (entry.rank === 1) stats.wins += 1
    if (entry.rank <= 3) stats.top3 += 1
    if (entry.rank > playerCount - 2) stats.bottom2 += 1
  })

  const assigned = Array.from({ length: playerCount }, (_, index) => FULL_LOADOUTS[(raceIndex - 1 + index) % FULL_LOADOUTS.length])
  const loadouts: RaceLoadout[] = assigned.map((itemIds, index) => ({
    playerId: `duck-${index + 1}`,
    itemIds: [...itemIds],
    source: 'AUTO',
  }))
  const loadoutByPlayer = new Map(loadouts.map((loadout) => [loadout.playerId, loadout.itemIds]))
  const activationSeen = new Set<string>()
  const successSeen = new Set<string>()
  const hitTimes = new Map<string, number[]>()
  const itemResult = simulateRace(createConfig(raceIndex, playerCount, loadouts), {
    recordEvents: false,
    onEvent(event) {
      const activation = itemActivationForEvent(event)
      if (activation) activationSeen.add(`${activation.playerId}:${activation.itemId}`)
      const success = itemSuccessForEvent(event)
      if (success) successSeen.add(`${success.playerId}:${success.itemId}`)
      if ((event.type === 'ROCKET_HIT' || event.type === 'BANANA_HIT') && event.targetPlayerId) {
        offensiveHits += 1
        const previous = hitTimes.get(event.targetPlayerId) ?? []
        if (previous.some((timestamp) => event.timestampWithinRaceMs - timestamp <= 2_000)) chainHitIncidents += 1
        previous.push(event.timestampWithinRaceMs)
        hitTimes.set(event.targetPlayerId, previous)
      }
    },
  })
  const itemRank = new Map(itemResult.standings.map((entry) => [entry.playerId, entry.rank]))

  for (const entry of itemResult.standings) {
    const itemIds = loadoutByPlayer.get(entry.playerId)!
    const key = loadoutKey(itemIds)
    const delta = baselineRank.get(entry.playerId)! - entry.rank
    const aggregateTargets = [loadoutStats.get(key)!, ...itemIds.map((itemId) => itemStats.get(itemId)!)]
    for (const stats of aggregateTargets) {
      stats.picks += 1
      stats.positionTotal += entry.rank
      stats.rankDeltaTotal += delta
      stats.absoluteRankDeltaTotal += Math.abs(delta)
      if (entry.rank === 1) stats.wins += 1
      if (entry.rank <= 3) stats.top3 += 1
      if (entry.rank > playerCount - 2) stats.bottom2 += 1
    }
    for (const itemId of itemIds) {
      if (activationSeen.has(`${entry.playerId}:${itemId}`)) {
        loadoutStats.get(key)!.activations += 1
        itemStats.get(itemId)!.activations += 1
      }
      if (successSeen.has(`${entry.playerId}:${itemId}`)) {
        loadoutStats.get(key)!.successes += 1
        itemStats.get(itemId)!.successes += 1
      }
    }
  }

  for (let leftIndex = 0; leftIndex < loadouts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < loadouts.length; rightIndex += 1) {
      const leftLoadout = loadoutKey(loadouts[leftIndex].itemIds)
      const rightLoadout = loadoutKey(loadouts[rightIndex].itemIds)
      if (leftLoadout === rightLoadout) continue
      const [left, right] = [leftLoadout, rightLoadout].sort()
      const key = `${left}::${right}`
      const stats = pairwise.get(key) ?? { observations: 0, leftWins: 0, rightWins: 0 }
      stats.observations += 1
      const leftPlayerId = leftLoadout === left ? loadouts[leftIndex].playerId : loadouts[rightIndex].playerId
      const rightPlayerId = rightLoadout === right ? loadouts[rightIndex].playerId : loadouts[leftIndex].playerId
      if (itemRank.get(leftPlayerId)! < itemRank.get(rightPlayerId)!) stats.leftWins += 1
      else stats.rightWins += 1
      pairwise.set(key, stats)
    }
  }

  const completed = offset + 1
  if (raceCount >= 1_000 && (completed % progressInterval === 0 || completed === raceCount)) {
    console.error(`Progress ${Math.round(completed / raceCount * 100)}% (${completed.toLocaleString()} races)`)
  }
}

const loadoutRows = [...loadoutStats].map(([loadout, stats]) => ({
  loadout,
  picks: stats.picks,
  winRate: `${percentage(stats.wins, stats.picks).toFixed(2)}%`,
  top3Rate: `${percentage(stats.top3, stats.picks).toFixed(2)}%`,
  averagePosition: rounded(stats.positionTotal / stats.picks),
  bottom2Rate: `${percentage(stats.bottom2, stats.picks).toFixed(2)}%`,
  averageRankDelta: rounded(stats.rankDeltaTotal / stats.picks),
  averageAbsoluteRankDelta: rounded(stats.absoluteRankDeltaTotal / stats.picks),
  activationRate: `${percentage(stats.activations, stats.picks * 2).toFixed(2)}%`,
  successRate: `${percentage(stats.successes, stats.activations).toFixed(2)}%`,
}))
const itemRows = [...itemStats].map(([item, stats]) => ({
  item,
  picks: stats.picks,
  winRate: `${percentage(stats.wins, stats.picks).toFixed(2)}%`,
  bottom2Rate: `${percentage(stats.bottom2, stats.picks).toFixed(2)}%`,
  averagePosition: rounded(stats.positionTotal / stats.picks),
  averageRankDelta: rounded(stats.rankDeltaTotal / stats.picks),
  activationRate: `${percentage(stats.activations, stats.picks).toFixed(2)}%`,
  successRate: `${percentage(stats.successes, stats.activations).toFixed(2)}%`,
}))
const slotRows = slotStats.map((stats, index) => ({
  slot: index + 1,
  winRate: `${percentage(stats.wins, stats.picks).toFixed(2)}%`,
  bottom2Rate: `${percentage(stats.bottom2, stats.picks).toFixed(2)}%`,
  averagePosition: rounded(stats.positionTotal / stats.picks),
}))

console.log('\nSlot fairness (no items)')
console.table(slotRows)
console.log('\nFull-budget loadouts (same-seed counterfactual)')
console.table(loadoutRows)
console.log('\nItem telemetry')
console.table(itemRows)

const violations: string[] = []
const expectedWinRate = 1 / playerCount
const expectedBottom2Rate = 2 / playerCount
const winTolerance = Math.max(0.01, 4 * Math.sqrt(expectedWinRate * (1 - expectedWinRate) / raceCount))
const bottom2Tolerance = Math.max(0.01, 4 * Math.sqrt(expectedBottom2Rate * (1 - expectedBottom2Rate) / raceCount))
for (let index = 0; index < slotStats.length; index += 1) {
  const stats = slotStats[index]
  const winRate = stats.wins / stats.picks
  const bottom2Rate = stats.bottom2 / stats.picks
  if (Math.abs(winRate - expectedWinRate) > winTolerance) {
    violations.push(`slot ${index + 1} win rate ${percentage(stats.wins, stats.picks).toFixed(2)}% outside ±${(winTolerance * 100).toFixed(2)}pp fairness tolerance`)
  }
  if (Math.abs(bottom2Rate - expectedBottom2Rate) > bottom2Tolerance) {
    violations.push(`slot ${index + 1} Bottom-2 rate ${percentage(stats.bottom2, stats.picks).toFixed(2)}% outside ±${(bottom2Tolerance * 100).toFixed(2)}pp fairness tolerance`)
  }
}
const winRates = [...loadoutStats].map(([loadout, stats]) => ({ loadout, rate: stats.wins / stats.picks, winPct: percentage(stats.wins, stats.picks) }))
const bestWin = [...winRates].sort((left, right) => right.rate - left.rate)[0]
const worstWin = [...winRates].sort((left, right) => left.rate - right.rate)[0]
if (worstWin.rate > 0 && bestWin.rate / worstWin.rate > 1.15) {
  violations.push(`loadout win-rate spread ${bestWin.winPct.toFixed(2)}% vs ${worstWin.winPct.toFixed(2)}% (ratio ${(bestWin.rate / worstWin.rate).toFixed(3)}× · ${bestWin.loadout} vs ${worstWin.loadout})`)
}
const positions = [...loadoutStats].map(([loadout, stats]) => ({ loadout, average: stats.positionTotal / stats.picks }))
const bestPosition = [...positions].sort((left, right) => left.average - right.average)[0]
const worstPosition = [...positions].sort((left, right) => right.average - left.average)[0]
if (worstPosition.average - bestPosition.average > 0.5) {
  violations.push(`average-position spread ${(worstPosition.average - bestPosition.average).toFixed(3)} > 0.5 (${bestPosition.loadout} vs ${worstPosition.loadout})`)
}
for (const [loadout, stats] of loadoutStats) {
  const impact = stats.absoluteRankDeltaTotal / stats.picks
  if (impact > 1) violations.push(`${loadout} average absolute rank delta ${impact.toFixed(3)} > 1.0`)
}
for (const [pair, stats] of pairwise) {
  if (stats.observations < 100) continue
  const advantage = Math.max(stats.leftWins, stats.rightWins) / stats.observations
  if (advantage > 0.55) violations.push(`${pair.replace('::', ' vs ')} pairwise advantage ${percentage(Math.max(stats.leftWins, stats.rightWins), stats.observations).toFixed(2)}% > 55%`)
}

const chainHitRate = percentage(chainHitIncidents, Math.max(1, offensiveHits))
console.log(`\nChain-hit incidents (>=2 offensive debuffs within 2s): ${chainHitIncidents.toLocaleString()} / ${offensiveHits.toLocaleString()} hits (${chainHitRate.toFixed(3)}%)`)
if (chainHitRate > 2) violations.push(`chain-hit incident rate ${chainHitRate.toFixed(3)}% > 2% diagnostic threshold`)

const elapsedSeconds = (performance.now() - startedAt) / 1000
console.log(`Simulated ${raceCount.toLocaleString()} same-seed baseline/item race pairs in ${elapsedSeconds.toFixed(2)}s (${(raceCount * 2 / elapsedSeconds).toFixed(0)} simulations/s).`)
if (violations.length === 0) console.log('PASS: all configured balance guardrails passed.')
else {
  console.log(`WARN: ${violations.length} balance guardrail violation(s):`)
  violations.forEach((violation) => console.log(`- ${violation}`))
  if (strict) process.exitCode = 1
}
