import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createItemRaceState,
  createSimulation,
  stepSimulation,
  slipstreamReady,
  ITEM_BALANCE,
} from '../packages/race-core/src'
import { evaluatePrepCandidates } from '../packages/race-core/src/auto-use/evaluate'
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
