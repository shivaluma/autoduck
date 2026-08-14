import type { RaceItemId } from '../../../race-protocol/src'

export interface RaceItemDefinition {
  id: RaceItemId
  name: string
  icon: string
  cost: 1 | 2
  category: 'major' | 'minor'
  description: string
}

export const RACE_ITEM_CATALOG: readonly RaceItemDefinition[] = [
  { id: 'BUBBLE_SHIELD', name: 'Bubble Shield', icon: '🫧', cost: 2, category: 'major', description: 'Chặn Rocket hoặc Banana đầu tiên.' },
  { id: 'HOMING_ROCKET', name: 'Homing Rocket', icon: '🚀', cost: 2, category: 'major', description: 'Twin volley: 2 rocket vào 2 dzịt phía trước, cách 0.7s — chậm 20% / 3.5s mỗi viên.' },
  { id: 'NITRO', name: 'Nitro', icon: '⚡', cost: 2, category: 'major', description: 'Tăng tốc +35% (max) trong 5.5 giây khi cần bứt phá.' },
  { id: 'BANANA', name: 'Banana', icon: '🍌', cost: 1, category: 'minor', description: 'Bẫy lane phía sau: knockback mạnh hơn, giữ chân kẻ đuổi.' },
  { id: 'FEATHER', name: 'Feather', icon: '🪶', cost: 1, category: 'minor', description: 'Né Banana đầu tiên.' },
  { id: 'QUACK_HORN', name: 'Quack Horn', icon: '🔊', cost: 1, category: 'minor', description: 'Đẩy rộng hơn — mở lane cho Rocket/Nitro.' },
] as const

export const AUTO_LOADOUT_PRESETS: readonly RaceItemId[][] = [
  ['NITRO', 'BANANA'],
  ['BUBBLE_SHIELD', 'QUACK_HORN'],
  ['HOMING_ROCKET', 'FEATHER'],
] as const

export function getRaceItem(itemId: RaceItemId) {
  return RACE_ITEM_CATALOG.find((item) => item.id === itemId)!
}
