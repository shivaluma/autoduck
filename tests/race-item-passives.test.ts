import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createItemRaceState,
  createSimulation,
  stepSimulation,
  slipstreamReady,
  tryApplyPrepSpeedBoost,
  ITEM_BALANCE,
} from '../packages/race-core/src'
import { evaluatePrepCandidates, evaluateReactiveDefense } from '../packages/race-core/src/auto-use/evaluate'
import { executePrepAction } from '../packages/race-core/src/auto-use/execute'
import { buildRaceObjectiveContext } from '../packages/race-core/src/auto-use/objective'
import type { RaceConfig } from '../packages/race-protocol/src'

function dummyConfig(loadouts: RaceConfig['loadouts'] = []): RaceConfig {
  return {
    raceId: 'test-passives',
    seed: '0'.repeat(64),
    protocolVersion: '1.0.0',
    engineVersion: '1.2.0',
    balanceVersion: 'S3.11',
    trackVersion: 'river-01-v2',
    tickRate: 60,
    players: [
      { playerId: 'duck-1', name: 'Duck 1' },
      { playerId: 'duck-2', name: 'Duck 2' },
      { playerId: 'duck-3', name: 'Duck 3' },
      { playerId: 'duck-4', name: 'Duck 4' },
    ],
    loadouts,
  }
}

test('Paddle Burst is unlocked during endgame burn even if rank is 1', () => {
  const cfg = dummyConfig([
    { playerId: 'duck-1', itemIds: ['BUBBLE_SHIELD', 'PADDLE_BURST'], source: 'PLAYER' },
  ])
  const itemState = createItemRaceState(cfg)
  const ducks = [
    { playerId: 'duck-1', progress: 0.85, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false },
    { playerId: 'duck-2', progress: 0.8, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false },
  ]
  const objective = buildRaceObjectiveContext(cfg)
  const evalCtx = {
    tick: 100,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
    ghostPlayerIds: new Set<string>(),
  }

  const candidates = evaluatePrepCandidates(evalCtx)
  const pbCandidate = candidates.find((c) => c.itemId === 'PADDLE_BURST')
  assert.ok(pbCandidate, 'Paddle Burst candidate should be generated at progress >= 0.78 for Rank 1')

  const candidateAsAction = {
    ...pbCandidate,
    executionDelayTicks: 0,
    itemKey: pbCandidate.itemKey,
    action: pbCandidate.action,
    itemId: pbCandidate.itemId,
    source: pbCandidate.source,
    score: pbCandidate.score,
    reason: pbCandidate.reason,
  }
  const executed = executePrepAction(candidateAsAction, itemState, ducks[0]!, ducks, 100, 60, () => undefined, {}, cfg)
  assert.equal(executed, true, 'Paddle Burst should execute successfully during endgame sprint')
})

test('Speed Demon reduces Draft Fin hold requirement', () => {
  const cfg = dummyConfig([
    { playerId: 'duck-1', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' }, // Speed Demon
    { playerId: 'duck-2', itemIds: ['BUBBLE_SHIELD', 'DRAFT_FIN'], source: 'PLAYER' }, // Mixed
  ])
  const itemState = createItemRaceState(cfg)
  const runtime1 = itemState.byPlayer.get('duck-1')!
  const runtime2 = itemState.byPlayer.get('duck-2')!

  assert.equal(runtime1.loadoutCombo, 'SPEED DEMON')
  assert.equal(runtime2.loadoutCombo, 'MAD DUCK')

  // Normal required ticks = 0.75 * 60 = 45 ticks. Speed demon required = 0.75 * 0.8 * 60 = 36 ticks.
  runtime1.draftSlipstreamTicks = 38
  runtime2.draftSlipstreamTicks = 38

  assert.equal(slipstreamReady(runtime1, 60), true, 'Speed Demon should be ready at 38 ticks')
  assert.equal(slipstreamReady(runtime2, 60), false, 'Non-Speed-Demon should require 45 ticks')
})

test('Fortress reduces duck collision push', () => {
  const cfg = dummyConfig([
    { playerId: 'duck-1', itemIds: ['BUBBLE_SHIELD', 'SHOCK_ABSORBER'], source: 'PLAYER' }, // Fortress
    { playerId: 'duck-2', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' }, // Speed Demon
  ])
  const sim = createSimulation(cfg, { recordEvents: false })
  sim.ducks[0]!.progress = 0.5
  sim.ducks[0]!.lateralOffset = 0.05
  sim.ducks[1]!.progress = 0.5
  sim.ducks[1]!.lateralOffset = -0.05

  const prevOffset0 = sim.ducks[0]!.lateralOffset
  const prevOffset1 = sim.ducks[1]!.lateralOffset

  stepSimulation(sim)

  const delta0 = Math.abs(sim.ducks[0]!.lateralOffset - prevOffset0)
  const delta1 = Math.abs(sim.ducks[1]!.lateralOffset - prevOffset1)

  assert.ok(delta0 < delta1, 'Fortress duck should experience less lateral displacement than non-fortress duck')
})

test('Menace reduces arm progress for offensive items', () => {
  const cfg = dummyConfig([
    { playerId: 'duck-1', itemIds: ['HOMING_ROCKET', 'BANANA'], source: 'PLAYER' }, // Menace
    { playerId: 'duck-2', itemIds: ['NITRO', 'HOMING_ROCKET'], source: 'PLAYER' }, // Mixed
  ])
  const itemState = createItemRaceState(cfg)
  assert.equal(itemState.byPlayer.get('duck-1')!.loadoutCombo, 'MENACE')
  assert.equal(itemState.byPlayer.get('duck-2')!.loadoutCombo, 'MAD DUCK')

  const ducks = [
    { playerId: 'duck-1', progress: 0.23, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.23, lateralOffset: 0, lateralVelocity: 0, currentRank: 3, finished: false },
    { playerId: 'duck-3', progress: 0.3, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false },
  ]
  const objective = buildRaceObjectiveContext(cfg)

  // At progress 0.23, base rocket armProgress is 0.25. Menace has 0.25 - 0.03 = 0.22.
  const evalCtx1 = {
    tick: 100,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: false,
    ghostPlayerIds: new Set<string>(),
  }
  const evalCtx2 = { ...evalCtx1, playerId: 'duck-2' }

  const candidates1 = evaluatePrepCandidates(evalCtx1)
  const candidates2 = evaluatePrepCandidates(evalCtx2)

  assert.ok(candidates1.some((c) => c.itemId === 'HOMING_ROCKET'), 'Menace should be armed at progress 0.23')
  assert.ok(!candidates2.some((c) => c.itemId === 'HOMING_ROCKET'), 'Mixed should NOT be armed at progress 0.23')
})

test('Quack Horn dispels active speed boost and silences victims for 3.0 seconds', () => {
  const cfg = dummyConfig([
    { playerId: 'duck-1', itemIds: ['HOMING_ROCKET', 'QUACK_HORN'], source: 'PLAYER' },
    { playerId: 'duck-2', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
  ])
  const itemState = createItemRaceState(cfg)
  const runtime1 = itemState.byPlayer.get('duck-1')!
  const runtime2 = itemState.byPlayer.get('duck-2')!

  // duck-2 has an active Nitro boost
  tryApplyPrepSpeedBoost(runtime2, 'duck-2', 'NITRO', 1.15, 1.5, 10, 60, () => undefined)
  assert.equal(runtime2.activeSpeedItemId, 'NITRO')
  assert.ok(runtime2.boostMultiplier > 1)

  const ducks = [
    { playerId: 'duck-1', progress: 0.5, lateralOffset: 0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.51, lateralOffset: 0.05, lateralVelocity: 0, currentRank: 1, finished: false },
  ]

  const emitted: Array<{ type: string; source?: string; target?: string }> = []
  const emit = (type: string, source?: string, target?: string) => {
    emitted.push({ type, source, target })
  }

  const candidate = {
    playerId: 'duck-1',
    itemKey: 'prep:QUACK_HORN',
    itemId: 'QUACK_HORN' as const,
    source: 'PREP' as const,
    action: 'USE' as const,
    score: 100,
    reason: 'OPPORTUNITY' as const,
  }

  const executed = executePrepAction(candidate, itemState, ducks[0]!, ducks, 20, 60, emit as never, {}, cfg)
  assert.equal(executed, true)

  // duck-2's boost should be broken (dispelled)
  assert.equal(runtime2.activeSpeedItemId, null)
  assert.equal(runtime2.boostMultiplier, 1)

  // duck-2 should be silenced until tick 20 + duration * 60
  assert.equal(runtime2.silencedUntilTick, 20 + Math.round(ITEM_BALANCE.horn.silenceDurationSeconds * 60))
  assert.ok(emitted.some((e) => e.type === 'BOOST_BROKEN'))
  assert.ok(emitted.some((e) => e.type === 'ITEM_SILENCED'))
  assert.ok(emitted.some((e) => e.type === 'PREDATOR_RUSH_STARTED')) // duck-1 is MENACE!
})

test('Silenced ducks cannot evaluate or execute prep items or reactive defense', () => {
  const cfg = dummyConfig([
    { playerId: 'duck-1', itemIds: ['BUBBLE_SHIELD', 'PADDLE_BURST'], source: 'PLAYER' },
  ])
  const itemState = createItemRaceState(cfg)
  const runtime1 = itemState.byPlayer.get('duck-1')!
  runtime1.silencedUntilTick = 500

  const ducks = [
    { playerId: 'duck-1', progress: 0.85, lateralOffset: 0, lateralVelocity: 0, currentRank: 1, finished: false },
  ]
  const objective = buildRaceObjectiveContext(cfg)
  const evalCtx = {
    tick: 100,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: true,
    ghostPlayerIds: new Set<string>(),
  }

  // Prep candidates should be empty while silenced
  const prepCandidates = evaluatePrepCandidates(evalCtx)
  assert.equal(prepCandidates.length, 0)

  // Reactive defense should be empty while silenced
  itemState.rockets.push({
    id: 1,
    sourcePlayerId: 'duck-2',
    targetPlayerId: 'duck-1',
    progress: 0.8,
    spawnedAtTick: 90,
    launchAtTick: 90,
    expiresAtTick: 300,
    kind: 'PREP',
    speedPerSecond: 0.16,
    hitRadius: 0.014,
    slowMultiplier: 0.68,
    slowDurationSeconds: 1.15,
    retargeted: false,
  })
  const reactiveCandidates = evaluateReactiveDefense(evalCtx)
  assert.equal(reactiveCandidates.length, 0)

  // Execution should be blocked
  const candidate = {
    playerId: 'duck-1',
    itemKey: 'prep:BUBBLE_SHIELD',
    itemId: 'BUBBLE_SHIELD' as const,
    source: 'PREP' as const,
    action: 'USE' as const,
    score: 100,
    reason: 'LATE_RACE' as const,
  }
  assert.equal(executePrepAction(candidate, itemState, ducks[0]!, ducks, 100, 60, () => undefined), false)
})

test('Horn AI prioritizes dispelling boosting targets and benefits from expanded radius', () => {
  const cfg = dummyConfig([
    { playerId: 'duck-1', itemIds: ['HOMING_ROCKET', 'QUACK_HORN'], source: 'PLAYER' }, // Menace
    { playerId: 'duck-2', itemIds: ['NITRO', 'DRAFT_FIN'], source: 'PLAYER' },
    { playerId: 'duck-3', itemIds: ['BUBBLE_SHIELD', 'FEATHER'], source: 'PLAYER' },
  ])
  const itemState = createItemRaceState(cfg)
  const runtime2 = itemState.byPlayer.get('duck-2')!

  // Position duck-2 at expanded progress distance (0.05) and lateral offset (0.45)
  // Base progressRadius * 1.5 = 0.040 * 1.5 = 0.060
  // Base lateralRadius * 1.5 = 0.48 * 1.5 = 0.72
  const ducks = [
    { playerId: 'duck-1', progress: 0.50, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 2, finished: false },
    { playerId: 'duck-2', progress: 0.54, lateralOffset: 0.45, lateralVelocity: 0, currentRank: 1, finished: false },
    { playerId: 'duck-3', progress: 0.80, lateralOffset: 0.0, lateralVelocity: 0, currentRank: 3, finished: false },
  ]
  const objective = buildRaceObjectiveContext(cfg)

  const evalCtxNormal = {
    tick: 100,
    tickRate: 60,
    objective,
    itemState,
    pickupState: { hazards: [] } as never,
    ducks,
    playerId: 'duck-1',
    secondsUntilNextPickupZone: 999,
    prepAutoUseEnabled: true,
    wildAutoUseEnabled: true,
    ghostPlayerIds: new Set<string>(),
  }

  // Without boost on duck-2
  const candidatesWithoutBoost = evaluatePrepCandidates(evalCtxNormal)
  const hornCand1 = candidatesWithoutBoost.find((c) => c.itemId === 'QUACK_HORN')
  assert.ok(hornCand1, 'Horn should detect duck-2 in expanded radius')

  // With active Nitro boost on duck-2
  tryApplyPrepSpeedBoost(runtime2, 'duck-2', 'NITRO', 1.15, 1.5, 90, 60, () => undefined)
  const candidatesWithBoost = evaluatePrepCandidates(evalCtxNormal)
  const hornCand2 = candidatesWithBoost.find((c) => c.itemId === 'QUACK_HORN')
  assert.ok(hornCand2, 'Horn should detect boosting duck-2')
  assert.ok(hornCand2.score > hornCand1.score, 'Horn score should be significantly higher when target is actively boosting')
})
