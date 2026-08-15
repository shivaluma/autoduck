import type { RaceItemId } from '../../../race-protocol/src'

export type ItemClass = 'SPEED' | 'DEFENSE' | 'ATTACK'

export const ITEM_CLASS_BY_ID: Record<RaceItemId, ItemClass> = {
  NITRO: 'SPEED',
  DRAFT_FIN: 'SPEED',
  PADDLE_BURST: 'SPEED',
  BUBBLE_SHIELD: 'DEFENSE',
  FEATHER: 'DEFENSE',
  SHOCK_ABSORBER: 'DEFENSE',
  HOMING_ROCKET: 'ATTACK',
  BANANA: 'ATTACK',
  QUACK_HORN: 'ATTACK',
}

export type LoadoutComboLabel =
  | 'SPEED COMBO'
  | 'DEFENSE COMBO'
  | 'ATTACK COMBO'
  | 'HYBRID'
  | 'SPEED DEMON'
  | 'FORTRESS'
  | 'MENACE'
  | 'MAD DUCK'

export function loadoutComboLabel(itemIds: readonly RaceItemId[]): LoadoutComboLabel | null {
  if (itemIds.length !== 2) return null
  const classes = itemIds.map((id) => ITEM_CLASS_BY_ID[id])
  const unique = new Set(classes)
  if (unique.size === 1) {
    if (classes[0] === 'SPEED') return 'SPEED DEMON'
    if (classes[0] === 'DEFENSE') return 'FORTRESS'
    return 'MENACE'
  }
  return 'MAD DUCK'
}

export function loadoutComboBadge(itemIds: readonly RaceItemId[]): string | null {
  if (itemIds.length !== 2) return null
  const classes = itemIds.map((id) => ITEM_CLASS_BY_ID[id])
  const unique = new Set(classes)
  if (unique.size === 1) {
    if (classes[0] === 'SPEED') return '⚡ SPEED COMBO'
    if (classes[0] === 'DEFENSE') return '🛡️ DEFENSE COMBO'
    return '💥 ATTACK COMBO'
  }
  return '🧪 HYBRID'
}
