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
  { id: 'MINI_NITRO', displayName: 'Mini Nitro', icon: '⚡', category: 'MOBILITY', behavior: 'INSTANT', description: 'Bứt tốc tức thì +30% tốc độ trong 2.5 giây.' },
  { id: 'TAILWIND', displayName: 'Tailwind', icon: '🌊', category: 'UTILITY', behavior: 'INSTANT', description: 'Thuận gió đẩy thuyền: +20% tốc độ và bơi ổn định giữ làn trong 3.0 giây.' },
  { id: 'MINI_BUBBLE', displayName: 'Mini Bubble', icon: '🫧', category: 'DEFENSE', behavior: 'HELD', description: 'Bong bóng phòng hộ cầm tay: chặn 1 đòn tấn công hoặc bẫy trong tối đa 6.0 giây.' },
  { id: 'MINI_ROCKET', displayName: 'Mini Rocket', icon: '🚀', category: 'ATTACK', behavior: 'HELD', description: 'Bắn tên lửa mini phá tăng tốc và hãm tốc độ đối thủ phía trước còn 50% trong 0.8 giây.' },
  { id: 'BANANA', displayName: 'Banana', icon: '🍌', category: 'ATTACK', behavior: 'HELD', description: 'Thả bẫy chuối trên làn bơi (8s): đối thủ đạp phải bị trượt lệch làn và giật lùi 4% quãng đường.' },
  { id: 'QUACK_HORN', displayName: 'Quack Horn', icon: '🔊', category: 'UTILITY', behavior: 'HELD', description: 'Thổi còi xung kích húc dạt các vịt bơi sát cạnh sang hai bên.' },
  { id: 'FEATHER', displayName: 'Feather Hop', icon: '🪽', category: 'DEFENSE', behavior: 'HELD', description: 'Lông Vũ nhảy né (5.0s): tự động kích hoạt nhảy né bẫy Chuối hoặc chướng ngại vật kế tiếp.' },
  { id: 'SLIPSTREAM_MAGNET', displayName: 'Slipstream Magnet', icon: '🧲', category: 'MOBILITY', behavior: 'INSTANT', description: 'Nam châm bám luồng hút đối thủ gần nhất phía trước, tăng +18% tốc độ trong 1.6 giây.' },
] as const

export const WILD_ITEM_BY_ID = new Map(WILD_ITEM_CATALOG.map((item) => [item.id, item]))

export function getWildItem(itemId: WildItemId) {
  const item = WILD_ITEM_BY_ID.get(itemId)
  if (!item) throw new Error(`Unknown Wild Item: ${itemId}`)
  return item
}
