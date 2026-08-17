import type { WildItemId } from '../../../race-protocol/src'

export type WildItemCategory = 'ATTACK' | 'DEFENSE' | 'MOBILITY' | 'UTILITY'
export type WildItemBehavior = 'INSTANT' | 'HELD'

export interface WildItemDefinition {
  id: WildItemId
  displayName: string
  icon: string
  category: WildItemCategory
  behavior: WildItemBehavior
  description: string
}

export const WILD_ITEM_CATALOG: readonly WildItemDefinition[] = [
  { id: 'MINI_NITRO', displayName: 'Mini Nitro', icon: '⚡', category: 'MOBILITY', behavior: 'INSTANT', description: '+30% tốc độ trong 2.5 giây.' },
  { id: 'TAILWIND', displayName: 'Tailwind', icon: '🌊', category: 'UTILITY', behavior: 'INSTANT', description: '+20% tốc độ và bơi ổn định trong 3.0 giây.' },
  { id: 'MINI_BUBBLE', displayName: 'Mini Bubble', icon: '🫧', category: 'DEFENSE', behavior: 'HELD', description: 'Chặn một Wild attack trong tối đa 6 giây.' },
  { id: 'MINI_ROCKET', displayName: 'Mini Rocket', icon: '🚀', category: 'ATTACK', behavior: 'HELD', description: 'Bắn dzịt phía trước: hãm tốc độ còn 35% trong 2.0 giây.' },
  { id: 'BANANA', displayName: 'Banana', icon: '🍌', category: 'ATTACK', behavior: 'HELD', description: 'Thả bẫy ngay lane phía sau: trượt lùi trên track + lệch lane.' },
  { id: 'QUACK_HORN', displayName: 'Quack Horn', icon: '🔊', category: 'UTILITY', behavior: 'HELD', description: 'Đẩy mạnh ngang dzịt đang bơi sát.' },
  { id: 'FEATHER', displayName: 'Feather Hop', icon: '🪽', category: 'DEFENSE', behavior: 'HELD', description: 'Kích hoạt timed dodge — né Banana/hazard kế tiếp (Wild pickup, khác Prep Feather passive).' },
  { id: 'SLIPSTREAM_MAGNET', displayName: 'Slipstream Magnet', icon: '🧲', category: 'MOBILITY', behavior: 'INSTANT', description: 'Bám luồng hút dzịt gần nhất phía trước (+18% tốc độ trong 1.6s).' },
] as const

export const WILD_ITEM_BY_ID = new Map(WILD_ITEM_CATALOG.map((item) => [item.id, item]))

export function getWildItem(itemId: WildItemId) {
  const item = WILD_ITEM_BY_ID.get(itemId)
  if (!item) throw new Error(`Unknown Wild Item: ${itemId}`)
  return item
}
