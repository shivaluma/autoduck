import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSimulation,
  simulateRace,
  snapshotSimulation,
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
import { createRaceCommit, createResultDigest } from '../lib/racing/audit'
import { replayRace } from '../lib/racing/replay'

function config(seed: string, playerCount = 8): RaceConfig {
  return raceConfigSchema.parse({
    raceId: `test-${seed.slice(0, 8)}`,
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

function seedFromIndex(index: number) {
  return index.toString(16).padStart(64, '0')
}

test('same race config reproduces the exact result and event stream', () => {
  const raceConfig = config('ab'.repeat(32))
  const first = simulateRace(raceConfig)
  const second = simulateRace(raceConfig)
  assert.deepEqual(second, first)
  assert.equal(createResultDigest(second), createResultDigest(first))
  assert.equal(first.standings.length, 8)
  assert.ok(first.durationMs >= 45_000 && first.durationMs <= 75_000)
})

test('commit changes when immutable race config changes', () => {
  const first = config('01'.repeat(32))
  const second = { ...first, seed: '02'.repeat(32) }
  assert.notEqual(createRaceCommit(first), createRaceCommit(second))
})

test('replay verifies the persisted result digest', () => {
  const raceConfig = config('ef'.repeat(32))
  const official = simulateRace(raceConfig)
  const expectedDigest = createResultDigest(official)
  assert.deepEqual(replayRace(raceConfig, expectedDigest).result, official)
  assert.throws(() => replayRace(raceConfig, '0'.repeat(64)), /Replay mismatch/)
  assert.throws(() => replayRace({ ...raceConfig, engineVersion: '0.9.0' }), /Unsupported replay version/)
})

test('legacy S3.2 replay stays pickup-free and supported', () => {
  const legacy = raceConfigSchema.parse({ ...config('ed'.repeat(32)), engineVersion: '1.1.0', balanceVersion: 'S3.2', trackVersion: 'river-01-v1', pickupConfig: undefined })
  const result = simulateRace(legacy)
  assert.equal(result.events.some((event) => event.type.startsWith('PICKUP_') || event.type.startsWith('HAZARD_') || event.type.startsWith('GOLDEN_')), false)
  assert.doesNotThrow(() => replayRace(legacy, createResultDigest(result)))
})

test('fixed-step simulation stays finite, bounded and produces unique ranks', () => {
  const state = createSimulation(config('cd'.repeat(32), 16))
  while (!state.finished) {
    stepSimulation(state)
    for (const duck of state.ducks) {
      assert.ok(Number.isFinite(duck.progress))
      assert.ok(Number.isFinite(duck.speed))
      assert.ok(Number.isFinite(duck.lateralOffset))
      assert.ok(duck.progress >= 0 && duck.progress <= 1)
      assert.ok(duck.speed > 0)
      assert.ok(duck.lateralOffset >= -1 && duck.lateralOffset <= 1)
    }
  }
  const snapshot = snapshotSimulation(state)
  assert.equal(new Set(snapshot.map((duck) => duck.rank)).size, 16)
  assert.deepEqual(snapshot.map((duck) => duck.rank), Array.from({ length: 16 }, (_, index) => index + 1))
})

test('player slots have no material win or Bottom-2 bias over many seeds', () => {
  const races = 1_000
  const wins = Array(8).fill(0) as number[]
  const bottomTwo = Array(8).fill(0) as number[]

  for (let raceIndex = 1; raceIndex <= races; raceIndex += 1) {
    const result = simulateRace(config(seedFromIndex(raceIndex)), { recordEvents: false })
    wins[Number(result.standings[0].playerId.split('-')[1]) - 1] += 1
    for (const entry of result.standings.slice(-2)) bottomTwo[Number(entry.playerId.split('-')[1]) - 1] += 1
  }

  for (const count of wins) assert.ok(Math.abs(count / races - 0.125) <= 0.04, `win rate ${count / races}`)
  for (const count of bottomTwo) assert.ok(Math.abs(count / races - 0.25) <= 0.055, `Bottom-2 rate ${count / races}`)
})
