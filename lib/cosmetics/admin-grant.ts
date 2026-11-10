import type { Prisma } from '../../prisma/generated/prisma/client'

/**
 * Grants every cosmetic in `cosmeticIds` that the player does not own yet, inside the caller's
 * transaction, and returns how many rows were inserted.
 *
 * Prisma rejects `createMany({ skipDuplicates: true })` on SQLite, so the existing rows are read
 * first and only the missing ids are inserted. Both statements run in the same transaction, which
 * the single SQLite connection serialises, so a concurrent grant cannot slip in between.
 */
export async function grantMissingCosmetics(
  tx: Pick<Prisma.TransactionClient, 'playerCosmetic'>,
  seasonPlayerId: number,
  cosmeticIds: readonly string[],
  source: string,
): Promise<number> {
  const owned = await tx.playerCosmetic.findMany({ where: { seasonPlayerId }, select: { cosmeticId: true } })
  const ownedIds = new Set(owned.map((row: { cosmeticId: string }) => row.cosmeticId))
  const missing = [...new Set(cosmeticIds)].filter((cosmeticId) => !ownedIds.has(cosmeticId))
  if (missing.length === 0) return 0
  await tx.playerCosmetic.createMany({
    data: missing.map((cosmeticId) => ({ seasonPlayerId, cosmeticId, source, isNew: true })),
  })
  return missing.length
}
