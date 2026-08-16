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
  { id: 'NITRO', name: 'Nitro', icon: '⚡', cost: 2, category: 'major', itemClass: 'SPEED', description: 'Bứt tốc mạnh mẽ trong chốc lát để vượt lên dẫn đầu (không cộng dồn tốc độ).' },
  { id: 'DRAFT_FIN', name: 'Draft Fin', icon: '🦈', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Bám sát đuôi đối thủ phía trước để đón luồng lướt gió tăng tốc (1 lần/trận).' },
  { id: 'PADDLE_BURST', name: 'Paddle Burst', icon: '🛶', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Quạt nước tăng tốc lội ngược dòng ở chặng sau cuộc đua (1 lần/trận).' },
  { id: 'BUBBLE_SHIELD', name: 'Bubble Shield', icon: '🫧', cost: 2, category: 'major', itemClass: 'DEFENSE', description: 'Tạo bong bóng phòng hộ, chặn hoàn toàn 1 đòn tấn công hoặc bẫy đầu tiên.' },
  { id: 'FEATHER', name: 'Feather', icon: '🪶', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Lông vũ hộ thân, tự động nhảy né 1 lần dẫm phải vỏ chuối hoặc bẫy nước.' },
  { id: 'SHOCK_ABSORBER', name: 'Shock Absorber', icon: '🦺', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Áo giảm chấn, giảm 50% lực đẩy và hiệu ứng làm chậm từ Tên Lửa / Còi đầu tiên.' },
  { id: 'HOMING_ROCKET', name: 'Homing Rocket', icon: '🚀', cost: 2, category: 'major', itemClass: 'ATTACK', description: 'Bắn tên lửa tầm nhiệt làm chậm đối thủ phía trước và ngắt ngay trạng thái tăng tốc.' },
  { id: 'BANANA', name: 'Banana', icon: '🍌', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Thả vỏ chuối bẫy phía sau, khiến đối thủ giẫm phải bị trượt làn và khựng lại.' },
  { id: 'QUACK_HORN', name: 'Quack Horn', icon: '🔊', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Bấm còi húc dạt các đối thủ bơi sát cạnh, phá tan thế bám đuôi lướt gió.' },
] as const

export const AUTO_LOADOUT_PRESETS: readonly RaceItemId[][] = [
  ['NITRO', 'DRAFT_FIN'],
  ['BUBBLE_SHIELD', 'FEATHER'],
  ['HOMING_ROCKET', 'BANANA'],
] as const

export function getRaceItem(itemId: RaceItemId) {
  return RACE_ITEM_CATALOG.find((item) => item.id === itemId)!
}
