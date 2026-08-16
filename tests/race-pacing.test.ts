import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRaceRng,
  generateDuckPacingSegments,
  evaluatePacingMultiplier,
  simulateRace,
  createSimulation,
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

test('generateDuckPacingSegments guarantees exact average of 1.0 across segments', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const rng = createRaceRng(seed.toString(16).padStart(64, '0'), 'duck:test')
    const segments = generateDuckPacingSegments(rng, 4, 0.12)
    assert.equal(segments.length, 4)
    const sum = segments.reduce((acc, val) => acc + val, 0)
    const average = sum / segments.length
    assert.ok(Math.abs(average - 1.0) < 1e-9, `Expected average 1.0 but got ${average}`)
    for (const val of segments) {
      assert.ok(val >= 0.7 && val <= 1.3, `Segment value ${val} out of bounds`)
    }
  }
})

test('evaluatePacingMultiplier smoothly interpolates and preserves exact total race speed budget', () => {
  const segments = [1.12, 1.06, 0.92, 0.90]
  assert.equal(evaluatePacingMultiplier(segments, 0.0), 1.12)
  assert.equal(evaluatePacingMultiplier(segments, 0.125), 1.12)
  assert.equal(evaluatePacingMultiplier(segments, 0.375), 1.06)
  assert.equal(evaluatePacingMultiplier(segments, 0.625), 0.92)
  assert.equal(evaluatePacingMultiplier(segments, 0.875), 0.90)
  assert.equal(evaluatePacingMultiplier(segments, 1.0), 0.90)

  // Midpoint between segment 0 (1.12) and segment 1 (1.06) at progress 0.25
  const mid01 = evaluatePacingMultiplier(segments, 0.25)
  assert.ok(Math.abs(mid01 - 1.09) < 1e-6, `Expected midpoint 1.09, got ${mid01}`)

  // Numerical integration over [0, 1] with fine step size
  const steps = 10_000
  let integral = 0
  for (let i = 0; i < steps; i += 1) {
    const p = (i + 0.5) / steps
    integral += evaluatePacingMultiplier(segments, p) * (1 / steps)
  }
  assert.ok(Math.abs(integral - 1.0) < 1e-4, `Expected total integral ~1.0, got ${integral}`)
})

test('race simulation creates dynamic lead changes across 8 ducks', () => {
  const config: RaceConfig = raceConfigSchema.parse({
    raceId: 'pacing-lead-changes-test',
    seed: '7a'.repeat(32),
    protocolVersion: RACE_PROTOCOL_VERSION,
    engineVersion: RACE_ENGINE_VERSION,
    balanceVersion: RACE_BALANCE_VERSION,
    trackVersion: DEFAULT_TRACK_VERSION,
    tickRate: RACE_TICK_RATE,
    players: Array.from({ length: 8 }, (_, index) => ({
      playerId: `duck-${index + 1}`,
      name: `Duck ${index + 1}`,
    })),
  })

  const state = createSimulation(config)
  const rankHistoryByDuck = new Map<string, number[]>()
  for (const duck of state.ducks) {
    rankHistoryByDuck.set(duck.playerId, [])
  }

  while (!state.finished) {
    stepSimulation(state)
    if (state.tick % 60 === 0) {
      for (const duck of state.ducks) {
        rankHistoryByDuck.get(duck.playerId)!.push(duck.currentRank)
      }
    }
  }

  // Count number of rank changes
  let totalRankChanges = 0
  for (const ranks of rankHistoryByDuck.values()) {
    for (let i = 1; i < ranks.length; i += 1) {
      if (ranks[i] !== ranks[i - 1]) totalRankChanges += 1
    }
  }

  assert.ok(totalRankChanges > 10, `Expected multiple rank changes during race, got ${totalRankChanges}`)
})
