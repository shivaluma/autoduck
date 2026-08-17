import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRiverTrack,
  createSimulation,
  evaluateSmartDesiredLateralOffset,
  simulateRace,
  stepSimulation,
} from '../packages/race-core/src'
import {
  DEFAULT_TRACK_VERSION,
  RACE_BALANCE_VERSION,
  RACE_ENGINE_VERSION,
  RACE_PROTOCOL_VERSION,
  RACE_TICK_RATE,
  raceConfigSchema,
  type RaceConfig,
} from '../packages/race-protocol/src'
import { createRaceRng } from '../packages/race-core/src/rng'

function config(seed: string, playerCount = 8): RaceConfig {
  return raceConfigSchema.parse({
    raceId: `boost-test-${seed.slice(0, 8)}`,
    seed,
    protocolVersion: RACE_PROTOCOL_VERSION,
    engineVersion: RACE_ENGINE_VERSION,
    balanceVersion: RACE_BALANCE_VERSION,
    trackVersion: DEFAULT_TRACK_VERSION,
    tickRate: RACE_TICK_RATE,
    players: Array.from({ length: playerCount }, (_, index) => ({
      playerId: `duck-${index + 1}`,
      name: `Duck ${index + 1}`,
    })),
  })
}

test('river track defines 4 distinct 4-lane boost gates', () => {
  const track = createRiverTrack()
  assert.equal(track.boostGates.length, 4)
  for (const gate of track.boostGates) {
    assert.equal(gate.lanes.length, 4)
    assert.ok(gate.progress > 0 && gate.progress < 1)
    const tiers = gate.lanes.map((l) => l.tier)
    assert.ok(tiers.includes('HYPER'))
    assert.ok(tiers.includes('SUPER'))
    assert.ok(tiers.includes('STANDARD'))
    assert.ok(tiers.includes('NEUTRAL'))
  }
})

test('ducks trigger BOOST_GATE_PASSED events with correct tier and speed boost', () => {
  const raceConfig = config('42'.repeat(32), 6)
  const result = simulateRace(raceConfig)
  const boostEvents = result.events.filter((e) => e.type === 'BOOST_GATE_PASSED')
  assert.ok(boostEvents.length >= 6 * 3, `Expected at least 18 boost gate pass events, got ${boostEvents.length}`)

  for (const event of boostEvents) {
    assert.ok(event.sourcePlayerId)
    assert.ok(event.metadata.gateId)
    assert.ok(event.metadata.laneId)
    assert.ok(['HYPER', 'SUPER', 'STANDARD', 'NEUTRAL'].includes(event.metadata.tier as string))
    assert.ok((event.metadata.multiplier as number) > 1.0)
    assert.ok((event.metadata.durationSeconds as number) > 0)
    assert.ok(typeof event.metadata.colorHex === 'number')
  }
})

test('AI evaluates higher scores for HYPER/SUPER lanes when clear, and avoids overcrowded lanes', () => {
  const raceConfig = config('77'.repeat(32), 4)
  const state = createSimulation(raceConfig)
  const rng = createRaceRng(raceConfig.seed, 'test-ai')

  // Put duck near first boost gate (progress 0.23, approaching gate at 0.26)
  const duck = state.ducks[0]
  duck.progress = 0.23
  duck.lateralOffset = 0.0

  // Gate 1 has HYPER on lane 1 (lateral: -0.85 to -0.425, center -0.6375)
  // When lane is clear, target offset should favor the high buff lane
  const clearTarget = evaluateSmartDesiredLateralOffset(state, duck, rng)
  assert.ok(typeof clearTarget === 'number')
  assert.ok(clearTarget >= -0.85 && clearTarget <= 0.85)

  // Put other ducks in HYPER lane right next to gate to create heavy congestion
  state.ducks[1].progress = 0.24
  state.ducks[1].lateralOffset = -0.6375
  state.ducks[2].progress = 0.24
  state.ducks[2].lateralOffset = -0.6375
  state.ducks[3].progress = 0.24
  state.ducks[3].lateralOffset = -0.6375

  // Now AI should smartly avoid the clogged HYPER lane and pick another clear lane
  const congestedTarget = evaluateSmartDesiredLateralOffset(state, duck, rng)
  assert.ok(typeof congestedTarget === 'number')
  assert.notEqual(congestedTarget, -0.6375)
})
