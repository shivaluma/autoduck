import type { RaceEventType } from '../../../race-protocol/src'
import { ITEM_BALANCE } from '../items/config'
import type { AutoUseCandidate } from './types'
import type { ItemDuckState, ItemRaceState } from '../items/engine'
import { activateWildItem } from '../pickups/engine'

type EmitItemEvent = (type: RaceEventType, sourcePlayerId?: string, targetPlayerId?: string, metadata?: Record<string, unknown>) => void
type EmitPickupEvent = (type: RaceEventType, sourcePlayerId?: string, targetPlayerId?: string, metadata?: Record<string, unknown>) => void

function runtimeFor(itemState: ItemRaceState, playerId: string) {
  return itemState.byPlayer.get(playerId)!
}

function hasUnused(runtime: ReturnType<typeof runtimeFor>, item: string) {
  return runtime.itemIds.includes(item as never) && !runtime.usedItems.has(item as never)
}

export function executePrepAction(
  candidate: AutoUseCandidate,
  itemState: ItemRaceState,
  duck: ItemDuckState,
  ducks: ItemDuckState[],
  tick: number,
  tickRate: number,
  emit: EmitItemEvent,
): boolean {
  const runtime = runtimeFor(itemState, duck.playerId)
  switch (candidate.itemId) {
    case 'NITRO': {
      if (!hasUnused(runtime, 'NITRO')) return false
      runtime.usedItems.add('NITRO')
      runtime.boostMultiplier = itemState.tuning.nitroSpeedMultiplier
      runtime.boostUntilTick = tick + Math.round(ITEM_BALANCE.nitro.durationSeconds * tickRate)
      emit('NITRO_STARTED', duck.playerId, undefined, { untilTick: runtime.boostUntilTick, autoReason: candidate.reason })
      return true
    }
    case 'HOMING_ROCKET': {
      if (!hasUnused(runtime, 'HOMING_ROCKET') || !candidate.targetPlayerId) return false
      const target = ducks.find((entry) => entry.playerId === candidate.targetPlayerId)
      if (!target || target.finished) return false
      runtime.usedItems.add('HOMING_ROCKET')
      itemState.rockets.push({
        id: itemState.nextObjectId++,
        sourcePlayerId: duck.playerId,
        targetPlayerId: target.playerId,
        progress: duck.progress,
        expiresAtTick: tick + Math.round(ITEM_BALANCE.rocket.lifetimeSeconds * tickRate),
        kind: 'PREP',
        speedPerSecond: ITEM_BALANCE.rocket.projectileSpeed,
        hitRadius: ITEM_BALANCE.rocket.hitRadius,
        slowMultiplier: itemState.tuning.rocketSlowMultiplier,
        slowDurationSeconds: ITEM_BALANCE.rocket.slowDurationSeconds,
        retargeted: false,
      })
      emit('ROCKET_FIRED', duck.playerId, target.playerId, { autoReason: candidate.reason })
      return true
    }
    case 'BANANA': {
      if (!hasUnused(runtime, 'BANANA')) return false
      const progress = Math.max(0, duck.progress - 0.003)
      if (itemState.bananas.some((banana) => Math.abs(banana.progress - progress) < ITEM_BALANCE.banana.minimumTrapSpacing)) return false
      runtime.usedItems.add('BANANA')
      itemState.bananas.push({
        id: itemState.nextObjectId++,
        sourcePlayerId: duck.playerId,
        progress,
        lateralOffset: duck.lateralOffset,
        expiresAtTick: tick + Math.round(ITEM_BALANCE.banana.lifetimeSeconds * tickRate),
        kind: 'PREP',
        hitProgressRadius: ITEM_BALANCE.banana.hitProgressRadius,
        hitLateralRadius: ITEM_BALANCE.banana.hitLateralRadius,
        progressKnockback: itemState.tuning.bananaKnockbackMultiplier * ITEM_BALANCE.banana.progressKnockback,
        lateralSlip: ITEM_BALANCE.banana.lateralSlip,
      })
      emit('BANANA_DROPPED', duck.playerId, undefined, { progress, lateralOffset: duck.lateralOffset, autoReason: candidate.reason })
      return true
    }
    case 'QUACK_HORN': {
      if (!hasUnused(runtime, 'QUACK_HORN')) return false
      const nearby = ducks.filter((target) => target.playerId !== duck.playerId && !target.finished
        && Math.abs(target.progress - duck.progress) <= ITEM_BALANCE.horn.progressRadius * 1.5
        && Math.abs(target.lateralOffset - duck.lateralOffset) <= ITEM_BALANCE.horn.lateralRadius * 1.5)
      if (nearby.length === 0) return false
      runtime.usedItems.add('QUACK_HORN')
      for (const target of nearby.sort((left, right) => left.playerId.localeCompare(right.playerId))) {
        const direction = target.lateralOffset === duck.lateralOffset
          ? (target.playerId.localeCompare(duck.playerId) < 0 ? -1 : 1)
          : Math.sign(target.lateralOffset - duck.lateralOffset)
        target.lateralVelocity += direction * ITEM_BALANCE.horn.lateralPush
      }
      emit('HORN_USED', duck.playerId, undefined, { targets: nearby.map((target) => target.playerId), autoReason: candidate.reason })
      return true
    }
    default:
      return false
  }
}

export function executeWildAction(
  candidate: AutoUseCandidate,
  itemState: ItemRaceState,
  ducks: ItemDuckState[],
  tick: number,
  tickRate: number,
  emit: EmitPickupEvent,
): boolean {
  const duck = ducks.find((entry) => entry.playerId === candidate.playerId)
  if (!duck || !candidate.wildItemInstanceId) return false
  const runtime = runtimeFor(itemState, duck.playerId)

  if (candidate.action === 'DISCARD') {
    if (!runtime.wildItem || runtime.wildItem.instanceId !== candidate.wildItemInstanceId) return false
    const consumed = runtime.wildItem
    runtime.wildItem = null
    emit('WILD_ITEM_AUTO_USED', duck.playerId, undefined, {
      instanceId: consumed.instanceId,
      itemId: consumed.itemId,
      discarded: true,
      forfeited: consumed.itemId === 'MINI_ROCKET' && duck.currentRank === 1,
      autoReason: candidate.reason,
    })
    return true
  }

  const result = activateWildItem(
    itemState,
    ducks,
    { playerId: duck.playerId, wildItemInstanceId: candidate.wildItemInstanceId },
    tick,
    tickRate,
    'AUTO',
    (type, source, target, metadata = {}) => emit(type, source, target, { ...metadata, autoReason: candidate.reason }),
  )
  return result.ok
}

export function executeAutoItemAction(
  candidate: AutoUseCandidate,
  itemState: ItemRaceState,
  ducks: ItemDuckState[],
  tick: number,
  tickRate: number,
  emitItem: EmitItemEvent,
  emitPickup: EmitPickupEvent,
): boolean {
  const duck = ducks.find((entry) => entry.playerId === candidate.playerId)
  if (!duck) return false
  if (candidate.source === 'PREP') return executePrepAction(candidate, itemState, duck, ducks, tick, tickRate, emitItem)
  return executeWildAction(candidate, itemState, ducks, tick, tickRate, emitPickup)
}
