import { COSMETIC_BY_ID } from './catalog'
import { LEGACY_V1_COSMETICS } from './legacy-v1'
import { SHOP_PRICES } from './shop'
import { COSMETIC_SLOTS, type DuckAppearance } from './types'

/**
 * v1 → v2 replacements for retired items that have a same-concept v2 design.
 * Anything retired and not listed here is refunded at its v1 shop price.
 */
export const LEGACY_REMAP: Record<string, string> = {
  'body-snoo-cosmic-abyss': 'body-ink',
  'body-coven-bone-white': 'body-pearl',
  'body-ghost': 'body-pearl',
  'body-galaxy': 'body-midnight',
  'body-void-purple': 'body-lavender',
  'skin-dots': 'bodySkin-polka-pond',
  'bodySkin-confetti-rain': 'bodySkin-polka-pond',
  'bodySkin-lotus-speckles': 'bodySkin-cheek-freckles',
  'bodySkin-star-freckles': 'bodySkin-star-constellations',
  'bodySkin-neon-scales': 'bodySkin-circuit-feathers',
  'bodySkin-hextech-runes': 'bodySkin-circuit-feathers',
  'bodySkin-porcelain-glaze': 'bodySkin-gold-veins',
  'face-office-burnout': 'face-monday-face',
  'face-victory-wink': 'face-happy',
  'face-lucky-wink': 'face-happy',
  'face-disco-shades': 'face-shades',
  'face-frog-goggles': 'face-swimming-goggles',
  'face-detective-lens': 'face-monocle',
  'face-spirit-fox-mask': 'face-kitsune-mask',
  'face-cyber-scan': 'face-laser-visor',
  'face-space-visor': 'face-laser-visor',
  'head-paper-crown': 'head-tiny-crown',
  'head-diamond-crown': 'head-tiny-crown',
  'head-moon-tiara': 'head-tiny-crown',
  'head-lotus-hat': 'head-bamboo-hat',
  'head-lucky-helmet': 'head-motorbike-helmet',
  'head-noodle-cup': 'head-pho-bowl',
  'head-rice-bowl': 'head-pho-bowl',
  'head-blood-moon-horns': 'head-dragon-horns',
  'outfit-office-shirt': 'outfit-office-tie',
  'outfit-rain-poncho': 'outfit-raincoat',
  'outfit-street-jacket': 'outfit-biker-vest',
  'outfit-golden-tux': 'outfit-boss-blazer',
  'outfit-diamond-armor': 'outfit-quack-knight',
  'outfit-moon-kimono': 'outfit-spirit-haori',
  'outfit-spirit-blossom-haori': 'outfit-spirit-haori',
  'outfit-star-guardian-sailor-dress': 'outfit-sailor-shirt',
  'outfit-project-cyber-exosuit': 'outfit-cyber-samurai',
  'pet-corgi-pup': 'pet-shiba-inu',
  'pet-golden-retriever': 'pet-shiba-inu',
  'pet-cloud-cat': 'pet-calico-cat',
  'pet-project-cyber-drone': 'pet-tiny-drone',
  'aura-space-dust': 'aura-fireflies',
  'aura-royal-sparkles': 'aura-golden-rays',
  'aura-spirit-blossom-petals': 'aura-lotus-breeze',
  'aura-project-matrix-grid': 'aura-neon-glitch',
  'trail-ghost-ripples': 'trail-ripples',
  'trail-storm-foam': 'trail-bubble-wake',
  'trail-spirit-blossom-sakura': 'trail-lotus-petals',
  'trail-project-cyber-glitch': 'trail-pixel-stream',
  'trail-arcane-hextech-lightning': 'trail-neon-wake',
}

export interface LegacyInventoryPlan {
  /** v1 IDs to delete from inventory. */
  remove: string[]
  /** v2 IDs to grant as replacements. */
  grant: Array<{ cosmeticId: string; replaces: string }>
  /** QP refunds for retired items with no replacement (or whose replacement is already owned). */
  refund: Array<{ cosmeticId: string; amount: number }>
}

/** Decides what happens to one player's inventory. Pure, so it is unit-tested and idempotent by construction. */
export function planLegacyInventory(ownedIds: string[]): LegacyInventoryPlan {
  const owned = new Set(ownedIds)
  const plan: LegacyInventoryPlan = { remove: [], grant: [], refund: [] }
  const granted = new Set<string>()

  for (const id of ownedIds) {
    if (COSMETIC_BY_ID.has(id)) continue
    plan.remove.push(id)
    const replacement = LEGACY_REMAP[id]
    if (replacement && COSMETIC_BY_ID.has(replacement) && !owned.has(replacement) && !granted.has(replacement)) {
      plan.grant.push({ cosmeticId: replacement, replaces: id })
      granted.add(replacement)
      continue
    }
    const legacy = LEGACY_V1_COSMETICS[id]
    if (legacy) plan.refund.push({ cosmeticId: id, amount: SHOP_PRICES[legacy[1]] })
  }

  return plan
}

/** Rewrites an appearance so every equipped ID exists in v2 and is owned. Unknown slots are dropped. */
export function remapAppearance(appearance: Record<string, unknown>, ownedAfter: Set<string>): DuckAppearance {
  const next: Record<string, string> = {}
  for (const slot of COSMETIC_SLOTS) {
    const key = `${slot}Id`
    const value = appearance[key]
    if (typeof value !== 'string' || !value) continue
    const id = COSMETIC_BY_ID.has(value) ? value : LEGACY_REMAP[value]
    const item = id ? COSMETIC_BY_ID.get(id) : undefined
    if (item && item.slot === slot && ownedAfter.has(item.id)) next[key] = item.id
  }
  if (!next.bodyColorId) next.bodyColorId = 'body-sunshine'
  return next as DuckAppearance
}
