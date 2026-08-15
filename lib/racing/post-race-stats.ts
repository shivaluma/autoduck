import {
  createSimulation,
  itemActivationForEvent,
  itemSuccessForEvent,
  simulateRace,
  stepSimulation,
} from '@/packages/race-core/src'
import { getRaceItem } from '@/packages/race-core/src/items/catalog'
import type { RaceConfig, RaceEvent, RaceItemId, RaceFinishEntry } from '@/packages/race-protocol/src'
import { recordedWildInputsFromEvents } from '@/lib/racing/persistence'

const ATTACK_HIT_TYPES = new Set([
  'ROCKET_HIT',
  'MINI_ROCKET_HIT',
  'BANANA_HIT',
  'WILD_BANANA_HIT',
  'HAZARD_HIT',
])

const ATTACK_BLOCKED_TYPES = new Set([
  'ROCKET_BLOCKED',
  'MINI_ROCKET_BLOCKED',
  'BANANA_BLOCKED',
  'WILD_BANANA_BLOCKED',
  'BUBBLE_POPPED',
  'MINI_BUBBLE_BLOCKED',
  'FEATHER_DODGED',
  'WILD_FEATHER_DODGED',
  'HAZARD_DODGED',
])

const ROCKET_SLOW_SECONDS = 0.65
const ROCKET_MITIGATED_SLOW_SECONDS = 0.4

export interface PostRacePlayerInput {
  playerId: string
  name: string
  avatarUrl?: string | null
  itemIds?: RaceItemId[]
}

export interface PostRaceItemStat {
  itemId: RaceItemId
  name: string
  icon: string
  activations: number
  successes: number
}

export interface PostRacePlayerStats {
  playerId: string
  name: string
  avatarUrl?: string | null
  itemIds: RaceItemId[]
  finalRank: number
  baselineRank: number
  rankDelta: number
  finishTimeMs: number | null
  averageSpeed: number
  peakSpeed: number
  attacksDealt: number
  attacksReceived: number
  attacksBlocked: number
  collisions: number
  pickupsCollected: number
  wildItemsUsed: number
  boostBreaks: number
  timeLostFromAttacksSeconds: number
  itemStats: PostRaceItemStat[]
  efficiencyScore: number
}

export interface PostRaceHighlights {
  bestItemUser: { playerId: string; name: string; rankDelta: number } | null
  mostAttacked: { playerId: string; name: string; attacksReceived: number } | null
  bestAttacker: { playerId: string; name: string; attacksDealt: number } | null
  fastestAverage: { playerId: string; name: string; averageSpeed: number } | null
  mostTimeLost: { playerId: string; name: string; timeLostFromAttacksSeconds: number } | null
}

export interface PostRaceStats {
  players: PostRacePlayerStats[]
  highlights: PostRaceHighlights
  raceDurationMs: number
  totalEvents: number
}

function emptyPlayerStats(player: PostRacePlayerInput): PostRacePlayerStats {
  return {
    playerId: player.playerId,
    name: player.name,
    avatarUrl: player.avatarUrl,
    itemIds: player.itemIds ?? [],
    finalRank: 99,
    baselineRank: 99,
    rankDelta: 0,
    finishTimeMs: null,
    averageSpeed: 0,
    peakSpeed: 0,
    attacksDealt: 0,
    attacksReceived: 0,
    attacksBlocked: 0,
    collisions: 0,
    pickupsCollected: 0,
    wildItemsUsed: 0,
    boostBreaks: 0,
    timeLostFromAttacksSeconds: 0,
    itemStats: [],
    efficiencyScore: 0,
  }
}

function bumpItemStat(stats: PostRacePlayerStats, itemId: RaceItemId, field: 'activations' | 'successes') {
  let row = stats.itemStats.find((entry) => entry.itemId === itemId)
  if (!row) {
    const definition = getRaceItem(itemId)
    row = { itemId, name: definition.name, icon: definition.icon, activations: 0, successes: 0 }
    stats.itemStats.push(row)
  }
  row[field] += 1
}

function hornTargets(event: RaceEvent): string[] {
  const targets = event.metadata.targets
  if (Array.isArray(targets)) return targets.filter((value): value is string => typeof value === 'string')
  const ducksHit = Number(event.metadata.ducksHit ?? 0)
  if (ducksHit > 0 && event.targetPlayerId) return [event.targetPlayerId]
  return []
}

function collectMotionStats(config: RaceConfig, events: RaceEvent[]) {
  const manualInputs = recordedWildInputsFromEvents(events)
  const state = createSimulation(config, { recordEvents: false, manualInputs })
  const speedTotals = new Map<string, { sum: number; peak: number; samples: number }>()
  const maximumTicks = 180 * config.tickRate

  while (!state.finished && state.tick < maximumTicks) {
    stepSimulation(state)
    for (const duck of state.ducks) {
      if (duck.finished && duck.speed <= 0) continue
      const bucket = speedTotals.get(duck.playerId) ?? { sum: 0, peak: 0, samples: 0 }
      bucket.sum += duck.speed
      bucket.peak = Math.max(bucket.peak, duck.speed)
      bucket.samples += 1
      speedTotals.set(duck.playerId, bucket)
    }
  }

  const averages = new Map<string, { averageSpeed: number; peakSpeed: number }>()
  for (const [playerId, bucket] of speedTotals) {
    averages.set(playerId, {
      averageSpeed: bucket.samples > 0 ? bucket.sum / bucket.samples : 0,
      peakSpeed: bucket.peak,
    })
  }
  return averages
}

function computeEfficiencyScore(stats: PostRacePlayerStats) {
  const itemSuccesses = stats.itemStats.reduce((sum, item) => sum + item.successes, 0)
  const itemActivations = stats.itemStats.reduce((sum, item) => sum + item.activations, 0)
  const successRate = itemActivations > 0 ? itemSuccesses / itemActivations : 0
  return (
    stats.rankDelta * 4
    + itemSuccesses * 2
    + stats.attacksDealt * 1.5
    + stats.attacksBlocked * 1.2
    - stats.attacksReceived * 0.8
    - stats.timeLostFromAttacksSeconds * 0.6
    + successRate * 2
  )
}

function topPlayer(
  players: PostRacePlayerStats[],
  selector: (player: PostRacePlayerStats) => number,
) {
  const sorted = [...players].sort((left, right) => selector(right) - selector(left))
  const best = sorted[0]
  if (!best || selector(best) <= 0) return null
  return best
}

export function buildPostRaceStats(
  config: RaceConfig,
  events: RaceEvent[],
  players: PostRacePlayerInput[],
): PostRaceStats {
  const byPlayer = new Map(players.map((player) => [player.playerId, emptyPlayerStats(player)]))
  for (const player of players) {
    const stats = byPlayer.get(player.playerId)!
    stats.itemIds = player.itemIds ?? []
  }

  const finishTimes = new Map<string, number>()
  for (const event of events) {
    if (event.type === 'DUCK_FINISHED' && event.sourcePlayerId) {
      const finishTimeMs = Number(event.metadata.finishTimeMs ?? event.timestampWithinRaceMs)
      finishTimes.set(event.sourcePlayerId, finishTimeMs)
    }
  }

  const finalRank = new Map(
    [...finishTimes.entries()]
      .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
      .map(([playerId], index) => [playerId, index + 1]),
  )

  let baselineRank = new Map<string, number>()
  try {
    const baseline = simulateRace({ ...config, raceId: `${config.raceId}-post-race-baseline`, loadouts: [] }, { recordEvents: false })
    baselineRank = new Map<string, number>(baseline.standings.map((entry: RaceFinishEntry) => [entry.playerId, entry.rank]))
  } catch {
    baselineRank = new Map(players.map((player, index) => [player.playerId, index + 1]))
  }

  for (const [playerId, stats] of byPlayer) {
    stats.finalRank = finalRank.get(playerId) ?? players.length
    stats.baselineRank = baselineRank.get(playerId) ?? stats.finalRank
    stats.rankDelta = stats.baselineRank - stats.finalRank
    stats.finishTimeMs = finishTimes.get(playerId) ?? null
  }

  for (const event of events) {
    const activation = itemActivationForEvent(event)
    if (activation && byPlayer.has(activation.playerId)) {
      bumpItemStat(byPlayer.get(activation.playerId)!, activation.itemId, 'activations')
    }
    const success = itemSuccessForEvent(event)
    if (success && byPlayer.has(success.playerId)) {
      bumpItemStat(byPlayer.get(success.playerId)!, success.itemId, 'successes')
    }

    if (event.type === 'PICKUP_COLLECTED' && event.sourcePlayerId && byPlayer.has(event.sourcePlayerId)) {
      byPlayer.get(event.sourcePlayerId)!.pickupsCollected += 1
    }

    if ((event.type === 'WILD_ITEM_USED' || event.type === 'WILD_ITEM_AUTO_USED') && event.sourcePlayerId && byPlayer.has(event.sourcePlayerId)) {
      byPlayer.get(event.sourcePlayerId)!.wildItemsUsed += 1
    }

    if (event.type === 'DUCK_COLLISION') {
      for (const playerId of [event.sourcePlayerId, event.targetPlayerId]) {
        if (playerId && byPlayer.has(playerId)) byPlayer.get(playerId)!.collisions += 1
      }
    }

    if (ATTACK_HIT_TYPES.has(event.type)) {
      if (event.sourcePlayerId && byPlayer.has(event.sourcePlayerId)) {
        byPlayer.get(event.sourcePlayerId)!.attacksDealt += 1
      }
      if (event.targetPlayerId && byPlayer.has(event.targetPlayerId)) {
        const victim = byPlayer.get(event.targetPlayerId)!
        victim.attacksReceived += 1
        if (event.type === 'ROCKET_HIT' || event.type === 'MINI_ROCKET_HIT') {
          const mitigated = event.type === 'ROCKET_HIT' && events.some((candidate) =>
            candidate.type === 'SHOCK_ABSORBER_PROC'
            && candidate.targetPlayerId === event.targetPlayerId
            && candidate.tick === event.tick,
          )
          victim.timeLostFromAttacksSeconds += mitigated ? ROCKET_MITIGATED_SLOW_SECONDS : ROCKET_SLOW_SECONDS
        }
      }
    }

    if (ATTACK_BLOCKED_TYPES.has(event.type)) {
      const defenderId = event.sourcePlayerId ?? event.targetPlayerId
      if (defenderId && byPlayer.has(defenderId)) {
        byPlayer.get(defenderId)!.attacksBlocked += 1
      }
    }

    if ((event.type === 'HORN_USED' || event.type === 'WILD_HORN_USED') && event.sourcePlayerId && byPlayer.has(event.sourcePlayerId)) {
      byPlayer.get(event.sourcePlayerId)!.attacksDealt += hornTargets(event).length
      for (const targetId of hornTargets(event)) {
        if (byPlayer.has(targetId)) byPlayer.get(targetId)!.attacksReceived += 1
      }
    }

    if (event.type === 'BOOST_BROKEN' && event.sourcePlayerId && byPlayer.has(event.sourcePlayerId)) {
      const victim = byPlayer.get(event.sourcePlayerId)!
      const remainingBoostTicks = Number(event.metadata.remainingBoostTicks ?? 0)
      const tickRate = config.tickRate
      const secondsDestroyed = remainingBoostTicks / tickRate
      victim.boostBreaks += 1
      victim.timeLostFromAttacksSeconds += secondsDestroyed
    }
  }

  const motion = collectMotionStats(config, events)
  for (const [playerId, stats] of byPlayer) {
    const sample = motion.get(playerId)
    if (sample) {
      stats.averageSpeed = sample.averageSpeed
      stats.peakSpeed = sample.peakSpeed
    }
    stats.efficiencyScore = computeEfficiencyScore(stats)
  }

  const playerStats = [...byPlayer.values()].sort((left, right) => left.finalRank - right.finalRank)
  const raceDurationMs = finishTimes.size > 0 ? Math.max(...finishTimes.values()) : 0

  const highlights: PostRaceHighlights = {
    bestItemUser: (() => {
      const best = topPlayer(playerStats, (player) => player.rankDelta)
      return best ? { playerId: best.playerId, name: best.name, rankDelta: best.rankDelta } : null
    })(),
    mostAttacked: (() => {
      const best = topPlayer(playerStats, (player) => player.attacksReceived)
      return best ? { playerId: best.playerId, name: best.name, attacksReceived: best.attacksReceived } : null
    })(),
    bestAttacker: (() => {
      const best = topPlayer(playerStats, (player) => player.attacksDealt)
      return best ? { playerId: best.playerId, name: best.name, attacksDealt: best.attacksDealt } : null
    })(),
    fastestAverage: (() => {
      const best = topPlayer(playerStats, (player) => player.averageSpeed)
      return best ? { playerId: best.playerId, name: best.name, averageSpeed: best.averageSpeed } : null
    })(),
    mostTimeLost: (() => {
      const best = topPlayer(playerStats, (player) => player.timeLostFromAttacksSeconds)
      return best ? { playerId: best.playerId, name: best.name, timeLostFromAttacksSeconds: best.timeLostFromAttacksSeconds } : null
    })(),
  }

  return {
    players: playerStats,
    highlights,
    raceDurationMs,
    totalEvents: events.length,
  }
}
