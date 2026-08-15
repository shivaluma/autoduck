import { simulateRace } from '../../packages/race-core/src'
import { CORE_BALANCE } from '../../packages/race-core/src/config'
import { ITEM_CLASS_BY_ID, type ItemClass } from '../../packages/race-core/src/items/classes'
import { getRaceItem } from '../../packages/race-core/src/items/catalog'
import {
  DEFAULT_TRACK_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  type RaceConfig,
  type RaceEvent,
  type RaceEventType,
  type RaceItemId,
  type RaceLoadout,
} from '../../packages/race-protocol/src'
import type { SeedSwapOutcome } from './balance-sim-stats'

export type FullLoadout = readonly [RaceItemId, RaceItemId]

export const MAJORS = ['NITRO', 'BUBBLE_SHIELD', 'HOMING_ROCKET'] as const satisfies readonly RaceItemId[]
export const MINORS = ['DRAFT_FIN', 'PADDLE_BURST', 'FEATHER', 'SHOCK_ABSORBER', 'BANANA', 'QUACK_HORN'] as const satisfies readonly RaceItemId[]

export const FULL_LOADOUTS: readonly FullLoadout[] = MAJORS.flatMap((major) => MINORS.map((minor) => [major, minor] as const))

export const PURE_LOADOUTS_BY_CLASS: Record<ItemClass, readonly FullLoadout[]> = {
  SPEED: [['NITRO', 'DRAFT_FIN'], ['NITRO', 'PADDLE_BURST']],
  DEFENSE: [['BUBBLE_SHIELD', 'FEATHER'], ['BUBBLE_SHIELD', 'SHOCK_ABSORBER']],
  ATTACK: [['HOMING_ROCKET', 'BANANA'], ['HOMING_ROCKET', 'QUACK_HORN']],
}

export const ITEM_CLASSES: ItemClass[] = ['SPEED', 'DEFENSE', 'ATTACK']

const ACTIVATION_EVENTS: Partial<Record<RaceEventType, RaceItemId>> = {
  NITRO_STARTED: 'NITRO',
  DRAFT_FIN_STARTED: 'DRAFT_FIN',
  PADDLE_BURST_STARTED: 'PADDLE_BURST',
  ROCKET_FIRED: 'HOMING_ROCKET',
  BANANA_DROPPED: 'BANANA',
  HORN_USED: 'QUACK_HORN',
}

export function loadoutKey(itemIds: readonly RaceItemId[]) {
  return itemIds.join(' + ')
}

export function loadoutArchetype(itemIds: readonly RaceItemId[]): ItemClass {
  const major = itemIds.find((itemId) => getRaceItem(itemId).category === 'major')
  if (major) return ITEM_CLASS_BY_ID[major]
  return ITEM_CLASS_BY_ID[itemIds[0]!]
}

export function seedFromIndex(index: number) {
  return index.toString(16).padStart(64, '0')
}

export function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator * 100
}

export function rounded(value: number, digits = 3) {
  return Number(value.toFixed(digits))
}

export interface RunningStats {
  samples: number
  wins: number
  top3: number
  bottom2: number
  rankSum: number
  mean: number
  m2: number
  ownerFinishPositionsImprovedSum: number
}

export function emptyRunningStats(): RunningStats {
  return { samples: 0, wins: 0, top3: 0, bottom2: 0, rankSum: 0, mean: 0, m2: 0, ownerFinishPositionsImprovedSum: 0 }
}

export function updateRunningStats(stats: RunningStats, rank: number, playerCount: number, ownerFinishPositionsImproved = 0) {
  stats.samples += 1
  stats.rankSum += rank
  stats.ownerFinishPositionsImprovedSum += ownerFinishPositionsImproved
  if (rank === 1) stats.wins += 1
  if (rank <= 3) stats.top3 += 1
  if (rank > playerCount - 2) stats.bottom2 += 1
  const delta = rank - stats.mean
  stats.mean += delta / stats.samples
  stats.m2 += delta * (rank - stats.mean)
}

export function stddev(stats: RunningStats) {
  if (stats.samples < 2) return 0
  return Math.sqrt(stats.m2 / (stats.samples - 1))
}

export interface ItemInstrument {
  equippedRaces: number
  organicActivations: number
  fallbackActivations: number
  forceBurnActivations: number
  successfulEffects: number
  meaningfulEffects: number
  eligibleThreats: number
  actualCollisionOpportunities: number
  defenseAvailableAtExposure: number
  successfulProcs: number
  /** @deprecated use eligibleThreats */
  eligibleThreatExposures: number
  /** @deprecated use successfulProcs */
  eligibleThreatProcs: number
  ownerFinishPositionsImprovedSum: number
  ownerFinishPositionsImprovedCount: number
  victimFinishPositionsLostSum: number
  victimFinishPositionsLostCount: number
}

export function emptyItemInstrument(): ItemInstrument {
  return {
    equippedRaces: 0,
    organicActivations: 0,
    fallbackActivations: 0,
    forceBurnActivations: 0,
    successfulEffects: 0,
    meaningfulEffects: 0,
    eligibleThreats: 0,
    actualCollisionOpportunities: 0,
    defenseAvailableAtExposure: 0,
    successfulProcs: 0,
    eligibleThreatExposures: 0,
    eligibleThreatProcs: 0,
    ownerFinishPositionsImprovedSum: 0,
    ownerFinishPositionsImprovedCount: 0,
    victimFinishPositionsLostSum: 0,
    victimFinishPositionsLostCount: 0,
  }
}

export interface CounterInstrument {
  boostBreakOpportunities: number
  boostBreakSuccess: number
  boostOwnerPositionsDeniedSum: number
  boostSecondsDestroyedSum: number
  boostDistanceDeniedSum: number
  boostFractionDeniedSum: number
  eligibleAttacksReceived: number
  attacksFullyBlocked: number
  attacksMitigated: number
  defenseItemsEquipped: number
  defenseItemsUnused: number
  speedActivations: number
  speedOwnerPositionsImprovedSum: number
}

export function emptyCounterInstrument(): CounterInstrument {
  return {
    boostBreakOpportunities: 0,
    boostBreakSuccess: 0,
    boostOwnerPositionsDeniedSum: 0,
    boostSecondsDestroyedSum: 0,
    boostDistanceDeniedSum: 0,
    boostFractionDeniedSum: 0,
    eligibleAttacksReceived: 0,
    attacksFullyBlocked: 0,
    attacksMitigated: 0,
    defenseItemsEquipped: 0,
    defenseItemsUnused: 0,
    speedActivations: 0,
    speedOwnerPositionsImprovedSum: 0,
  }
}

export interface RaceInstrumentation {
  items: Record<RaceItemId, ItemInstrument>
  counters: CounterInstrument
  featherExposureRaces: number
}

export function emptyRaceInstrumentation(): RaceInstrumentation {
  const items = Object.fromEntries([...MAJORS, ...MINORS].map((itemId) => [itemId, emptyItemInstrument()])) as Record<RaceItemId, ItemInstrument>
  return { items, counters: emptyCounterInstrument(), featherExposureRaces: 0 }
}

function activationBucket(autoReason: unknown): 'organic' | 'fallback' | 'forceBurn' {
  if (autoReason === 'LATE_RACE') return 'forceBurn'
  if (autoReason === 'INVENTORY_PRESSURE') return 'fallback'
  return 'organic'
}

function recordOwnerImprovement(item: ItemInstrument, baselineRank: number, finalRank: number) {
  const improved = baselineRank - finalRank
  item.ownerFinishPositionsImprovedSum += improved
  item.ownerFinishPositionsImprovedCount += 1
  return improved
}

function recordVictimLoss(item: ItemInstrument, baselineRank: number, finalRank: number) {
  const lost = finalRank - baselineRank
  if (lost > 0) {
    item.victimFinishPositionsLostSum += lost
    item.victimFinishPositionsLostCount += 1
  }
}

export function mergeRaceInstrumentation(target: RaceInstrumentation, source: RaceInstrumentation) {
  target.featherExposureRaces += source.featherExposureRaces
  for (const key of Object.keys(target.counters) as Array<keyof CounterInstrument>) {
    target.counters[key] += source.counters[key]
  }
  for (const itemId of [...MAJORS, ...MINORS]) {
    const left = target.items[itemId]!
    const right = source.items[itemId]!
    for (const key of Object.keys(left) as Array<keyof ItemInstrument>) {
      left[key] += right[key]
    }
  }
}

export function createRaceConfig(seedIndex: number, playerCount: number, loadouts: RaceLoadout[] = []): RaceConfig {
  return {
    raceId: `balance-${seedIndex}`,
    seed: seedFromIndex(seedIndex),
    protocolVersion: RACE_PROTOCOL_VERSION,
    engineVersion: RACE_ENGINE_VERSION,
    balanceVersion: RACE_BALANCE_VERSION,
    trackVersion: DEFAULT_TRACK_VERSION,
    tickRate: RACE_TICK_RATE,
    players: Array.from({ length: playerCount }, (_, index) => ({ playerId: `duck-${index + 1}`, name: `Duck ${index + 1}` })),
    loadouts,
  }
}

export function neutralLoadouts(seedIndex: number, excludeKeys: Set<string>, count: number): FullLoadout[] {
  const pool = FULL_LOADOUTS.filter((loadout) => !excludeKeys.has(loadoutKey(loadout)))
  const source = pool.length > 0 ? pool : FULL_LOADOUTS
  return Array.from({ length: count }, (_, index) => source[(seedIndex + index) % source.length]!)
}

export function buildLoadouts(
  loadoutA: FullLoadout,
  loadoutB: FullLoadout,
  slotA: number,
  slotB: number,
  playerCount: number,
  seedIndex: number,
): RaceLoadout[] {
  const exclude = new Set([loadoutKey(loadoutA), loadoutKey(loadoutB)])
  const neutrals = neutralLoadouts(seedIndex, exclude, playerCount - 2)
  const loadouts: RaceLoadout[] = []
  let neutralIndex = 0
  for (let slot = 1; slot <= playerCount; slot += 1) {
    const playerId = `duck-${slot}`
    let itemIds: RaceItemId[]
    if (slot === slotA) itemIds = [...loadoutA]
    else if (slot === slotB) itemIds = [...loadoutB]
    else {
      itemIds = [...neutrals[neutralIndex]!]
      neutralIndex += 1
    }
    loadouts.push({ playerId, itemIds, source: 'AUTO' })
  }
  return loadouts
}

function recordFeatherThreat(
  feather: ItemInstrument,
  options: { defenseAvailable: boolean; proc: boolean },
) {
  feather.eligibleThreats += 1
  feather.actualCollisionOpportunities += 1
  feather.eligibleThreatExposures += 1
  if (options.defenseAvailable) feather.defenseAvailableAtExposure += 1
  if (options.proc) {
    feather.successfulProcs += 1
    feather.eligibleThreatProcs += 1
  }
}

export interface RaceEventTrackerContext {
  loadoutByPlayer: Map<string, readonly RaceItemId[]>
  baselineRank: Map<string, number>
  finalRank: Map<string, number>
  focusPlayers: Set<string>
  instrumentation: RaceInstrumentation
  boostedPlayers: Set<string>
  tickRate: number
}

export function createRaceEventTrackerContext(
  loadoutByPlayer: Map<string, readonly RaceItemId[]>,
  baselineRank: Map<string, number>,
  finalRank: Map<string, number>,
  focusPlayers: Set<string>,
  instrumentation: RaceInstrumentation,
  tickRate = RACE_TICK_RATE,
): RaceEventTrackerContext {
  return {
    loadoutByPlayer,
    baselineRank,
    finalRank,
    focusPlayers,
    instrumentation,
    boostedPlayers: new Set<string>(),
    tickRate,
  }
}

export interface InstrumentEvent {
  type: RaceEventType
  sourcePlayerId?: string
  targetPlayerId?: string
  metadata: Record<string, unknown>
}

export function toInstrumentEvent(event: RaceEvent): InstrumentEvent {
  return {
    type: event.type,
    sourcePlayerId: event.sourcePlayerId,
    targetPlayerId: event.targetPlayerId,
    metadata: event.metadata,
  }
}

export function trackRaceEvent(
  event: InstrumentEvent | RaceEvent,
  context: RaceEventTrackerContext,
) {
  const {
    loadoutByPlayer,
    baselineRank,
    finalRank,
    focusPlayers,
    instrumentation,
    boostedPlayers,
    tickRate,
  } = context
  const autoReason = event.metadata.autoReason
  const bucket = activationBucket(autoReason)
  const bumpActivation = (itemId: RaceItemId, playerId: string) => {
    if (!focusPlayers.has(playerId)) return
    const item = instrumentation.items[itemId]!
    if (bucket === 'organic') item.organicActivations += 1
    else if (bucket === 'fallback') item.fallbackActivations += 1
    else item.forceBurnActivations += 1
    recordOwnerImprovement(item, baselineRank.get(playerId)!, finalRank.get(playerId)!)
    if (itemId === 'NITRO' || itemId === 'DRAFT_FIN' || itemId === 'PADDLE_BURST') {
      instrumentation.counters.speedActivations += 1
      instrumentation.counters.speedOwnerPositionsImprovedSum += baselineRank.get(playerId)! - finalRank.get(playerId)!
    }
  }

  const activationItem = ACTIVATION_EVENTS[event.type]
  if (activationItem && event.sourcePlayerId && focusPlayers.has(event.sourcePlayerId)) {
    const loadout = loadoutByPlayer.get(event.sourcePlayerId)
    if (loadout?.includes(activationItem)) {
      bumpActivation(activationItem, event.sourcePlayerId)
      if (event.type === 'HORN_USED') {
        const targets = (event.metadata.targets as string[] | undefined) ?? []
        if (targets.length >= 1) {
          instrumentation.items.QUACK_HORN!.successfulEffects += 1
          instrumentation.items.QUACK_HORN!.meaningfulEffects += 1
        }
      } else if (event.type !== 'ROCKET_FIRED') {
        instrumentation.items[activationItem]!.successfulEffects += 1
      }
    }
  }

  if (event.type === 'NITRO_STARTED' || event.type === 'DRAFT_FIN_STARTED' || event.type === 'PADDLE_BURST_STARTED') {
    if (event.sourcePlayerId && focusPlayers.has(event.sourcePlayerId)) boostedPlayers.add(event.sourcePlayerId)
  }

  if (event.type === 'ROCKET_HIT' && event.targetPlayerId && event.sourcePlayerId && focusPlayers.has(event.sourcePlayerId)) {
    const rocket = instrumentation.items.HOMING_ROCKET!
    recordOwnerImprovement(rocket, baselineRank.get(event.sourcePlayerId)!, finalRank.get(event.sourcePlayerId)!)
    recordVictimLoss(rocket, baselineRank.get(event.targetPlayerId)!, finalRank.get(event.targetPlayerId)!)
    rocket.successfulEffects += 1
  }

  if (event.type === 'BOOST_BROKEN' && event.sourcePlayerId && event.targetPlayerId) {
    const victimId = event.sourcePlayerId
    const attackerId = event.targetPlayerId
    const attackerLoadout = loadoutByPlayer.get(attackerId)
    if (
      attackerLoadout?.includes('HOMING_ROCKET')
      && focusPlayers.has(attackerId)
      && focusPlayers.has(victimId)
    ) {
      const remainingBoostTicks = Number(event.metadata.remainingBoostTicks ?? 0)
      const originalBoostTicks = Math.max(1, Number(event.metadata.originalBoostTicks ?? 1))
      const boostMultiplier = Number(event.metadata.boostMultiplier ?? 1)
      const fractionDenied = Number(event.metadata.fractionDenied ?? remainingBoostTicks / originalBoostTicks)
      const baseSpeed = 1 / CORE_BALANCE.targetDurationSeconds
      instrumentation.counters.boostBreakOpportunities += 1
      instrumentation.counters.boostBreakSuccess += 1
      instrumentation.counters.boostOwnerPositionsDeniedSum += Math.max(0, finalRank.get(victimId)! - baselineRank.get(victimId)!)
      instrumentation.counters.boostSecondsDestroyedSum += remainingBoostTicks / tickRate
      instrumentation.counters.boostDistanceDeniedSum += baseSpeed * Math.max(0, boostMultiplier - 1) * remainingBoostTicks / tickRate
      instrumentation.counters.boostFractionDeniedSum += fractionDenied
    }
    boostedPlayers.delete(victimId)
  }

  if ((event.type === 'BANANA_HIT' || event.type === 'WILD_BANANA_HIT') && event.targetPlayerId && focusPlayers.has(event.targetPlayerId)) {
    const loadout = loadoutByPlayer.get(event.targetPlayerId)!
    if (loadout.includes('FEATHER')) {
      recordFeatherThreat(instrumentation.items.FEATHER!, { defenseAvailable: false, proc: false })
    }
  }

  if ((event.type === 'ROCKET_HIT' || event.type === 'MINI_ROCKET_HIT') && event.targetPlayerId && focusPlayers.has(event.targetPlayerId)) {
    instrumentation.counters.eligibleAttacksReceived += 1
  }

  if (event.type === 'HAZARD_HIT' && event.sourcePlayerId && focusPlayers.has(event.sourcePlayerId)) {
    const loadout = loadoutByPlayer.get(event.sourcePlayerId)!
    if (loadout.includes('FEATHER')) {
      recordFeatherThreat(instrumentation.items.FEATHER!, { defenseAvailable: false, proc: false })
    }
  }

  if (event.type === 'FEATHER_DODGED' && event.sourcePlayerId && focusPlayers.has(event.sourcePlayerId)) {
    const feather = instrumentation.items.FEATHER!
    recordFeatherThreat(feather, { defenseAvailable: true, proc: true })
    feather.successfulEffects += 1
    recordOwnerImprovement(feather, baselineRank.get(event.sourcePlayerId)!, finalRank.get(event.sourcePlayerId)!)
  }

  if (event.type === 'HAZARD_DODGED' && event.sourcePlayerId && focusPlayers.has(event.sourcePlayerId)) {
    const loadout = loadoutByPlayer.get(event.sourcePlayerId)!
    if (loadout.includes('FEATHER')) {
      const feather = instrumentation.items.FEATHER!
      recordFeatherThreat(feather, { defenseAvailable: true, proc: true })
      feather.successfulEffects += 1
    }
  }

  if (event.type === 'BUBBLE_POPPED' && event.sourcePlayerId && event.metadata.blocked && focusPlayers.has(event.sourcePlayerId)) {
    const bubble = instrumentation.items.BUBBLE_SHIELD!
    bubble.successfulEffects += 1
    instrumentation.counters.attacksFullyBlocked += 1
    recordOwnerImprovement(bubble, baselineRank.get(event.sourcePlayerId)!, finalRank.get(event.sourcePlayerId)!)
  }

  if (event.type === 'SHOCK_ABSORBER_PROC' && event.targetPlayerId && focusPlayers.has(event.targetPlayerId)) {
    const shock = instrumentation.items.SHOCK_ABSORBER!
    shock.successfulEffects += 1
    instrumentation.counters.attacksMitigated += 1
    recordOwnerImprovement(shock, baselineRank.get(event.targetPlayerId)!, finalRank.get(event.targetPlayerId)!)
    if (event.sourcePlayerId) recordVictimLoss(shock, baselineRank.get(event.sourcePlayerId)!, finalRank.get(event.sourcePlayerId)!)
  }

  if (event.type === 'ROCKET_BLOCKED' && event.targetPlayerId && focusPlayers.has(event.targetPlayerId)) {
    instrumentation.counters.attacksFullyBlocked += 1
  }
}

export interface PairObservation {
  rankA: number
  rankB: number
  baselineRankA: number
  baselineRankB: number
  instrumentation: RaceInstrumentation
}

export function runPairedRace(
  seedIndex: number,
  loadoutA: FullLoadout,
  loadoutB: FullLoadout,
  slotA: number,
  slotB: number,
  playerCount: number,
): PairObservation {
  const baseline = simulateRace(createRaceConfig(seedIndex, playerCount), { recordEvents: false })
  const baselineRank = new Map(baseline.standings.map((entry) => [entry.playerId, entry.rank]))
  const loadouts = buildLoadouts(loadoutA, loadoutB, slotA, slotB, playerCount, seedIndex)
  const loadoutByPlayer = new Map(loadouts.map((loadout) => [loadout.playerId, loadout.itemIds]))
  const instrumentation = emptyRaceInstrumentation()
  const focusPlayers = new Set([`duck-${slotA}`, `duck-${slotB}`])
  const pendingEvents: InstrumentEvent[] = []

  for (const loadout of loadouts) {
    if (!focusPlayers.has(loadout.playerId)) continue
    for (const itemId of loadout.itemIds) instrumentation.items[itemId]!.equippedRaces += 1
    if (loadout.itemIds.includes('BUBBLE_SHIELD') || loadout.itemIds.includes('FEATHER') || loadout.itemIds.includes('SHOCK_ABSORBER')) {
      instrumentation.counters.defenseItemsEquipped += loadout.itemIds.filter((id) => id === 'BUBBLE_SHIELD' || id === 'FEATHER' || id === 'SHOCK_ABSORBER').length
    }
  }

  const result = simulateRace(createRaceConfig(seedIndex, playerCount, loadouts), {
    recordEvents: false,
    onEvent(event) {
      pendingEvents.push(toInstrumentEvent(event))
    },
  })
  const finalRank = new Map(result.standings.map((entry) => [entry.playerId, entry.rank]))
  const tracker = createRaceEventTrackerContext(loadoutByPlayer, baselineRank, finalRank, focusPlayers, instrumentation)
  for (const event of pendingEvents) trackRaceEvent(event, tracker)

  let featherEquippedThisRace = false
  for (const playerId of focusPlayers) {
    const loadout = loadoutByPlayer.get(playerId)!
    if (loadout.includes('FEATHER')) featherEquippedThisRace = true
    for (const itemId of loadout) {
      const item = instrumentation.items[itemId]!
      if (item.successfulEffects === 0 && item.organicActivations + item.fallbackActivations + item.forceBurnActivations === 0) {
        if (itemId === 'BUBBLE_SHIELD' || itemId === 'FEATHER' || itemId === 'SHOCK_ABSORBER') instrumentation.counters.defenseItemsUnused += 1
      }
    }
  }
  if (featherEquippedThisRace && instrumentation.items.FEATHER!.eligibleThreats > 0) {
    instrumentation.featherExposureRaces += 1
  }

  const playerA = `duck-${slotA}`
  const playerB = `duck-${slotB}`
  return {
    rankA: finalRank.get(playerA)!,
    rankB: finalRank.get(playerB)!,
    baselineRankA: baselineRank.get(playerA)!,
    baselineRankB: baselineRank.get(playerB)!,
    instrumentation,
  }
}

export interface MatchupAggregate {
  key: string
  leftLoadout: FullLoadout
  rightLoadout: FullLoadout
  left: RunningStats
  right: RunningStats
  seedOutcomes: SeedSwapOutcome[]
  instrumentation: RaceInstrumentation
}

export function emptyMatchupAggregate(leftLoadout: FullLoadout, rightLoadout: FullLoadout): MatchupAggregate {
  return {
    key: `${loadoutKey(leftLoadout)} vs ${loadoutKey(rightLoadout)}`,
    leftLoadout,
    rightLoadout,
    left: emptyRunningStats(),
    right: emptyRunningStats(),
    seedOutcomes: [],
    instrumentation: emptyRaceInstrumentation(),
  }
}

export function recordPairObservation(aggregate: MatchupAggregate, seedIndex: number, observation: PairObservation, playerCount: number) {
  updateRunningStats(aggregate.left, observation.rankA, playerCount, observation.baselineRankA - observation.rankA)
  updateRunningStats(aggregate.right, observation.rankB, playerCount, observation.baselineRankB - observation.rankB)
  let seed = aggregate.seedOutcomes.find((entry) => entry.seedIndex === seedIndex)
  if (!seed) {
    seed = { seedIndex, leftWins: [] }
    aggregate.seedOutcomes.push(seed)
  }
  seed.leftWins.push(observation.rankA < observation.rankB)
  mergeRaceInstrumentation(aggregate.instrumentation, observation.instrumentation)
}

export function summarizeStats(stats: RunningStats, playerCount: number) {
  const samples = stats.samples
  return {
    samples,
    winPct: rounded(percentage(stats.wins, samples), 2),
    top3Pct: rounded(percentage(stats.top3, samples), 2),
    bottom2Pct: rounded(percentage(stats.bottom2, samples), 2),
    avgRank: rounded(stats.rankSum / samples, 3),
    ownerFinishPositionsImproved: rounded(stats.ownerFinishPositionsImprovedSum / samples, 3),
    stdRank: rounded(stddev(stats), 3),
    expectedNeutralWinPct: rounded(100 / playerCount, 2),
  }
}

export function runMatchupBatch(
  left: FullLoadout,
  right: FullLoadout,
  startIndex: number,
  seedCount: number,
  playerCount: number,
  swapSlots: boolean,
): MatchupAggregate {
  const aggregate = emptyMatchupAggregate(left, right)
  const slotPairs = swapSlots ? [[1, 2], [2, 1]] as const : [[1, 2]] as const
  for (let offset = 0; offset < seedCount; offset += 1) {
    const seedIndex = startIndex + offset
    for (const [slotA, slotB] of slotPairs) {
      const observation = runPairedRace(seedIndex, left, right, slotA, slotB, playerCount)
      recordPairObservation(aggregate, seedIndex, observation, playerCount)
    }
  }
  return aggregate
}

export function mergeRunningStats(target: RunningStats, source: RunningStats) {
  if (source.samples === 0) return
  if (target.samples === 0) {
    Object.assign(target, structuredClone(source))
    return
  }
  const total = target.samples + source.samples
  const delta = source.mean - target.mean
  target.m2 += source.m2 + delta * delta * target.samples * source.samples / total
  target.mean = (target.mean * target.samples + source.mean * source.samples) / total
  target.samples = total
  target.wins += source.wins
  target.top3 += source.top3
  target.bottom2 += source.bottom2
  target.rankSum += source.rankSum
  target.ownerFinishPositionsImprovedSum += source.ownerFinishPositionsImprovedSum
}

export function mergeMatchupAggregate(target: MatchupAggregate, source: MatchupAggregate) {
  for (const seed of source.seedOutcomes) target.seedOutcomes.push({ seedIndex: seed.seedIndex, leftWins: [...seed.leftWins] })
  mergeRunningStats(target.left, source.left)
  mergeRunningStats(target.right, source.right)
  mergeRaceInstrumentation(target.instrumentation, source.instrumentation)
}

export function runFocusedLoadoutRace(seedIndex: number, focusLoadout: FullLoadout, focusSlot: number, playerCount: number) {
  const dummy = FULL_LOADOUTS[(seedIndex + focusSlot) % FULL_LOADOUTS.length]!
  const observation = runPairedRace(seedIndex, focusLoadout, dummy, focusSlot, focusSlot === 1 ? 2 : 1, playerCount)
  return {
    rank: focusSlot === 1 ? observation.rankA : observation.rankB,
    baselineRank: focusSlot === 1 ? observation.baselineRankA : observation.baselineRankB,
    instrumentation: observation.instrumentation,
  }
}

export function allPureCrossMatchups(attacker: ItemClass, defender: ItemClass) {
  return PURE_LOADOUTS_BY_CLASS[attacker].flatMap((left) => PURE_LOADOUTS_BY_CLASS[defender].map((right) => [left, right] as const))
}

export function allPureClassMatchups(itemClass: ItemClass) {
  return allPureCrossMatchups(itemClass, itemClass)
}

export function upperTrianglePairs<T>(items: readonly T[]) {
  const pairs: Array<[T, T]> = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) pairs.push([items[i]!, items[j]!])
  }
  return pairs
}
