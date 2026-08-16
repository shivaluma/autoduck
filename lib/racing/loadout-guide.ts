import { ITEM_CLASS_BY_ID, loadoutComboBadge, loadoutComboLabel } from '@/packages/race-core/src/items/classes'
import type { RaceItemId } from '@/packages/race-protocol/src'

export type LoadoutPairingTier = 'recommended' | 'solid' | 'niche' | 'hybrid'

const PURE_COMBO_NOTES: Record<'SPEED' | 'DEFENSE' | 'ATTACK', string> = {
  SPEED: 'Lối chơi bứt tốc áp đảo: tối ưu hóa bám đuôi và bứt phá về đích. Nhược điểm: thiếu phòng thủ, dễ bị Tên Lửa ngắt đà.',
  DEFENSE: 'Lối chơi bất khả xâm phạm: vô hiệu hóa đòn tấn công và hạn chế va chạm. Nhược điểm: tốc độ cơ bản không quá nổi trội.',
  ATTACK: 'Lối chơi áp đảo khống chế: ngắt đà tăng tốc của đối thủ và bẫy đường phía sau. Rất mạnh khi ép sân các vịt không mang Khiên.',
}

const HYBRID_NOTES: ReadonlyArray<{ classes: readonly [string, string]; message: string }> = [
  { classes: ['SPEED', 'DEFENSE'], message: 'Lối chơi cơ động toàn diện: vừa sở hữu tốc độ bứt phá, vừa có khiên phòng hộ bảo vệ trước cạm bẫy.' },
  { classes: ['DEFENSE', 'ATTACK'], message: 'Lối chơi rình rập an toàn: tự bảo vệ bản thân trước hiểm nguy, đồng thời tung đòn hiểm phá rối nhóm dẫn đầu.' },
  { classes: ['ATTACK', 'SPEED'], message: 'Lối chơi tiến công thần tốc: liên tục ngắt nhịp đối thủ phía trước để chớp thời cơ vượt lên dẫn đầu.' },
]

export function evaluateLoadoutPairing(itemIds: readonly RaceItemId[]): { tier: LoadoutPairingTier; message: string; badge: string | null; label: string | null } | null {
  if (itemIds.length !== 2) return null
  const badge = loadoutComboBadge(itemIds)
  const label = loadoutComboLabel(itemIds)
  if (!badge) return null

  const classes = itemIds.map((id) => ITEM_CLASS_BY_ID[id])
  const unique = new Set(classes)

  if (unique.size === 1) {
    const itemClass = classes[0]!
    return {
      tier: 'recommended',
      message: PURE_COMBO_NOTES[itemClass],
      badge,
      label,
    }
  }

  const sorted = [...classes].sort().join(',')
  const hybrid = HYBRID_NOTES.find((entry) => [...entry.classes].sort().join(',') === sorted)
  return {
    tier: 'hybrid',
    message: hybrid?.message ?? 'Lối chơi linh hoạt: kết hợp hài hòa giữa 2 trường phái để tùy biến theo từng cục diện trận đua.',
    badge,
    label,
  }
}
