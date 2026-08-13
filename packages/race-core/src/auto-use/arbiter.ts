import type { RaceEventType, RaceConfig } from '../../../race-protocol/src'
import { createRaceRng } from '../rng'
import type { RaceTrack } from '../track'
import type { ItemDuckState, ItemRaceState } from '../items/engine'
import type { PickupRaceState } from '../pickups/engine'
import { AUTO_USE_CONFIG } from './config'
import { buildRaceObjectiveContext } from './objective'
import type { RaceObjectiveContext } from './types'
import { decideOffensiveAutoItemAction, decideReactiveAutoItemAction, revalidatePendingAction } from './evaluate'
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

function offensiveItem(itemId: string) {
  return ['HOMING_ROCKET', 'BANANA', 'MINI_ROCKET', 'QUACK_HORN'].includes(itemId)
}

function finishAction(input: AutoUseTickInput, playerId: string, offensive: boolean) {
  const runtime = input.itemState.byPlayer.get(playerId)!
  runtime.lastItemUseTick = input.tick
  if (offensive) runtime.lastOffensiveUseTick = input.tick
  runtime.nextAutoActionTick = input.tick + cooldownTicks(input.config, playerId, input.tick, input.tickRate)
}

function buildEvalContext(input: AutoUseTickInput, duck: ItemDuckState, objective: RaceObjectiveContext) {
  return {
    tick: input.tick,
    tickRate: input.tickRate,
    objective,
    itemState: input.itemState,
    pickupState: input.pickupState,
    ducks: input.ducks,
    playerId: duck.playerId,
    secondsUntilNextPickupZone: secondsUntilNextPickupZone(duck, input.track),
    prepAutoUseEnabled: input.prepAutoUseEnabled,
    wildAutoUseEnabled: input.wildAutoUseEnabled,
  }
}

function executeDecision(input: AutoUseTickInput, duck: ItemDuckState, decision: NonNullable<ReturnType<typeof decideOffensiveAutoItemAction>>) {
  if (decision.bypassThreshold) {
    const executed = executeAutoItemAction(decision, input.itemState, input.ducks, input.tick, input.tickRate, input.emitItem, input.emitPickup)
    if (executed) finishAction(input, duck.playerId, offensiveItem(String(decision.itemId)))
    return
  }

  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  runtime.pendingAutoAction = decision
  runtime.pendingAutoActionExecuteTick = input.tick + reactionDelayTicks(input.config, duck.playerId, input.tick, input.tickRate)
}

function processPendingAction(input: AutoUseTickInput, duck: ItemDuckState, evalCtx: ReturnType<typeof buildEvalContext>) {
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  if (!runtime.pendingAutoAction || input.tick < runtime.pendingAutoActionExecuteTick) return false

  const pending = runtime.pendingAutoAction
  runtime.pendingAutoAction = null
  runtime.pendingAutoActionExecuteTick = 0
  if (revalidatePendingAction(evalCtx, pending)) {
    const executed = executeAutoItemAction(pending, input.itemState, input.ducks, input.tick, input.tickRate, input.emitItem, input.emitPickup)
    if (executed) finishAction(input, duck.playerId, offensiveItem(String(pending.itemId)))
  }
  return true
}

function processDuckExecute(input: AutoUseTickInput, duck: ItemDuckState, objective: RaceObjectiveContext) {
  if (duck.finished) return
  if (!input.prepAutoUseEnabled && !input.wildAutoUseEnabled) return
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  const evalCtx = buildEvalContext(input, duck, objective)

  if (processPendingAction(input, duck, evalCtx)) return
  if (runtime.pendingAutoAction || input.tick < runtime.nextAutoActionTick) return
  if (!input.wildAutoUseEnabled) return

  const reactive = decideReactiveAutoItemAction(evalCtx)
  if (!reactive) return
  executeDecision(input, duck, reactive)
}

function processDuckDecide(input: AutoUseTickInput, duck: ItemDuckState, objective: RaceObjectiveContext) {
  if (duck.finished) return
  if (!input.prepAutoUseEnabled && !input.wildAutoUseEnabled) return
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  if (runtime.pendingAutoAction || input.tick < runtime.nextAutoActionTick) return

  const onDecisionTick = input.tick >= runtime.nextAutoDecisionTick
  const evalCtx = buildEvalContext(input, duck, objective)
  const decision = decideOffensiveAutoItemAction(evalCtx)
  if (!decision) {
    if (onDecisionTick) runtime.nextAutoDecisionTick = input.tick + AUTO_USE_CONFIG.decisionIntervalTicks
    return
  }

  if (onDecisionTick) runtime.nextAutoDecisionTick = input.tick + AUTO_USE_CONFIG.decisionIntervalTicks
  executeDecision(input, duck, decision)
}

function sortedDucks(ducks: ItemDuckState[]) {
  return [...ducks].sort((left, right) => left.playerId.localeCompare(right.playerId))
}

function predictLateral(duck: ItemDuckState, horizonSeconds: number) {
  return duck.lateralOffset + duck.lateralVelocity * horizonSeconds
}

function hasReactiveThreat(input: AutoUseTickInput, duck: ItemDuckState) {
  if (!input.wildAutoUseEnabled) return false
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  const wild = runtime.wildItem
  if (!wild) return false
  const incomingRocket = input.itemState.rockets.some((rocket) => rocket.targetPlayerId === duck.playerId)
  if (incomingRocket && wild.itemId === 'MINI_BUBBLE') return true
  if (wild.itemId !== 'FEATHER') return false
  return input.itemState.bananas.some((banana) => {
    if (banana.sourcePlayerId === duck.playerId) return false
    const etaProgress = Math.max(0, banana.progress - duck.progress)
    return etaProgress >= 0 && etaProgress < 0.035
      && Math.abs(predictLateral(duck, 0.45) - banana.lateralOffset) <= banana.hitLateralRadius * 1.2
  })
}

function duckNeedsExecute(input: AutoUseTickInput, duck: ItemDuckState) {
  if (duck.finished || (!input.prepAutoUseEnabled && !input.wildAutoUseEnabled)) return false
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  if (runtime.pendingAutoAction && input.tick >= runtime.pendingAutoActionExecuteTick) return true
  if (runtime.pendingAutoAction || input.tick < runtime.nextAutoActionTick) return false
  return hasReactiveThreat(input, duck)
}

function duckNeedsDecide(input: AutoUseTickInput, duck: ItemDuckState) {
  if (duck.finished || (!input.prepAutoUseEnabled && !input.wildAutoUseEnabled)) return false
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  if (runtime.pendingAutoAction || input.tick < runtime.nextAutoActionTick) return false
  return input.tick >= runtime.nextAutoDecisionTick
}

export function tickAutoUseExecute(input: AutoUseTickInput) {
  const ducks = sortedDucks(input.ducks)
  const active = ducks.filter((duck) => duckNeedsExecute(input, duck))
  if (active.length === 0) return
  const objective = buildRaceObjectiveContext(input.config)
  for (const duck of active) processDuckExecute(input, duck, objective)
}

export function tickAutoUseDecide(input: AutoUseTickInput) {
  const ducks = sortedDucks(input.ducks)
  if (!ducks.some((duck) => duckNeedsDecide(input, duck))) return
  const objective = buildRaceObjectiveContext(input.config)
  for (const duck of ducks) {
    if (duckNeedsDecide(input, duck)) processDuckDecide(input, duck, objective)
  }
}

/** Runs execute + decide in one call. Prefer split calls inside stepSimulation for performance. */
export function tickAutoUseAI(input: AutoUseTickInput) {
  tickAutoUseExecute(input)
  tickAutoUseDecide(input)
}
