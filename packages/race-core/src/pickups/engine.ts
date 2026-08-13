import type {
  HazardType,
  PickupConfig,
  PickupSpawnType,
  RaceConfig,
  RaceEventType,
  RecordedWildItemInput,
  WildItemId,
} from '../../../race-protocol/src'
import { createRaceRng, type DeterministicRng } from '../rng'
import type { HazardZone, PickupZone, RaceTrack } from '../track'
import {
  applyItemBoost,
  applyItemSlow,
  type BananaRuntime,
  type DuckItemRuntime,
  type ItemDuckState,
  type ItemRaceState,
  type RocketRuntime,
} from '../items/engine'
import { resolveIncomingRaceEffect } from '../items/interactions'
import { PICKUP_BALANCE, POSITION_CATEGORY_WEIGHTS } from './config'
import { getWildItem, WILD_ITEM_CATALOG, type WildItemCategory } from './catalog'

export interface PickupSpawn {
  id: string
  zoneId: string
  anchorId: string
  type: PickupSpawnType
  progress: number
  lateralOffset: number
  state: 'ACTIVE' | 'COLLECTED' | 'EXPIRED'
  collectedByPlayerId?: string
  collectedAtTick?: number
}

export interface HazardSpawn {
  id: string
  zoneId: string
  anchorId: string
  type: HazardType
  progress: number
  lateralOffset: number
  radius: number
  hitPlayerIds: Set<string>
}

export interface PickupRaceState {
  config: ResolvedPickupConfig
  pickups: PickupSpawn[]
  hazards: HazardSpawn[]
  activatedZoneIds: Set<string>
  slotFullFeedback: Set<string>
  goldenCollectorPlayerId: string | null
}

type ResolvedPickupConfig = Omit<Required<PickupConfig>, 'forceItem'> & { forceItem?: WildItemId }

export type EmitPickupEvent = (type: RaceEventType, sourcePlayerId?: string, targetPlayerId?: string, metadata?: Record<string, unknown>) => void

export interface WildUseResult {
  ok: boolean
  reason?: 'NO_ITEM' | 'ITEM_CHANGED' | 'NO_TARGET' | 'NOT_USEABLE'
  targetPlayerId?: string
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

function shuffled<T>(values: readonly T[], rng: DeterministicRng) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = rng.integer(0, index)
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

function pickupConfig(config: RaceConfig): ResolvedPickupConfig {
  if (!config.pickupConfig) {
    return {
      enabled: false,
      goldenBoxEnabled: false,
      goldenBoxProbability: 0,
      hazardsEnabled: false,
      positionAwareLoot: true,
      spawnMultiplier: 0,
      regularPickupCap: PICKUP_BALANCE.regularPickupCap,
      manualItemsEnabled: false,
      autoItemsEnabled: false,
      chaosBoxEnabled: false,
      forceItem: undefined,
      disabledItems: [],
      idealManualPlayerIds: [],
      forceGoldenBox: false,
    }
  }
  return {
    enabled: config.pickupConfig?.enabled ?? true,
    goldenBoxEnabled: config.pickupConfig?.goldenBoxEnabled ?? true,
    goldenBoxProbability: config.pickupConfig?.goldenBoxProbability ?? PICKUP_BALANCE.goldenBoxProbability,
    hazardsEnabled: config.pickupConfig?.hazardsEnabled ?? true,
    positionAwareLoot: config.pickupConfig?.positionAwareLoot ?? true,
    spawnMultiplier: config.pickupConfig?.spawnMultiplier ?? 1,
    regularPickupCap: config.pickupConfig?.regularPickupCap ?? PICKUP_BALANCE.regularPickupCap,
    manualItemsEnabled: config.pickupConfig?.manualItemsEnabled ?? true,
    autoItemsEnabled: config.pickupConfig?.autoItemsEnabled ?? true,
    chaosBoxEnabled: config.pickupConfig?.chaosBoxEnabled ?? false,
    forceItem: config.pickupConfig?.forceItem,
    disabledItems: config.pickupConfig?.disabledItems ?? [],
    idealManualPlayerIds: config.pickupConfig?.idealManualPlayerIds ?? [],
    forceGoldenBox: config.pickupConfig?.forceGoldenBox ?? false,
  }
}

function boxCount(playerCount: number, zone: PickupZone, multiplier: number) {
  if (multiplier <= 0 || zone.spawnRatio <= 0) return 0
  const normal = clamp(Math.round(playerCount * 0.5), 2, 5)
  return clamp(Math.round(normal * multiplier * zone.spawnRatio), 2, zone.candidateAnchors.length)
}

function createRegularBoxes(config: RaceConfig, track: RaceTrack, resolved: ResolvedPickupConfig) {
  if (!resolved.enabled) return []
  const rng = createRaceRng(config.seed, `pickup-spawn:${config.raceId}`)
  const spawns: PickupSpawn[] = []
  for (const zone of track.pickupZones) {
    const anchors = shuffled(zone.candidateAnchors, rng).slice(0, boxCount(config.players.length, zone, resolved.spawnMultiplier))
    const center = (zone.startProgress + zone.endProgress) / 2
    for (const anchor of anchors) {
      spawns.push({
        id: `box:${zone.id}:${anchor.id}`,
        zoneId: zone.id,
        anchorId: anchor.id,
        type: 'QUACK_BOX',
        progress: clamp(center + anchor.progressOffset, zone.startProgress, zone.endProgress),
        lateralOffset: anchor.lateralOffset,
        state: 'ACTIVE',
      })
    }
  }
  return spawns.sort((left, right) => left.progress - right.progress || left.id.localeCompare(right.id))
}

function createGoldenBox(config: RaceConfig, track: RaceTrack, resolved: ResolvedPickupConfig, occupied: PickupSpawn[]) {
  if (!resolved.goldenBoxEnabled) return null
  const rng = createRaceRng(config.seed, `gold-box:${config.raceId}`)
  if (!resolved.forceGoldenBox && rng.next() >= resolved.goldenBoxProbability) return null
  const zones = track.pickupZones.filter((zone) => zone.startProgress >= PICKUP_BALANCE.goldenProgressMinimum && zone.endProgress <= PICKUP_BALANCE.goldenProgressMaximum)
  if (zones.length === 0) return null
  const zone = zones[rng.integer(0, zones.length - 1)]!
  const occupiedAnchors = new Set(occupied.filter((spawn) => spawn.zoneId === zone.id).map((spawn) => spawn.anchorId))
  const available = zone.candidateAnchors.filter((anchor) => !occupiedAnchors.has(anchor.id))
  const candidates = available.length > 0 ? available : zone.candidateAnchors
  const anchor = candidates[rng.integer(0, candidates.length - 1)]!
  const center = (zone.startProgress + zone.endProgress) / 2
  return {
    id: `gold:${zone.id}:${anchor.id}`,
    zoneId: zone.id,
    anchorId: anchor.id,
    type: 'GOLDEN_BOX' as const,
    progress: clamp(center + anchor.progressOffset, PICKUP_BALANCE.goldenProgressMinimum, PICKUP_BALANCE.goldenProgressMaximum),
    lateralOffset: anchor.lateralOffset,
    state: 'ACTIVE' as const,
  }
}

function createHazards(config: RaceConfig, zones: HazardZone[], resolved: ResolvedPickupConfig) {
  if (!resolved.hazardsEnabled) return []
  const rng = createRaceRng(config.seed, `hazards:${config.raceId}`)
  const countRoll = rng.next()
  const count = countRoll < 0.45 ? 0 : countRoll < 0.9 ? 1 : 2
  return shuffled(zones, rng).slice(0, count).map((zone, index) => {
    const anchor = zone.anchors[rng.integer(0, zone.anchors.length - 1)]!
    const type = zone.allowedTypes[rng.integer(0, zone.allowedTypes.length - 1)]!
    return {
      id: `hazard:${zone.id}:${anchor.id}:${index + 1}`,
      zoneId: zone.id,
      anchorId: anchor.id,
      type,
      progress: anchor.progress,
      lateralOffset: anchor.lateralOffset,
      radius: anchor.radius,
      hitPlayerIds: new Set<string>(),
    }
  }).sort((left, right) => left.progress - right.progress || left.id.localeCompare(right.id))
}

export function createPickupRaceState(config: RaceConfig, track: RaceTrack): PickupRaceState {
  const resolved = pickupConfig(config)
  const regular = createRegularBoxes(config, track, resolved)
  const golden = createGoldenBox(config, track, resolved, regular)
  return {
    config: resolved,
    pickups: golden ? [...regular, golden].sort((left, right) => left.progress - right.progress || left.id.localeCompare(right.id)) : regular,
    hazards: createHazards(config, track.hazardZones, resolved),
    activatedZoneIds: new Set(),
    slotFullFeedback: new Set(),
    goldenCollectorPlayerId: null,
  }
}

export function announcePickupWorld(state: PickupRaceState, emit: EmitPickupEvent) {
  for (const pickup of state.pickups) {
    emit(pickup.type === 'GOLDEN_BOX' ? 'GOLDEN_BOX_SPAWNED' : 'PICKUP_SPAWNED', undefined, undefined, {
      pickupId: pickup.id, zoneId: pickup.zoneId, pickupType: pickup.type, progress: pickup.progress, lateralOffset: pickup.lateralOffset,
    })
  }
  for (const hazard of state.hazards) {
    emit('HAZARD_SPAWNED', undefined, undefined, {
      hazardId: hazard.id, zoneId: hazard.zoneId, hazardType: hazard.type, progress: hazard.progress, lateralOffset: hazard.lateralOffset, radius: hazard.radius,
    })
  }
}

function rankBucket(duck: ItemDuckState, playerCount: number) {
  const edge = Math.max(1, Math.ceil(playerCount * 0.25))
  if (duck.currentRank <= edge) return 'front' as const
  if (duck.currentRank > playerCount - edge) return 'back' as const
  return 'middle' as const
}

function weightedCategory(rng: DeterministicRng, bucket: 'front' | 'middle' | 'back'): WildItemCategory {
  const weights = POSITION_CATEGORY_WEIGHTS[bucket]
  const entries = Object.entries(weights) as Array<[WildItemCategory, number]>
  const roll = rng.range(0, entries.reduce((sum, [, weight]) => sum + weight, 0))
  let cursor = 0
  for (const [category, weight] of entries) {
    cursor += weight
    if (roll < cursor) return category
  }
  return entries.at(-1)![0]
}

function nearestAhead(duck: ItemDuckState, ducks: ItemDuckState[], maximumDistance: number, itemState?: ItemRaceState, tick?: number) {
  return ducks.filter((candidate) => !candidate.finished && candidate.playerId !== duck.playerId && candidate.progress > duck.progress)
    .filter((candidate) => candidate.progress - duck.progress <= maximumDistance)
    .filter((candidate) => !itemState || tick === undefined || tick >= itemState.byPlayer.get(candidate.playerId)!.rocketProtectionUntilTick)
    .sort((left, right) => left.progress - right.progress || left.playerId.localeCompare(right.playerId))[0]
}

export function rollWildItem(config: RaceConfig, pickupState: PickupRaceState, pickup: PickupSpawn, duck: ItemDuckState, ducks: ItemDuckState[]) {
  if (pickupState.config.forceItem && !pickupState.config.disabledItems.includes(pickupState.config.forceItem)) return pickupState.config.forceItem
  const rng = createRaceRng(config.seed, `pickup-loot:${config.raceId}:${pickup.id}:${duck.playerId}`)
  const bucket = pickupState.config.positionAwareLoot ? rankBucket(duck, ducks.length) : 'middle'
  const category = weightedCategory(rng, bucket)
  let candidates = WILD_ITEM_CATALOG.filter((item) => item.category === category && !pickupState.config.disabledItems.includes(item.id))
  if (!nearestAhead(duck, ducks, PICKUP_BALANCE.magnet.maximumTargetDistance)) {
    candidates = candidates.filter((item) => item.id !== 'SLIPSTREAM_MAGNET')
  }
  if (candidates.length === 0) candidates = WILD_ITEM_CATALOG.filter((item) => !pickupState.config.disabledItems.includes(item.id))
  if (candidates.length === 0) throw new Error('At least one Wild Item must be enabled')
  return candidates[rng.integer(0, candidates.length - 1)]!.id
}

function grantOrTriggerItem(config: RaceConfig, pickupState: PickupRaceState, itemState: ItemRaceState, pickup: PickupSpawn, duck: ItemDuckState, ducks: ItemDuckState[], tick: number, tickRate: number, emit: EmitPickupEvent) {
  const runtime = itemState.byPlayer.get(duck.playerId)!
  const itemId = rollWildItem(config, pickupState, pickup, duck, ducks)
  const definition = getWildItem(itemId)
  const instanceId = `wild:${config.raceId}:${pickup.id}:${duck.playerId}`
  if (definition.behavior === 'HELD') {
    runtime.wildItem = { instanceId, itemId, acquiredAtTick: tick }
    emit('WILD_ITEM_GRANTED', duck.playerId, undefined, { pickupId: pickup.id, instanceId, itemId, rank: duck.currentRank })
    return
  }
  if (itemId === 'MINI_NITRO') {
    applyItemBoost(runtime, PICKUP_BALANCE.miniNitro.multiplier, PICKUP_BALANCE.miniNitro.durationSeconds, tick, tickRate)
  } else if (itemId === 'TAILWIND') {
    applyItemBoost(runtime, PICKUP_BALANCE.tailwind.multiplier, PICKUP_BALANCE.tailwind.durationSeconds, tick, tickRate)
    runtime.tailwindUntilTick = tick + Math.round(PICKUP_BALANCE.tailwind.durationSeconds * tickRate)
    emit('TAILWIND_STARTED', duck.playerId, undefined, { untilTick: runtime.tailwindUntilTick })
  } else if (itemId === 'SLIPSTREAM_MAGNET') {
    applyItemBoost(runtime, PICKUP_BALANCE.magnet.multiplier, PICKUP_BALANCE.magnet.durationSeconds, tick, tickRate)
    runtime.magnetUntilTick = tick + Math.round(PICKUP_BALANCE.magnet.durationSeconds * tickRate)
    emit('MAGNET_STARTED', duck.playerId, nearestAhead(duck, ducks, PICKUP_BALANCE.magnet.maximumTargetDistance)?.playerId, { untilTick: runtime.magnetUntilTick })
  }
  emit('INSTANT_PICKUP_TRIGGERED', duck.playerId, undefined, { pickupId: pickup.id, instanceId, itemId, rank: duck.currentRank })
}

function crossingFraction(duck: ItemDuckState & { previousProgress?: number }, progress: number) {
  const previous = duck.previousProgress ?? duck.progress
  const travelled = duck.progress - previous
  if (travelled <= 0) return 1
  return clamp((progress - previous) / travelled, 0, 1)
}

function touches(duck: ItemDuckState & { previousProgress?: number }, progress: number, lateralOffset: number, progressRadius: number, lateralRadius: number) {
  const minimum = Math.min(duck.previousProgress ?? duck.progress, duck.progress) - progressRadius
  const maximum = Math.max(duck.previousProgress ?? duck.progress, duck.progress) + progressRadius
  return progress >= minimum && progress <= maximum && Math.abs(duck.lateralOffset - lateralOffset) <= lateralRadius
}

function collectPickups(config: RaceConfig, pickupState: PickupRaceState, itemState: ItemRaceState, ducks: Array<ItemDuckState & { previousProgress?: number }>, tick: number, tickRate: number, emit: EmitPickupEvent) {
  for (const pickup of pickupState.pickups.filter((spawn) => spawn.state === 'ACTIVE').sort((left, right) => left.id.localeCompare(right.id))) {
    const contacts = ducks.filter((duck) => !duck.finished && touches(duck, pickup.progress, pickup.lateralOffset, PICKUP_BALANCE.progressRadius, PICKUP_BALANCE.lateralRadius))
    if (contacts.length === 0) continue
    const eligible = contacts.filter((duck) => {
      if (pickup.type === 'GOLDEN_BOX') return true
      const runtime = itemState.byPlayer.get(duck.playerId)!
      if (runtime.regularPickupCount >= pickupState.config.regularPickupCap) return false
      if (!runtime.wildItem) return true
      const key = `${pickup.id}:${duck.playerId}`
      if (!pickupState.slotFullFeedback.has(key)) {
        pickupState.slotFullFeedback.add(key)
        emit('PICKUP_SKIPPED_SLOT_FULL', duck.playerId, undefined, { pickupId: pickup.id, itemId: runtime.wildItem.itemId })
      }
      return false
    }).sort((left, right) => {
      const leftDistance = Math.hypot(left.progress - pickup.progress, left.lateralOffset - pickup.lateralOffset)
      const rightDistance = Math.hypot(right.progress - pickup.progress, right.lateralOffset - pickup.lateralOffset)
      return leftDistance - rightDistance
        || crossingFraction(left, pickup.progress) - crossingFraction(right, pickup.progress)
        || left.playerId.localeCompare(right.playerId)
    })
    const collector = eligible[0]
    if (!collector) continue
    pickup.state = 'COLLECTED'
    pickup.collectedByPlayerId = collector.playerId
    pickup.collectedAtTick = tick
    emit('PICKUP_COLLECTED', collector.playerId, undefined, { pickupId: pickup.id, pickupType: pickup.type, progress: pickup.progress, lateralOffset: pickup.lateralOffset })
    if (pickup.type === 'GOLDEN_BOX') {
      pickupState.goldenCollectorPlayerId = collector.playerId
      emit('GOLDEN_BOX_COLLECTED', collector.playerId, undefined, { pickupId: pickup.id })
      continue
    }
    const runtime = itemState.byPlayer.get(collector.playerId)!
    runtime.regularPickupCount += 1
    grantOrTriggerItem(config, pickupState, itemState, pickup, collector, ducks, tick, tickRate, emit)
  }
}

function activateZones(track: RaceTrack, pickupState: PickupRaceState, ducks: ItemDuckState[], emit: EmitPickupEvent) {
  const furthest = Math.max(...ducks.map((duck) => duck.progress))
  for (const zone of track.pickupZones) {
    if (furthest < zone.startProgress || pickupState.activatedZoneIds.has(zone.id)) continue
    pickupState.activatedZoneIds.add(zone.id)
    emit('PICKUP_ZONE_ACTIVATED', undefined, undefined, { zoneId: zone.id })
  }
}

function resolveHazards(pickupState: PickupRaceState, itemState: ItemRaceState, ducks: Array<ItemDuckState & { previousProgress?: number }>, tick: number, tickRate: number, emit: EmitPickupEvent) {
  for (const hazard of pickupState.hazards) {
    for (const duck of ducks.filter((candidate) => !candidate.finished).sort((left, right) => left.playerId.localeCompare(right.playerId))) {
      if (hazard.hitPlayerIds.has(duck.playerId) || !touches(duck, hazard.progress, hazard.lateralOffset, PICKUP_BALANCE.progressRadius, hazard.radius)) continue
      hazard.hitPlayerIds.add(duck.playerId)
      const runtime = itemState.byPlayer.get(duck.playerId)!
      const minor = hazard.type !== 'WHIRLPOOL'
      const outcome = minor ? resolveIncomingRaceEffect(runtime, 'MINOR_HAZARD', tick, tickRate) : 'HIT'
      if (outcome === 'DODGED_WILD_FEATHER') {
        emit('WILD_FEATHER_DODGED', duck.playerId, undefined, { hazardId: hazard.id, hazardType: hazard.type })
        emit('HAZARD_DODGED', duck.playerId, undefined, { hazardId: hazard.id, hazardType: hazard.type })
        continue
      }
      const tuning = PICKUP_BALANCE.hazards[hazard.type]
      applyItemSlow(runtime, tuning.slowMultiplier, tuning.durationSeconds, tick, tickRate)
      const direction = duck.lateralOffset === hazard.lateralOffset ? (duck.playerId.localeCompare(hazard.id) < 0 ? -1 : 1) : Math.sign(duck.lateralOffset - hazard.lateralOffset)
      duck.lateralVelocity += direction * tuning.wobble
      emit('HAZARD_HIT', duck.playerId, undefined, { hazardId: hazard.id, hazardType: hazard.type })
    }
  }
}

function createWildRocket(itemState: ItemRaceState, duck: ItemDuckState, target: ItemDuckState, tick: number, tickRate: number): RocketRuntime {
  return {
    id: itemState.nextObjectId++, sourcePlayerId: duck.playerId, targetPlayerId: target.playerId, progress: duck.progress,
    spawnedAtTick: tick,
    expiresAtTick: tick + Math.round(PICKUP_BALANCE.miniRocket.lifetimeSeconds * tickRate), kind: 'WILD',
    speedPerSecond: PICKUP_BALANCE.miniRocket.projectileSpeed, hitRadius: PICKUP_BALANCE.miniRocket.hitRadius,
    slowMultiplier: PICKUP_BALANCE.miniRocket.slowMultiplier, slowDurationSeconds: PICKUP_BALANCE.miniRocket.slowDurationSeconds,
    retargeted: false,
  }
}

function createWildBanana(itemState: ItemRaceState, duck: ItemDuckState, tick: number, tickRate: number): BananaRuntime | null {
  const offsets = [PICKUP_BALANCE.banana.dropBehindProgress, PICKUP_BALANCE.banana.dropBehindProgress + 0.012, PICKUP_BALANCE.banana.dropBehindProgress + 0.024]
  const progress = offsets
    .map((offset) => Math.max(0, duck.progress - offset))
    .find((point) => point <= 0.985 && !itemState.bananas.some((banana) =>
      Math.abs(banana.progress - point) < PICKUP_BALANCE.banana.minimumTrapSpacing
      && Math.abs(banana.lateralOffset - duck.lateralOffset) < PICKUP_BALANCE.banana.hitLateralRadius))
  if (progress === undefined) return null
  return {
    id: itemState.nextObjectId++, sourcePlayerId: duck.playerId, progress, lateralOffset: duck.lateralOffset,
    armedAtTick: tick + Math.round(PICKUP_BALANCE.banana.armingSeconds * tickRate),
    expiresAtTick: tick + Math.round(PICKUP_BALANCE.banana.lifetimeSeconds * tickRate), kind: 'WILD',
    hitProgressRadius: PICKUP_BALANCE.banana.hitProgressRadius, hitLateralRadius: PICKUP_BALANCE.banana.hitLateralRadius,
    progressKnockback: PICKUP_BALANCE.banana.progressKnockback,
    lateralSlip: PICKUP_BALANCE.banana.lateralSlip,
  }
}

type HeldHandler = (context: { itemState: ItemRaceState; runtime: DuckItemRuntime; duck: ItemDuckState; ducks: ItemDuckState[]; tick: number; tickRate: number; targetPlayerId?: string; emit: EmitPickupEvent }) => WildUseResult

const HELD_HANDLERS: Record<Exclude<WildItemId, 'MINI_NITRO' | 'TAILWIND' | 'SLIPSTREAM_MAGNET'>, HeldHandler> = {
  MINI_BUBBLE: ({ runtime, duck, tick, tickRate, emit }) => {
    runtime.wildBubbleAvailable = true
    runtime.wildBubbleUntilTick = tick + Math.round(PICKUP_BALANCE.miniBubble.durationSeconds * tickRate)
    emit('MINI_BUBBLE_ACTIVATED', duck.playerId, undefined, { untilTick: runtime.wildBubbleUntilTick })
    return { ok: true }
  },
  MINI_ROCKET: ({ itemState, duck, ducks, tick, tickRate, targetPlayerId, emit }) => {
    const maximumDistance = duck.progress >= PICKUP_BALANCE.autoUse.forceBurnProgress
      ? PICKUP_BALANCE.miniRocket.maximumTargetDistance * PICKUP_BALANCE.miniRocket.forceBurnTargetDistanceMultiplier
      : duck.progress >= PICKUP_BALANCE.autoUse.endGameBurnProgress
        ? PICKUP_BALANCE.miniRocket.maximumTargetDistance * PICKUP_BALANCE.miniRocket.endGameTargetDistanceMultiplier
        : PICKUP_BALANCE.miniRocket.maximumTargetDistance
    const preferred = targetPlayerId
      ? ducks.find((candidate) => candidate.playerId === targetPlayerId && !candidate.finished && candidate.progress > duck.progress && candidate.progress - duck.progress <= maximumDistance)
      : undefined
    const target = preferred ?? nearestAhead(duck, ducks, maximumDistance, itemState, tick)
    if (!target) return { ok: false, reason: 'NO_TARGET' }
    itemState.rockets.push(createWildRocket(itemState, duck, target, tick, tickRate))
    emit('MINI_ROCKET_FIRED', duck.playerId, target.playerId, {})
    return { ok: true, targetPlayerId: target.playerId }
  },
  BANANA: ({ itemState, duck, tick, tickRate, emit }) => {
    const banana = createWildBanana(itemState, duck, tick, tickRate)
    if (!banana) return { ok: false, reason: 'NOT_USEABLE' }
    itemState.bananas.push(banana)
    emit('WILD_BANANA_DROPPED', duck.playerId, undefined, { id: banana.id, progress: banana.progress, lateralOffset: banana.lateralOffset })
    return { ok: true }
  },
  QUACK_HORN: ({ duck, ducks, emit }) => {
    const endGame = duck.progress >= PICKUP_BALANCE.autoUse.endGameBurnProgress
    const forceBurn = duck.progress >= PICKUP_BALANCE.autoUse.forceBurnProgress
    const radiusScale = forceBurn ? PICKUP_BALANCE.horn.endGameProgressRadiusMultiplier : endGame ? 1.25 : 1
    const progressRadius = PICKUP_BALANCE.horn.progressRadius * radiusScale
    const lateralRadius = PICKUP_BALANCE.horn.lateralRadius * radiusScale
    const nearby = ducks.filter((candidate) => candidate.playerId !== duck.playerId && !candidate.finished
      && Math.abs(candidate.progress - duck.progress) <= progressRadius
      && Math.abs(candidate.lateralOffset - duck.lateralOffset) <= lateralRadius)
      .sort((left, right) => left.playerId.localeCompare(right.playerId))
    if (nearby.length === 0) return { ok: false, reason: 'NO_TARGET' }
    for (const target of nearby) {
      const direction = target.lateralOffset === duck.lateralOffset ? (target.playerId.localeCompare(duck.playerId) < 0 ? -1 : 1) : Math.sign(target.lateralOffset - duck.lateralOffset)
      target.lateralVelocity += direction * PICKUP_BALANCE.horn.lateralPush
    }
    emit('WILD_HORN_USED', duck.playerId, undefined, { targets: nearby.map((target) => target.playerId) })
    return { ok: true }
  },
  FEATHER: ({ runtime, duck, tick, tickRate, emit }) => {
    runtime.wildFeatherAvailable = true
    runtime.wildFeatherUntilTick = tick + Math.round(PICKUP_BALANCE.feather.durationSeconds * tickRate)
    emit('WILD_FEATHER_USED', duck.playerId, undefined, { untilTick: runtime.wildFeatherUntilTick })
    return { ok: true }
  },
}

export function activateWildItem(itemState: ItemRaceState, ducks: ItemDuckState[], input: { playerId: string; wildItemInstanceId: string; targetPlayerId?: string }, tick: number, tickRate: number, mode: 'MANUAL' | 'AUTO', emit: EmitPickupEvent): WildUseResult {
  const duck = ducks.find((candidate) => candidate.playerId === input.playerId)
  const runtime = itemState.byPlayer.get(input.playerId)
  if (!duck || !runtime?.wildItem) return { ok: false, reason: 'NO_ITEM' }
  if (runtime.wildItem.instanceId !== input.wildItemInstanceId) return { ok: false, reason: 'ITEM_CHANGED' }
  const definition = getWildItem(runtime.wildItem.itemId)
  if (definition.behavior !== 'HELD') return { ok: false, reason: 'NOT_USEABLE' }
  const handler = HELD_HANDLERS[runtime.wildItem.itemId as keyof typeof HELD_HANDLERS]
  const result = handler({ itemState, runtime, duck, ducks, tick, tickRate, targetPlayerId: input.targetPlayerId, emit })
  if (!result.ok) return result
  const consumed = runtime.wildItem
  runtime.wildItem = null
  emit(mode === 'MANUAL' ? 'WILD_ITEM_USED' : 'WILD_ITEM_AUTO_USED', duck.playerId, result.targetPlayerId, { instanceId: consumed.instanceId, itemId: consumed.itemId })
  return result
}

function expireWildEffects(itemState: ItemRaceState, tick: number, emit: EmitPickupEvent) {
  for (const [playerId, runtime] of [...itemState.byPlayer].sort(([left], [right]) => left.localeCompare(right))) {
    if (runtime.wildBubbleAvailable && tick >= runtime.wildBubbleUntilTick) {
      runtime.wildBubbleAvailable = false
      emit('MINI_BUBBLE_EXPIRED', playerId, undefined, {})
    }
    if (runtime.wildFeatherAvailable && tick >= runtime.wildFeatherUntilTick) runtime.wildFeatherAvailable = false
    if (runtime.tailwindUntilTick > 0 && tick === runtime.tailwindUntilTick) emit('TAILWIND_ENDED', playerId, undefined, {})
    if (runtime.magnetUntilTick > 0 && tick === runtime.magnetUntilTick) emit('MAGNET_ENDED', playerId, undefined, {})
  }
}

export function applyRecordedWildInputs(itemState: ItemRaceState, ducks: ItemDuckState[], inputs: RecordedWildItemInput[], tick: number, tickRate: number, emit: EmitPickupEvent) {
  for (const input of inputs.filter((entry) => entry.authoritativeTick === tick).sort((left, right) => left.clientActionId.localeCompare(right.clientActionId))) {
    const result = activateWildItem(itemState, ducks, { playerId: input.playerId, wildItemInstanceId: input.wildItemInstanceId }, tick, tickRate, 'MANUAL', emit)
    emit('WILD_ITEM_MANUAL_INPUT', input.playerId, result.targetPlayerId, {
      instanceId: input.wildItemInstanceId,
      clientActionId: input.clientActionId,
      action: input.action,
      applied: result.ok,
      reason: result.reason,
    })
  }
}

export function tickPickupSystem(config: RaceConfig, track: RaceTrack, pickupState: PickupRaceState, itemState: ItemRaceState, ducks: Array<ItemDuckState & { previousProgress?: number }>, tick: number, tickRate: number, emit: EmitPickupEvent) {
  expireWildEffects(itemState, tick, emit)
  if (!pickupState.config.enabled && pickupState.pickups.length === 0 && pickupState.hazards.length === 0) return
  activateZones(track, pickupState, ducks, emit)
  collectPickups(config, pickupState, itemState, ducks, tick, tickRate, emit)
  resolveHazards(pickupState, itemState, ducks, tick, tickRate, emit)
}

export function snapshotPickupWorld(state: PickupRaceState) {
  return {
    pickups: state.pickups.map((pickup) => ({ id: pickup.id, type: pickup.type, progress: pickup.progress, lateralOffset: pickup.lateralOffset, state: pickup.state })),
    hazards: state.hazards.map((hazard) => ({ id: hazard.id, type: hazard.type, progress: hazard.progress, lateralOffset: hazard.lateralOffset, radius: hazard.radius })),
  }
}
