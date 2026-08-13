import type { RaceItemId } from '../../../race-protocol/src'
import { getRaceItem } from './catalog'

export const PREP_CREDITS = 3
export const LOADOUT_SLOTS = 2

export function validateLoadout(itemIds: RaceItemId[]) {
  if (itemIds.length > LOADOUT_SLOTS) throw new Error(`Tối đa ${LOADOUT_SLOTS} items`)
  if (new Set(itemIds).size !== itemIds.length) throw new Error('Không được chọn item trùng nhau')
  const items = itemIds.map(getRaceItem)
  const spent = items.reduce((sum, item) => sum + item.cost, 0)
  if (spent > PREP_CREDITS) throw new Error(`Vượt quá ${PREP_CREDITS} Prep Credits`)
  if (items.filter((item) => item.category === 'major').length > 1) throw new Error('Tối đa 1 Major Item')
  return { items, spent, ready: spent === PREP_CREDITS && itemIds.length === LOADOUT_SLOTS }
}
