import type { RaceItemId, WildItemId } from '../../../race-protocol/src'
import { CORE_BALANCE } from '../config'
import { ITEM_BALANCE } from '../items/config'
import { PICKUP_BALANCE } from '../pickups/config'
import type { ItemDuckState, ItemRaceState } from '../items/engine'
import type { PickupRaceState } from '../pickups/engine'
import { AUTO_USE_CONFIG } from './config'
import type { AutoUseCandidate, AutoUseCandidateDraft, RaceObjectiveContext } from './types'

export interface EvaluationContext {
  tick: number
  tickRate: number
  objective: RaceObjectiveContext
  itemState: ItemRaceState
  pickupState: PickupRaceState
  ducks: ItemDuckState[]
  playerId: string
  secondsUntilNextPickupZone: number
  prepAutoUseEnabled: boolean
  wildAutoUseEnabled: boolean
}

function endGameBurnScore(progress: number, kind: 'PREP' | 'WILD') {
  const cfg = kind === 'PREP' ? ITEM_BALANCE.autoUse : PICKUP_BALANCE.autoUse
  let score = 0
  if (progress >= cfg.endGameBurnProgress) score += 28
  if (progress >= cfg.forceBurnProgress) score += 22
  return score
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function activeDucks(ducks: ItemDuckState[]) {
  return ducks.filter((duck) => !duck.finished)
}

function duckById(ducks: ItemDuckState[], playerId: string) {
  return ducks.find((duck) => duck.playerId === playerId)!
}

function hasUnusedPrep(runtime: ItemRaceState['byPlayer'] extends Map<string, infer R> ? R : never, item: RaceItemId) {
  return runtime.itemIds.includes(item) && !runtime.usedItems.has(item) && !runtime.pendingRocketVolley
}

function hasUnusedOffensiveMajor(runtime: ItemRaceState['byPlayer'] extends Map<string, infer R> ? R : never) {
  return (runtime.itemIds.includes('HOMING_ROCKET') && !runtime.usedItems.has('HOMING_ROCKET') && !runtime.pendingRocketVolley)
    || (runtime.itemIds.includes('NITRO') && !runtime.usedItems.has('NITRO'))
}

function baseSpeed() {
  return 1 / CORE_BALANCE.targetDurationSeconds
}

function dynamicThreshold(ctx: EvaluationContext) {
  const progress = duckById(ctx.ducks, ctx.playerId).progress
  let threshold: number = AUTO_USE_CONFIG.thresholds.early
  if (progress >= AUTO_USE_CONFIG.progressFinal) threshold = AUTO_USE_CONFIG.thresholds.finalStretch
  else if (progress >= AUTO_USE_CONFIG.progressLate) threshold = AUTO_USE_CONFIG.thresholds.late
  else if (progress >= AUTO_USE_CONFIG.progressMid) threshold = AUTO_USE_CONFIG.thresholds.mid
  if (ctx.objective.isCurrentlyLosing(ctx.playerId, duckById(ctx.ducks, ctx.playerId).currentRank)) threshold -= 10
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)!
  if (runtime.wildItem && ctx.secondsUntilNextPickupZone < 2) threshold -= 15
  if (runtime.wildItem && ctx.secondsUntilNextPickupZone < 1) threshold -= 10
  return threshold
}

function inventoryPressure(ctx: EvaluationContext) {
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)!
  if (!runtime.wildItem) return 0
  const seconds = ctx.secondsUntilNextPickupZone
  if (seconds < 1) return AUTO_USE_CONFIG.inventoryPressure.under1s
  if (seconds < 2) return AUTO_USE_CONFIG.inventoryPressure.under2s
  if (seconds < 3.5) return AUTO_USE_CONFIG.inventoryPressure.under3_5s
  return 0
}

function predictLateral(duck: ItemDuckState, horizonSeconds: number) {
  return duck.lateralOffset + duck.lateralVelocity * horizonSeconds
}

function bananaIntersectionScore(source: ItemDuckState, target: ItemDuckState, horizonSeconds: number) {
  const trapProgress = Math.max(0, source.progress - ITEM_BALANCE.banana.dropBehindProgress)
  const trapLateral = source.lateralOffset
  const predictedLateral = predictLateral(target, horizonSeconds)
  const progressGap = source.progress - target.progress
  if (progressGap <= 0 || progressGap > 0.12) return 0
  const lateralGap = Math.abs(predictedLateral - trapLateral)
  const radius = ITEM_BALANCE.banana.hitLateralRadius
  if (lateralGap > radius * 1.25) return 0
  const arrivalGap = Math.abs(target.progress - trapProgress)
  const onPath = arrivalGap < 0.08 ? 1 : 0.4
  return clamp((1 - lateralGap / (radius * 1.25)) * 100 * onPath, 0, 100)
}

function rocketTargets(ctx: EvaluationContext, kind: 'PREP' | 'WILD') {
  const source = duckById(ctx.ducks, ctx.playerId)
  const maxDistance = kind === 'PREP'
    ? (source.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress
      ? ITEM_BALANCE.rocket.maximumTargetDistance * ITEM_BALANCE.rocket.endGameTargetDistanceMultiplier
      : ITEM_BALANCE.rocket.maximumTargetDistance)
    : (source.progress >= PICKUP_BALANCE.autoUse.forceBurnProgress
      ? PICKUP_BALANCE.miniRocket.maximumTargetDistance * PICKUP_BALANCE.miniRocket.forceBurnTargetDistanceMultiplier
      : source.progress >= PICKUP_BALANCE.autoUse.endGameBurnProgress
        ? PICKUP_BALANCE.miniRocket.maximumTargetDistance * PICKUP_BALANCE.miniRocket.endGameTargetDistanceMultiplier
        : PICKUP_BALANCE.miniRocket.maximumTargetDistance)

  return activeDucks(ctx.ducks)
    .filter((candidate) => candidate.playerId !== source.playerId && candidate.progress > source.progress)
    .filter((candidate) => candidate.progress - source.progress <= maxDistance)
    .filter((candidate) => ctx.tick >= ctx.itemState.byPlayer.get(candidate.playerId)!.rocketProtectionUntilTick)
    .map((target) => {
      const targetRuntime = ctx.itemState.byPlayer.get(target.playerId)!
      let score = 0
      const penalty = ctx.objective.offensiveTargetPenalty(source.playerId, target.playerId)
      if (!Number.isFinite(penalty)) return null
      score += ctx.objective.opponentThreat(source.playerId, target.playerId) * 10
      score += clamp((maxDistance - (target.progress - source.progress)) / maxDistance * 14, 0, 14)
      const gap = target.progress - source.progress
      if (gap > 0.02 && gap < maxDistance * 0.75) score += 12
      if (ctx.objective.isCurrentlyLosing(source.playerId, source.currentRank) && target.currentRank === source.currentRank - 1) score += 35
      if (source.progress >= AUTO_USE_CONFIG.progressLate) score += 15
      if (targetRuntime.bubbleAvailable || targetRuntime.wildBubbleAvailable) score -= ITEM_BALANCE.rocket.volleyShots > 1 ? 8 : 25
      if (targetRuntime.featherAvailable) score -= 5
      score -= penalty
      return { target, score }
    })
    .filter((entry): entry is { target: ItemDuckState; score: number } => entry !== null && entry.score > 0)
    .sort((left, right) => right.score - left.score || left.target.playerId.localeCompare(right.target.playerId))
}

export function evaluateReactiveDefense(ctx: EvaluationContext): AutoUseCandidateDraft[] {
  if (!ctx.wildAutoUseEnabled) return []
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)!
  const duck = duckById(ctx.ducks, ctx.playerId)
  const incomingRocket = ctx.itemState.rockets.some((rocket) => rocket.targetPlayerId === duck.playerId)
  const incomingBanana = ctx.itemState.bananas.some((banana) => {
    if (banana.sourcePlayerId === duck.playerId) return false
    const etaProgress = Math.max(0, banana.progress - duck.progress)
    return etaProgress >= 0 && etaProgress < 0.035
      && Math.abs(predictLateral(duck, 0.45) - banana.lateralOffset) <= banana.hitLateralRadius * 1.2
  })
  const reactive: AutoUseCandidateDraft[] = []

  if (incomingRocket && runtime.wildItem?.itemId === 'MINI_BUBBLE') {
    reactive.push({
      itemKey: `wild:${runtime.wildItem.instanceId}`,
      itemId: 'MINI_BUBBLE',
      source: 'WILD',
      action: 'USE',
      score: 100,
      reason: 'REACTIVE_DEFENSE',
      bypassThreshold: true,
      wildItemInstanceId: runtime.wildItem.instanceId,
    })
  }
  if (incomingBanana && runtime.wildItem?.itemId === 'FEATHER') {
    reactive.push({
      itemKey: `wild:${runtime.wildItem.instanceId}`,
      itemId: 'FEATHER',
      source: 'WILD',
      action: 'USE',
      score: 95,
      reason: 'REACTIVE_DEFENSE',
      bypassThreshold: true,
      wildItemInstanceId: runtime.wildItem.instanceId,
    })
  }
  return reactive
}

export function evaluatePrepCandidates(ctx: EvaluationContext): AutoUseCandidateDraft[] {
  if (!ctx.prepAutoUseEnabled) return []
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)!
  const duck = duckById(ctx.ducks, ctx.playerId)
  const candidates: AutoUseCandidateDraft[] = []
  const danger = ctx.objective.dangerScore(duck.playerId, duck.currentRank, duck.progress, ctx.ducks)
  const pressure = inventoryPressure(ctx)

  if (hasUnusedPrep(runtime, 'NITRO') && duck.progress >= ITEM_BALANCE.nitro.armProgress) {
    const ahead = activeDucks(ctx.ducks).find((candidate) => candidate.progress > duck.progress)
    const gap = ahead ? ahead.progress - duck.progress : 1
    const expectedGain = baseSpeed() * (ctx.itemState.tuning.nitroSpeedMultiplier - 1) * ITEM_BALANCE.nitro.durationSeconds
    let score = 0
    if (ctx.objective.isCurrentlyLosing(duck.playerId, duck.currentRank)) score += 35
    if (expectedGain >= gap) score += 35
    else if (expectedGain >= gap * 0.5) score += 15
    if (duck.progress >= AUTO_USE_CONFIG.progressLate) score += 15
    score += endGameBurnScore(duck.progress, 'PREP')
    if (ctx.objective.mode === 'REVERSE') score -= 80
    if (duck.currentRank >= 2 && duck.currentRank <= 4 && gap < 0.08) score += 22
    if (duck.currentRank <= 2 && duck.progress < 0.7) score -= 12
    if (ctx.tick < runtime.boostUntilTick) score -= 100
    if (gap > expectedGain * 2) score -= 20
    score += pressure * 0.15
    candidates.push({ itemKey: 'prep:NITRO', itemId: 'NITRO', source: 'PREP', action: 'USE', score, reason: 'OPPORTUNITY' })
  }

  if (hasUnusedPrep(runtime, 'HOMING_ROCKET') && duck.progress >= ITEM_BALANCE.rocket.armProgress && duck.progress <= ITEM_BALANCE.rocket.disableProgress) {
    const targets = rocketTargets(ctx, 'PREP')
    const best = targets[0]
    if (best) {
      candidates.push({
        itemKey: 'prep:HOMING_ROCKET',
        itemId: 'HOMING_ROCKET',
        source: 'PREP',
        action: 'USE',
        score: best.score + danger * 0.15 + pressure * 0.1,
        targetPlayerId: best.target.playerId,
        volleyTargetPlayerIds: targets.slice(0, ITEM_BALANCE.rocket.volleyShots).map((entry) => entry.target.playerId),
        reason: 'OBJECTIVE',
      })
    }
  }

  if (hasUnusedPrep(runtime, 'BANANA') && duck.progress >= ITEM_BALANCE.banana.armProgress) {
    let score = 0
    let bestIntersection = 0
    for (const target of activeDucks(ctx.ducks)) {
      if (target.playerId === duck.playerId || target.progress >= duck.progress) continue
      bestIntersection = Math.max(bestIntersection, bananaIntersectionScore(duck, target, AUTO_USE_CONFIG.bananaPredictionHorizonSeconds))
    }
    score += bestIntersection * 0.55
    if (danger > 50) score += 20
    if (bestIntersection > 20) score += 18
    if (bestIntersection > 50) score += 20
    if (duck.progress >= AUTO_USE_CONFIG.progressLate) score += 15
    score += endGameBurnScore(duck.progress, 'PREP')
    score += pressure * 0.1
    const chaser = activeDucks(ctx.ducks)
      .filter((target) => target.playerId !== duck.playerId && target.progress < duck.progress)
      .sort((left, right) => right.progress - left.progress)[0]
    if (chaser && duck.progress - chaser.progress <= ITEM_BALANCE.banana.closeBehindDistance) score += 24
    if (hasUnusedOffensiveMajor(runtime) && bestIntersection > 12) score += 22
    if (hasUnusedOffensiveMajor(runtime) && chaser) score += 28
    if (hasUnusedOffensiveMajor(runtime) && duck.currentRank >= 4 && chaser) score += 20
    if (bestIntersection > 20 || score >= 24) {
      candidates.push({ itemKey: 'prep:BANANA', itemId: 'BANANA', source: 'PREP', action: 'USE', score, reason: 'OPPORTUNITY' })
    }
  }

  if (hasUnusedPrep(runtime, 'QUACK_HORN') && duck.progress >= ITEM_BALANCE.horn.armProgress) {
    let netValue = 0
    for (const target of activeDucks(ctx.ducks)) {
      if (target.playerId === duck.playerId) continue
      if (Math.abs(target.progress - duck.progress) > ITEM_BALANCE.horn.progressRadius * 1.5) continue
      if (Math.abs(target.lateralOffset - duck.lateralOffset) > ITEM_BALANCE.horn.lateralRadius * 1.5) continue
      const impact = ITEM_BALANCE.horn.lateralPush
      if (ctx.objective.isTeammate(duck.playerId, target.playerId)) netValue -= impact * 40
      else if (target.currentRank < duck.currentRank) netValue += impact * 30
      else netValue += impact * 16
    }
    if (hasUnusedOffensiveMajor(runtime) && netValue > 0) netValue += 10
    if (duck.currentRank >= 3 && netValue > 0) netValue += 4
    if (netValue >= (duck.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress ? 5 : 7)) {
      candidates.push({
        itemKey: 'prep:QUACK_HORN',
        itemId: 'QUACK_HORN',
        source: 'PREP',
        action: 'USE',
        score: clamp(netValue * 6.5, 0, 100) + endGameBurnScore(duck.progress, 'PREP') + pressure * 0.05,
        reason: 'OPPORTUNITY',
      })
    }
  }

  return candidates
}

export function evaluateWildCandidates(ctx: EvaluationContext): AutoUseCandidateDraft[] {
  if (!ctx.wildAutoUseEnabled) return []
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)!
  const wild = runtime.wildItem
  if (!wild) return []
  const duck = duckById(ctx.ducks, ctx.playerId)
  const pressure = inventoryPressure(ctx)
  const danger = ctx.objective.dangerScore(duck.playerId, duck.currentRank, duck.progress, ctx.ducks)
  const candidates: AutoUseCandidateDraft[] = []
  const itemId = wild.itemId

  if (itemId === 'MINI_ROCKET') {
    const best = rocketTargets(ctx, 'WILD')[0]
    if (best) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}`,
        itemId,
        source: 'WILD',
        action: 'USE',
        score: best.score + danger * 0.2 + pressure * 0.35,
        targetPlayerId: best.target.playerId,
        reason: pressure > 0 ? 'INVENTORY_PRESSURE' : 'OBJECTIVE',
        wildItemInstanceId: wild.instanceId,
      })
    } else if (duck.currentRank === 1 && duck.progress >= PICKUP_BALANCE.autoUse.forceBurnProgress) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}`,
        itemId,
        source: 'WILD',
        action: 'DISCARD',
        score: 65 + pressure,
        reason: 'DISCARD',
        bypassThreshold: true,
        wildItemInstanceId: wild.instanceId,
      })
    }
  }

  if (itemId === 'BANANA') {
    let score = endGameBurnScore(duck.progress, 'WILD')
    let bestIntersection = 0
    for (const target of activeDucks(ctx.ducks)) {
      if (target.playerId === duck.playerId || target.progress >= duck.progress) continue
      bestIntersection = Math.max(bestIntersection, bananaIntersectionScore(duck, target, AUTO_USE_CONFIG.bananaPredictionHorizonSeconds))
    }
    score += bestIntersection * 0.4 + pressure * 0.35
    if (danger > 45) score += 15
    if (duck.progress >= AUTO_USE_CONFIG.progressLate) score += 12
    if (score >= 30) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}`,
        itemId,
        source: 'WILD',
        action: 'USE',
        score,
        reason: pressure > 0 ? 'INVENTORY_PRESSURE' : 'OPPORTUNITY',
        wildItemInstanceId: wild.instanceId,
      })
    }
  }

  if (itemId === 'MINI_BUBBLE') {
    let score = 0
    const incoming = ctx.itemState.rockets.some((rocket) => rocket.targetPlayerId === duck.playerId)
    if (incoming) score += 80
    if (danger > 60 && duck.progress >= AUTO_USE_CONFIG.progressLate) score += 25
    score += pressure * 0.4
    if (score >= 35) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}`,
        itemId,
        source: 'WILD',
        action: 'USE',
        score,
        reason: incoming ? 'REACTIVE_DEFENSE' : 'INVENTORY_PRESSURE',
        wildItemInstanceId: wild.instanceId,
      })
    }
  }

  if (itemId === 'FEATHER') {
    let score = endGameBurnScore(duck.progress, 'WILD')
    const hazardSoon = ctx.pickupState.hazards.some((hazard) => hazard.progress > duck.progress && hazard.progress - duck.progress < 0.035 && !hazard.hitPlayerIds.has(duck.playerId))
    const bananaSoon = ctx.itemState.bananas.some((banana) => banana.progress > duck.progress && banana.progress - duck.progress < 0.035)
    if (hazardSoon || bananaSoon) score += 70
    if (danger > 45) score += 20
    score += clamp((duck.currentRank / Math.max(1, ctx.objective.playerCount)) * 25, 0, 25)
    score += pressure * 0.25
    if (duck.progress >= AUTO_USE_CONFIG.progressLate) score += 10
    if (score >= 35) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}`,
        itemId,
        source: 'WILD',
        action: 'USE',
        score,
        reason: 'OPPORTUNITY',
        wildItemInstanceId: wild.instanceId,
      })
    }
  }

  if (itemId === 'QUACK_HORN') {
    let netValue = 0
    for (const target of activeDucks(ctx.ducks)) {
      if (target.playerId === duck.playerId) continue
      if (Math.abs(target.progress - duck.progress) > PICKUP_BALANCE.horn.progressRadius * 1.4) continue
      if (Math.abs(target.lateralOffset - duck.lateralOffset) > PICKUP_BALANCE.horn.lateralRadius * 1.4) continue
      const impact = PICKUP_BALANCE.horn.lateralPush
      if (ctx.objective.isTeammate(duck.playerId, target.playerId)) netValue -= impact * 50
      else if (target.currentRank < duck.currentRank) netValue += impact * 30
      else netValue += impact * 8
    }
    if (netValue + pressure * 0.1 >= 15) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}`,
        itemId,
        source: 'WILD',
        action: 'USE',
        score: clamp(netValue * 6.5, 0, 100) + endGameBurnScore(duck.progress, 'WILD') + pressure * 0.1,
        reason: 'OPPORTUNITY',
        wildItemInstanceId: wild.instanceId,
      })
    }
  }

  const maxScore = candidates.reduce((best, candidate) => Math.max(best, candidate.score), -Infinity)
  if (maxScore < 0 && pressure >= 20) {
    candidates.push({
      itemKey: `wild:${wild.instanceId}:discard`,
      itemId,
      source: 'WILD',
      action: 'DISCARD',
      score: pressure,
      reason: 'DISCARD',
      wildItemInstanceId: wild.instanceId,
    })
  }

  return candidates
}

export function decideReactiveAutoItemAction(ctx: EvaluationContext): AutoUseCandidate | null {
  const attach = (candidate: AutoUseCandidateDraft): AutoUseCandidate => ({ ...candidate, playerId: ctx.playerId })
  const reactive = evaluateReactiveDefense(ctx).map(attach)
  if (reactive.length === 0) return null
  return reactive.sort((left, right) => right.score - left.score || left.itemKey.localeCompare(right.itemKey))[0]!
}

export function decideOffensiveAutoItemAction(ctx: EvaluationContext): AutoUseCandidate | null {
  const attach = (candidate: AutoUseCandidateDraft): AutoUseCandidate => ({ ...candidate, playerId: ctx.playerId })
  const candidates = [
    ...evaluatePrepCandidates(ctx),
    ...evaluateWildCandidates(ctx),
  ].map(attach)
  if (candidates.length === 0) return null
  const best = candidates.sort((left, right) => right.score - left.score || left.itemKey.localeCompare(right.itemKey))[0]!
  const threshold = dynamicThreshold(ctx)
  if (best.bypassThreshold || best.score >= threshold) return best
  return null
}

export function decideAutoItemAction(ctx: EvaluationContext): AutoUseCandidate | null {
  return decideReactiveAutoItemAction(ctx) ?? decideOffensiveAutoItemAction(ctx)
}

export function revalidatePendingAction(ctx: EvaluationContext, pending: AutoUseCandidate): boolean {
  if (pending.bypassThreshold) return true
  const fresh = [
    ...evaluatePrepCandidates(ctx),
    ...evaluateWildCandidates(ctx),
  ].find((candidate) => candidate.itemKey === pending.itemKey && candidate.action === pending.action)
  if (!fresh) return false
  const threshold = dynamicThreshold(ctx)
  return fresh.score >= threshold * 0.85
}

export { dynamicThreshold }
