import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { applyQuackTransaction } from '@/lib/cosmetics/economy'
import { GACHA_CONFIG, selectGachaResult } from '@/lib/cosmetics/gacha'
import { COSMETIC_CATALOG } from '@/lib/cosmetics/catalog'

type CosmeticOverride = { cosmeticId: string; enabled: boolean; gachaEligible: boolean | null }

export async function POST(request: Request) {
  const body = await request.json() as { token?: string; idempotencyKey?: string }
  if (!body.token || !body.idempotencyKey) return NextResponse.json({ error: 'Request không hợp lệ' }, { status: 400 })
  const player = await prisma.seasonPlayer.findUnique({ where: { accessToken: body.token }, include: { cosmetics: true } })
  if (!player) return NextResponse.json({ error: 'Personal link không hợp lệ' }, { status: 401 })
  const previousTransaction = await prisma.currencyTransaction.findUnique({ where: { idempotencyKey: body.idempotencyKey } })
  if (previousTransaction?.seasonPlayerId === player.id && previousTransaction.gachaPullId) {
    const previous = await prisma.gachaPull.findUnique({ where: { id: previousTransaction.gachaPullId } })
    if (previous) return NextResponse.json({ ok: true, pull: previous, balance: previousTransaction.balanceAfter + previous.refundAmount, config: GACHA_CONFIG })
  }
  if (player.quackPoints < GACHA_CONFIG.cost) return NextResponse.json({ error: 'Cần 3 QP để mở Mystery Egg' }, { status: 409 })

  try {
    const reveal = await prisma.$transaction(async (tx: typeof prisma) => {
      const previousTransaction = await tx.currencyTransaction.findUnique({ where: { idempotencyKey: body.idempotencyKey } })
      if (previousTransaction?.gachaPullId) {
        const previous = await tx.gachaPull.findUnique({ where: { id: previousTransaction.gachaPullId } })
        if (previous) return { pull: previous, balance: previousTransaction.balanceAfter + previous.refundAmount }
      }

      const fresh = await tx.seasonPlayer.findUniqueOrThrow({ where: { id: player.id }, include: { cosmetics: true } })
      if (fresh.quackPoints < GACHA_CONFIG.cost) throw new Error('INSUFFICIENT_QP')
      const overrides = await tx.cosmeticConfig.findMany()
      const overrideById = new Map<string, CosmeticOverride>(overrides.map((item: CosmeticOverride) => [item.cosmeticId, item]))
      const gachaCatalog = COSMETIC_CATALOG.filter((item) => {
        const override = overrideById.get(item.id)
        return override?.enabled !== false && (override?.gachaEligible ?? item.gachaEligible)
      })
      const result = selectGachaResult({
        ownedIds: new Set(fresh.cosmetics.map((item: { cosmeticId: string }) => item.cosmeticId)),
        rarePity: fresh.rarePity,
        epicPity: fresh.epicPity,
        legendaryPity: fresh.legendaryPity,
        catalog: gachaCatalog,
      })
      const pullId = randomUUID()
      await applyQuackTransaction(tx, {
        seasonPlayerId: fresh.id,
        amount: -GACHA_CONFIG.cost,
        reason: 'GACHA_PULL',
        cosmeticId: result.finalItem.id,
        gachaPullId: pullId,
        idempotencyKey: body.idempotencyKey!,
      })
      if (result.refundAmount > 0) {
        await applyQuackTransaction(tx, {
          seasonPlayerId: fresh.id,
          amount: result.refundAmount,
          reason: 'DUPLICATE_REFUND',
          cosmeticId: result.finalItem.id,
          gachaPullId: pullId,
          idempotencyKey: `${body.idempotencyKey}:refund`,
        })
      } else {
        await tx.playerCosmetic.create({ data: { seasonPlayerId: fresh.id, cosmeticId: result.finalItem.id, source: 'GACHA', sourceReferenceId: pullId } })
      }
      const pull = await tx.gachaPull.create({ data: {
        id: pullId,
        seasonPlayerId: fresh.id,
        cost: GACHA_CONFIG.cost,
        rolledRarity: result.rolledRarity,
        finalCosmeticId: result.finalItem.id,
        wasDuplicate: result.wasDuplicate,
        wasRerolled: result.wasRerolled,
        refundAmount: result.refundAmount,
        rarePityBefore: fresh.rarePity,
        rarePityAfter: result.pityAfter.rarePity,
        epicPityBefore: fresh.epicPity,
        epicPityAfter: result.pityAfter.epicPity,
        legendaryPityBefore: fresh.legendaryPity,
        legendaryPityAfter: result.pityAfter.legendaryPity,
      } })
      const updated = await tx.seasonPlayer.update({
        where: { id: fresh.id },
        data: result.pityAfter,
        select: { quackPoints: true },
      })
      return { pull, balance: updated.quackPoints }
    })
    return NextResponse.json({ ok: true, ...reveal, config: GACHA_CONFIG })
  } catch (error) {
    return NextResponse.json({ error: String(error).includes('INSUFFICIENT_QP') ? 'Không đủ QP' : 'Mystery Egg chưa mở được' }, { status: 409 })
  }
}
