import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { COSMETIC_BY_ID, COSMETIC_CATALOG } from '@/lib/cosmetics/catalog'
import { applyQuackTransaction } from '@/lib/cosmetics/economy'

function authorized(request: Request) {
  return request.headers.get('x-race-secret') === process.env.RACE_SECRET_KEY
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const season = await prisma.season.findFirst({ where: { status: 'active' }, include: { players: { include: { user: true, cosmetics: true, appearance: true } } } })
  if (!season) return NextResponse.json({ error: 'Chưa có Season active' }, { status: 404 })
  const [transactions, pulls, events, configs, earned, spent, shopPurchaseCount, gachaPullCount] = await Promise.all([
    prisma.currencyTransaction.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.gachaPull.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.cosmeticAdminEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.cosmeticConfig.findMany(),
    prisma.currencyTransaction.aggregate({ where: { amount: { gt: 0 } }, _sum: { amount: true } }),
    prisma.currencyTransaction.aggregate({ where: { amount: { lt: 0 } }, _sum: { amount: true } }),
    prisma.shopPurchase.count(),
    prisma.gachaPull.count(),
  ])
  const equipped = (slot: 'headId' | 'petId' | 'auraId') => {
    const counts = new Map<string, number>()
    for (const player of season.players) {
      const id = player.appearance?.[slot]
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return [...counts].sort((left, right) => right[1] - left[1]).slice(0, 10).map(([cosmeticId, count]) => ({ cosmeticId, count }))
  }
  const rarityDistribution = Object.fromEntries(['common', 'uncommon', 'rare', 'epic', 'legendary'].map((rarity) => [rarity, season.players.reduce((total: number, player: { cosmetics: Array<{ cosmeticId: string }> }) => total + player.cosmetics.filter((entry) => COSMETIC_BY_ID.get(entry.cosmeticId)?.rarity === rarity).length, 0)]))
  return NextResponse.json({
    catalog: COSMETIC_CATALOG,
    players: season.players.map((player: { id: number; user: { name: string }; quackPoints: number; cosmetics: unknown[] }) => ({ id: player.id, name: player.user.name, quackPoints: player.quackPoints, collectionCount: player.cosmetics.length })),
    transactions,
    pulls,
    events,
    configs,
    analytics: {
      qpEarned: earned._sum.amount ?? 0,
      qpSpent: -(spent._sum.amount ?? 0),
      shopPurchases: shopPurchaseCount,
      gachaPulls: gachaPullCount,
      duplicateRefundRate: pulls.length ? pulls.filter((pull: { refundAmount: number }) => pull.refundAmount > 0).length / pulls.length : 0,
      rarityDistribution,
      mostEquipped: { heads: equipped('headId'), pets: equipped('petId'), auras: equipped('auraId') },
      collectionDistribution: season.players.map((player: { user: { name: string }; cosmetics: unknown[] }) => ({ name: player.user.name, count: player.cosmetics.length })),
    },
  })
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json() as { action?: string; playerId?: number; cosmeticId?: string; amount?: number; enabled?: boolean; shopEligible?: boolean; gachaEligible?: boolean; priceOverride?: number | null; limitedLabel?: string | null }
  const player = body.playerId ? await prisma.seasonPlayer.findUnique({ where: { id: body.playerId } }) : null
  if (body.action === 'adjust-qp') {
    if (!player || !Number.isInteger(body.amount) || body.amount === 0) return NextResponse.json({ error: 'Player/amount không hợp lệ' }, { status: 400 })
    try {
      await prisma.$transaction(async (tx: typeof prisma) => {
        await applyQuackTransaction(tx, { seasonPlayerId: player.id, amount: body.amount!, reason: 'ADMIN_ADJUSTMENT', idempotencyKey: `admin:${crypto.randomUUID()}`, metadata: { actor: 'host' } })
        await tx.cosmeticAdminEvent.create({ data: { action: 'ADJUST_QP', actor: 'host', playerId: player.id, metadataJson: JSON.stringify({ amount: body.amount }) } })
      })
      return NextResponse.json({ ok: true })
    } catch { return NextResponse.json({ error: 'Không thể điều chỉnh QP' }, { status: 409 }) }
  }
  if (body.action === 'grant' || body.action === 'revoke') {
    if (!player || !body.cosmeticId || !COSMETIC_BY_ID.has(body.cosmeticId)) return NextResponse.json({ error: 'Player/cosmetic không hợp lệ' }, { status: 400 })
    await prisma.$transaction(async (tx: typeof prisma) => {
      if (body.action === 'grant') await tx.playerCosmetic.upsert({ where: { seasonPlayerId_cosmeticId: { seasonPlayerId: player.id, cosmeticId: body.cosmeticId! } }, create: { seasonPlayerId: player.id, cosmeticId: body.cosmeticId!, source: 'ADMIN' }, update: {} })
      else await tx.playerCosmetic.deleteMany({ where: { seasonPlayerId: player.id, cosmeticId: body.cosmeticId } })
      await tx.cosmeticAdminEvent.create({ data: { action: body.action === 'grant' ? 'GRANT_COSMETIC' : 'REVOKE_COSMETIC', actor: 'host', playerId: player.id, cosmeticId: body.cosmeticId } })
    })
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'configure') {
    if (!body.cosmeticId || !COSMETIC_BY_ID.has(body.cosmeticId)) return NextResponse.json({ error: 'Cosmetic không hợp lệ' }, { status: 400 })
    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.cosmeticConfig.upsert({ where: { cosmeticId: body.cosmeticId }, create: { cosmeticId: body.cosmeticId!, enabled: body.enabled ?? true, shopEligible: body.shopEligible, gachaEligible: body.gachaEligible, priceOverride: body.priceOverride, limitedLabel: body.limitedLabel }, update: { enabled: body.enabled, shopEligible: body.shopEligible, gachaEligible: body.gachaEligible, priceOverride: body.priceOverride, limitedLabel: body.limitedLabel } })
      await tx.cosmeticAdminEvent.create({ data: { action: 'CONFIGURE_COSMETIC', actor: 'host', cosmeticId: body.cosmeticId, metadataJson: JSON.stringify(body) } })
    })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 })
}
