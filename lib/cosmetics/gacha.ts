import { randomInt } from 'node:crypto'
import { COSMETIC_CATALOG } from './catalog'
import type { CosmeticDefinition, CosmeticRarity } from './types'

export const GACHA_CONFIG = {
  cost: 3,
  duplicateRefund: 2,
  odds: { common: 40, uncommon: 30, rare: 18, epic: 9, legendary: 3 } satisfies Record<CosmeticRarity, number>,
  pity: { rare: 5, epic: 12, legendary: 30 },
} as const

const RARITY_ORDER: CosmeticRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

export function rollRarity(input: { rarePity: number; epicPity: number; legendaryPity: number }, rng = () => randomInt(1_000_000) / 1_000_000): CosmeticRarity {
  if (input.legendaryPity >= GACHA_CONFIG.pity.legendary) return 'legendary'
  if (input.epicPity >= GACHA_CONFIG.pity.epic) return rng() < 0.25 ? 'legendary' : 'epic'
  if (input.rarePity >= GACHA_CONFIG.pity.rare) {
    const roll = rng() * 30
    return roll < 3 ? 'legendary' : roll < 12 ? 'epic' : 'rare'
  }
  const roll = rng() * 100
  if (roll < 40) return 'common'
  if (roll < 70) return 'uncommon'
  if (roll < 88) return 'rare'
  if (roll < 97) return 'epic'
  return 'legendary'
}

export function selectGachaResult(input: {
  ownedIds: Set<string>
  rarePity: number
  epicPity: number
  legendaryPity: number
  catalog?: CosmeticDefinition[]
}, rng = () => randomInt(1_000_000) / 1_000_000) {
  const catalog = input.catalog ?? COSMETIC_CATALOG
  let rolledRarity = rollRarity(input, rng)
  const eligibleRarities = RARITY_ORDER.filter((rarity) => catalog.some((item) => item.gachaEligible && item.rarity === rarity && !input.ownedIds.has(item.id)))
  if (!eligibleRarities.includes(rolledRarity)) {
    const rolledIndex = RARITY_ORDER.indexOf(rolledRarity)
    rolledRarity = eligibleRarities.find((rarity) => RARITY_ORDER.indexOf(rarity) > rolledIndex)
      ?? eligibleRarities.at(-1)
      ?? rolledRarity
  }
  const pool = catalog.filter((item) => item.gachaEligible && item.rarity === rolledRarity)
  const first = pool[Math.floor(rng() * pool.length)] as CosmeticDefinition | undefined
  if (!first) throw new Error(`Gacha pool ${rolledRarity} trống`)
  const wasDuplicate = input.ownedIds.has(first.id)
  const unowned = pool.filter((item) => !input.ownedIds.has(item.id))
  const finalItem = wasDuplicate && unowned.length ? unowned[Math.floor(rng() * unowned.length)]! : first
  const duplicateRemains = input.ownedIds.has(finalItem.id)
  const rank = RARITY_ORDER.indexOf(rolledRarity)
  return {
    rolledRarity,
    finalItem,
    wasDuplicate,
    wasRerolled: wasDuplicate && unowned.length > 0,
    refundAmount: duplicateRemains ? GACHA_CONFIG.duplicateRefund : 0,
    pityAfter: {
      rarePity: rank >= RARITY_ORDER.indexOf('rare') ? 0 : input.rarePity + 1,
      epicPity: rank >= RARITY_ORDER.indexOf('epic') ? 0 : input.epicPity + 1,
      legendaryPity: rolledRarity === 'legendary' ? 0 : input.legendaryPity + 1,
    },
  }
}
