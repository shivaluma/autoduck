import { ITEM_CLASS_BY_ID, loadoutComboBadge, loadoutComboLabel } from '@/packages/race-core/src/items/classes'
import type { RaceItemId } from '@/packages/race-protocol/src'

export type LoadoutPairingTier = 'recommended' | 'solid' | 'niche' | 'hybrid'

const PURE_COMBO_NOTES: Record<'SPEED' | 'DEFENSE' | 'ATTACK', string> = {
  SPEED: 'SPEED DEMON — Bứt tốc áp đảo: bám đuôi lướt gió nhanh hơn 20% và vượt mặt hệ Phòng thủ. Nhược điểm: hệ Tấn công phá boost và cướp đà của bạn.',
  DEFENSE: 'FORTRESS — Bo thủ kiên cố: chặn đòn để nhận Guard Surge, giảm 20% lực va chạm và 25% lực đẩy của Còi. Khắc chế hệ Tấn công; nhược điểm: không theo kịp hệ Tốc độ.',
  ATTACK: 'MENACE — Áp đảo khống chế: phá boost, cướp đà vịt Tốc độ và nhận thêm Predator Rush (+10% trong 1s) mỗi khi đánh trúng. Nhược điểm: đòn bị Phòng thủ chặn thì không được gì.',
}

const HYBRID_NOTES: ReadonlyArray<{ classes: readonly [string, string]; message: string }> = [
  { classes: ['SPEED', 'DEFENSE'], message: 'Lối chơi cơ động toàn diện: vừa sở hữu tốc độ bứt phá, vừa có khiên phòng hộ bảo vệ trước cạm bẫy và tên lửa.' },
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
