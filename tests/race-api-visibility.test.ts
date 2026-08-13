import assert from 'node:assert/strict'
import test from 'node:test'
import { publicRaceEngineVisibility } from '../lib/racing/public-engine'
import { raceConfigSchema } from '../packages/race-protocol/src'

const config = raceConfigSchema.parse({
  raceId: 'live-skin',
  seed: 'ab'.repeat(32),
  players: [
    { playerId: '1', name: 'Thanh', cosmeticKey: JSON.stringify({ bodyColorId: 'body-sunshine' }) },
    { playerId: '2', name: 'Huy' },
  ],
})

test('pending and running races expose replay config for client-side live simulation', () => {
  for (const status of ['pending', 'running'] as const) {
    const visible = publicRaceEngineVisibility(status, config.seed, config)
    assert.equal(visible.seed, config.seed)
    assert.equal(visible.config, config)
    assert.deepEqual(visible.players, config.players)
  }
})

test('finished race reveals the immutable replay config', () => {
  const visible = publicRaceEngineVisibility('finished', config.seed, config)

  assert.equal(visible.seed, config.seed)
  assert.equal(visible.config, config)
  assert.deepEqual(visible.players, config.players)
})
