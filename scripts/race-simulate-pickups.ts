import { createRaceRng, simulateRace } from '../packages/race-core/src'
import { raceConfigSchema, type RaceResult, type WildItemId } from '../packages/race-protocol/src'

const racesArg = process.argv.findIndex((value) => value === '--races')
const raceCount = Math.max(1, Number(racesArg >= 0 ? process.argv[racesArg + 1] : 100_000))
const offsetArg = process.argv.findIndex((value) => value === '--offset')
const raceOffset = Math.max(0, Number(offsetArg >= 0 ? process.argv[offsetArg + 1] : 0))
const summaryJson = process.argv.includes('--summary-json')
const playerCounts = [6, 8, 10, 12]
const pickupDistribution = new Map<number, number>()
const itemDistribution = new Map<string, number>()
const itemBucketDistribution = new Map<string, number>()
let absoluteRankDelta = 0
let rankSamples = 0
let winnerChanges = 0
let loserChanges = 0
let rocketFires = 0
let rocketHits = 0
let rocketBlocks = 0
let bananaDrops = 0
let bananaHits = 0
let bubbleBlocks = 0
let hazardHits = 0
let goldenSpawns = 0
let goldenCollections = 0
let manualOpportunities = 0
let manualAdvantageTotal = 0
let manualAdvantageSamples = 0
let hitChains = 0

function seed(index: number) {
  return index.toString(16).padStart(64, '0')
}

function config(index: number, playerCount: number, pickups: boolean, autoItemsEnabled = true, forceItem?: WildItemId) {
  return raceConfigSchema.parse({
    raceId: `pickup-sim-${index}-${pickups ? 'on' : 'off'}`,
    seed: seed(index),
    players: Array.from({ length: playerCount }, (_, playerIndex) => ({ playerId: `duck-${playerIndex + 1}`, name: `Duck ${playerIndex + 1}` })),
    loadouts: Array.from({ length: playerCount }, (_, playerIndex) => ({
      playerId: `duck-${playerIndex + 1}`,
      itemIds: playerIndex % 3 === 0 ? ['NITRO', 'BANANA'] : playerIndex % 3 === 1 ? ['BUBBLE_SHIELD', 'QUACK_HORN'] : ['HOMING_ROCKET', 'FEATHER'],
      source: 'PLAYER',
    })),
    pickupConfig: {
      enabled: pickups,
      goldenBoxEnabled: pickups,
      goldenBoxProbability: 0.12,
      hazardsEnabled: pickups,
      positionAwareLoot: true,
      spawnMultiplier: pickups ? 1 : 0,
      regularPickupCap: 2,
      manualItemsEnabled: true,
      autoItemsEnabled,
      chaosBoxEnabled: false,
      forceItem,
      forceGoldenBox: false,
      disabledItems: [],
      idealManualPlayerIds: [],
    },
  })
}

function ranks(result: RaceResult) {
  return new Map(result.standings.map((entry) => [entry.playerId, entry.rank]))
}

function setEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

for (let localIndex = 1; localIndex <= raceCount; localIndex += 1) {
  const raceIndex = raceOffset + localIndex
  const playerCount = playerCounts[(raceIndex - 1) % playerCounts.length]!
  const baseline = simulateRace(config(raceIndex, playerCount, false), { recordEvents: false })
  const counts = new Map<string, number>()
  const harmfulByVictim = new Map<string, number[]>()
  const result = simulateRace(config(raceIndex, playerCount, true), { recordEvents: false, onEvent: (event) => {
    if (event.type === 'WILD_ITEM_GRANTED' || event.type === 'INSTANT_PICKUP_TRIGGERED') {
      counts.set(event.sourcePlayerId!, (counts.get(event.sourcePlayerId!) ?? 0) + 1)
      const itemId = String(event.metadata.itemId)
      const rank = Number(event.metadata.rank)
      const bucket = rank <= Math.ceil(playerCount * 0.25) ? 'front' : rank > playerCount - Math.ceil(playerCount * 0.25) ? 'back' : 'middle'
      itemDistribution.set(itemId, (itemDistribution.get(itemId) ?? 0) + 1)
      itemBucketDistribution.set(`${bucket}:${itemId}`, (itemBucketDistribution.get(`${bucket}:${itemId}`) ?? 0) + 1)
      if (event.type === 'WILD_ITEM_GRANTED') manualOpportunities += 1
    }
    if (event.type === 'MINI_ROCKET_FIRED') rocketFires += 1
    if (event.type === 'MINI_ROCKET_HIT') rocketHits += 1
    if (event.type === 'MINI_ROCKET_BLOCKED') rocketBlocks += 1
    if (event.type === 'WILD_BANANA_DROPPED') bananaDrops += 1
    if (event.type === 'WILD_BANANA_HIT') bananaHits += 1
    if (event.type === 'MINI_BUBBLE_BLOCKED') bubbleBlocks += 1
    if (event.type === 'HAZARD_HIT') hazardHits += 1
    if (event.type === 'GOLDEN_BOX_SPAWNED') goldenSpawns += 1
    if (event.type === 'GOLDEN_BOX_COLLECTED') goldenCollections += 1
    if (['MINI_ROCKET_HIT', 'WILD_BANANA_HIT'].includes(event.type) && event.targetPlayerId) {
      const ticks = harmfulByVictim.get(event.targetPlayerId) ?? []
      if (ticks.some((tick) => event.tick - tick < 120)) hitChains += 1
      ticks.push(event.tick)
      harmfulByVictim.set(event.targetPlayerId, ticks)
    }
  } })
  const baselineRanks = ranks(baseline)
  const resultRanks = ranks(result)
  for (const [playerId, finalRank] of resultRanks) {
    absoluteRankDelta += Math.abs(finalRank - baselineRanks.get(playerId)!)
    rankSamples += 1
  }
  if (baseline.standings[0]!.playerId !== result.standings[0]!.playerId) winnerChanges += 1
  if (!setEqual(baseline.standings.slice(-2).map((entry) => entry.playerId), result.standings.slice(-2).map((entry) => entry.playerId))) loserChanges += 1

  for (let playerIndex = 1; playerIndex <= playerCount; playerIndex += 1) {
    const count = counts.get(`duck-${playerIndex}`) ?? 0
    pickupDistribution.set(count, (pickupDistribution.get(count) ?? 0) + 1)
  }

  if (raceIndex <= Math.min(2_000, raceOffset + raceCount)) {
    const rng = createRaceRng(seed(raceIndex), 'manual-approximation')
    const idealManualPlayerIds = Array.from({ length: playerCount }, (_, index) => `duck-${index + 1}`).filter(() => rng.next() < 0.5)
    const manualConfig = config(raceIndex, playerCount, true)
    manualConfig.pickupConfig = { ...manualConfig.pickupConfig!, idealManualPlayerIds }
    const manualResult = simulateRace(manualConfig, { recordEvents: false })
    const manualRanks = ranks(manualResult)
    for (const playerId of idealManualPlayerIds) {
      manualAdvantageTotal += resultRanks.get(playerId)! - manualRanks.get(playerId)!
      manualAdvantageSamples += 1
    }
  }
  if (summaryJson && localIndex % 1_000 === 0) console.error(`progress ${localIndex}/${raceCount}`)
}

const totalPlayers = [...pickupDistribution.values()].reduce((sum, value) => sum + value, 0)
const summary = {
  races: raceCount,
  offset: raceOffset,
  totalPlayers,
  pickupDistribution: Object.fromEntries(pickupDistribution),
  itemDistribution: Object.fromEntries(itemDistribution),
  itemBucketDistribution: Object.fromEntries(itemBucketDistribution),
  averageAbsoluteRankDelta: absoluteRankDelta / rankSamples,
  winnerChangeRate: winnerChanges / raceCount,
  loserGroupChangeRate: loserChanges / raceCount,
  rocketHitRate: rocketHits / Math.max(1, rocketFires),
  rocketBlockRate: rocketBlocks / Math.max(1, rocketFires),
  bananaHitRate: bananaHits / Math.max(1, bananaDrops),
  bubbleBlocks,
  hazardHitsPerRace: hazardHits / raceCount,
  goldenSpawnRate: goldenSpawns / raceCount,
  goldenCollectionRate: goldenCollections / Math.max(1, goldenSpawns),
  qpInflationPerRace: goldenCollections / raceCount,
  heldItemActivationOpportunityPerRace: manualOpportunities / raceCount,
  manualAdvantageEstimateRanks: manualAdvantageTotal / Math.max(1, manualAdvantageSamples),
  manualAdvantageTotal,
  manualAdvantageSamples,
  offensiveHitChainsPerRace: hitChains / raceCount,
}

if (summaryJson) {
  console.log(JSON.stringify(summary))
} else {
  console.log(`Pickup simulation: ${raceCount.toLocaleString()} races`)
  console.table([...pickupDistribution].sort(([left], [right]) => left - right).map(([count, samples]) => ({ pickups: count, samples, percentage: `${(samples / totalPlayers * 100).toFixed(2)}%` })))
  console.table([...itemDistribution].sort(([, left], [, right]) => right - left).map(([item, count]) => ({ item, count, percentage: `${(count / [...itemDistribution.values()].reduce((sum, value) => sum + value, 0) * 100).toFixed(2)}%` })))
  console.table([...itemBucketDistribution].sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => ({ bucketItem: key, count })))
  console.table(summary)
}

if (absoluteRankDelta / rankSamples > 0.9) process.exitCode = 1
if (goldenCollections / raceCount > 0.13) process.exitCode = 1
