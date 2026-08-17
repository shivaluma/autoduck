import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createItemRaceState,
  tryApplyPrepSpeedBoost,
  breakActiveSpeedBoost,
  itemSpeedMultiplier,
  evaluatePrepCandidates,
  buildRaceObjectiveContext,
  ITEM_BALANCE,
  type DuckItemRuntime,
  type ItemDuckState,
  type EvaluationContext,
} from '../packages/race-core/src'
import type { RaceConfig } from '../packages/race-protocol/src'

function createTestRuntime(itemIds: Array<'NITRO' | 'DRAFT_FIN' | 'PADDLE_BURST' | 'BUBBLE_SHIELD' | 'HOMING_ROCKET'> = ['NITRO']): DuckItemRuntime {
  return {
    itemIds,
    loadoutCombo: null,
    usedItems: new Set(),
    bubbleAvailable: false,
    bubbleUntilTick: 0,
    silencedUntilTick: 0,
    featherAvailable: false,
    shockAbsorberAvailable: false,
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
  }
}

test('Nitro follows 3-phase acceleration curve: ignition, overdrive, decay', () => {
  const runtime = createTestRuntime(['NITRO'])
  const tickRate = 60
  const emit = () => undefined

  tryApplyPrepSpeedBoost(runtime, 'duck-1', 'NITRO', 1.25, 1.70, 100, tickRate, emit)

  assert.equal(runtime.activeSpeedItemId, 'NITRO')
  assert.equal(runtime.boostMultiplier, 1.25)

  // 1. Ignition phase (0.18s = 11 ticks): ticks 100..111
  // At tick 100 (elapsed 0): boost is 1.00
  const boostStart = itemSpeedMultiplier(runtime, 100)
  assert.equal(Number(boostStart.toFixed(3)), 1.000)

  // Mid ignition at tick 105 (elapsed 5/11): boost is ~1.114
  const boostMidIgnition = itemSpeedMultiplier(runtime, 105)
  assert.ok(boostMidIgnition > 1.05 && boostMidIgnition < 1.25)

  // 2. Overdrive phase (peak hold): ticks 112..187
  const boostOverdrive = itemSpeedMultiplier(runtime, 140)
  assert.equal(Number(boostOverdrive.toFixed(2)), 1.25)

  // 3. Decay phase (0.25s = 15 ticks): ticks 188..202
  // Mid decay at tick 195 (elapsed 8/15): boost is declining from 1.25 to 1.00
  const boostMidDecay = itemSpeedMultiplier(runtime, 195)
  assert.ok(boostMidDecay > 1.00 && boostMidDecay < 1.25)

  // After boost ends at tick 203: returns to 1.00
  const boostEnded = itemSpeedMultiplier(runtime, 203)
  assert.equal(boostEnded, 1.0)
})

test('Nitro does NOT cleanse slow effects and combines smoothly', () => {
  const runtime = createTestRuntime(['NITRO'])
  const tickRate = 60
  const emit = () => undefined

  // Apply a 0.8x slow for 3 seconds
  runtime.slowMultiplier = 0.80
  runtime.slowUntilTick = 300

  // Trigger Nitro at tick 100 during slow
  tryApplyPrepSpeedBoost(runtime, 'duck-1', 'NITRO', 1.25, 1.70, 100, tickRate, emit)

  // During overdrive, speed multiplier is peak (1.25) * slow (0.80) = 1.00
  const combinedOverdrive = itemSpeedMultiplier(runtime, 140)
  assert.equal(Number(combinedOverdrive.toFixed(2)), 1.00)

  // Slow remains active throughout and after Nitro ends
  const slowAfterNitro = itemSpeedMultiplier(runtime, 205)
  assert.equal(Number(slowAfterNitro.toFixed(2)), 0.80)
})

test('Attack interactions: Prep Rocket 100% break, Mini Rocket 50% break, Banana 30% disruption, Horn no break', () => {
  const tickRate = 60
  const emitted: Array<{ type: string; metadata: Record<string, unknown> }> = []
  const emit = (type: string, _source?: string, _target?: string, metadata: Record<string, unknown> = {}) => {
    emitted.push({ type, metadata })
  }

  // 1. Prep Rocket: 100% Boost Break
  const rocketVictim = createTestRuntime(['NITRO'])
  tryApplyPrepSpeedBoost(rocketVictim, 'duck-1', 'NITRO', 1.25, 1.70, 100, tickRate, emit)
  breakActiveSpeedBoost(rocketVictim, 130, tickRate, emit as never, 'attacker', 'duck-1', 'ROCKET')
  assert.equal(rocketVictim.boostMultiplier, 1)
  assert.equal(rocketVictim.activeSpeedItemId, null)
  assert.equal(emitted.find((e) => e.type === 'BOOST_BROKEN' && e.metadata.breakSource === 'ROCKET')?.metadata.partial, false)

  // 2. Mini Rocket: 50% partial break
  const miniRocketVictim = createTestRuntime(['NITRO'])
  tryApplyPrepSpeedBoost(miniRocketVictim, 'duck-2', 'NITRO', 1.25, 1.70, 100, tickRate, emit)
  const remainingBeforeMini = miniRocketVictim.boostUntilTick - 130
  breakActiveSpeedBoost(miniRocketVictim, 130, tickRate, emit as never, 'attacker', 'duck-2', 'MINI_ROCKET')
  const remainingAfterMini = miniRocketVictim.boostUntilTick - 130
  assert.equal(remainingAfterMini, Math.round(remainingBeforeMini * 0.5))
  assert.equal(miniRocketVictim.activeSpeedItemId, 'NITRO') // Still running remaining duration

  // 3. Banana: 30% partial disruption (not full 100% cancellation)
  const bananaVictim = createTestRuntime(['NITRO'])
  tryApplyPrepSpeedBoost(bananaVictim, 'duck-3', 'NITRO', 1.25, 1.70, 100, tickRate, emit)
  const remainingBeforeBanana = bananaVictim.boostUntilTick - 130
  breakActiveSpeedBoost(bananaVictim, 130, tickRate, emit as never, 'attacker', 'duck-3', 'BANANA')
  const remainingAfterBanana = bananaVictim.boostUntilTick - 130
  assert.equal(remainingAfterBanana, remainingBeforeBanana - Math.round(remainingBeforeBanana * 0.30))
  assert.equal(bananaVictim.activeSpeedItemId, 'NITRO') // Continues running underneath

  // 4. Horn: does NOT cancel Nitro
  const hornVictim = createTestRuntime(['NITRO'])
  tryApplyPrepSpeedBoost(hornVictim, 'duck-4', 'NITRO', 1.25, 1.70, 100, tickRate, emit)
  const boostUntilBeforeHorn = hornVictim.boostUntilTick
  breakActiveSpeedBoost(hornVictim, 130, tickRate, emit as never, 'attacker', 'duck-4', 'QUACK_HORN')
  assert.equal(hornVictim.boostUntilTick, boostUntilBeforeHorn)
  assert.equal(hornVictim.activeSpeedItemId, 'NITRO')
})

test('Nitro AI utility scoring: overtakes, loser zone safety, finish conversion, and rocket threat avoidance', () => {
  const baseConfig: RaceConfig = {
    raceId: 'nitro-ai-eval',
    seed: '11'.repeat(32),
    protocolVersion: '1.0.0',
    engineVersion: '1.2.0',
    balanceVersion: 'S3.12',
    trackVersion: 'river-01-v2',
    tickRate: 60,
    players: [
      { playerId: 'duck-1', name: 'Thanh' },
      { playerId: 'duck-2', name: 'Huy' },
      { playerId: 'duck-3', name: 'Minh' },
      { playerId: 'duck-4', name: 'Bao' },
      { playerId: 'duck-5', name: 'Long' },
      { playerId: 'duck-6', name: 'Khoa' },
      { playerId: 'duck-7', name: 'Nam' },
      { playerId: 'duck-8', name: 'An' },
    ],
    loadouts: [{ playerId: 'duck-6', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' }],
  }

  const itemState = createItemRaceState(baseConfig)
  const ducks: ItemDuckState[] = [
    { playerId: 'duck-1', progress: 0.85, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false },
    { playerId: 'duck-2', progress: 0.84, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-3', progress: 0.70, lateralOffset: 0, lateralVelocity: 0, currentRank: 3, finished: false },
    { playerId: 'duck-4', progress: 0.65, lateralOffset: 0, lateralVelocity: 0, currentRank: 4, finished: false },
    { playerId: 'duck-5', progress: 0.506, lateralOffset: 0, lateralVelocity: 0, currentRank: 5, finished: false },
    { playerId: 'duck-6', progress: 0.500, lateralOffset: 0, lateralVelocity: 0, currentRank: 6, finished: false },
    { playerId: 'duck-7', progress: 0.40, lateralOffset: 0, lateralVelocity: 0, currentRank: 7, finished: false },
    { playerId: 'duck-8', progress: 0.38, lateralOffset: 0, lateralVelocity: 0, currentRank: 8, finished: false },
  ]

  const normalCtx: EvaluationContext = {
    tick: 500,
    tickRate: 60,
    objective: buildRaceObjectiveContext(baseConfig),
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-6',
    secondsUntilNextPickupZone: 999,
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: true,
    ghostPlayerIds: new Set(),
  }

  // 1. Duck-6 is in position to overtake Duck-5 (gap 0.006 is well within expected gain ~0.0094)
  const normalCandidates = evaluatePrepCandidates(normalCtx)
  const nitroCandidate = normalCandidates.find((c) => c.itemId === 'NITRO')
  assert.ok(nitroCandidate, 'Nitro candidate should be evaluated')
  assert.ok(nitroCandidate.score >= 42, 'Nitro score should be high for clean overtake')

  // 2. Incoming Rocket threat: AI holds Nitro when Rocket is inbound without shield
  itemState.rockets.push({
    id: 99,
    sourcePlayerId: 'duck-7',
    targetPlayerId: 'duck-6',
    progress: 0.45,
    spawnedAtTick: 480,
    launchAtTick: 480,
    expiresAtTick: 700,
    kind: 'PREP',
    speedPerSecond: ITEM_BALANCE.rocket.projectileSpeed,
    hitRadius: ITEM_BALANCE.rocket.hitRadius,
    slowMultiplier: 0.30,
    slowDurationSeconds: 1.20,
    retargeted: false,
  })

  const threatenedCandidates = evaluatePrepCandidates(normalCtx)
  const threatenedNitro = threatenedCandidates.find((c) => c.itemId === 'NITRO')
  assert.ok(!threatenedNitro || threatenedNitro.score < 30, 'Nitro should be held when incoming rocket threatens boost break')

  // 3. Reverse Mode: AI avoids using Nitro because moving forward gives negative utility
  const reverseConfig: RaceConfig = {
    ...baseConfig,
    chaosConfig: { type: 'REVERSE' },
  }
  const reverseCtx: EvaluationContext = {
    ...normalCtx,
    objective: buildRaceObjectiveContext(reverseConfig),
  }
  itemState.rockets = [] // clear rockets
  const reverseCandidates = evaluatePrepCandidates(reverseCtx)
  const reverseNitro = reverseCandidates.find((c) => c.itemId === 'NITRO')
  assert.equal(reverseNitro, undefined, 'AI should avoid auto-using Nitro in Reverse mode')
})
