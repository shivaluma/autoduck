import type { RaceConfig, RaceEventType, RaceItemId } from '../../../race-protocol/src'
import { ITEM_BALANCE } from './config'
import { resolveIncomingRaceEffect, type ItemDefenseState } from './interactions'

export interface ItemDuckState {
  playerId: string
  progress: number
  lateralOffset: number
  lateralVelocity: number
  currentRank: number
  finished: boolean
}

export interface DuckItemRuntime extends ItemDefenseState {
  itemIds: RaceItemId[]
  usedItems: Set<RaceItemId>
  slowMultiplier: number
  slowUntilTick: number
  boostMultiplier: number
  boostUntilTick: number
}

export interface RocketRuntime {
  id: number
  sourcePlayerId: string
  targetPlayerId: string
  progress: number
  expiresAtTick: number
}

export interface BananaRuntime {
  id: number
  sourcePlayerId: string
  progress: number
  lateralOffset: number
  expiresAtTick: number
}

export interface ItemRaceState {
  byPlayer: Map<string, DuckItemRuntime>
  rockets: RocketRuntime[]
  bananas: BananaRuntime[]
  nextObjectId: number
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
        itemImmunityUntilTick: 0,
        rocketProtectionUntilTick: 0,
        slowMultiplier: 1,
        slowUntilTick: 0,
        boostMultiplier: 1,
        boostUntilTick: 0,
      }]
    })),
    rockets: [],
    bananas: [],
    nextObjectId: 1,
  }
}

function hasUnused(runtime: DuckItemRuntime, item: RaceItemId) {
  return runtime.itemIds.includes(item) && !runtime.usedItems.has(item)
}

function orderedActive(ducks: ItemDuckState[]) {
  return ducks.filter((duck) => !duck.finished).sort((left, right) => right.progress - left.progress || left.playerId.localeCompare(right.playerId))
}

function activateNitro(runtime: DuckItemRuntime, duck: ItemDuckState, ducks: ItemDuckState[], tick: number, tickRate: number, emit: EmitItemEvent) {
  if (!hasUnused(runtime, 'NITRO') || duck.progress < ITEM_BALANCE.nitro.armProgress) return
  const ahead = orderedActive(ducks).find((candidate) => candidate.progress > duck.progress)
  const shouldTrigger = duck.currentRank >= ITEM_BALANCE.nitro.triggerRank
    || Boolean(ahead && ahead.progress - duck.progress > ITEM_BALANCE.nitro.gapThreshold)
    || duck.progress >= ITEM_BALANCE.nitro.fallbackProgress
  if (!shouldTrigger) return
  runtime.usedItems.add('NITRO')
  runtime.boostMultiplier = ITEM_BALANCE.nitro.speedMultiplier
  runtime.boostUntilTick = tick + Math.round(ITEM_BALANCE.nitro.durationSeconds * tickRate)
  emit('NITRO_STARTED', duck.playerId, undefined, { untilTick: runtime.boostUntilTick })
}

function activateRocket(itemState: ItemRaceState, runtime: DuckItemRuntime, duck: ItemDuckState, ducks: ItemDuckState[], tick: number, tickRate: number, emit: EmitItemEvent) {
  if (!hasUnused(runtime, 'HOMING_ROCKET') || duck.progress < ITEM_BALANCE.rocket.armProgress || duck.progress > ITEM_BALANCE.rocket.disableProgress) return
  const target = orderedActive(ducks)
    .filter((candidate) => candidate.progress > duck.progress)
    .sort((left, right) => left.progress - right.progress || left.playerId.localeCompare(right.playerId))
    .find((candidate) => {
      const targetRuntime = itemState.byPlayer.get(candidate.playerId)!
      return candidate.progress - duck.progress <= ITEM_BALANCE.rocket.maximumTargetDistance && tick >= targetRuntime.rocketProtectionUntilTick
    })
  if (!target) return
  runtime.usedItems.add('HOMING_ROCKET')
  itemState.rockets.push({
    id: itemState.nextObjectId++, sourcePlayerId: duck.playerId, targetPlayerId: target.playerId,
    progress: duck.progress, expiresAtTick: tick + Math.round(ITEM_BALANCE.rocket.lifetimeSeconds * tickRate),
  })
  emit('ROCKET_FIRED', duck.playerId, target.playerId, {})
}

function activateBanana(itemState: ItemRaceState, runtime: DuckItemRuntime, duck: ItemDuckState, ducks: ItemDuckState[], tick: number, tickRate: number, emit: EmitItemEvent) {
  if (!hasUnused(runtime, 'BANANA') || duck.progress < ITEM_BALANCE.banana.armProgress) return
  const closeBehind = ducks.some((candidate) => !candidate.finished && candidate.progress < duck.progress && duck.progress - candidate.progress <= ITEM_BALANCE.banana.closeBehindDistance)
  if (!closeBehind && duck.progress < ITEM_BALANCE.banana.fallbackProgress) return
  const progress = Math.max(0, duck.progress - 0.003)
  if (itemState.bananas.some((banana) => Math.abs(banana.progress - progress) < ITEM_BALANCE.banana.minimumTrapSpacing)) return
  runtime.usedItems.add('BANANA')
  itemState.bananas.push({
    id: itemState.nextObjectId++, sourcePlayerId: duck.playerId, progress, lateralOffset: duck.lateralOffset,
    expiresAtTick: tick + Math.round(ITEM_BALANCE.banana.lifetimeSeconds * tickRate),
  })
  emit('BANANA_DROPPED', duck.playerId, undefined, { progress, lateralOffset: duck.lateralOffset })
}

function activateHorn(runtime: DuckItemRuntime, duck: ItemDuckState, ducks: ItemDuckState[], emit: EmitItemEvent) {
  if (!hasUnused(runtime, 'QUACK_HORN') || duck.progress < ITEM_BALANCE.horn.armProgress) return
  const nearby = ducks.filter((candidate) => candidate.playerId !== duck.playerId && !candidate.finished
    && Math.abs(candidate.progress - duck.progress) <= ITEM_BALANCE.horn.progressRadius
    && Math.abs(candidate.lateralOffset - duck.lateralOffset) <= ITEM_BALANCE.horn.lateralRadius)
  if (nearby.length === 0) return
  runtime.usedItems.add('QUACK_HORN')
  for (const target of nearby.sort((left, right) => left.playerId.localeCompare(right.playerId))) {
    const direction = target.lateralOffset === duck.lateralOffset
      ? (target.playerId.localeCompare(duck.playerId) < 0 ? -1 : 1)
      : Math.sign(target.lateralOffset - duck.lateralOffset)
    target.lateralVelocity += direction * ITEM_BALANCE.horn.lateralPush
  }
  emit('HORN_USED', duck.playerId, undefined, { targets: nearby.map((target) => target.playerId) })
}

export function applyItemSlow(runtime: DuckItemRuntime, multiplier: number, durationSeconds: number, tick: number, tickRate: number) {
  if (tick >= runtime.slowUntilTick || multiplier < runtime.slowMultiplier) {
    runtime.slowMultiplier = Math.max(ITEM_BALANCE.minimumSpeedMultiplier, multiplier)
    runtime.slowUntilTick = tick + Math.round(durationSeconds * tickRate)
  }
}

function updateRockets(itemState: ItemRaceState, ducks: ItemDuckState[], tick: number, tickRate: number, emit: EmitItemEvent) {
  const keep: RocketRuntime[] = []
  for (const rocket of itemState.rockets.sort((left, right) => left.id - right.id)) {
    const target = ducks.find((duck) => duck.playerId === rocket.targetPlayerId)
    if (!target || target.finished || tick >= rocket.expiresAtTick) {
      emit('ROCKET_EXPIRED', rocket.sourcePlayerId, rocket.targetPlayerId, {})
      continue
    }
    rocket.progress += ITEM_BALANCE.rocket.projectileSpeed / tickRate
    if (rocket.progress + ITEM_BALANCE.rocket.hitRadius < target.progress) {
      keep.push(rocket)
      continue
    }
    const defense = itemState.byPlayer.get(target.playerId)!
    const outcome = resolveIncomingRaceEffect(defense, 'ROCKET', tick, tickRate)
    if (outcome === 'HIT') {
      applyItemSlow(defense, ITEM_BALANCE.rocket.slowMultiplier, ITEM_BALANCE.rocket.slowDurationSeconds, tick, tickRate)
      emit('ROCKET_HIT', rocket.sourcePlayerId, target.playerId, {})
    } else if (outcome === 'BLOCKED_BUBBLE') {
      emit('BUBBLE_POPPED', target.playerId, rocket.sourcePlayerId, { blocked: 'ROCKET' })
      emit('ROCKET_BLOCKED', rocket.sourcePlayerId, target.playerId, { defense: 'BUBBLE_SHIELD' })
    } else {
      emit('ROCKET_BLOCKED', rocket.sourcePlayerId, target.playerId, { defense: 'IMMUNITY' })
    }
  }
  itemState.rockets = keep
}

function updateBananas(itemState: ItemRaceState, ducks: ItemDuckState[], tick: number, tickRate: number, emit: EmitItemEvent) {
  const keep: BananaRuntime[] = []
  for (const banana of itemState.bananas.sort((left, right) => left.id - right.id)) {
    if (tick >= banana.expiresAtTick) {
      emit('BANANA_EXPIRED', banana.sourcePlayerId, undefined, { id: banana.id })
      continue
    }
    const target = ducks.filter((duck) => !duck.finished && duck.playerId !== banana.sourcePlayerId)
      .sort((left, right) => left.playerId.localeCompare(right.playerId))
      .find((duck) => Math.abs(duck.progress - banana.progress) <= ITEM_BALANCE.banana.hitProgressRadius
        && Math.abs(duck.lateralOffset - banana.lateralOffset) <= ITEM_BALANCE.banana.hitLateralRadius)
    if (!target) {
      keep.push(banana)
      continue
    }
    const defense = itemState.byPlayer.get(target.playerId)!
    const outcome = resolveIncomingRaceEffect(defense, 'BANANA', tick, tickRate)
    if (outcome === 'HIT') {
      applyItemSlow(defense, ITEM_BALANCE.banana.slowMultiplier, ITEM_BALANCE.banana.slowDurationSeconds, tick, tickRate)
      const direction = target.lateralOffset >= banana.lateralOffset ? 1 : -1
      target.lateralVelocity += direction * ITEM_BALANCE.banana.lateralSlip
      emit('BANANA_HIT', banana.sourcePlayerId, target.playerId, {})
    } else if (outcome === 'BLOCKED_BUBBLE') {
      emit('BUBBLE_POPPED', target.playerId, banana.sourcePlayerId, { blocked: 'BANANA' })
      emit('BANANA_BLOCKED', banana.sourcePlayerId, target.playerId, { defense: 'BUBBLE_SHIELD' })
    } else if (outcome === 'DODGED_FEATHER') {
      emit('FEATHER_DODGED', target.playerId, banana.sourcePlayerId, {})
      emit('BANANA_BLOCKED', banana.sourcePlayerId, target.playerId, { defense: 'FEATHER' })
    } else {
      emit('BANANA_BLOCKED', banana.sourcePlayerId, target.playerId, { defense: 'IMMUNITY' })
    }
  }
  itemState.bananas = keep
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
      runtime.boostMultiplier = 1
      emit('NITRO_ENDED', duck.playerId, undefined, {})
    }
    if (runtime.slowMultiplier < 1 && tick >= runtime.slowUntilTick) runtime.slowMultiplier = 1
    activateNitro(runtime, duck, ducks, tick, tickRate, emit)
    activateRocket(itemState, runtime, duck, ducks, tick, tickRate, emit)
    activateBanana(itemState, runtime, duck, ducks, tick, tickRate, emit)
    activateHorn(runtime, duck, ducks, emit)
  }
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
  if (tick < runtime.boostUntilTick) effects.push('NITRO')
  if (tick < runtime.slowUntilTick) effects.push('SLOWED')
  return effects
}
