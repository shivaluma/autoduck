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

test('authoritative runtime exposes durable snapshot and event batches for multi-instance viewers', async () => {
  const config = raceConfigSchema.parse({
    raceId: 'runtime-persistence',
    seed: '32'.repeat(32),
    players: Array.from({ length: 8 }, (_, index) => ({ playerId: String(index + 1), name: `Duck ${index + 1}` })),
  })
  const snapshotTicks: number[] = []
  const persistedEventTypes: string[] = []
  const result = await runAuthoritativeRace(config, {
    realtime: false,
    persistenceRate: 2,
    onSnapshot: (snapshot) => snapshotTicks.push(snapshot.tick),
    onEvents: (events) => persistedEventTypes.push(...events.map((event) => event.type)),
  })

  assert.ok(snapshotTicks.length > 10)
  assert.equal(snapshotTicks.at(-1), Math.ceil(result.durationMs / (1000 / config.tickRate)))
  assert.equal(persistedEventTypes[0], 'RACE_STARTED')
  assert.equal(persistedEventTypes.at(-1), 'RACE_FINISHED')
})
