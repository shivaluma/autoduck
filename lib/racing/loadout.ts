import { AUTO_LOADOUT_PRESETS, validateLoadout } from '@/packages/race-core/src'
import { createRaceRng } from '@/packages/race-core/src/rng'
import { raceItemIdSchema, type RaceItemId } from '@/packages/race-protocol/src'

export function parseItemIds(value: string): RaceItemId[] {
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('Invalid loadout')
  return parsed.map((item) => raceItemIdSchema.parse(item))
}

export function serializeItemIds(itemIds: RaceItemId[]) {
  validateLoadout(itemIds)
  return JSON.stringify(itemIds)
}

export function selectAutoLoadout(seed: string, playerId: string) {
  const rng = createRaceRng(seed, `auto-loadout:${playerId}`)
  return [...AUTO_LOADOUT_PRESETS[rng.integer(0, AUTO_LOADOUT_PRESETS.length - 1)]]
}
