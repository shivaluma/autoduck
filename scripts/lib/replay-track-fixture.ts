import path from 'node:path'
import { raceConfigSchema, type RaceConfig } from '../../packages/race-protocol/src'

export const FIXTURE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'replay-track')

/** Deterministic short race for the committed DTRK fixture: 3 ducks, production pickups, a forced mini rocket. */
export function buildFixtureConfig(): RaceConfig {
  return raceConfigSchema.parse({
    raceId: '9001',
    seed: '0d'.repeat(32),
    players: [
      { playerId: '1', name: 'Fixture A' },
      { playerId: '2', name: 'Fixture B' },
      { playerId: '3', name: 'Fixture C' },
    ],
    loadouts: [
      { playerId: '1', itemIds: ['NITRO', 'HOMING_ROCKET'], source: 'AUTO' },
      { playerId: '2', itemIds: ['BANANA', 'BUBBLE_SHIELD'], source: 'AUTO' },
      { playerId: '3', itemIds: ['FEATHER', 'QUACK_HORN'], source: 'AUTO' },
    ],
    pickupConfig: {
      enabled: true,
      goldenBoxEnabled: true,
      goldenBoxProbability: 0.15,
      hazardsEnabled: true,
      spawnMultiplier: 1.25,
      regularPickupCap: 3,
      forceItem: 'MINI_ROCKET',
    },
  })
}
