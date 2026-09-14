import { RACE_ITEM_CATALOG, validateLoadout } from '@/packages/race-core/src'
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

export function selectAutoLoadout(seed: string, playerId: string): RaceItemId[] {
  const rng = createRaceRng(seed, `auto-loadout:${playerId}`)
  const majorItems = RACE_ITEM_CATALOG.filter((item) => item.cost === 2 || item.category === 'major')
  const minorItems = RACE_ITEM_CATALOG.filter((item) => item.cost === 1 || item.category === 'minor')

  const major = majorItems[rng.integer(0, majorItems.length - 1)].id
  const minor = minorItems[rng.integer(0, minorItems.length - 1)].id

  return [major, minor]
}
