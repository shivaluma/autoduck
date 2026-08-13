import assert from 'node:assert/strict'
import test from 'node:test'
import { runAuthoritativeRace } from '../lib/racing/runtime'
import { simulateRace } from '../packages/race-core/src'
import { raceConfigSchema } from '../packages/race-protocol/src'

test('authoritative runtime produces the same result as direct replay', async () => {
  const config = raceConfigSchema.parse({
    raceId: '42',
    seed: '42'.repeat(32),
    players: Array.from({ length: 8 }, (_, index) => ({ playerId: String(index + 1), name: `Duck ${index + 1}` })),
  })
  const runtime = await runAuthoritativeRace(config, { realtime: false })
  assert.deepEqual(runtime, simulateRace(config))
})
