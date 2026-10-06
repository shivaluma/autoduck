import type { RaceItemId } from '../../../race-protocol/src'
import { CORE_BALANCE } from '../config'
import { ITEM_BALANCE } from '../items/config'
import { PICKUP_BALANCE } from '../pickups/config'
import type { ItemDuckState, ItemRaceState } from '../items/engine'
import { itemSpeedMultiplier, slipstreamReady } from '../items/engine'
import type { PickupRaceState } from '../pickups/engine'
import { AUTO_USE_CONFIG } from './config'
import type { AutoUseCandidate, AutoUseCandidateDraft, RaceObjectiveContext } from './types'
import { NEUTRAL_TRAITS, grudgeWeight, type AiIntent, type DuckBrain, type TemperamentTraits } from './brain'
import { DIRECTOR_CONFIG, readRace } from './director'
import { defaultHornSide, hornSideTargets, type HornSide } from '../items/aim'
import { wildHornReach } from '../pickups/engine'

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

function carriesSpeedMomentum(runtime: ItemRaceState['byPlayer'] extends Map<string, infer R> ? R : never, tick: number) {
  if (runtime.activeSpeedItemId && tick < runtime.boostUntilTick) return true
  return runtime.itemIds.includes('NITRO') && !runtime.usedItems.has('NITRO')
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
  threshold -= Math.round(lossRisk(ctx) * 12)
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

function chaosIntent(ctx: EvaluationContext): AiIntent {
  const mode = chaosOf(ctx).chaosMode
  if (mode === 'DUO' || mode === 'CONSTRUCTORS') return 'TEAM_PLAY'
  if (mode === 'BOUNTY_HUNT') return 'BOUNTY'
  return 'DESPERATE'
}

function brainOf(ctx: EvaluationContext): DuckBrain | undefined {
  const brain = ctx.itemState.brains?.get(ctx.playerId)
  return brain?.ablated ? undefined : brain
}

function chaosOf(ctx: EvaluationContext) {
  return ctx.itemState.brains?.get(ctx.playerId)?.ablated ? ctx.objective.naiveChaos : ctx.objective.chaos
}

function traitsOf(ctx: EvaluationContext): TemperamentTraits {
  return brainOf(ctx)?.traits ?? NEUTRAL_TRAITS
}

/** Chaos-accurate loss risk (0..1) for the evaluating duck. */
function lossRisk(ctx: EvaluationContext) {
  return chaosOf(ctx).lossRisk(ctx.playerId, ctx.ducks)
}

/** Danger (0..100): loss risk, plus being squeezed in a pack, plus lateness. */
function dangerOf(ctx: EvaluationContext, duck: ItemDuckState) {
  const risk = lossRisk(ctx)
  let gapAhead = Infinity
  let gapBehind = Infinity
  for (const other of ctx.ducks) {
    if (other.finished || other.playerId === duck.playerId) continue
    if (other.progress >= duck.progress) gapAhead = Math.min(gapAhead, other.progress - duck.progress)
    else gapBehind = Math.min(gapBehind, duck.progress - other.progress)
  }
  const squeeze = gapAhead < 0.008 && gapBehind < 0.008 ? 15 : gapAhead < 0.015 ? 8 : 0
  return clamp(risk * 80 + squeeze + (duck.progress > 0.75 ? 10 : 0), 0, 100)
}

function isDesperate(ctx: EvaluationContext, duck: ItemDuckState) {
  return duck.progress >= DIRECTOR_CONFIG.desperationProgress && lossRisk(ctx) >= DIRECTOR_CONFIG.desperationRisk
}

/** How many places `target` is likely to lose if slowed for `slowDistance` (progress units). */
function estimateDrop(ctx: EvaluationContext, target: ItemDuckState, slowDistance: number) {
  let drop = 0
  for (const other of ctx.ducks) {
    if (other.finished || other.playerId === target.playerId) continue
    if (other.progress < target.progress && target.progress - other.progress <= slowDistance) drop++
  }
  return drop
}

export interface BananaAimPlan {
  /** Lane to toss the peel onto. */
  aimLateral: number
  /** 0..100: best chaser's chance of running into it (comparable to bananaIntersectionScore). */
  intersection: number
  targetId: string | null
  teammateAtRisk: boolean
}

/**
 * Aims a banana: predicts each chaser's lane when it reaches the peel, discounts chasers that have time
 * to dodge or a defence that would turn the hit into their guard surge, values hits by Chaos utility,
 * and tosses the peel (within `maxOffset`) onto the lane with the best expected payoff.
 */
export function planBananaAim(ctx: EvaluationContext, duck: ItemDuckState, maxOffset: number, dropBehind: number, hitRadius: number, slowDistance: number): BananaAimPlan {
  const trap = Math.max(0, duck.progress - dropBehind)
  const chasers = activeDucks(ctx.ducks)
    .filter((target) => target.playerId !== duck.playerId && !ctx.ghostPlayerIds?.has(target.playerId) && target.progress < trap && trap - target.progress <= 0.12)
    .map((target) => {
      const runtime = ctx.itemState.byPlayer.get(target.playerId)!
      const seconds = Math.max(0.05, (trap - target.progress) / (baseSpeed() * Math.max(0.3, itemSpeedMultiplier(runtime, ctx.tick))))
      // The lane AI only steers around peels it sees shortly ahead, on its next impulse (0.5-1.1s).
      const dodge = seconds < 0.55 ? 1 : seconds < 1.1 ? 0.65 : 0.4
      const teammate = ctx.objective.isTeammate(duck.playerId, target.playerId)
      const defended = (runtime.bubbleAvailable && ctx.tick < runtime.bubbleUntilTick) || runtime.featherAvailable
        || (runtime.wildBubbleAvailable && ctx.tick < runtime.wildBubbleUntilTick) || (runtime.wildFeatherAvailable && ctx.tick < runtime.wildFeatherUntilTick)
      const value = teammate ? -2 : defended ? -0.3
        : 1 + clamp(chaosTargetValue(ctx, target, estimateDrop(ctx, target, slowDistance)) / 40, -0.5, 1.5) + socialTargetBonus(ctx, target).bonus / 20
      return { target, predicted: predictLateral(target, Math.min(seconds, 1)), dodge, teammate, value }
    })
  const hitFraction = (lane: number, predicted: number) => Math.max(0, 1 - Math.abs(lane - predicted) / hitRadius)
  let best = { aimLateral: duck.lateralOffset, total: -Infinity }
  for (let step = -4; step <= 4; step++) {
    const lane = Math.max(-0.95, Math.min(0.95, duck.lateralOffset + (maxOffset * step) / 4))
    let total = 0
    for (const chaser of chasers) total += chaser.value * chaser.dodge * hitFraction(lane, chaser.predicted)
    if (total > best.total + 1e-9 || (Math.abs(total - best.total) <= 1e-9 && Math.abs(lane - duck.lateralOffset) < Math.abs(best.aimLateral - duck.lateralOffset))) best = { aimLateral: lane, total }
  }
  let intersection = 0
  let targetId: string | null = null
  let teammateAtRisk = false
  for (const chaser of chasers) {
    const chance = chaser.dodge * hitFraction(best.aimLateral, chaser.predicted)
    if (chaser.teammate) { if (chance > 0) teammateAtRisk = true; continue }
    if (chaser.value > 0 && chance * 100 > intersection) { intersection = chance * 100; targetId = chaser.target.playerId }
  }
  return { aimLateral: best.aimLateral, intersection, targetId, teammateAtRisk }
}

/** Would a sideways shove of `distance` toward `side` put `target` onto a live peel or hazard just ahead of it? */
function shovesIntoTrap(ctx: EvaluationContext, target: ItemDuckState, side: HornSide, distance: number) {
  const landing = Math.max(-0.95, Math.min(0.95, target.lateralOffset + side * distance))
  const ahead = (progress: number) => progress > target.progress && progress - target.progress < 0.04
  for (const banana of ctx.itemState.bananas) {
    if (banana.sourcePlayerId === target.playerId || !ahead(banana.progress)) continue
    if (Math.abs(landing - banana.lateralOffset) <= banana.hitLateralRadius && Math.abs(target.lateralOffset - banana.lateralOffset) > banana.hitLateralRadius) return true
  }
  for (const hazard of ctx.pickupState.hazards ?? []) {
    if (hazard.hitPlayerIds.has(target.playerId) || !ahead(hazard.progress)) continue
    if (Math.abs(landing - hazard.lateralOffset) <= hazard.radius && Math.abs(target.lateralOffset - hazard.lateralOffset) > hazard.radius) return true
  }
  return false
}

/** Chaos utility of knocking `target` back `drop` places (and climbing `selfGain`), ≈ -100..100. */
function chaosTargetValue(ctx: EvaluationContext, target: ItemDuckState, drop: number, selfGain = 0) {
  return chaosOf(ctx).actionValue(ctx.playerId, ctx.ducks, selfGain, target.playerId, drop)
}

/** Grudge, rivalry, runaway-leader and bounty pull toward a target, with the intent that explains it. */
function socialTargetBonus(ctx: EvaluationContext, target: ItemDuckState): { bonus: number; intent: AiIntent | undefined } {
  const brain = brainOf(ctx)
  const traits = traitsOf(ctx)
  const options: Array<[number, AiIntent]> = []
  const grudge = grudgeWeight(brain, target.playerId, ctx.tick, ctx.tickRate)
  if (grudge > 0.2) options.push([traits.vengeance * 10 * Math.min(2, grudge), 'RETALIATING'])
  if (brain?.rivalId === target.playerId) options.push([4 + traits.aggression * 4, 'RIVALRY'])
  if (readRace(ctx.ducks).runawayLeaderId === target.playerId) options.push([2 + traits.aggression * 5, 'HUNTING'])
  if (chaosOf(ctx).wantedPlayerId === target.playerId) options.push([0, 'BOUNTY'])
  if (options.length === 0) return { bonus: 0, intent: undefined }
  const bonus = options.reduce((sum, [value]) => sum + value, 0)
  const intent = options.sort((left, right) => right[0] - left[0])[0]![1]
  return { bonus, intent }
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

export interface RocketImpactForecast {
  timeToImpact: number
  hitConfidence: number
  damageProbability: number
  boostRemainingSeconds: number
  defenseMitigation: number
  expectedImpactValue: number
}

function rocketTargets(ctx: EvaluationContext, kind: 'PREP' | 'WILD', preferredTargetId?: string) {
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

  const projectileSpeed = kind === 'PREP'
    ? ITEM_BALANCE.rocket.projectileSpeed
    : PICKUP_BALANCE.miniRocket.projectileSpeed

  const lifetimeSeconds = kind === 'PREP'
    ? ITEM_BALANCE.rocket.lifetimeSeconds
    : PICKUP_BALANCE.miniRocket.lifetimeSeconds

  const maxAcceptableTTI = kind === 'PREP'
    ? (source.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress ? 2.5 : 1.6)
    : (source.progress >= PICKUP_BALANCE.autoUse.forceBurnProgress ? 2.2 : (source.progress >= PICKUP_BALANCE.autoUse.endGameBurnProgress ? 1.8 : 1.2))

  const impactConfig = kind === 'PREP' ? ITEM_BALANCE.rocket : PICKUP_BALANCE.miniRocket
  const slowCost = (c: typeof impactConfig | typeof ITEM_BALANCE.shockAbsorber) =>
    (1 - c.staggerMultiplier) * c.staggerDurationSeconds + (1 - c.recoverySlowMultiplier) * c.recoveryDurationSeconds
  const mitigatedCostRatio = Math.min(1, slowCost(ITEM_BALANCE.shockAbsorber) / slowCost(impactConfig))

  const eligible = ctx.ducks.filter(target => !target.finished && target.playerId !== source.playerId
    && target.progress > source.progress && !ctx.ghostPlayerIds.has(target.playerId)
    && !ctx.objective.isTeammate(source.playerId, target.playerId))
  type ScoredTarget = { target: ItemDuckState; score: number; forecast: RocketImpactForecast; intent?: AiIntent }
  let best: ScoredTarget | undefined
  let preferred: ScoredTarget | undefined
  for (const target of eligible) {
    if (target.progress - source.progress > maxDistance) continue
    const targetRuntime = ctx.itemState.byPlayer.get(target.playerId)!
    const penalty = ctx.objective.offensiveTargetPenalty(source.playerId, target.playerId)
    if (!Number.isFinite(penalty)) continue

    if (ctx.tick < targetRuntime.rocketProtectionUntilTick) continue

    // Kinematics & Time-To-Impact (TTI) Forecast
    const gap = target.progress - source.progress
    const targetEstimatedSpeed = baseSpeed() * itemSpeedMultiplier(targetRuntime, ctx.tick)
    const relativeSpeed = projectileSpeed - targetEstimatedSpeed
    if (relativeSpeed <= 0) continue
    const hitRadius = kind === 'PREP' ? ITEM_BALANCE.rocket.hitRadius : PICKUP_BALANCE.miniRocket.hitRadius
    const tti = Math.max(ITEM_BALANCE.rocket.armingTicks / ctx.tickRate, (gap - hitRadius) / relativeSpeed)
    const impactTick = ctx.tick + Math.ceil(tti * ctx.tickRate)

    // Gate: Reject if projectile cannot reach target in lifetime or acceptable window
    if (tti > lifetimeSeconds || tti > maxAcceptableTTI) continue

    // Gate: Reject if target is projected to finish race before projectile arrives
    const projectedTargetProgressAtImpact = target.progress + targetEstimatedSpeed * tti
    if (projectedTargetProgressAtImpact >= 1.0) continue

    // Hit confidence degrades gracefully with flight duration
    const hitConfidence = clamp(1 - (tti / lifetimeSeconds) * 0.6, 0.25, 1.0)

    // Defense analysis:
    // Active bubble or unspent prep bubble provides hard block (damage probability = 0)
    const hasActiveBubble = (targetRuntime.bubbleAvailable && (targetRuntime.bubbleUntilTick === undefined || impactTick < targetRuntime.bubbleUntilTick))
      || (targetRuntime.wildBubbleAvailable && impactTick < (targetRuntime.wildBubbleUntilTick ?? 0))
    // Deliberately keeps the reaction-time model even though a packed Bubble reflexes: perfect Bubble
    // knowledge makes attackers ignore Defense entirely and pile onto Speed, breaking the class counter loop
    // (measured in docs/balance/S3.14.md).
    const hasPrepBubbleInInventory = hasUnusedPrep(targetRuntime, 'BUBBLE_SHIELD')
      && Math.max(ctx.tick, targetRuntime.silencedUntilTick) + Math.ceil(AUTO_USE_CONFIG.reactionDelayMaxSeconds * ctx.tickRate) < impactTick
    const hasBubbleProtection = hasActiveBubble || hasPrepBubbleInInventory

    const damageProbability = hasBubbleProtection || impactTick < targetRuntime.itemImmunityUntilTick ? 0 : 1.0
    const defenseMitigation = targetRuntime.shockAbsorberAvailable
      ? mitigatedCostRatio : 1
    // Feather does NOT block Rocket (0 penalty)

    // Expected Damage Value
    const rawImpact = 34
    const expectedDamageValue = rawImpact * hitConfidence * damageProbability * defenseMitigation

    // Expected Boost Break Value at Impact
    const boostRemainingTicks = Math.max(0, targetRuntime.boostUntilTick - impactTick)
    let expectedBoostBreakValue = 0
    if (boostRemainingTicks > 0 && targetRuntime.boostMultiplier > 1) {
      const boostSecondsRemaining = boostRemainingTicks / ctx.tickRate
      const breakEfficiency = kind === 'PREP' ? 1.0 : 0.5
      expectedBoostBreakValue = clamp(boostSecondsRemaining * 14 * (targetRuntime.boostMultiplier - 1) * 35 * breakEfficiency, 0, 24) * damageProbability * hitConfidence
    }

    // ATTACK > SPEED: a clean hit on a speed duck steals its momentum.
    const momentumStealValue = carriesSpeedMomentum(targetRuntime, ctx.tick)
      ? AUTO_USE_CONFIG.momentumStealValue * damageProbability * hitConfidence
      : 0

    // Shield Strip Value (valuable when under inventory pressure, endgame, or no other unprotected targets ahead)
    let shieldStripValue = 0
    if (hasBubbleProtection) {
      const pressure = inventoryPressure(ctx)
      const isEndGame = source.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress
      const isOnlyTargetAhead = eligible.length <= 1
      const isLosing = lossRisk(ctx) >= 0.5

      let rawStrip = 6
      if (pressure > 0 || isEndGame) {
        rawStrip = 24
      } else if (isOnlyTargetAhead && isLosing) {
        rawStrip = 26
      } else if (isOnlyTargetAhead) {
        rawStrip = 16
      }
      shieldStripValue = rawStrip * hitConfidence
    }

    // Objective Value: what the hit is worth under the actual Chaos rule (team, bounty and cut lines
    // included), plus the brain's social pull toward grudges, rivals and runaway leaders.
    let objectiveValue = 0
    objectiveValue += ctx.objective.opponentThreat(source.playerId, target.playerId) * 8
    objectiveValue += clamp((maxDistance - gap) / maxDistance * 12, 0, 12)
    if (gap > 0.02 && gap < maxDistance * 0.75) objectiveValue += 10

    const slowDistance = slowCost(impactConfig) * defenseMitigation * baseSpeed()
    // The steal's own climb is already priced by momentumStealValue; counting it here too made every
    // at-risk attacker fixate on Nitro carriers.
    const chaosValue = chaosTargetValue(ctx, target, estimateDrop(ctx, target, slowDistance)) * damageProbability * hitConfidence
    objectiveValue += clamp(chaosValue * 0.6, -20, 40)
    const social = socialTargetBonus(ctx, target)
    objectiveValue += social.bonus * Math.max(0.25, damageProbability)

    if (source.progress >= AUTO_USE_CONFIG.progressLate) objectiveValue += 12

    const opportunism = 0.8 + traitsOf(ctx).opportunism * 0.4
    let totalScore = objectiveValue + expectedDamageValue + (expectedBoostBreakValue + momentumStealValue) * opportunism + shieldStripValue - penalty

    if (source.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress) {
      totalScore = Math.max(totalScore, 20 + clamp((maxDistance - gap) / maxDistance * 10, 0, 10))
    }

    const entry: ScoredTarget = {
      target,
      score: totalScore,
      intent: social.intent ?? (chaosValue >= 15 && chaosOf(ctx).chaosMode !== 'NORMAL' ? chaosIntent(ctx) : undefined),
      forecast: {
        timeToImpact: tti,
        hitConfidence,
        damageProbability,
        boostRemainingSeconds: boostRemainingTicks / ctx.tickRate,
        defenseMitigation,
        expectedImpactValue: expectedDamageValue + expectedBoostBreakValue,
      },
    }
    if (entry.score <= 0) continue
    if (!best || entry.score > best.score || (entry.score === best.score && entry.target.playerId.localeCompare(best.target.playerId) < 0)) best = entry
    if (target.playerId === preferredTargetId) preferred = entry
  }
  // Hysteresis prevents pointless switching while allowing materially better targets.
  if (preferred && best && preferred.score >= best.score - 5) return [preferred]
  return best ? [best] : []
}

export function resolveRocketTarget(ctx: EvaluationContext, kind: 'PREP' | 'WILD', preferredTargetId?: string) {
  return rocketTargets(ctx, kind, preferredTargetId)[0]?.target.playerId ?? null
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

  // The prep Bubble Shield is no longer raised here: it reflexes on its own against prep attacks
  // (items/engine.ts armBubbleReflex), and box attacks only meet a bubble that is already up.

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
  const danger = dangerOf(ctx, duck)
  const pressure = inventoryPressure(ctx)

  if (hasUnusedPrep(runtime, 'NITRO') && duck.progress >= ITEM_BALANCE.nitro.armProgress) {
    if (ctx.objective.mode === 'REVERSE') {
      // In Reverse mode, Nitro gives negative utility since advancing forward causes penalties
    } else {
      const expectedGain = baseSpeed() * (ctx.itemState.tuning.nitroSpeedMultiplier - 1) * ITEM_BALANCE.nitro.durationSeconds
      const enemiesAhead = activeDucks(ctx.ducks)
        .filter((candidate) => candidate.playerId !== duck.playerId && candidate.progress > duck.progress)
        .sort((left, right) => left.progress - right.progress)

      let possibleOvertakes = 0
      let nearestAheadGap = 1.0
      for (const ahead of enemiesAhead) {
        const gap = ahead.progress - duck.progress
        if (gap < nearestAheadGap) nearestAheadGap = gap
        if (gap <= expectedGain * 1.05) {
          possibleOvertakes += 1
        }
      }

      let score = 0

      // 1. Overtake Value: High reward for convertable position jumps
      if (possibleOvertakes >= 2) {
        score += 65
      } else if (possibleOvertakes === 1) {
        score += 42
      } else if (nearestAheadGap <= expectedGain * 1.5) {
        score += 20
      } else if (nearestAheadGap > expectedGain * 2.2 && duck.progress < 0.82) {
        score -= 25
      }

      // 2. Safety Value: what the overtakes are worth under the actual Chaos rule (escaping the
      // loser set, keeping a teammate's average up, pushing past the Wanted duck...).
      const isLosing = chaosOf(ctx).isLosingNow(duck.playerId, ctx.ducks)
      if (isLosing) {
        // Escaping counts only if the overtakes actually leave the (Chaos-accurate) loser set.
        const escapes = chaosOf(ctx).actionValue(duck.playerId, ctx.ducks, possibleOvertakes) >= 50
        score += escapes ? 55 : 35
      } else if (danger > 50) {
        score += 18
      }

      // 3. Finish Conversion: Snatch 1st place or secure podium in late sprint
      const isLate = duck.progress >= 0.82
      if (isLate) {
        if (duck.currentRank === 2 && enemiesAhead.length > 0 && nearestAheadGap <= expectedGain * 1.25) {
          score += 60
        } else if (duck.currentRank <= 3 && nearestAheadGap <= expectedGain * 1.3) {
          score += 40
        } else if (duck.progress >= 0.90) {
          score += 25
        }
      }

      // 4. Escape Value: Break away when closely pursued from behind
      const closestBehind = activeDucks(ctx.ducks)
        .filter((candidate) => candidate.playerId !== duck.playerId && candidate.progress <= duck.progress)
        .sort((left, right) => right.progress - left.progress)[0]
      if (closestBehind) {
        const gapBehind = duck.progress - closestBehind.progress
        if (gapBehind <= 0.025) {
          score += 22
        }
      }

      // 5. Rocket Threat Forecast: Hold Nitro if an incoming rocket will break it
      const incomingRockets = ctx.itemState.rockets.filter(
        (rocket) => rocket.targetPlayerId === duck.playerId && rocket.launchAtTick <= ctx.tick && ctx.tick < rocket.expiresAtTick,
      )
      if (incomingRockets.length > 0) {
        const hasShield = runtime.bubbleAvailable || runtime.wildBubbleAvailable
        if (!hasShield) {
          let minTimeToImpact = Infinity
          for (const rocket of incomingRockets) {
            const distance = Math.max(0, duck.progress - rocket.progress)
            const relSpeed = rocket.speedPerSecond - baseSpeed()
            const tti = relSpeed > 0 ? distance / relSpeed : 2.0
            if (tti < minTimeToImpact) minTimeToImpact = tti
          }
          if (minTimeToImpact < 1.0 && duck.progress < 0.96) {
            score -= 80
          } else if (minTimeToImpact >= 1.5 && possibleOvertakes > 0) {
            score -= 15
          }
        }
      }

      // 6. Boost Stacking Check: Avoid overriding active speed effect
      if (ctx.tick < runtime.boostUntilTick && runtime.boostMultiplier > 1) {
        score -= 100
      }

      score += endGameBurnScore(duck.progress, 'PREP')
      score += pressure * 0.15

      if (score >= 30) {
        candidates.push({
          itemKey: 'prep:NITRO',
          itemId: 'NITRO',
          source: 'PREP',
          action: 'USE',
          score: clamp(score, 0, 100),
          reason: isLate ? 'END_GAME_BURN' : isLosing ? 'OBJECTIVE' : 'OPPORTUNITY',
        })
      }
    }
  }

  if (hasUnusedPrep(runtime, 'DRAFT_FIN') && duck.progress >= ITEM_BALANCE.draftFin.armProgress && slipstreamReady(runtime, ctx.tickRate, duck.progress)) {
    const ahead = runtime.draftTargetPlayerId ? duckById(ctx.ducks, runtime.draftTargetPlayerId) : null
    let score = 30
    if (ahead && ahead.currentRank === duck.currentRank - 1) score += 35
    if (lossRisk(ctx) >= 0.5) score += 20
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
      if (lossRisk(ctx) >= 0.5) score += 22
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
        intent: best.intent,
      })
    }
  }

  const bananaArmProgress = runtime.loadoutCombo === 'MENACE'
    ? Math.max(0.15, ITEM_BALANCE.banana.armProgress - 0.03)
    : ITEM_BALANCE.banana.armProgress
  if (hasUnusedPrep(runtime, 'BANANA') && duck.progress >= bananaArmProgress) {
    let score = 0
    let bestIntersection = 0
    const enemies = activeDucks(ctx.ducks).filter(
      (target) => target.playerId !== duck.playerId
        && !ctx.objective.isTeammate(duck.playerId, target.playerId)
        && !ctx.ghostPlayerIds?.has(target.playerId),
    )
    let teammateAtRisk: boolean
    let aim: BananaAimPlan | null = null
    if (brainOf(ctx)) {
      const bananaSlow = ((1 - ITEM_BALANCE.banana.staggerMultiplier) * ITEM_BALANCE.banana.staggerDurationSeconds
        + (1 - ITEM_BALANCE.banana.recoverySlowMultiplier) * ITEM_BALANCE.banana.recoveryDurationSeconds) * baseSpeed()
      aim = planBananaAim(ctx, duck, ITEM_BALANCE.banana.aimMaxOffset, ITEM_BALANCE.banana.dropBehindProgress, ITEM_BALANCE.banana.hitLateralRadius, bananaSlow)
      bestIntersection = aim.intersection
      teammateAtRisk = aim.teammateAtRisk
    } else {
      for (const target of enemies) {
        if (target.progress >= duck.progress) continue
        bestIntersection = Math.max(bestIntersection, bananaIntersectionScore(duck, target, AUTO_USE_CONFIG.bananaPredictionHorizonSeconds))
      }
      teammateAtRisk = activeDucks(ctx.ducks).some(
        (target) => target.playerId !== duck.playerId
          && ctx.objective.isTeammate(duck.playerId, target.playerId)
          && target.progress < duck.progress
          && (
            bananaIntersectionScore(duck, target, AUTO_USE_CONFIG.bananaPredictionHorizonSeconds) > 0
            || (duck.progress - target.progress < 0.08 && Math.abs(target.lateralOffset - duck.lateralOffset) <= ITEM_BALANCE.banana.hitLateralRadius * 1.5)
          ),
      )
    }

    if (!teammateAtRisk) {
      score += bestIntersection * 0.55
      if (danger > 50) score += 20
      if (bestIntersection > 20) score += 18
      if (bestIntersection > 50) score += 20
      if (duck.progress >= AUTO_USE_CONFIG.progressLate) score += 15
      score += endGameBurnScore(duck.progress, 'PREP')
      score += pressure * 0.1
      const chaser = enemies
        .filter((target) => target.progress < duck.progress)
        .sort((left, right) => right.progress - left.progress)[0]
      if (chaser && duck.progress - chaser.progress <= ITEM_BALANCE.banana.closeBehindDistance) score += 24
      if (hasUnusedOffensiveMajor(runtime) && bestIntersection > 12) score += 22
      if (hasUnusedOffensiveMajor(runtime) && chaser) score += 28
      if (hasUnusedOffensiveMajor(runtime) && duck.currentRank >= 4 && chaser) score += 20
      if (bestIntersection > 20 || score >= 24) {
        candidates.push({
          itemKey: 'prep:BANANA', itemId: 'BANANA', source: 'PREP', action: 'USE', score, reason: 'OPPORTUNITY',
          aimLateral: aim?.aimLateral,
          targetPlayerId: aim?.targetId ?? undefined,
          intent: aim?.targetId && bestIntersection >= 50 ? 'TRAP_SET' : undefined,
        })
      }
    }
  }

  const hornArmProgress = runtime.loadoutCombo === 'MENACE'
    ? Math.max(0.15, ITEM_BALANCE.horn.armProgress - 0.03)
    : ITEM_BALANCE.horn.armProgress
  if (hasUnusedPrep(runtime, 'QUACK_HORN') && duck.progress >= hornArmProgress) {
    const { progressRadius, sideReach, centerBand } = ITEM_BALANCE.horn
    const isGhost = (target: ItemDuckState) => Boolean(ctx.ghostPlayerIds?.has(target.playerId))
    // A brain picks the better side; a legacy brain scores the side it would blast by default.
    const sides: HornSide[] = brainOf(ctx)
      ? [-1, 1]
      : [defaultHornSide(duck, activeDucks(ctx.ducks), progressRadius, sideReach, centerBand, isGhost)]
    let best: { side: HornSide; netValue: number; targetsCount: number; intent: AiIntent | undefined } | null = null

    for (const side of sides) {
      let hornIntent: AiIntent | undefined
      let netValue = 0
      let targetsCount = 0
      let hasTeammateInRadius = false

      for (const target of hornSideTargets(duck, activeDucks(ctx.ducks), side, progressRadius, sideReach, centerBand, isGhost)) {
        if (ctx.objective.isTeammate(duck.playerId, target.playerId)) {
          hasTeammateInRadius = true
          break
        }

        const targetRuntime = ctx.itemState.byPlayer.get(target.playerId)
        // Bubble / Feather stop the horn and hand the target a guard surge.
        const bubbleReady = targetRuntime && targetRuntime.bubbleAvailable && ctx.tick < targetRuntime.bubbleUntilTick
        if (targetRuntime && (bubbleReady || targetRuntime.featherAvailable)) {
          netValue -= 12
          continue
        }
        targetsCount += 1
        const impact = ITEM_BALANCE.horn.lateralPush

        if (target.currentRank < duck.currentRank) {
          netValue += impact * 18
        } else {
          netValue += impact * 10
        }
        const hornChaos = chaosTargetValue(ctx, target, estimateDrop(ctx, target, 0.006))
        // Horn hits several ducks at once: keep its Chaos/social pull small or it becomes a precision steal.
        netValue += clamp(hornChaos * 0.15, -4, 6)
        const hornSocial = socialTargetBonus(ctx, target)
        netValue += hornSocial.bonus * 0.2
        if (hornSocial.intent && !hornIntent) hornIntent = hornSocial.intent
        // Shoving a duck into a waiting peel or hazard is worth a lot more than a plain shove.
        if (brainOf(ctx) && shovesIntoTrap(ctx, target, side, ITEM_BALANCE.horn.lateralShove + ITEM_BALANCE.horn.lateralPush * 0.25)) {
          netValue += AUTO_USE_CONFIG.brain.shoveIntoTrapValue
          hornIntent = 'SHOVE'
        }

        // Horn breaks active speed-item boosts and steals speed ducks' momentum (Shock Absorber only softens it).
        if (targetRuntime && !targetRuntime.shockAbsorberAvailable && ctx.tick < targetRuntime.boostUntilTick && targetRuntime.boostMultiplier > 1 && targetRuntime.activeSpeedItemId) {
          netValue += 20
        }
        if (targetRuntime && carriesSpeedMomentum(targetRuntime, ctx.tick)) {
          netValue += AUTO_USE_CONFIG.momentumStealValue * 0.5
        }

        // Destroy target's drafting slipstream charge
        if (targetRuntime && targetRuntime.draftSlipstreamTicks > 10) {
          netValue += 10
        }

        // Silence lockout value: suppress enemies with unspent prep items
        if (targetRuntime && ctx.tick >= (targetRuntime.silenceImmuneUntilTick ?? 0) && ctx.tick >= targetRuntime.silencedUntilTick && targetRuntime.itemIds.some((id) => !targetRuntime.usedItems.has(id))) {
          netValue += 8 * ITEM_BALANCE.horn.silenceDurationSeconds / 2.5
        }
      }
      if (hasTeammateInRadius || targetsCount === 0) continue

      // Multi-target pack disruption bonus
      if (targetsCount >= 2) {
        netValue += 12 * (targetsCount - 1)
      }

      // MENACE synergy rewards hitting a target with Predator Rush.
      if (runtime.loadoutCombo === 'MENACE') {
        netValue += 14
        if (duck.currentRank >= 2) netValue += 6
      }

      if (hasUnusedOffensiveMajor(runtime) && netValue > 0) netValue += 6
      if (duck.currentRank >= 3 && netValue > 0) netValue += 3
      if (!best || netValue > best.netValue) best = { side, netValue, targetsCount, intent: hornIntent }
    }

    const isLateSprint = duck.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress
    const minThreshold = isLateSprint ? 4 : (duck.progress >= ITEM_BALANCE.horn.fallbackProgress ? 5 : 7)
    if (best && best.netValue >= minThreshold) {
      candidates.push({
        itemKey: 'prep:QUACK_HORN',
        itemId: 'QUACK_HORN',
        source: 'PREP',
        action: 'USE',
        score: clamp(best.netValue, 0, 100) + endGameBurnScore(duck.progress, 'PREP') + pressure * 0.05,
        reason: 'OPPORTUNITY',
        intent: best.intent,
        hornSide: brainOf(ctx) ? best.side : undefined,
      })
    }
  }

  if (hasUnusedPrep(runtime, 'BUBBLE_SHIELD') && !runtime.bubbleAvailable) {
    const isLateSprint = duck.progress >= ITEM_BALANCE.autoUse.endGameBurnProgress
    let score = 0
    // Bubble is a reactive counter to attacks; it is only burned proactively in the final sprint.
    if (duck.progress >= ITEM_BALANCE.bubbleShield.endGameBurnProgress) {
      score += 35
    }
    if (lossRisk(ctx) >= 0.5 && duck.progress >= 0.50) score += 15
    if (duck.progress >= AUTO_USE_CONFIG.progressFinal) score += 30
    score += endGameBurnScore(duck.progress, 'PREP')
    score += pressure * 0.1
    if (score >= 28) {
      candidates.push({
        itemKey: 'prep:BUBBLE_SHIELD',
        itemId: 'BUBBLE_SHIELD',
        source: 'PREP',
        action: 'USE',
        score,
        reason: isLateSprint ? 'END_GAME_BURN' : duck.currentRank <= 2 ? 'OPPORTUNITY' : 'LATE_RACE',
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
  const danger = dangerOf(ctx, duck)
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
        intent: best.intent,
        wildItemInstanceId: wild.instanceId,
      })
    } else if (duck.progress >= PICKUP_BALANCE.autoUse.forceBurnProgress || pressure >= 20 || duck.currentRank === 1) {
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
    let teammateAtRisk: boolean
    let aim: BananaAimPlan | null = null
    if (brainOf(ctx)) {
      const bananaSlow = ((1 - PICKUP_BALANCE.banana.staggerMultiplier) * PICKUP_BALANCE.banana.staggerDurationSeconds
        + (1 - PICKUP_BALANCE.banana.recoverySlowMultiplier) * PICKUP_BALANCE.banana.recoveryDurationSeconds) * baseSpeed()
      aim = planBananaAim(ctx, duck, PICKUP_BALANCE.banana.aimMaxOffset, PICKUP_BALANCE.banana.dropBehindProgress, PICKUP_BALANCE.banana.hitLateralRadius, bananaSlow)
      bestIntersection = aim.intersection
      teammateAtRisk = aim.teammateAtRisk
    } else {
      const enemies = activeDucks(ctx.ducks).filter(
        (target) => target.playerId !== duck.playerId
          && !ctx.objective.isTeammate(duck.playerId, target.playerId)
          && !ctx.ghostPlayerIds?.has(target.playerId),
      )
      for (const target of enemies) {
        if (target.progress >= duck.progress) continue
        bestIntersection = Math.max(bestIntersection, bananaIntersectionScore(duck, target, AUTO_USE_CONFIG.bananaPredictionHorizonSeconds))
      }
      teammateAtRisk = activeDucks(ctx.ducks).some(
        (target) => target.playerId !== duck.playerId
          && ctx.objective.isTeammate(duck.playerId, target.playerId)
          && target.progress < duck.progress
          && (
            bananaIntersectionScore(duck, target, AUTO_USE_CONFIG.bananaPredictionHorizonSeconds) > 0
            || (duck.progress - target.progress < 0.08 && Math.abs(target.lateralOffset - duck.lateralOffset) <= PICKUP_BALANCE.banana.hitLateralRadius * 1.5)
          ),
      )
    }

    if (!teammateAtRisk && (bestIntersection > 0 || duck.progress >= AUTO_USE_CONFIG.progressLate || danger > 45)) {
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
          aimLateral: aim?.aimLateral,
          intent: aim?.targetId && bestIntersection >= 50 ? 'TRAP_SET' : undefined,
        })
      }
    } else if (teammateAtRisk && (pressure >= 20 || duck.progress >= PICKUP_BALANCE.autoUse.forceBurnProgress)) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}:discard`,
        itemId,
        source: 'WILD',
        action: 'DISCARD',
        score: 60 + pressure,
        reason: 'DISCARD',
        bypassThreshold: true,
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
    const { progressRadius, sideReach, centerBand } = wildHornReach(duck)
    const isGhost = (target: ItemDuckState) => Boolean(ctx.ghostPlayerIds?.has(target.playerId))
    const sides: HornSide[] = brainOf(ctx)
      ? [-1, 1]
      : [defaultHornSide(duck, activeDucks(ctx.ducks), progressRadius, sideReach, centerBand, isGhost)]
    let best: { side: HornSide; netValue: number; targetsCount: number; shove: boolean } | null = null
    let teammateBlocked = false

    for (const side of sides) {
      let netValue = 0
      let targetsCount = 0
      let hasTeammateInRadius = false
      let shove = false
      for (const target of hornSideTargets(duck, activeDucks(ctx.ducks), side, progressRadius, sideReach, centerBand, isGhost)) {
        if (ctx.objective.isTeammate(duck.playerId, target.playerId)) {
          hasTeammateInRadius = true
          break
        }
        const targetRuntime = ctx.itemState.byPlayer.get(target.playerId)
        if (targetRuntime && ((targetRuntime.bubbleAvailable && ctx.tick < targetRuntime.bubbleUntilTick) || (targetRuntime.wildBubbleAvailable && ctx.tick < targetRuntime.wildBubbleUntilTick))) {
          netValue -= 8
          continue
        }
        targetsCount += 1
        const impact = PICKUP_BALANCE.horn.lateralPush
        netValue += target.currentRank < duck.currentRank ? impact * 18 : impact * 8
        netValue += clamp(chaosTargetValue(ctx, target, estimateDrop(ctx, target, 0.005)) * 0.15, -4, 6)
        netValue += socialTargetBonus(ctx, target).bonus * 0.2
        if (brainOf(ctx) && shovesIntoTrap(ctx, target, side, PICKUP_BALANCE.horn.lateralShove + PICKUP_BALANCE.horn.lateralPush * 0.25)) {
          netValue += AUTO_USE_CONFIG.brain.shoveIntoTrapValue
          shove = true
        }
        if (targetRuntime && ctx.tick < targetRuntime.boostUntilTick && targetRuntime.boostMultiplier > 1 && targetRuntime.activeSpeedItemId !== 'NITRO') {
          netValue += 16
        }
        if (targetRuntime && targetRuntime.draftSlipstreamTicks > 10) {
          netValue += 10
        }
      }
      if (hasTeammateInRadius) { teammateBlocked = true; continue }
      if (targetsCount === 0) continue
      if (targetsCount >= 2) netValue += 10 * (targetsCount - 1)
      if (!best || netValue > best.netValue) best = { side, netValue, targetsCount, shove }
    }

    if (best && best.netValue + pressure * 0.1 >= 8) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}`,
        itemId,
        source: 'WILD',
        action: 'USE',
        score: clamp(best.netValue, 0, 100) + endGameBurnScore(duck.progress, 'WILD') + pressure * 0.1,
        reason: 'OPPORTUNITY',
        wildItemInstanceId: wild.instanceId,
        hornSide: brainOf(ctx) ? best.side : undefined,
        intent: best.shove ? 'SHOVE' : undefined,
      })
    } else if (!best && teammateBlocked && (pressure >= 20 || duck.progress >= PICKUP_BALANCE.autoUse.forceBurnProgress)) {
      candidates.push({
        itemKey: `wild:${wild.instanceId}:discard`,
        itemId,
        source: 'WILD',
        action: 'DISCARD',
        score: 60 + pressure,
        reason: 'DISCARD',
        bypassThreshold: true,
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

const SPEED_PREP_ITEMS = new Set<string>(['NITRO', 'DRAFT_FIN', 'PADDLE_BURST'])

/**
 * Opportunity cost of using a prep item before the temperament's planned window. Box items are
 * never held (they block the next box). Danger and desperation erase patience.
 */
export function holdCost(ctx: EvaluationContext, candidate: Pick<AutoUseCandidate, 'itemId' | 'source'>) {
  if (candidate.source !== 'PREP') return 0
  const duck = duckById(ctx.ducks, ctx.playerId)
  const traits = traitsOf(ctx)
  const window = traits.plannedWindow[candidate.itemId as RaceItemId]
  if (window === undefined || duck.progress >= window || isDesperate(ctx, duck)) return 0
  // Full cost until the last stretch before the window, then a short ramp so the plan does not snap.
  const earliness = Math.min(1, (window - duck.progress) / AUTO_USE_CONFIG.brain.holdRampProgress)
  return traits.patience * AUTO_USE_CONFIG.brain.holdCostScale * earliness * (1 - lossRisk(ctx))
}

/** Candidate score as this duck's brain sees it (temperament, drama, plan). */
export function brainScore(ctx: EvaluationContext, candidate: AutoUseCandidate) {
  if (candidate.bypassThreshold || candidate.action === 'DISCARD') return candidate.score
  const duck = duckById(ctx.ducks, ctx.playerId)
  const traits = traitsOf(ctx)
  const offensive = isOffensiveAutoItem(String(candidate.itemId))
  let score = candidate.score
  if (offensive) score += (traits.aggression - 0.5) * AUTO_USE_CONFIG.brain.aggressionScale
  if ((offensive || SPEED_PREP_ITEMS.has(String(candidate.itemId))) && readRace(ctx.ducks).duelIds.includes(ctx.playerId)) {
    score += traits.clutch * AUTO_USE_CONFIG.brain.clutchDuelBonus
  }
  if (isDesperate(ctx, duck)) score += AUTO_USE_CONFIG.brain.desperationBonus
  return score - holdCost(ctx, candidate)
}

/** The intent a fired candidate expresses, for the AI_INTENT event. */
export function candidateIntent(ctx: EvaluationContext, candidate: AutoUseCandidate): AiIntent | undefined {
  if (candidate.intent) return candidate.intent
  const duck = duckById(ctx.ducks, ctx.playerId)
  if (readRace(ctx.ducks).duelIds.includes(ctx.playerId)) return 'CLUTCH'
  if (isDesperate(ctx, duck)) return 'DESPERATE'
  if (SPEED_PREP_ITEMS.has(String(candidate.itemId)) && duck.currentRank === 1) return 'BREAKAWAY'
  return undefined
}

export function decideOffensiveAutoItemAction(ctx: EvaluationContext): AutoUseCandidate | null {
  const attach = (candidate: AutoUseCandidateDraft): AutoUseCandidate => ({ ...candidate, playerId: ctx.playerId })
  const candidates = [
    ...evaluatePrepCandidates(ctx),
    ...evaluateWildCandidates(ctx),
  ].map(attach)
  if (candidates.length === 0) return null
  const threshold = dynamicThreshold(ctx)
  const scored = candidates
    .map((candidate) => ({ candidate, score: brainScore(ctx, candidate) }))
    .sort((left, right) => right.score - left.score || left.candidate.itemKey.localeCompare(right.candidate.itemKey))
  const best = scored[0]!
  if (best.candidate.bypassThreshold || best.score >= threshold) return { ...best.candidate, score: best.score }
  // Ready but deliberately saved for the planned window: remember it so the duck can announce the plan.
  const brain = brainOf(ctx)
  if (brain) {
    const held = scored.find(({ candidate }) => candidate.score >= threshold && holdCost(ctx, candidate) > 0)
    brain.heldItemId = held ? held.candidate.itemId as RaceItemId : brain.heldItemId
  }
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
  // Re-aim with the fresh read: the duck kept moving during its reaction delay.
  pending.aimLateral = fresh.aimLateral
  pending.hornSide = fresh.hornSide
  if (pending.itemId === 'HOMING_ROCKET' || pending.itemId === 'MINI_ROCKET') {
    const kind = pending.itemId === 'HOMING_ROCKET' ? 'PREP' : 'WILD'
    const resolvedTarget = resolveRocketTarget(ctx, kind, pending.targetPlayerId)
    if (!resolvedTarget) return false
    if (ctx.objective.isTeammate(ctx.playerId, resolvedTarget)) return false
    pending.targetPlayerId = resolvedTarget
  }
  const threshold = dynamicThreshold(ctx)
  return brainScore(ctx, { ...fresh, playerId: ctx.playerId }) >= threshold * 0.85
}

export { dynamicThreshold }
