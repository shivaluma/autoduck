import { createHash } from 'node:crypto'
import { COSMETIC_CATALOG, COSMETIC_BY_ID } from './catalog'
import type { CosmeticDefinition, CosmeticRarity } from './types'

export const SHOP_PRICES: Record<CosmeticRarity, number> = {
  common: 2,
  uncommon: 4,
  rare: 7,
  epic: 12,
  legendary: 20,
}

const ROTATION_COUNTS: Partial<Record<CosmeticRarity, number>> = { common: 6, uncommon: 6, rare: 6, epic: 3, legendary: 2 }

function seededScore(seed: string, id: string) {
  return createHash('sha256').update(`${seed}:${id}`).digest().readUInt32BE(0)
}

export function getShopWeek(now = new Date()) {
  const vietnam = new Date(now.getTime() + 7 * 60 * 60 * 1000)
  const day = vietnam.getUTCDay() || 7
  const localMonday = new Date(Date.UTC(vietnam.getUTCFullYear(), vietnam.getUTCMonth(), vietnam.getUTCDate() - day + 1))
  const monday = new Date(localMonday.getTime() - 7 * 60 * 60 * 1000)
  const endsAt = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000)
  return { weekKey: localMonday.toISOString().slice(0, 10), startsAt: monday, endsAt }
}

export function generateRotationPool(seasonKey: string, weekKey: string) {
  return Object.entries(ROTATION_COUNTS).flatMap(([rarity, count]) => COSMETIC_CATALOG
    .filter((item) => item.shopEligible && item.rarity === rarity)
    .sort((left, right) => seededScore(`${seasonKey}:${weekKey}`, left.id) - seededScore(`${seasonKey}:${weekKey}`, right.id))
    .slice(0, count)
    .map((item) => item.id))
}

export function personalizeRotation(poolIds: string[], ownedIds: Set<string>, seasonKey: string, weekKey: string): CosmeticDefinition[] {
  const counts: Partial<Record<CosmeticRarity, number>> = { common: 2, uncommon: 2, rare: 2, epic: 1 }
  const result = Object.entries(counts).flatMap(([rarity, count]) => poolIds
    .flatMap((id) => COSMETIC_BY_ID.get(id) ?? [])
    .filter((item) => item.rarity === rarity && !ownedIds.has(item.id))
    .slice(0, count))
  const legendaryEnabled = seededScore(seasonKey, weekKey) / 0xffffffff < 0.3
  if (legendaryEnabled) {
    const legendary = poolIds.flatMap((id) => COSMETIC_BY_ID.get(id) ?? []).find((item) => item.rarity === 'legendary' && !ownedIds.has(item.id))
    if (legendary) result.push(legendary)
  }
  return result
}
