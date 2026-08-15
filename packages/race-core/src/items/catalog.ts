import type { RaceItemId } from '../../../race-protocol/src'
import type { ItemClass } from './classes'

export interface RaceItemDefinition {
  id: RaceItemId
  name: string
  icon: string
  cost: 1 | 2
  category: 'major' | 'minor'
  itemClass: ItemClass
  description: string
}

export const RACE_ITEM_CATALOG: readonly RaceItemDefinition[] = [
  { id: 'NITRO', name: 'Nitro', icon: '⚡', cost: 2, category: 'major', itemClass: 'SPEED', description: 'Burst +18% tốc độ / 1.5s — không stack boost.' },
  { id: 'DRAFT_FIN', name: 'Draft Fin', icon: '🦈', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Slipstream: bám sát phía sau → +9% / 1.1s (1 lần/race).' },
  { id: 'PADDLE_BURST', name: 'Paddle Burst', icon: '🛶', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Comeback: >65% track + nửa dưới BXH → +8% / 1.3s (1 lần/race).' },
  { id: 'BUBBLE_SHIELD', name: 'Bubble Shield', icon: '🫧', cost: 2, category: 'major', itemClass: 'DEFENSE', description: 'Chặn 1 đòn tấn công (Rocket/Banana/wild attack).' },
  { id: 'FEATHER', name: 'Feather', icon: '🪶', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Prep passive — né Banana/trap 1 lần (khác Wild Feather Hop timed).' },
  { id: 'SHOCK_ABSORBER', name: 'Shock Absorber', icon: '🦺', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Giảm 50% Rocket/Horn đầu tiên — không chặn hẳn.' },
  { id: 'HOMING_ROCKET', name: 'Homing Rocket', icon: '🚀', cost: 2, category: 'major', itemClass: 'ATTACK', description: 'Slow ngắn + 💥 BOOST BREAK (hủy Nitro/Draft/Paddle đang chạy).' },
  { id: 'BANANA', name: 'Banana', icon: '🍌', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Bẫy phía sau — phá momentum + trượt lane.' },
  { id: 'QUACK_HORN', name: 'Quack Horn', icon: '🔊', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Đẩy ngang vịt sát — pack fight / phá slipstream.' },
] as const

export const AUTO_LOADOUT_PRESETS: readonly RaceItemId[][] = [
  ['NITRO', 'DRAFT_FIN'],
  ['BUBBLE_SHIELD', 'FEATHER'],
  ['HOMING_ROCKET', 'BANANA'],
] as const

export function getRaceItem(itemId: RaceItemId) {
  return RACE_ITEM_CATALOG.find((item) => item.id === itemId)!
}
