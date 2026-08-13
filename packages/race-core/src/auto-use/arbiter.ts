import type { RaceEventType, RaceConfig } from '../../../race-protocol/src'
import { createRaceRng } from '../rng'
import type { RaceTrack } from '../track'
import type { ItemDuckState, ItemRaceState } from '../items/engine'
import type { PickupRaceState } from '../pickups/engine'
import { AUTO_USE_CONFIG } from './config'
import { buildRaceObjectiveContext } from './objective'
import { decideAutoItemAction, revalidatePendingAction } from './evaluate'
import { executeAutoItemAction } from './execute'

type EmitItemEvent = (type: RaceEventType, sourcePlayerId?: string, targetPlayerId?: string, metadata?: Record<string, unknown>) => void
type EmitPickupEvent = (type: RaceEventType, sourcePlayerId?: string, targetPlayerId?: string, metadata?: Record<string, unknown>) => void

function secondsUntilNextPickupZone(duck: ItemDuckState, track: RaceTrack) {
  const upcoming = track.pickupZones
    .map((zone) => (zone.startProgress + zone.endProgress) / 2)
    .filter((center) => center > duck.progress + 0.001)
    .sort((left, right) => left - right)[0]
  if (upcoming === undefined) return 999
  return Math.max(0, (upcoming - duck.progress) * 60)
}

function reactionDelayTicks(config: RaceConfig, playerId: string, tick: number, tickRate: number) {
  const rng = createRaceRng(config.seed, `auto-use-delay:${config.raceId}:${playerId}:${tick}`)
  return Math.round(rng.range(AUTO_USE_CONFIG.reactionDelayMinSeconds, AUTO_USE_CONFIG.reactionDelayMaxSeconds) * tickRate)
}

function cooldownTicks(config: RaceConfig, playerId: string, tick: number, tickRate: number) {
  const rng = createRaceRng(config.seed, `auto-use-cooldown:${config.raceId}:${playerId}:${tick}`)
  return Math.round(rng.range(AUTO_USE_CONFIG.cooldownMinSeconds, AUTO_USE_CONFIG.cooldownMaxSeconds) * tickRate)
}

export interface AutoUseTickInput {
  config: RaceConfig
  track: RaceTrack
  itemState: ItemRaceState
  pickupState: PickupRaceState
  ducks: ItemDuckState[]
  tick: number
  tickRate: number
  prepAutoUseEnabled: boolean
  wildAutoUseEnabled: boolean
  emitItem: EmitItemEvent
  emitPickup: EmitPickupEvent
}

function finishAction(input: AutoUseTickInput, playerId: string, offensive: boolean) {
  const runtime = input.itemState.byPlayer.get(playerId)!
  runtime.lastItemUseTick = input.tick
  if (offensive) runtime.lastOffensiveUseTick = input.tick
  runtime.nextAutoActionTick = input.tick + cooldownTicks(input.config, playerId, input.tick, input.tickRate)
}

function processDuckAutoUse(input: AutoUseTickInput, duck: ItemDuckState) {
  if (duck.finished) return
  if (!input.prepAutoUseEnabled && !input.wildAutoUseEnabled && !input.itemState.byPlayer.get(duck.playerId)!.pendingAutoAction) return
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  const evalCtx = {
    tick: input.tick,
    tickRate: input.tickRate,
    objective: buildRaceObjectiveContext(input.config),
    itemState: input.itemState,
    pickupState: input.pickupState,
    ducks: input.ducks,
    playerId: duck.playerId,
    secondsUntilNextPickupZone: secondsUntilNextPickupZone(duck, input.track),
    prepAutoUseEnabled: input.prepAutoUseEnabled,
    wildAutoUseEnabled: input.wildAutoUseEnabled,
  }

  if (runtime.pendingAutoAction && input.tick >= runtime.pendingAutoActionExecuteTick) {
    const pending = runtime.pendingAutoAction
    runtime.pendingAutoAction = null
    runtime.pendingAutoActionExecuteTick = 0
    if (revalidatePendingAction(evalCtx, pending)) {
      const executed = executeAutoItemAction(pending, input.itemState, input.ducks, input.tick, input.tickRate, input.emitItem, input.emitPickup)
      if (executed) {
        finishAction(input, duck.playerId, ['HOMING_ROCKET', 'BANANA', 'MINI_ROCKET', 'QUACK_HORN'].includes(String(pending.itemId)))
      }
    }
    return
  }

  if (runtime.pendingAutoAction || input.tick < runtime.nextAutoActionTick) return

  const onDecisionTick = input.tick >= runtime.nextAutoDecisionTick
  const decision = decideAutoItemAction(evalCtx)
  if (!decision) {
    if (onDecisionTick) runtime.nextAutoDecisionTick = input.tick + AUTO_USE_CONFIG.decisionIntervalTicks
    return
  }

  if (decision.bypassThreshold) {
    const executed = executeAutoItemAction(decision, input.itemState, input.ducks, input.tick, input.tickRate, input.emitItem, input.emitPickup)
    if (executed) finishAction(input, duck.playerId, ['HOMING_ROCKET', 'BANANA', 'MINI_ROCKET', 'QUACK_HORN'].includes(String(decision.itemId)))
    if (onDecisionTick) runtime.nextAutoDecisionTick = input.tick + AUTO_USE_CONFIG.decisionIntervalTicks
    return
  }

  if (!onDecisionTick) return
  runtime.nextAutoDecisionTick = input.tick + AUTO_USE_CONFIG.decisionIntervalTicks
  runtime.pendingAutoAction = decision
  runtime.pendingAutoActionExecuteTick = input.tick + reactionDelayTicks(input.config, duck.playerId, input.tick, input.tickRate)
}

export function tickAutoUseAI(input: AutoUseTickInput) {
  for (const duck of [...input.ducks].sort((left, right) => left.playerId.localeCompare(right.playerId))) {
    processDuckAutoUse(input, duck)
  }
}
