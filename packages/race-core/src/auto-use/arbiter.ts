import type { RaceEventType, RaceConfig } from '../../../race-protocol/src'
import { createRaceRng } from '../rng'
import type { RaceTrack } from '../track'
import type { ItemDuckState, ItemRaceState } from '../items/engine'
import type { PickupRaceState } from '../pickups/engine'
import { ghostPlayerIdsFromConfig } from '../ghost'
import { buildRaceObjectiveContext } from './objective'
import type { RaceObjectiveContext } from './types'
import {
  decideOffensiveAutoItemAction,
  decideReactiveAutoItemAction,
  isOffensiveAutoItem,
  offensiveCooldownBlocks,
  revalidatePendingAction,
} from './evaluate'
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

function reactiveMinVisibleTicks(tickRate: number) {
  return Math.round(AUTO_USE_CONFIG.reactiveThreatMinVisibleSeconds * tickRate)
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
    ghostPlayerIds: ghostPlayerIdsFromConfig(input.config),
  }
}

function queueDecision(input: AutoUseTickInput, duck: ItemDuckState, decision: NonNullable<ReturnType<typeof decideOffensiveAutoItemAction>>) {
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

  const decisionTargetId = pending.targetPlayerId
  if (!revalidatePendingAction(evalCtx, pending)) return true

  const executeMetadata: Record<string, unknown> = {}
  if (pending.itemId === 'HOMING_ROCKET' || pending.itemId === 'MINI_ROCKET') {
    executeMetadata.decisionTargetId = decisionTargetId ?? null
    executeMetadata.executeTargetId = pending.targetPlayerId ?? null
    executeMetadata.retargetedAtExecute = decisionTargetId !== undefined && decisionTargetId !== pending.targetPlayerId
  }

  const executed = executeAutoItemAction(
    pending,
    input.itemState,
    input.ducks,
    input.tick,
    input.tickRate,
    input.emitItem,
    input.emitPickup,
    executeMetadata,
    input.config,
  )
  if (executed) finishAction(input, duck.playerId, isOffensiveAutoItem(String(pending.itemId)))
  return true
}

function processDuckExecute(input: AutoUseTickInput, duck: ItemDuckState, objective: RaceObjectiveContext) {
  if (duck.finished) return
  if (!input.prepAutoUseEnabled && !input.wildAutoUseEnabled) return
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  const evalCtx = buildEvalContext(input, duck, objective)

  updateReactiveThreatVisibility(input, duck)

  if (processPendingAction(input, duck, evalCtx)) return
  if (runtime.pendingAutoAction || input.tick < runtime.nextAutoActionTick) return
  if (!input.wildAutoUseEnabled) return
  if (offensiveCooldownBlocks(evalCtx, duck.playerId)) return

  const reactive = decideReactiveAutoItemAction(evalCtx)
  if (!reactive || !reactiveThreatReady(input, duck)) return
  queueDecision(input, duck, reactive)
}

function processDuckDecide(input: AutoUseTickInput, duck: ItemDuckState, objective: RaceObjectiveContext) {
  if (duck.finished) return
  if (!input.prepAutoUseEnabled && !input.wildAutoUseEnabled) return
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  if (runtime.pendingAutoAction || input.tick < runtime.nextAutoActionTick) return
  if (offensiveCooldownBlocks(buildEvalContext(input, duck, objective), duck.playerId)) return

  const onDecisionTick = input.tick >= runtime.nextAutoDecisionTick
  const evalCtx = buildEvalContext(input, duck, objective)
  const decision = decideOffensiveAutoItemAction(evalCtx)
  if (!decision) {
    if (onDecisionTick) runtime.nextAutoDecisionTick = input.tick + AUTO_USE_CONFIG.decisionIntervalTicks
    return
  }

  if (onDecisionTick) runtime.nextAutoDecisionTick = input.tick + AUTO_USE_CONFIG.decisionIntervalTicks
  queueDecision(input, duck, decision)
}

function sortedDucks(ducks: ItemDuckState[]) {
  return [...ducks].sort((left, right) => left.playerId.localeCompare(right.playerId))
}

function predictLateral(duck: ItemDuckState, horizonSeconds: number) {
  return duck.lateralOffset + duck.lateralVelocity * horizonSeconds
}

function incomingBananaThreat(input: AutoUseTickInput, duck: ItemDuckState) {
  return input.itemState.bananas.some((banana) => {
    if (banana.sourcePlayerId === duck.playerId) return false
    const etaProgress = Math.max(0, banana.progress - duck.progress)
    return etaProgress >= 0 && etaProgress < 0.035
      && Math.abs(predictLateral(duck, 0.45) - banana.lateralOffset) <= banana.hitLateralRadius * 1.2
  })
}

function updateReactiveThreatVisibility(input: AutoUseTickInput, duck: ItemDuckState) {
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  const rocketVisible = input.itemState.rockets.some((rocket) => rocket.targetPlayerId === duck.playerId)
  const bananaVisible = incomingBananaThreat(input, duck)

  if (rocketVisible) {
    if (runtime.reactiveRocketVisibleSinceTick === null) runtime.reactiveRocketVisibleSinceTick = input.tick
  } else {
    runtime.reactiveRocketVisibleSinceTick = null
  }

  if (bananaVisible) {
    if (runtime.reactiveBananaVisibleSinceTick === null) runtime.reactiveBananaVisibleSinceTick = input.tick
  } else {
    runtime.reactiveBananaVisibleSinceTick = null
  }
}

function reactiveThreatReady(input: AutoUseTickInput, duck: ItemDuckState) {
  const runtime = input.itemState.byPlayer.get(duck.playerId)!
  const wild = runtime.wildItem
  if (!wild) return false
  const minVisible = reactiveMinVisibleTicks(input.tickRate)
  const incomingRocket = input.itemState.rockets.some((rocket) => rocket.targetPlayerId === duck.playerId)
  if (incomingRocket && wild.itemId === 'MINI_BUBBLE') {
    return runtime.reactiveRocketVisibleSinceTick !== null
      && input.tick - runtime.reactiveRocketVisibleSinceTick >= minVisible
  }
  if (wild.itemId !== 'FEATHER') return false
  if (!incomingBananaThreat(input, duck)) return false
  return runtime.reactiveBananaVisibleSinceTick !== null
    && input.tick - runtime.reactiveBananaVisibleSinceTick >= minVisible
}

function hasReactiveThreat(input: AutoUseTickInput, duck: ItemDuckState) {
  if (!input.wildAutoUseEnabled) return false
  updateReactiveThreatVisibility(input, duck)
  return reactiveThreatReady(input, duck)
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

export function tickAutoUseExecute(input: AutoUseTickInput, objective = buildRaceObjectiveContext(input.config)) {
  const ducks = sortedDucks(input.ducks)
  const active = ducks.filter((duck) => duckNeedsExecute(input, duck))
  if (active.length === 0) return
  for (const duck of active) processDuckExecute(input, duck, objective)
}

export function tickAutoUseDecide(input: AutoUseTickInput, objective = buildRaceObjectiveContext(input.config)) {
  const ducks = sortedDucks(input.ducks)
  if (!ducks.some((duck) => duckNeedsDecide(input, duck))) return
  for (const duck of ducks) {
    if (duckNeedsDecide(input, duck)) processDuckDecide(input, duck, objective)
  }
}

/** Runs execute + decide in one call. Prefer split calls inside stepSimulation for performance. */
export function tickAutoUseAI(input: AutoUseTickInput) {
  const objective = buildRaceObjectiveContext(input.config)
  tickAutoUseExecute(input, objective)
  tickAutoUseDecide(input, objective)
}
