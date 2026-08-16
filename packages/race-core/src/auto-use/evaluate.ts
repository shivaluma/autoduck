import type { RaceItemId, WildItemId } from '../../../race-protocol/src'
import { CORE_BALANCE } from '../config'
import { ITEM_BALANCE } from '../items/config'
import { PICKUP_BALANCE } from '../pickups/config'
import type { ItemDuckState, ItemRaceState } from '../items/engine'
import { slipstreamReady } from '../items/engine'
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
  ghostPlayerIds: Set<string>
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
  return runtime.itemIds.includes(item) && !runtime.usedItems.has(item)
}

function hasUnusedOffensiveMajor(runtime: ItemRaceState['byPlayer'] extends Map<string, infer R> ? R : never) {
  return (runtime.itemIds.includes('HOMING_ROCKET') && !runtime.usedItems.has('HOMING_ROCKET'))
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
    .filter((candidate) => !ctx.ghostPlayerIds?.has(candidate.playerId))
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
      score += ctx.objective.offensiveTargetRankBonus(source.playerId, target.currentRank)
      if (source.progress >= AUTO_USE_CONFIG.progressLate) score += 15
      if ((targetRuntime.bubbleAvailable && ctx.tick < targetRuntime.bubbleUntilTick) || (targetRuntime.wildBubbleAvailable && ctx.tick < targetRuntime.wildBubbleUntilTick)) score -= 25
      else if (hasUnusedPrep(targetRuntime, 'BUBBLE_SHIELD')) score -= 10
      if (targetRuntime.shockAbsorberAvailable) score -= 12
      if (targetRuntime.featherAvailable) score -= 5
      if (ctx.tick < targetRuntime.boostUntilTick && targetRuntime.boostMultiplier > 1) score += 18
      score -= penalty
      if (source.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress) {
        score = Math.max(score, 20 + clamp((maxDistance - gap) / maxDistance * 10, 0, 10))
      }
      return { target, score }
    })
    .filter((entry): entry is { target: ItemDuckState; score: number } => entry !== null && entry.score > 0)
    .sort((left, right) => right.score - left.score || left.target.playerId.localeCompare(right.target.playerId))
}

export function resolveRocketTarget(ctx: EvaluationContext, kind: 'PREP' | 'WILD', preferredTargetId?: string) {
  const targets = rocketTargets(ctx, kind)
  if (preferredTargetId) {
    const preferred = targets.find((entry) => entry.target.playerId === preferredTargetId)
    if (preferred) return preferred.target.playerId
  }
  return targets[0]?.target.playerId ?? null
}

const OFFENSIVE_AUTO_ITEMS = new Set(['HOMING_ROCKET', 'BANANA', 'MINI_ROCKET', 'QUACK_HORN'])

export function isOffensiveAutoItem(itemId: string) {
  return OFFENSIVE_AUTO_ITEMS.has(itemId)
}

export function offensiveCooldownBlocks(ctx: EvaluationContext, playerId: string) {
  const runtime = ctx.itemState.byPlayer.get(playerId)!
  if (runtime.lastOffensiveUseTick <= 0) return false
  const cooldownTicks = Math.round(AUTO_USE_CONFIG.cooldownMinSeconds * ctx.tickRate)
  return ctx.tick < runtime.lastOffensiveUseTick + cooldownTicks
}

export function evaluateReactiveDefense(ctx: EvaluationContext): AutoUseCandidateDraft[] {
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)!
  if (ctx.tick < runtime.silencedUntilTick) return []
  const duck = duckById(ctx.ducks, ctx.playerId)
  const incomingRocket = ctx.itemState.rockets.some((rocket) => rocket.targetPlayerId === duck.playerId)
  const incomingBanana = ctx.itemState.bananas.some((banana) => {
    if (banana.sourcePlayerId === duck.playerId) return false
    const etaProgress = Math.max(0, banana.progress - duck.progress)
    return etaProgress >= 0 && etaProgress < 0.035
      && Math.abs(predictLateral(duck, 0.45) - banana.lateralOffset) <= banana.hitLateralRadius * 1.2
  })
  const reactive: AutoUseCandidateDraft[] = []

  if (ctx.prepAutoUseEnabled && hasUnusedPrep(runtime, 'BUBBLE_SHIELD') && !runtime.bubbleAvailable) {
    if (incomingRocket || incomingBanana) {
      reactive.push({
        itemKey: 'prep:BUBBLE_SHIELD',
        itemId: 'BUBBLE_SHIELD',
        source: 'PREP',
        action: 'USE',
        score: 105,
        reason: 'REACTIVE_DEFENSE',
        bypassThreshold: true,
      })
    }
  }

  if (ctx.wildAutoUseEnabled) {
    if (incomingRocket && runtime.wildItem?.itemId === 'MINI_BUBBLE' && !runtime.wildBubbleAvailable) {
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
  }
  return reactive
}

export function evaluatePrepCandidates(ctx: EvaluationContext): AutoUseCandidateDraft[] {
  if (!ctx.prepAutoUseEnabled) return []
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)!
  if (ctx.tick < runtime.silencedUntilTick) return []
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
    if (ctx.tick < runtime.boostUntilTick && runtime.boostMultiplier > 1) score -= 100
    if (gap > expectedGain * 2) score -= 20
    score += pressure * 0.15
    candidates.push({ itemKey: 'prep:NITRO', itemId: 'NITRO', source: 'PREP', action: 'USE', score, reason: 'OPPORTUNITY' })
  }

  if (hasUnusedPrep(runtime, 'DRAFT_FIN') && duck.progress >= ITEM_BALANCE.draftFin.armProgress && slipstreamReady(runtime, ctx.tickRate, duck.progress)) {
    const ahead = runtime.draftTargetPlayerId ? duckById(ctx.ducks, runtime.draftTargetPlayerId) : null
    let score = 30
    if (ahead && ahead.currentRank === duck.currentRank - 1) score += 35
    if (ctx.objective.isCurrentlyLosing(duck.playerId, duck.currentRank)) score += 20
    if (duck.progress >= AUTO_USE_CONFIG.progressLate) score += 12
    score += endGameBurnScore(duck.progress, 'PREP')
    score += pressure * 0.1
    candidates.push({
      itemKey: 'prep:DRAFT_FIN',
      itemId: 'DRAFT_FIN',
      source: 'PREP',
      action: 'USE',
      score,
      reason: 'OPPORTUNITY',
    })
  }

  if (hasUnusedPrep(runtime, 'PADDLE_BURST') && duck.progress >= ITEM_BALANCE.paddleBurst.armProgress) {
    const activeCount = activeDucks(ctx.ducks).length
    const isLateSprint = duck.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress
    if (duck.currentRank > Math.ceil(activeCount / 2) || isLateSprint) {
      let score = 0
      if (duck.currentRank >= activeCount - 1) score += 28
      if (duck.currentRank >= Math.ceil(activeCount * 0.75)) score += 18
      if (ctx.objective.isCurrentlyLosing(duck.playerId, duck.currentRank)) score += 22
      if (isLateSprint) score += 30
      score += endGameBurnScore(duck.progress, 'PREP')
      score += pressure * 0.12
      if (score >= 24) {
        candidates.push({
          itemKey: 'prep:PADDLE_BURST',
          itemId: 'PADDLE_BURST',
          source: 'PREP',
          action: 'USE',
          score,
          reason: isLateSprint ? 'END_GAME_BURN' : 'LATE_RACE',
        })
      }
    }
  }

  const rocketArmProgress = runtime.loadoutCombo === 'MENACE'
    ? Math.max(0.15, ITEM_BALANCE.rocket.armProgress - 0.03)
    : ITEM_BALANCE.rocket.armProgress
  if (hasUnusedPrep(runtime, 'HOMING_ROCKET') && duck.progress >= rocketArmProgress && duck.progress <= ITEM_BALANCE.rocket.disableProgress) {
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
        reason: 'OBJECTIVE',
      })
    }
  }

  const bananaArmProgress = runtime.loadoutCombo === 'MENACE'
    ? Math.max(0.15, ITEM_BALANCE.banana.armProgress - 0.03)
    : ITEM_BALANCE.banana.armProgress
  if (hasUnusedPrep(runtime, 'BANANA') && duck.progress >= bananaArmProgress) {
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

  const hornArmProgress = runtime.loadoutCombo === 'MENACE'
    ? Math.max(0.15, ITEM_BALANCE.horn.armProgress - 0.03)
    : ITEM_BALANCE.horn.armProgress
  if (hasUnusedPrep(runtime, 'QUACK_HORN') && duck.progress >= hornArmProgress) {
    let netValue = 0
    let targetsCount = 0
    for (const target of activeDucks(ctx.ducks)) {
      if (target.playerId === duck.playerId || ctx.ghostPlayerIds?.has(target.playerId)) continue
      if (Math.abs(target.progress - duck.progress) > ITEM_BALANCE.horn.progressRadius * 1.5) continue
      if (Math.abs(target.lateralOffset - duck.lateralOffset) > ITEM_BALANCE.horn.lateralRadius * 1.5) continue
      
      const isTeammate = ctx.objective.isTeammate(duck.playerId, target.playerId)
      if (isTeammate) {
        netValue -= ITEM_BALANCE.horn.lateralPush * 30
        continue
      }

      targetsCount += 1
      const impact = ITEM_BALANCE.horn.lateralPush
      const targetRuntime = ctx.itemState.byPlayer.get(target.playerId)

      if (target.currentRank < duck.currentRank) {
        netValue += impact * 18
      } else {
        netValue += impact * 10
      }
      netValue += ctx.objective.offensiveTargetRankBonus(duck.playerId, target.currentRank) * 0.25

      // Dispel active speed boosts (Nitro, Tailwind, Paddle, Draft) -> EMP Dispel
      if (targetRuntime && (targetRuntime.boostMultiplier > 1 || targetRuntime.activeSpeedItemId !== null)) {
        netValue += 20
      }

      // Destroy target's drafting slipstream charge
      if (targetRuntime && targetRuntime.draftSlipstreamTicks > 10) {
        netValue += 10
      }

      // Silence lockout value: suppress enemies with unspent prep items
      if (targetRuntime && targetRuntime.itemIds.some((id) => !targetRuntime.usedItems.has(id))) {
        netValue += 8
      }
    }

    // Multi-target pack disruption bonus
    if (targetsCount >= 2) {
      netValue += 12 * (targetsCount - 1)
    }

    // MENACE Synergy: grants Predator Rush (+10% speed for 2.2s) when hitting any target
    if (runtime.loadoutCombo === 'MENACE' && targetsCount > 0) {
      netValue += 14
      if (duck.currentRank >= 2) netValue += 6
    }

    if (hasUnusedOffensiveMajor(runtime) && netValue > 0) netValue += 6
    if (duck.currentRank >= 3 && netValue > 0) netValue += 3

    const isLateSprint = duck.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress
    const minThreshold = isLateSprint ? 4 : (duck.progress >= ITEM_BALANCE.horn.fallbackProgress ? 5 : 7)

    if (targetsCount > 0 && netValue >= minThreshold) {
      candidates.push({
        itemKey: 'prep:QUACK_HORN',
        itemId: 'QUACK_HORN',
        source: 'PREP',
        action: 'USE',
        score: clamp(netValue, 0, 100) + endGameBurnScore(duck.progress, 'PREP') + pressure * 0.05,
        reason: 'OPPORTUNITY',
      })
    }
  }

  if (hasUnusedPrep(runtime, 'BUBBLE_SHIELD') && !runtime.bubbleAvailable && duck.progress >= ITEM_BALANCE.bubbleShield.endGameBurnProgress) {
    const isLateSprint = duck.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress
    let score = 25
    if (ctx.objective.isCurrentlyLosing(duck.playerId, duck.currentRank)) score += 20
    if (duck.currentRank <= 3) score += 25
    if (isLateSprint) score += 30
    score += endGameBurnScore(duck.progress, 'PREP')
    score += pressure * 0.1
    if (score >= 28) {
      candidates.push({
        itemKey: 'prep:BUBBLE_SHIELD',
        itemId: 'BUBBLE_SHIELD',
        source: 'PREP',
        action: 'USE',
        score,
        reason: isLateSprint ? 'END_GAME_BURN' : 'LATE_RACE',
      })
    }
  }

  return candidates
}

export function evaluateWildCandidates(ctx: EvaluationContext): AutoUseCandidateDraft[] {
  if (!ctx.wildAutoUseEnabled) return []
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)!
  if (ctx.tick < runtime.silencedUntilTick) return []
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
    let targetsCount = 0
    for (const target of activeDucks(ctx.ducks)) {
      if (target.playerId === duck.playerId || ctx.ghostPlayerIds?.has(target.playerId)) continue
      if (Math.abs(target.progress - duck.progress) > PICKUP_BALANCE.horn.progressRadius * 1.4) continue
      if (Math.abs(target.lateralOffset - duck.lateralOffset) > PICKUP_BALANCE.horn.lateralRadius * 1.4) continue
      
      const isTeammate = ctx.objective.isTeammate(duck.playerId, target.playerId)
      if (isTeammate) {
        netValue -= PICKUP_BALANCE.horn.lateralPush * 35
        continue
      }

      targetsCount += 1
      const impact = PICKUP_BALANCE.horn.lateralPush
      const targetRuntime = ctx.itemState.byPlayer.get(target.playerId)

      if (target.currentRank < duck.currentRank) {
        netValue += impact * 18
      } else {
        netValue += impact * 8
      }
      netValue += ctx.objective.offensiveTargetRankBonus(duck.playerId, target.currentRank) * 0.22

      if (targetRuntime && (targetRuntime.boostMultiplier > 1 || targetRuntime.activeSpeedItemId !== null)) {
        netValue += 16
      }
      if (targetRuntime && targetRuntime.draftSlipstreamTicks > 10) {
        netValue += 10
      }
    }

    if (targetsCount >= 2) {
      netValue += 10 * (targetsCount - 1)
    }

    if (targetsCount > 0 && netValue + pressure * 0.1 >= 8) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}`,
        itemId,
        source: 'WILD',
        action: 'USE',
        score: clamp(netValue, 0, 100) + endGameBurnScore(duck.progress, 'WILD') + pressure * 0.1,
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
  const runtime = ctx.itemState.byPlayer.get(ctx.playerId)
  if (runtime && ctx.tick < runtime.silencedUntilTick) return false
  if (isOffensiveAutoItem(String(pending.itemId)) && offensiveCooldownBlocks(ctx, ctx.playerId)) return false
  if (pending.bypassThreshold) return true
  const fresh = [
    ...evaluatePrepCandidates(ctx),
    ...evaluateWildCandidates(ctx),
  ].find((candidate) => candidate.itemKey === pending.itemKey && candidate.action === pending.action)
  if (!fresh) return false
  if (pending.itemId === 'HOMING_ROCKET' || pending.itemId === 'MINI_ROCKET') {
    const kind = pending.itemId === 'HOMING_ROCKET' ? 'PREP' : 'WILD'
    const resolvedTarget = resolveRocketTarget(ctx, kind, pending.targetPlayerId)
    if (!resolvedTarget) return false
    pending.targetPlayerId = resolvedTarget
  }
  const threshold = dynamicThreshold(ctx)
  return fresh.score >= threshold * 0.85
}

export { dynamicThreshold }
