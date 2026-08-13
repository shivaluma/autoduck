import assert from 'node:assert/strict'
import test from 'node:test'
import { simulateRace } from '../packages/race-core/src'
import { raceConfigSchema } from '../packages/race-protocol/src'
import { buildRaceItemTelemetry } from '../lib/racing/telemetry'

test('official item telemetry uses a same-seed no-item counterfactual', () => {
  const config = raceConfigSchema.parse({
    raceId: 'telemetry-race',
    seed: 'dc'.repeat(32),
    players: Array.from({ length: 8 }, (_, index) => ({ playerId: String(index + 1), name: `Duck ${index + 1}` })),
    loadouts: Array.from({ length: 8 }, (_, index) => ({
      playerId: String(index + 1),
      itemIds: index % 2 === 0 ? ['NITRO', 'BANANA'] : ['HOMING_ROCKET', 'FEATHER'],
      source: 'PLAYER',
    })),
  })
  const official = simulateRace(config)
  const rows = buildRaceItemTelemetry(42, config, official)

  assert.equal(rows.length, 16)
  assert.equal(rows.every((row) => row.raceId === 42), true)
  assert.equal(rows.every((row) => row.baselineRank >= 1 && row.baselineRank <= 8), true)
  assert.equal(rows.every((row) => row.rankDelta === row.baselineRank - row.finalRank), true)
  assert.equal(rows.filter((row) => row.won).length, 2)
  assert.ok(rows.some((row) => row.activated))
})
