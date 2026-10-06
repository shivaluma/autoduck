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
  { id: 'NITRO', name: 'Nitro', icon: '⚡', cost: 2, category: 'major', itemClass: 'SPEED', description: 'Bình tăng tốc 3 giai đoạn (Đề pa → Đỉnh điểm +25% → Hạ nhiệt) trong 1.8s giúp xé gió vượt lên (1 lần/trận). Khắc chế Phòng thủ; bị Tấn công phá đà và cướp tốc.' },
  { id: 'DRAFT_FIN', name: 'Draft Fin', icon: '🦈', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Bám sát đuôi đối thủ phía trước trong 0.75s để đón luồng lướt gió tăng tốc +21% trong 1.6s (1 lần/trận).' },
  { id: 'PADDLE_BURST', name: 'Paddle Burst', icon: '🛶', cost: 1, category: 'minor', itemClass: 'SPEED', description: 'Quạt nước bứt tốc +15% trong 1.8s ở chặng cuối (từ 65% quãng đường) để lội ngược dòng (1 lần/trận).' },
  { id: 'BUBBLE_SHIELD', name: 'Bubble Shield', icon: '🫧', cost: 2, category: 'major', itemClass: 'DEFENSE', description: 'Bong bóng phản xạ: tự bung khi Tên Lửa/Chuối trang bị đầu tiên sắp trúng (trừ khi đang bị Câm Lặng) và chặn hoàn toàn; khi đang bật cũng vô hiệu Còi và đồ nhặt. Chặn thành công nhận Guard Surge +8% trong 1s. Cồng kềnh: chậm 0.5% khi chưa dùng.' },
  { id: 'FEATHER', name: 'Feather', icon: '🪶', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Lông vũ hộ thân (Nội tại): nhảy né 1 lần Vỏ Chuối, Còi Quack Horn hoặc chướng ngại vật (không chặn Tên Lửa), né xong nhận Guard Surge +15% trong 1.8s. Chưa dùng tới 88% quãng đường sẽ hóa luồng lướt +4% trong 1s.' },
  { id: 'SHOCK_ABSORBER', name: 'Shock Absorber', icon: '🦺', cost: 1, category: 'minor', itemClass: 'DEFENSE', description: 'Áo giáp chống sốc (Nội tại): đỡ 1 đòn Tên Lửa (còn 40% tốc độ 0.3s rồi 80% 0.3s, vẫn mất boost) hoặc Còi (giảm 60% lực đẩy, không bị Câm Lặng); hồi xong nhận Guard Surge +6% trong 0.8s. Không giữ được Nitro khỏi bị cướp đà.' },
  { id: 'HOMING_ROCKET', name: 'Homing Rocket', icon: '🚀', cost: 2, category: 'major', itemClass: 'ATTACK', description: 'Bắn tên lửa tầm nhiệt nhắm đối thủ phía trước, triệt tiêu tăng tốc và hãm tốc còn 12% trong 0.95s rồi 50% trong 0.65s (1 lần/trận). Trúng vịt Tốc độ (đang boost hoặc còn Nitro) sẽ cướp đà +20% trong 2.3s.' },
  { id: 'BANANA', name: 'Banana', icon: '🍌', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Thả vỏ chuối bẫy trên làn bơi phía sau (14s), đối thủ dẫm phải bị trượt văng làn, mất boost và hãm còn 15% trong 0.85s rồi 60% trong 0.7s. Trúng vịt Tốc độ sẽ cướp đà.' },
  { id: 'QUACK_HORN', name: 'Quack Horn', icon: '🔊', cost: 1, category: 'minor', itemClass: 'ATTACK', description: 'Thổi còi xung kích húc dạt đối thủ bơi sát cạnh, phá mọi boost (kể cả Nitro) và Câm Lặng 0.5s; sau đó mục tiêu miễn câm lặng 2s. Cướp đà 1.5s từ 1 vịt Tốc độ trúng còi. Bong bóng đang bật và Lông vũ chặn được còi.' },
] as const

export const AUTO_LOADOUT_PRESETS: readonly RaceItemId[][] = [
  ['NITRO', 'DRAFT_FIN'],
  ['BUBBLE_SHIELD', 'FEATHER'],
  ['HOMING_ROCKET', 'BANANA'],
] as const

export function getRaceItem(itemId: RaceItemId) {
  return RACE_ITEM_CATALOG.find((item) => item.id === itemId)!
}
