import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { COSMETIC_BY_ID } from '@/lib/cosmetics/catalog'
import { applyQuackTransaction } from '@/lib/cosmetics/economy'
import { generateRotationPool, getShopWeek, personalizeRotation, SHOP_PRICES } from '@/lib/cosmetics/shop'

type CosmeticOverride = { cosmeticId: string; enabled: boolean; shopEligible: boolean | null; priceOverride: number | null; limitedLabel: string | null }

async function context(token: string | null) {
  if (!token) return null
  return prisma.seasonPlayer.findUnique({ where: { accessToken: token }, include: { season: true, cosmetics: true } })
}

async function rotationFor(player: { seasonId: number; season: { key: string } }) {
  const week = getShopWeek()
  return prisma.shopRotation.upsert({
    where: { seasonId_weekKey: { seasonId: player.seasonId, weekKey: week.weekKey } },
    create: { seasonId: player.seasonId, ...week, itemsJson: JSON.stringify(generateRotationPool(player.season.key, week.weekKey)) },
    update: {},
  })
}

export async function GET(request: Request) {
  const player = await context(new URL(request.url).searchParams.get('token'))
  if (!player) return NextResponse.json({ error: 'Personal link không hợp lệ' }, { status: 401 })
  const rotation = await rotationFor(player)
  const owned = new Set<string>(player.cosmetics.map((item: { cosmeticId: string }) => item.cosmeticId))
  const configs = await prisma.cosmeticConfig.findMany()
  const configById = new Map<string, CosmeticOverride>(configs.map((item: CosmeticOverride) => [item.cosmeticId, item]))
  const items = personalizeRotation(JSON.parse(rotation.itemsJson), owned, player.season.key, rotation.weekKey).filter((item) => {
    const config = configById.get(item.id)
    return config?.enabled !== false && (config?.shopEligible ?? item.shopEligible)
  }).map((item) => ({ ...item, price: configById.get(item.id)?.priceOverride ?? SHOP_PRICES[item.rarity], limitedLabel: configById.get(item.id)?.limitedLabel }))
  return NextResponse.json({ balance: player.quackPoints, endsAt: rotation.endsAt, prices: SHOP_PRICES, items, ownedIds: [...owned] })
}

export async function POST(request: Request) {
  const body = await request.json() as { token?: string; cosmeticId?: string; idempotencyKey?: string }
  const player = await context(body.token ?? null)
  if (!player || !body.cosmeticId || !body.idempotencyKey) return NextResponse.json({ error: 'Request không hợp lệ' }, { status: 400 })
  const item = COSMETIC_BY_ID.get(body.cosmeticId)
  if (!item) return NextResponse.json({ error: 'Cosmetic không tồn tại' }, { status: 404 })
  const previous = await prisma.currencyTransaction.findUnique({ where: { idempotencyKey: body.idempotencyKey } })
  if (previous?.seasonPlayerId === player.id && previous.reason === 'SHOP_PURCHASE') return NextResponse.json({ ok: true, balance: previous.balanceAfter, cosmeticId: item.id, item })
  const rotation = await rotationFor(player)
  const config = await prisma.cosmeticConfig.findUnique({ where: { cosmeticId: item.id } })
  const offered = personalizeRotation(JSON.parse(rotation.itemsJson), new Set(player.cosmetics.map((entry: { cosmeticId: string }) => entry.cosmeticId)), player.season.key, rotation.weekKey)
  if (!offered.some((entry) => entry.id === item.id)) return NextResponse.json({ error: 'Món này không có trong shop của bạn' }, { status: 409 })
  if (config?.enabled === false || config?.shopEligible === false) return NextResponse.json({ error: 'Món này đang tắt' }, { status: 409 })
  const price = config?.priceOverride ?? SHOP_PRICES[item.rarity]
  if (player.quackPoints < price) return NextResponse.json({ error: 'Không đủ QP' }, { status: 409 })
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const existing = await tx.currencyTransaction.findUnique({ where: { idempotencyKey: body.idempotencyKey } })
      if (existing) return { balance: existing.balanceAfter, cosmeticId: item.id }
      await applyQuackTransaction(tx, { seasonPlayerId: player.id, amount: -price, reason: 'SHOP_PURCHASE', cosmeticId: item.id, idempotencyKey: body.idempotencyKey! })
      await tx.playerCosmetic.create({ data: { seasonPlayerId: player.id, cosmeticId: item.id, source: 'SHOP', sourceReferenceId: rotation.id } })
      await tx.shopPurchase.create({ data: { seasonPlayerId: player.id, rotationId: rotation.id, cosmeticId: item.id, price } })
      const updated = await tx.seasonPlayer.findUniqueOrThrow({ where: { id: player.id }, select: { quackPoints: true } })
      return { balance: updated.quackPoints, cosmeticId: item.id }
    })
    return NextResponse.json({ ok: true, ...result, item })
  } catch (error) {
    return NextResponse.json({ error: String(error).includes('quackPoints') ? 'Không đủ QP' : 'Không mua được món này' }, { status: 409 })
  }
}
