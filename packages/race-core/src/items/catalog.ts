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
  { id: 'NITRO', name: 'Nitro', icon: '⚡', cost: 2, category: 'major', itemClass: 'SPEED', description: 'Bứt tốc mạnh mẽ +25% trong 2.0s để xé gió vượt lên dẫn đầu.' },
  { id: 'DRAFT_FIN', name: 'Draft Fin', icon: '🦈', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Bám sát đuôi đối thủ phía trước để lướt gió tăng tốc +20% trong 1.6s (1 lần/trận).' },
  { id: 'PADDLE_BURST', name: 'Paddle Burst', icon: '🛶', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Quạt nước tăng tốc +18% trong 1.8s lội ngược dòng ở chặng cuối (1 lần/trận).' },
  { id: 'BUBBLE_SHIELD', name: 'Bubble Shield', icon: '🫧', cost: 2, category: 'major', itemClass: 'DEFENSE', description: 'Bật bong bóng phòng hộ 4.5s, chặn hoàn toàn 1 đòn tấn công/bẫy và tạo lực đẩy +12% khi nổ.' },
  { id: 'FEATHER', name: 'Feather', icon: '🪶', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Lông vũ hộ thân, tự động nhảy né 1 lần dẫm phải vỏ chuối hoặc bẫy nước.' },
  { id: 'SHOCK_ABSORBER', name: 'Shock Absorber', icon: '🦺', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Áo giảm chấn, giảm hãm tên lửa còn 65% trong 0.9s và giảm 60% lực đẩy Còi.' },
  { id: 'HOMING_ROCKET', name: 'Homing Rocket', icon: '🚀', cost: 2, category: 'major', itemClass: 'ATTACK', description: 'Bắn tên lửa tầm nhiệt hãm đối thủ còn 25% tốc độ trong 2.5s và ngắt ngay trạng thái tăng tốc.' },
  { id: 'BANANA', name: 'Banana', icon: '🍌', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Thả vỏ chuối bẫy phía sau, khiến đối thủ giẫm phải bị trượt văng làn và giật lùi quãng đường.' },
  { id: 'QUACK_HORN', name: 'Quack Horn', icon: '🔊', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Bấm còi sóng xung kích húc dạt mạnh đối thủ bơi sát, triệt tiêu tăng tốc và khóa item trong 2.5s.' },
] as const

export const AUTO_LOADOUT_PRESETS: readonly RaceItemId[][] = [
  ['NITRO', 'DRAFT_FIN'],
  ['BUBBLE_SHIELD', 'FEATHER'],
  ['HOMING_ROCKET', 'BANANA'],
] as const

export function getRaceItem(itemId: RaceItemId) {
  return RACE_ITEM_CATALOG.find((item) => item.id === itemId)!
}
