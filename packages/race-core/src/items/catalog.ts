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
  { id: 'HOMING_ROCKET', name: 'Homing Rocket', icon: '🚀', cost: 2, category: 'major', description: 'Bắn dzịt phía trước: chậm còn 10% tốc độ trong 4.4 giây.' },
  { id: 'NITRO', name: 'Nitro', icon: '⚡', cost: 2, category: 'major', description: 'Tự tăng tốc khi đang tụt lại.' },
  { id: 'BANANA', name: 'Banana', icon: '🍌', cost: 1, category: 'minor', description: 'Thả bẫy ngay lane phía sau: trượt lùi trên track.' },
  { id: 'FEATHER', name: 'Feather', icon: '🪶', cost: 1, category: 'minor', description: 'Né Banana đầu tiên.' },
  { id: 'QUACK_HORN', name: 'Quack Horn', icon: '🔊', cost: 1, category: 'minor', description: 'Đẩy mạnh ngang các dzịt đang bơi sát.' },
] as const

export const AUTO_LOADOUT_PRESETS: readonly RaceItemId[][] = [
  ['NITRO', 'BANANA'],
  ['BUBBLE_SHIELD', 'QUACK_HORN'],
  ['HOMING_ROCKET', 'FEATHER'],
] as const

export function getRaceItem(itemId: RaceItemId) {
  return RACE_ITEM_CATALOG.find((item) => item.id === itemId)!
}
