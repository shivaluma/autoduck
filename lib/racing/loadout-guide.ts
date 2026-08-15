import { ITEM_CLASS_BY_ID, loadoutComboBadge, loadoutComboLabel } from '@/packages/race-core/src/items/classes'
import type { RaceItemId } from '@/packages/race-protocol/src'

export type LoadoutPairingTier = 'recommended' | 'solid' | 'niche' | 'hybrid'

const PURE_COMBO_NOTES: Record<'SPEED' | 'DEFENSE' | 'ATTACK', string> = {
  SPEED: '⚡ SPEED DEMON — burst + slipstream/comeback. Không phòng thủ → dễ bị Rocket phá boost.',
  DEFENSE: '🛡️ FORTRESS — chặn/né/giảm đòn. Chậm hơn Speed thuần nhưng waste attack của đối thủ.',
  ATTACK: '💥 MENACE — phá momentum + trap/pack fight. Mạnh vs Speed không mang shield.',
}

const HYBRID_NOTES: ReadonlyArray<{ classes: readonly [string, string]; message: string }> = [
  { classes: ['SPEED', 'DEFENSE'], message: '🧪 MAD DUCK — burst + survivability. Ví dụ Nitro + Feather: nhanh nhưng vẫn né Banana.' },
  { classes: ['DEFENSE', 'ATTACK'], message: '🧪 MAD DUCK — tự bảo vệ + đặt trap. Chậm — Speed build có thể chạy bỏ.' },
  { classes: ['ATTACK', 'SPEED'], message: '🧪 MAD DUCK — phá leader rồi vượt. Zero defense — ăn Rocket là chịu nguyên.' },
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
    message: hybrid?.message ?? '🧪 HYBRID — soft counter theo matchup, không có bonus stat.',
    badge,
    label,
  }
}
