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
  { id: 'MINI_NITRO', displayName: 'Mini Nitro', icon: '⚡', category: 'MOBILITY', behavior: 'INSTANT', description: 'Bứt tốc tức thì +9% tốc độ trong 1.15 giây.' },
  { id: 'TAILWIND', displayName: 'Tailwind', icon: '🌊', category: 'UTILITY', behavior: 'INSTANT', description: 'Thuận gió đẩy thuyền: +7% tốc độ và bơi ổn định giữ làn trong 1.9 giây.' },
  { id: 'MINI_BUBBLE', displayName: 'Mini Bubble', icon: '🫧', category: 'DEFENSE', behavior: 'HELD', description: 'Bong bóng phòng hộ cầm tay (6s): chặn 1 đòn tấn công hoặc bẫy rồi nhận +12% trong 1.2s; hết hạn mà chưa dùng sẽ hóa luồng đẩy +13% trong 1.8s.' },
  { id: 'MINI_ROCKET', displayName: 'Mini Rocket', icon: '🚀', category: 'ATTACK', behavior: 'HELD', description: 'Tên lửa mini cắt 50% thời gian boost còn lại, hãm tốc còn 25% trong 0.55s rồi 65% trong 0.45s. Trúng vịt Tốc độ sẽ cướp đà +20% trong 1.2s.' },
  { id: 'BANANA', displayName: 'Banana', icon: '🍌', category: 'ATTACK', behavior: 'HELD', description: 'Ném bẫy chuối (lệch tối đa 0.18 làn, 8s): đối thủ đạp phải trượt lệch làn, hãm còn 22% trong 0.6s rồi 60% trong 0.5s. Trúng vịt Tốc độ sẽ cướp đà.' },
  { id: 'QUACK_HORN', displayName: 'Quack Horn', icon: '🔊', category: 'UTILITY', behavior: 'HELD', description: 'Thổi còi về một bên, húc dạt các vịt phía đó, phá boost (trừ Nitro) và Câm Lặng 0.7s; cướp đà từ 1 vịt Tốc độ. Bong bóng đang bật chặn được còi.' },
  { id: 'FEATHER', displayName: 'Feather Hop', icon: '🪽', category: 'DEFENSE', behavior: 'HELD', description: 'Lông Vũ nhảy né (5.0s): né bẫy Chuối hoặc chướng ngại vật kế tiếp rồi nhận +12% trong 1.2s; hết hạn mà chưa dùng sẽ hóa luồng lướt +8% trong 1.2s.' },
  { id: 'SLIPSTREAM_MAGNET', displayName: 'Slipstream Magnet', icon: '🧲', category: 'MOBILITY', behavior: 'INSTANT', description: 'Nam châm bám luồng hút đối thủ gần nhất phía trước, tăng +12% tốc độ trong 1.6 giây.' },
] as const

export const WILD_ITEM_BY_ID = new Map(WILD_ITEM_CATALOG.map((item) => [item.id, item]))

export function getWildItem(itemId: WildItemId) {
  const item = WILD_ITEM_BY_ID.get(itemId)
  if (!item) throw new Error(`Unknown Wild Item: ${itemId}`)
  return item
}
