import type { RaceConfig, RaceEventType } from '../../../race-protocol/src'
import { ITEM_BALANCE } from '../items/config'
import type { AutoUseCandidate } from './types'
import type { ItemDuckState, ItemRaceState } from '../items/engine'
import { breakActiveSpeedBoost, firePrepRocket, slipstreamReady, triggerMenacePredatorRush, tryActivateBubbleShield, tryApplyPrepSpeedBoost } from '../items/engine'
import { resolveRocketTarget } from './evaluate'
import { buildRaceObjectiveContext } from './objective'
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
  executeMetadata: Record<string, unknown> = {},
  raceConfig?: RaceConfig,
): boolean {
  const runtime = runtimeFor(itemState, duck.playerId)
  if (tick < runtime.silencedUntilTick) return false
  switch (candidate.itemId) {
    case 'NITRO': {
      if (!hasUnused(runtime, 'NITRO')) return false
      const outcome = tryApplyPrepSpeedBoost(runtime, duck.playerId, 'NITRO', itemState.tuning.nitroSpeedMultiplier, ITEM_BALANCE.nitro.durationSeconds, tick, tickRate, emit, { autoReason: candidate.reason })
      if (outcome === 'ignored') return false
      runtime.usedItems.add('NITRO')
      return true
    }
    case 'DRAFT_FIN': {
      if (!hasUnused(runtime, 'DRAFT_FIN') || !slipstreamReady(runtime, tickRate, duck.progress)) return false
      const outcome = tryApplyPrepSpeedBoost(runtime, duck.playerId, 'DRAFT_FIN', ITEM_BALANCE.draftFin.speedMultiplier, ITEM_BALANCE.draftFin.durationSeconds, tick, tickRate, emit, {
        draftTarget: runtime.draftTargetPlayerId,
        autoReason: candidate.reason,
      })
      if (outcome === 'ignored') return false
      runtime.usedItems.add('DRAFT_FIN')
      return true
    }
    case 'PADDLE_BURST': {
      if (!hasUnused(runtime, 'PADDLE_BURST')) return false
      if (duck.progress < ITEM_BALANCE.paddleBurst.armProgress) return false
      const activeCount = ducks.filter((entry) => !entry.finished).length
      const isLateSprint = duck.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress
      if (!isLateSprint && duck.currentRank <= Math.ceil(activeCount / 2)) return false
      const outcome = tryApplyPrepSpeedBoost(runtime, duck.playerId, 'PADDLE_BURST', ITEM_BALANCE.paddleBurst.speedMultiplier, ITEM_BALANCE.paddleBurst.durationSeconds, tick, tickRate, emit, { autoReason: candidate.reason })
      if (outcome === 'ignored') return false
      runtime.usedItems.add('PADDLE_BURST')
      return true
    }
    case 'BUBBLE_SHIELD': {
      if (!hasUnused(runtime, 'BUBBLE_SHIELD')) return false
      const activated = tryActivateBubbleShield(runtime, duck.playerId, tick, tickRate, emit, { autoReason: candidate.reason })
      return activated
    }
    case 'HOMING_ROCKET': {
      if (!hasUnused(runtime, 'HOMING_ROCKET')) return false
      if (raceConfig) {
        const objective = buildRaceObjectiveContext(raceConfig)
        const evalCtx = {
          tick,
          tickRate,
          objective,
          itemState,
          pickupState: { hazards: [] } as never,
          ducks,
          playerId: duck.playerId,
          secondsUntilNextPickupZone: 999,
          prepAutoUseEnabled: true,
          wildAutoUseEnabled: false,
          ghostPlayerIds: itemState.ghostPlayerIds,
        }
        const resolvedTarget = resolveRocketTarget(evalCtx, 'PREP', candidate.targetPlayerId)
        if (!resolvedTarget) return false
        candidate.targetPlayerId = resolvedTarget
      } else if (!candidate.targetPlayerId) {
        return false
      }
      const target = ducks.find((entry) => entry.playerId === candidate.targetPlayerId)
      if (!target || target.finished) return false
      const fired = firePrepRocket(itemState, duck, target.playerId, tick, tickRate, emit, candidate.reason, executeMetadata)
      return fired
    }
    case 'BANANA': {
      if (!hasUnused(runtime, 'BANANA')) return false
      const progress = Math.max(0, duck.progress - ITEM_BALANCE.banana.dropBehindProgress)
      if (itemState.bananas.some((banana) => Math.abs(banana.progress - progress) < ITEM_BALANCE.banana.minimumTrapSpacing && Math.abs(banana.lateralOffset - duck.lateralOffset) < ITEM_BALANCE.banana.hitLateralRadius)) return false
      runtime.usedItems.add('BANANA')
      itemState.bananas.push({
        id: itemState.nextObjectId++,
        sourcePlayerId: duck.playerId,
        progress,
        lateralOffset: duck.lateralOffset,
        armedAtTick: tick + Math.round(ITEM_BALANCE.banana.armingSeconds * tickRate),
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
        && !itemState.ghostPlayerIds.has(target.playerId)
        && Math.abs(target.progress - duck.progress) <= ITEM_BALANCE.horn.progressRadius * 1.5
        && Math.abs(target.lateralOffset - duck.lateralOffset) <= ITEM_BALANCE.horn.lateralRadius * 1.5)
      if (nearby.length === 0) return false
      runtime.usedItems.add('QUACK_HORN')
      let slipstreamChargeDestroyedTicks = 0
      for (const target of nearby.sort((left, right) => left.playerId.localeCompare(right.playerId))) {
        const defense = runtimeFor(itemState, target.playerId)
        let push = ITEM_BALANCE.horn.lateralPush
        let shove = ITEM_BALANCE.horn.lateralShove
        if (defense.loadoutCombo === 'FORTRESS') {
          push *= 0.75
          shove *= 0.75
        }
        if (defense.shockAbsorberAvailable) {
          defense.shockAbsorberAvailable = false
          push *= ITEM_BALANCE.shockAbsorber.hornPushMultiplier
          shove *= ITEM_BALANCE.shockAbsorber.hornShoveMultiplier
          emit('SHOCK_ABSORBER_PROC', target.playerId, duck.playerId, { mitigated: 'QUACK_HORN' })
        }
        slipstreamChargeDestroyedTicks += defense.draftSlipstreamTicks
        defense.draftSlipstreamTicks = 0
        defense.draftTargetPlayerId = null

        // EMP: Dispel active speed boosts and silence item usage for 3.0s
        breakActiveSpeedBoost(defense, tick, tickRate, emit, duck.playerId, target.playerId, 'QUACK_HORN')
        defense.silencedUntilTick = Math.max(defense.silencedUntilTick, tick + Math.round(ITEM_BALANCE.horn.silenceDurationSeconds * tickRate))
        emit('ITEM_SILENCED', target.playerId, duck.playerId, {
          durationSeconds: ITEM_BALANCE.horn.silenceDurationSeconds,
          untilTick: defense.silencedUntilTick,
          source: 'QUACK_HORN',
        })

        const direction = target.lateralOffset === duck.lateralOffset
          ? (target.playerId.localeCompare(duck.playerId) < 0 ? -1 : 1)
          : Math.sign(target.lateralOffset - duck.lateralOffset)
        target.lateralVelocity += direction * push
        target.lateralOffset = Math.max(-0.95, Math.min(0.95, target.lateralOffset + direction * shove))
      }
      if (runtime.loadoutCombo === 'MENACE') {
        triggerMenacePredatorRush(itemState, duck.playerId, tick, tickRate, emit, 'QUACK_HORN')
      }
      emit('HORN_USED', duck.playerId, undefined, {
        targets: nearby.map((target) => target.playerId),
        autoReason: candidate.reason,
        slipstreamChargeDestroyedTicks,
        slipstreamChargeDestroyedSeconds: slipstreamChargeDestroyedTicks / tickRate,
        ducksHit: nearby.length,
        silencedSeconds: ITEM_BALANCE.horn.silenceDurationSeconds,
      })
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
  if (candidate.action !== 'DISCARD' && tick < runtime.silencedUntilTick) return false

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
    { playerId: duck.playerId, wildItemInstanceId: candidate.wildItemInstanceId, targetPlayerId: candidate.targetPlayerId },
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
  executeMetadata: Record<string, unknown> = {},
  raceConfig?: RaceConfig,
): boolean {
  const duck = ducks.find((entry) => entry.playerId === candidate.playerId)
  if (!duck) return false
  if (candidate.source === 'PREP') return executePrepAction(candidate, itemState, duck, ducks, tick, tickRate, emitItem, executeMetadata, raceConfig)
  return executeWildAction(candidate, itemState, ducks, tick, tickRate, emitPickup)
}
