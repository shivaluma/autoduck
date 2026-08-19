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
  { id: 'NITRO', name: 'Nitro', icon: '⚡', cost: 2, category: 'major', itemClass: 'SPEED', description: 'Bình tăng tốc 3 giai đoạn (Đề pa → Đỉnh điểm +25% → Hạ nhiệt) trong 1.7s giúp xé gió vượt lên (1 lần/trận, bị phá bởi Tên Lửa).' },
  { id: 'DRAFT_FIN', name: 'Draft Fin', icon: '🦈', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Bám sát đuôi đối thủ phía trước trong 0.75s để đón luồng lướt gió tăng tốc +20% trong 1.6s (1 lần/trận).' },
  { id: 'PADDLE_BURST', name: 'Paddle Burst', icon: '🛶', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Quạt nước bứt tốc +18% trong 1.8s ở chặng cuối (từ 65% quãng đường) để lội ngược dòng (1 lần/trận).' },
  { id: 'BUBBLE_SHIELD', name: 'Bubble Shield', icon: '🫧', cost: 2, category: 'major', itemClass: 'DEFENSE', description: 'Bật bong bóng phòng hộ 4.5s khi gặp nguy hiểm, chặn hoàn toàn 1 đòn Tên Lửa hoặc bẫy Chuối; khi vỡ tạo luồng đẩy +8% trong 1.2s.' },
  { id: 'FEATHER', name: 'Feather', icon: '🪶', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Lông vũ hộ thân (Nội tại), tự động nhảy né 1 lần khi dẫm phải Vỏ Chuối hoặc chướng ngại vật (không chặn Tên Lửa).' },
  { id: 'SHOCK_ABSORBER', name: 'Shock Absorber', icon: '🦺', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Áo giáp chống sốc (Nội tại), giảm hơn 50% mức độ và thời gian khựng tốc từ Tên Lửa, giảm 60% lực đẩy từ Còi Quack Horn.' },
  { id: 'HOMING_ROCKET', name: 'Homing Rocket', icon: '🚀', cost: 2, category: 'major', itemClass: 'ATTACK', description: 'Bắn tên lửa tầm nhiệt nhắm đối thủ phía trước, triệt tiêu tăng tốc và làm khựng đứng bánh xoay vòng trong 1.6s (1 lần/trận).' },
  { id: 'BANANA', name: 'Banana', icon: '🍌', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Thả vỏ chuối bẫy trên làn bơi phía sau (10s), đối thủ dẫm phải bị trượt văng làn và giật lùi 5% quãng đường.' },
  { id: 'QUACK_HORN', name: 'Quack Horn', icon: '🔊', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Thổi còi xung kích húc dạt mạnh đối thủ bơi sát cạnh, phá luồng Lướt Gió và khóa dùng item (Câm Lặng) trong 2.5s.' },
] as const

export const AUTO_LOADOUT_PRESETS: readonly RaceItemId[][] = [
  ['NITRO', 'DRAFT_FIN'],
  ['BUBBLE_SHIELD', 'FEATHER'],
  ['HOMING_ROCKET', 'BANANA'],
] as const

export function getRaceItem(itemId: RaceItemId) {
  return RACE_ITEM_CATALOG.find((item) => item.id === itemId)!
}
