import { COSMETIC_BY_ID, DEFAULT_APPEARANCE, STARTER_COSMETIC_IDS } from './catalog'
import { COSMETIC_SLOTS, type DuckAppearance } from './types'
import type { Prisma } from '../../prisma/generated/prisma/client'

export async function grantStarterCosmetics(tx: Prisma.TransactionClient, seasonPlayerId: number) {
  for (const cosmeticId of STARTER_COSMETIC_IDS) {
    await tx.playerCosmetic.upsert({
      where: { seasonPlayerId_cosmeticId: { seasonPlayerId, cosmeticId } },
      create: { seasonPlayerId, cosmeticId, source: 'DEFAULT', isNew: false },
      update: {},
    })
  }
  await tx.playerAppearance.upsert({
    where: { seasonPlayerId },
    create: { seasonPlayerId, ...DEFAULT_APPEARANCE },
    update: {},
  })
}

export function normalizeAppearance(input: Record<string, unknown>): DuckAppearance {
  const result: Record<string, string> = {}
  for (const slot of COSMETIC_SLOTS) {
    const key = `${slot}Id`
    const value = input[key]
    if (typeof value === 'string' && value.length > 0) result[key] = value
  }
  if (!result.bodyColorId) throw new Error('Duck cần một Body Color')
  return result as DuckAppearance
}

export async function saveAppearance(tx: Prisma.TransactionClient, seasonPlayerId: number, rawAppearance: Record<string, unknown>) {
  const appearance = normalizeAppearance(rawAppearance)
  const equippedIds = Object.values(appearance)
  for (const [key, cosmeticId] of Object.entries(appearance)) {
    const cosmetic = COSMETIC_BY_ID.get(cosmeticId)
    if (!cosmetic) throw new Error(`Cosmetic không tồn tại: ${cosmeticId}`)
    if (`${cosmetic.slot}Id` !== key) throw new Error(`${cosmetic.name} không thuộc slot ${key}`)
  }
  const owned = await tx.playerCosmetic.findMany({
    where: { seasonPlayerId, cosmeticId: { in: equippedIds } },
    select: { cosmeticId: true },
  })
  const ownedIds = new Set(owned.map((item: { cosmeticId: string }) => item.cosmeticId))
  const missing = equippedIds.find((id) => !ownedIds.has(id))
  if (missing) throw new Error(`Bạn chưa sở hữu cosmetic: ${missing}`)

  const data = Object.fromEntries(COSMETIC_SLOTS.map((slot) => [`${slot}Id`, appearance[`${slot}Id` as keyof DuckAppearance] ?? null]))
  return tx.playerAppearance.upsert({
    where: { seasonPlayerId },
    create: { seasonPlayerId, ...data, bodyColorId: appearance.bodyColorId },
    update: data,
  })
}
