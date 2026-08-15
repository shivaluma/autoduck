import type { RaceConfig, RaceEventType, RaceItemId, RaceItemTuning, WildItemId } from '../../../race-protocol/src'
import { ghostPlayerIdsFromConfig } from '../ghost'
import { ITEM_BALANCE } from './config'
import { resolveIncomingRaceEffect, type ItemDefenseState } from './interactions'

export interface ItemDuckState {
  playerId: string
  progress: number
  previousProgress?: number
  lateralOffset: number
  lateralVelocity: number
  currentRank: number
  finished: boolean
}

import type { AutoUseCandidate } from '../auto-use/types'

export interface DuckItemRuntime extends ItemDefenseState {
  itemIds: RaceItemId[]
  usedItems: Set<RaceItemId>
  slowMultiplier: number
  slowUntilTick: number
  boostMultiplier: number
  boostUntilTick: number
  wildItem: { instanceId: string; itemId: WildItemId; acquiredAtTick: number } | null
  regularPickupCount: number
  wildBubbleAvailable: boolean
  wildBubbleUntilTick: number
  wildFeatherAvailable: boolean
  wildFeatherUntilTick: number
  tailwindUntilTick: number
  magnetUntilTick: number
  lastItemUseTick: number
  nextAutoDecisionTick: number
  nextAutoActionTick: number
  pendingAutoAction: AutoUseCandidate | null
  pendingAutoActionExecuteTick: number
  lastOffensiveUseTick: number
  shockAbsorberAvailable: boolean
  draftSlipstreamTicks: number
  draftTargetPlayerId: string | null
  activeSpeedItemId: RaceItemId | null
  queuedSpeedBoost: { multiplier: number; durationSeconds: number; itemId: RaceItemId } | null
  boostStartedAtTick: number
  reactiveRocketVisibleSinceTick: number | null
  reactiveBananaVisibleSinceTick: number | null
}

const SPEED_BOOST_PRIORITY: Partial<Record<RaceItemId, number>> = {
  NITRO: 3,
  DRAFT_FIN: 2,
  PADDLE_BURST: 1,
}

export type BoostBreakSource = 'ROCKET' | 'MINI_ROCKET' | 'BANANA' | 'WILD_BANANA'

export interface RocketRuntime {
  id: number
  sourcePlayerId: string
  targetPlayerId: string
  progress: number
  spawnedAtTick: number
  expiresAtTick: number
  kind: 'PREP' | 'WILD'
  speedPerSecond: number
  hitRadius: number
  slowMultiplier: number
  slowDurationSeconds: number
  retargeted: boolean
  launchAtTick: number
}

export interface BananaRuntime {
  id: number
  sourcePlayerId: string
  progress: number
  lateralOffset: number
  armedAtTick: number
  expiresAtTick: number
  kind: 'PREP' | 'WILD'
  hitProgressRadius: number
  hitLateralRadius: number
  progressKnockback: number
  lateralSlip: number
}

export interface ItemRaceState {
  byPlayer: Map<string, DuckItemRuntime>
  rockets: RocketRuntime[]
  bananas: BananaRuntime[]
  nextObjectId: number
  tuning: Required<RaceItemTuning>
  ghostPlayerIds: Set<string>
}

type EmitItemEvent = (type: RaceEventType, sourcePlayerId?: string, targetPlayerId?: string, metadata?: Record<string, unknown>) => void

export function createItemRaceState(config: RaceConfig): ItemRaceState {
  const loadoutByPlayer = new Map(config.loadouts.map((loadout) => [loadout.playerId, loadout.itemIds]))
  return {
    byPlayer: new Map(config.players.map((player) => {
      const itemIds = [...(loadoutByPlayer.get(player.playerId) ?? [])]
      return [player.playerId, {
        itemIds,
        usedItems: new Set<RaceItemId>(),
        bubbleAvailable: itemIds.includes('BUBBLE_SHIELD'),
        featherAvailable: itemIds.includes('FEATHER'),
        shockAbsorberAvailable: itemIds.includes('SHOCK_ABSORBER'),
        itemImmunityUntilTick: 0,
        rocketProtectionUntilTick: 0,
        slowMultiplier: 1,
        slowUntilTick: 0,
        boostMultiplier: 1,
        boostUntilTick: 0,
        wildItem: null,
        regularPickupCount: 0,
        wildBubbleAvailable: false,
        wildBubbleUntilTick: 0,
        wildFeatherAvailable: false,
        wildFeatherUntilTick: 0,
        tailwindUntilTick: 0,
        magnetUntilTick: 0,
        lastItemUseTick: 0,
        nextAutoDecisionTick: 0,
        nextAutoActionTick: 0,
        pendingAutoAction: null,
        pendingAutoActionExecuteTick: 0,
        lastOffensiveUseTick: 0,
        draftSlipstreamTicks: 0,
        draftTargetPlayerId: null,
        activeSpeedItemId: null,
        queuedSpeedBoost: null,
        boostStartedAtTick: 0,
        reactiveRocketVisibleSinceTick: null,
        reactiveBananaVisibleSinceTick: null,
      }]
    })),
    rockets: [],
    bananas: [],
    nextObjectId: 1,
    tuning: {
      nitroSpeedMultiplier: config.itemTuning?.nitroSpeedMultiplier ?? ITEM_BALANCE.nitro.speedMultiplier,
      rocketSlowMultiplier: config.itemTuning?.rocketSlowMultiplier ?? ITEM_BALANCE.rocket.slowMultiplier,
      bananaKnockbackMultiplier: config.itemTuning?.bananaKnockbackMultiplier ?? 1,
      bananaSlowMultiplier: config.itemTuning?.bananaSlowMultiplier ?? 1,
    },
    ghostPlayerIds: ghostPlayerIdsFromConfig(config),
  }
}

export function applyItemSlow(runtime: DuckItemRuntime, multiplier: number, durationSeconds: number, tick: number, tickRate: number) {
  if (tick >= runtime.slowUntilTick || multiplier < runtime.slowMultiplier) {
    runtime.slowMultiplier = Math.max(ITEM_BALANCE.minimumSpeedMultiplier, multiplier)
    runtime.slowUntilTick = tick + Math.round(durationSeconds * tickRate)
  }
}

export function applyItemBoost(runtime: DuckItemRuntime, multiplier: number, durationSeconds: number, tick: number, tickRate: number) {
  runtime.boostMultiplier = Math.min(ITEM_BALANCE.maximumSpeedMultiplier, multiplier)
  runtime.boostStartedAtTick = tick
  runtime.boostUntilTick = tick + Math.round(durationSeconds * tickRate)
}

const SPEED_START_EVENT: Partial<Record<RaceItemId, RaceEventType>> = {
  NITRO: 'NITRO_STARTED',
  DRAFT_FIN: 'DRAFT_FIN_STARTED',
  PADDLE_BURST: 'PADDLE_BURST_STARTED',
}

const SPEED_END_EVENT: Partial<Record<RaceItemId, RaceEventType>> = {
  NITRO: 'NITRO_ENDED',
  DRAFT_FIN: 'DRAFT_FIN_ENDED',
  PADDLE_BURST: 'PADDLE_BURST_ENDED',
}

export function breakActiveSpeedBoost(
  runtime: DuckItemRuntime,
  tick: number,
  tickRate: number,
  emit: EmitItemEvent,
  sourcePlayerId: string,
  targetPlayerId: string,
  breakSource: BoostBreakSource,
) {
  if (tick >= runtime.boostUntilTick || runtime.boostMultiplier <= 1) return
  const ended = runtime.activeSpeedItemId
  const boostMultiplier = runtime.boostMultiplier
  const remainingBoostTicks = Math.max(0, runtime.boostUntilTick - tick)
  const originalBoostTicks = Math.max(1, runtime.boostUntilTick - runtime.boostStartedAtTick)
  const fractionDenied = remainingBoostTicks / originalBoostTicks
  runtime.boostMultiplier = 1
  runtime.boostUntilTick = tick
  runtime.boostStartedAtTick = tick
  runtime.activeSpeedItemId = null
  runtime.queuedSpeedBoost = null
  if (ended && SPEED_END_EVENT[ended]) emit(SPEED_END_EVENT[ended]!, targetPlayerId, sourcePlayerId, { broken: true, consumedSeconds: remainingBoostTicks / tickRate })
  emit('BOOST_BROKEN', targetPlayerId, sourcePlayerId, {
    endedItem: ended ?? null,
    remainingBoostTicks,
    originalBoostTicks,
    boostMultiplier,
    fractionDenied,
    breakSource,
  })
}

export function tryApplyPrepSpeedBoost(
  runtime: DuckItemRuntime,
  duckId: string,
  itemId: RaceItemId,
  multiplier: number,
  durationSeconds: number,
  tick: number,
  tickRate: number,
  emit: EmitItemEvent,
  metadata: Record<string, unknown> = {},
): 'applied' | 'queued' | 'ignored' {
  const startEvent = SPEED_START_EVENT[itemId]
  if (!startEvent) return 'applied'
  if (tick < runtime.boostUntilTick && runtime.boostMultiplier > 1) {
    const incoming = { multiplier, durationSeconds, itemId }
    const incomingPriority = SPEED_BOOST_PRIORITY[itemId] ?? 0
    const existing = runtime.queuedSpeedBoost
    if (!existing) {
      runtime.queuedSpeedBoost = incoming
      emit('SPEED_BOOST_QUEUED', duckId, undefined, { itemId, durationSeconds, multiplier, replacedPrevious: false })
      return 'queued'
    }
    const existingPriority = SPEED_BOOST_PRIORITY[existing.itemId] ?? 0
    if (incomingPriority > existingPriority) {
      runtime.queuedSpeedBoost = incoming
      emit('SPEED_BOOST_QUEUED', duckId, undefined, { itemId, durationSeconds, multiplier, replacedPrevious: true, replacedItemId: existing.itemId })
      return 'queued'
    }
    return 'ignored'
  }
  applyItemBoost(runtime, multiplier, durationSeconds, tick, tickRate)
  runtime.activeSpeedItemId = itemId
  emit(startEvent, duckId, undefined, { untilTick: runtime.boostUntilTick, durationSeconds, multiplier, ...metadata })
  return 'applied'
}

function finishSpeedBoost(runtime: DuckItemRuntime, duckId: string, tick: number, tickRate: number, emit: EmitItemEvent) {
  const ended = runtime.activeSpeedItemId
  const consumedTicks = Math.max(0, tick - runtime.boostStartedAtTick)
  runtime.boostMultiplier = 1
  runtime.activeSpeedItemId = null
  if (ended && SPEED_END_EVENT[ended]) {
    emit(SPEED_END_EVENT[ended]!, duckId, undefined, { consumedSeconds: consumedTicks / tickRate, natural: true })
  }
  const queued = runtime.queuedSpeedBoost
  if (!queued) return
  runtime.queuedSpeedBoost = null
  applyItemBoost(runtime, queued.multiplier, queued.durationSeconds, tick, tickRate)
  runtime.activeSpeedItemId = queued.itemId
  const startEvent = SPEED_START_EVENT[queued.itemId]
  if (startEvent) {
    emit(startEvent, duckId, undefined, {
      untilTick: runtime.boostUntilTick,
      durationSeconds: queued.durationSeconds,
      multiplier: queued.multiplier,
      queued: true,
    })
  }
}

function updateSlipstreamTracking(itemState: ItemRaceState, ducks: ItemDuckState[]) {
  for (const duck of ducks) {
    if (duck.finished) continue
    const runtime = itemState.byPlayer.get(duck.playerId)!
    const ahead = ducks
      .filter((candidate) => !candidate.finished && candidate.progress > duck.progress)
      .sort((left, right) => left.progress - right.progress || left.playerId.localeCompare(right.playerId))[0]
    if (!ahead) {
      runtime.draftSlipstreamTicks = 0
      runtime.draftTargetPlayerId = null
      continue
    }
    const gap = ahead.progress - duck.progress
    const lateral = Math.abs(ahead.lateralOffset - duck.lateralOffset)
    if (gap <= ITEM_BALANCE.draftFin.maxGap && lateral <= ITEM_BALANCE.draftFin.lateralRadius) {
      runtime.draftSlipstreamTicks += 1
      runtime.draftTargetPlayerId = ahead.playerId
    } else {
      runtime.draftSlipstreamTicks = 0
      runtime.draftTargetPlayerId = null
    }
  }
}

export function slipstreamReady(runtime: DuckItemRuntime, tickRate: number) {
  return runtime.draftSlipstreamTicks >= Math.round(ITEM_BALANCE.draftFin.holdSeconds * tickRate)
}

function bananaTouches(duck: ItemDuckState, banana: BananaRuntime) {
  const previous = duck.previousProgress ?? duck.progress
  const minimum = Math.min(previous, duck.progress) - banana.hitProgressRadius
  const maximum = Math.max(previous, duck.progress) + banana.hitProgressRadius
  if (banana.progress < minimum || banana.progress > maximum) return false
  return Math.abs(duck.lateralOffset - banana.lateralOffset) <= banana.hitLateralRadius
}

export function firePrepRocket(
  itemState: ItemRaceState,
  source: ItemDuckState,
  targetPlayerId: string,
  tick: number,
  tickRate: number,
  emit: EmitItemEvent,
  autoReason?: string,
  metadata: Record<string, unknown> = {},
) {
  const runtime = itemState.byPlayer.get(source.playerId)!
  if (runtime.usedItems.has('HOMING_ROCKET')) return false
  if (itemState.ghostPlayerIds.has(targetPlayerId)) return false
  const target = itemState.byPlayer.has(targetPlayerId)
  if (!target) return false
  itemState.rockets.push({
    id: itemState.nextObjectId++,
    sourcePlayerId: source.playerId,
    targetPlayerId,
    progress: source.progress,
    spawnedAtTick: tick,
    launchAtTick: tick,
    expiresAtTick: tick + Math.round(ITEM_BALANCE.rocket.lifetimeSeconds * tickRate),
    kind: 'PREP',
    speedPerSecond: ITEM_BALANCE.rocket.projectileSpeed,
    hitRadius: ITEM_BALANCE.rocket.hitRadius,
    slowMultiplier: itemState.tuning.rocketSlowMultiplier,
    slowDurationSeconds: ITEM_BALANCE.rocket.slowDurationSeconds,
    retargeted: false,
  })
  runtime.usedItems.add('HOMING_ROCKET')
  emit('ROCKET_FIRED', source.playerId, targetPlayerId, { autoReason, ...metadata })
  return true
}

function updateRockets(itemState: ItemRaceState, ducks: ItemDuckState[], tick: number, tickRate: number, emit: EmitItemEvent) {
  const keep: RocketRuntime[] = []
  for (const rocket of itemState.rockets.sort((left, right) => left.id - right.id)) {
    let target = ducks.find((duck) => duck.playerId === rocket.targetPlayerId)
    if (rocket.kind === 'WILD' && (!target || target.finished) && !rocket.retargeted && tick < rocket.expiresAtTick) {
      target = ducks.filter((duck) => !duck.finished && duck.playerId !== rocket.sourcePlayerId && duck.progress > rocket.progress)
        .filter((duck) => !itemState.ghostPlayerIds.has(duck.playerId))
        .filter((duck) => tick >= itemState.byPlayer.get(duck.playerId)!.rocketProtectionUntilTick)
        .sort((left, right) => left.progress - right.progress || left.playerId.localeCompare(right.playerId))[0]
      if (target) {
        rocket.targetPlayerId = target.playerId
        rocket.retargeted = true
      }
    }
    const expiredType = rocket.kind === 'WILD' ? 'MINI_ROCKET_EXPIRED' : 'ROCKET_EXPIRED'
    if (!target || target.finished || tick >= rocket.expiresAtTick) {
      emit(expiredType, rocket.sourcePlayerId, rocket.targetPlayerId, {})
      continue
    }
    const launchAtTick = rocket.launchAtTick
    if (tick < launchAtTick) {
      keep.push(rocket)
      continue
    }
    if (tick === launchAtTick && launchAtTick > rocket.spawnedAtTick) {
      const source = ducks.find((duck) => duck.playerId === rocket.sourcePlayerId)
      if (source) rocket.progress = source.progress
    }
    rocket.progress += rocket.speedPerSecond / tickRate
    const armingTicks = ITEM_BALANCE.rocket.armingTicks
    if (tick < launchAtTick + armingTicks || rocket.progress + rocket.hitRadius < target.progress) {
      keep.push(rocket)
      continue
    }
    const defense = itemState.byPlayer.get(target.playerId)!
    const incoming = rocket.kind === 'WILD' ? 'MINI_ROCKET' : 'ROCKET'
    const outcome = resolveIncomingRaceEffect(defense, incoming, tick, tickRate)
    const hitType = rocket.kind === 'WILD' ? 'MINI_ROCKET_HIT' : 'ROCKET_HIT'
    const blockedType = rocket.kind === 'WILD' ? 'MINI_ROCKET_BLOCKED' : 'ROCKET_BLOCKED'
    if (outcome === 'HIT') {
      breakActiveSpeedBoost(defense, tick, tickRate, emit, rocket.sourcePlayerId, target.playerId, rocket.kind === 'WILD' ? 'MINI_ROCKET' : 'ROCKET')
      let slowMultiplier = rocket.slowMultiplier
      let slowDurationSeconds = rocket.slowDurationSeconds
      if (defense.shockAbsorberAvailable) {
        defense.shockAbsorberAvailable = false
        slowMultiplier = ITEM_BALANCE.shockAbsorber.slowMultiplier
        slowDurationSeconds = ITEM_BALANCE.shockAbsorber.slowDurationSeconds
        emit('SHOCK_ABSORBER_PROC', target.playerId, rocket.sourcePlayerId, { mitigated: incoming })
      }
      applyItemSlow(defense, slowMultiplier, slowDurationSeconds, tick, tickRate)
      emit(hitType, rocket.sourcePlayerId, target.playerId, {})
    } else if (outcome === 'BLOCKED_MINI_BUBBLE') {
      emit('MINI_BUBBLE_BLOCKED', target.playerId, rocket.sourcePlayerId, { blocked: incoming })
      emit(blockedType, rocket.sourcePlayerId, target.playerId, { defense: 'MINI_BUBBLE' })
    } else if (outcome === 'BLOCKED_BUBBLE') {
      emit('BUBBLE_POPPED', target.playerId, rocket.sourcePlayerId, { blocked: 'ROCKET' })
      emit(blockedType, rocket.sourcePlayerId, target.playerId, { defense: 'BUBBLE_SHIELD' })
    } else {
      emit(blockedType, rocket.sourcePlayerId, target.playerId, { defense: 'IMMUNITY' })
    }
  }
  itemState.rockets = keep
}

function updateBananas(itemState: ItemRaceState, ducks: ItemDuckState[], tick: number, tickRate: number, emit: EmitItemEvent) {
  const keep: BananaRuntime[] = []
  for (const banana of itemState.bananas.sort((left, right) => left.id - right.id)) {
    if (tick >= banana.expiresAtTick) {
      emit(banana.kind === 'WILD' ? 'WILD_BANANA_EXPIRED' : 'BANANA_EXPIRED', banana.sourcePlayerId, undefined, { id: banana.id })
      continue
    }
    if (tick < banana.armedAtTick) {
      keep.push(banana)
      continue
    }
    const target = ducks.filter((duck) => !duck.finished && duck.playerId !== banana.sourcePlayerId)
      .sort((left, right) => left.playerId.localeCompare(right.playerId))
      .find((duck) => bananaTouches(duck, banana))
    if (!target) {
      keep.push(banana)
      continue
    }
    const defense = itemState.byPlayer.get(target.playerId)!
    const incoming = banana.kind === 'WILD' ? 'WILD_BANANA' : 'BANANA'
    const outcome = resolveIncomingRaceEffect(defense, incoming, tick, tickRate)
    const hitType = banana.kind === 'WILD' ? 'WILD_BANANA_HIT' : 'BANANA_HIT'
    const blockedType = banana.kind === 'WILD' ? 'WILD_BANANA_BLOCKED' : 'BANANA_BLOCKED'
    if (outcome === 'HIT') {
      breakActiveSpeedBoost(defense, tick, tickRate, emit, banana.sourcePlayerId, target.playerId, banana.kind === 'WILD' ? 'WILD_BANANA' : 'BANANA')
      const knockback = banana.progressKnockback
      target.progress = Math.max(0, target.progress - knockback)
      if (target.previousProgress !== undefined) target.previousProgress = Math.min(target.previousProgress, target.progress)
      const direction = target.lateralOffset >= banana.lateralOffset ? 1 : -1
      target.lateralVelocity += direction * banana.lateralSlip
      emit(hitType, banana.sourcePlayerId, target.playerId, { knockback })
    } else if (outcome === 'BLOCKED_MINI_BUBBLE') {
      emit('MINI_BUBBLE_BLOCKED', target.playerId, banana.sourcePlayerId, { blocked: incoming })
      emit(blockedType, banana.sourcePlayerId, target.playerId, { blocked: true, defense: 'MINI_BUBBLE' })
    } else if (outcome === 'BLOCKED_BUBBLE') {
      emit('BUBBLE_POPPED', target.playerId, banana.sourcePlayerId, { blocked: 'BANANA' })
      emit(blockedType, banana.sourcePlayerId, target.playerId, { blocked: true, defense: 'BUBBLE_SHIELD' })
    } else if (outcome === 'DODGED_WILD_FEATHER') {
      emit('WILD_FEATHER_DODGED', target.playerId, banana.sourcePlayerId, {})
      emit(blockedType, banana.sourcePlayerId, target.playerId, { blocked: true, defense: 'WILD_FEATHER' })
    } else if (outcome === 'DODGED_FEATHER') {
      emit('FEATHER_DODGED', target.playerId, banana.sourcePlayerId, {})
      emit('BANANA_BLOCKED', banana.sourcePlayerId, target.playerId, { defense: 'FEATHER' })
    } else {
      emit('BANANA_BLOCKED', banana.sourcePlayerId, target.playerId, { defense: 'IMMUNITY' })
    }
  }
  itemState.bananas = keep
}

export function snapshotItemWorld(itemState: ItemRaceState) {
  return {
    rockets: itemState.rockets.map((rocket) => ({
      id: rocket.id,
      sourcePlayerId: rocket.sourcePlayerId,
      targetPlayerId: rocket.targetPlayerId,
      progress: rocket.progress,
      kind: rocket.kind,
    })),
    bananas: itemState.bananas.map((banana) => ({
      id: banana.id,
      sourcePlayerId: banana.sourcePlayerId,
      progress: banana.progress,
      lateralOffset: banana.lateralOffset,
      kind: banana.kind,
    })),
  }
}

export function tickItemSystem(
  itemState: ItemRaceState,
  ducks: ItemDuckState[],
  tick: number,
  tickRate: number,
  emit: EmitItemEvent,
) {
  const stableDucks = [...ducks].sort((left, right) => left.playerId.localeCompare(right.playerId))
  for (const duck of stableDucks) {
    if (duck.finished) continue
    const runtime = itemState.byPlayer.get(duck.playerId)!
    if (runtime.boostMultiplier > 1 && tick >= runtime.boostUntilTick) {
      finishSpeedBoost(runtime, duck.playerId, tick, tickRate, emit)
    }
    if (runtime.slowMultiplier < 1 && tick >= runtime.slowUntilTick) runtime.slowMultiplier = 1
  }
  updateSlipstreamTracking(itemState, stableDucks)
  updateRockets(itemState, ducks, tick, tickRate, emit)
  updateBananas(itemState, ducks, tick, tickRate, emit)
}

export function itemSpeedMultiplier(runtime: DuckItemRuntime, tick: number) {
  const boost = tick < runtime.boostUntilTick ? runtime.boostMultiplier : 1
  const slow = tick < runtime.slowUntilTick ? runtime.slowMultiplier : 1
  return Math.min(ITEM_BALANCE.maximumSpeedMultiplier, boost) * Math.max(ITEM_BALANCE.minimumSpeedMultiplier, slow)
}

export function itemActiveEffects(runtime: DuckItemRuntime, tick: number) {
  const effects: string[] = []
  if (runtime.bubbleAvailable) effects.push('BUBBLE_SHIELD')
  if (runtime.featherAvailable) effects.push('FEATHER')
  if (runtime.shockAbsorberAvailable) effects.push('SHOCK_ABSORBER')
  if (tick < runtime.boostUntilTick && runtime.activeSpeedItemId) effects.push(runtime.activeSpeedItemId)
  else if (tick < runtime.boostUntilTick) effects.push('NITRO')
  if (tick < runtime.slowUntilTick) effects.push('SLOWED')
  if (runtime.wildBubbleAvailable && tick < runtime.wildBubbleUntilTick) effects.push('MINI_BUBBLE')
  if (runtime.wildFeatherAvailable && tick < runtime.wildFeatherUntilTick) effects.push('WILD_FEATHER')
  if (tick < runtime.tailwindUntilTick) effects.push('TAILWIND')
  if (tick < runtime.magnetUntilTick) effects.push('SLIPSTREAM_MAGNET')
  return effects
}
