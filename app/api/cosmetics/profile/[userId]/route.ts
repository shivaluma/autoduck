import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId: rawUserId } = await context.params
  const userId = Number(rawUserId)
  if (!Number.isInteger(userId)) return NextResponse.json({ error: 'Dzịt không hợp lệ' }, { status: 400 })
  const player = await prisma.seasonPlayer.findFirst({
    where: { userId, season: { status: 'active' } },
    include: { user: true, appearance: true, cosmetics: { orderBy: { obtainedAt: 'desc' } }, season: true },
  })
  if (!player) return NextResponse.json({ error: 'Không tìm thấy dzịt' }, { status: 404 })
  return NextResponse.json({
    name: player.user.name,
    season: player.season.name,
    appearance: player.appearance,
    favoriteId: player.appearance?.favoriteId ?? null,
    collectionCount: player.cosmetics.length,
    recentCosmetics: player.cosmetics.slice(0, 8),
    stats: { raceWins: player.raceWins, raceCount: player.raceCount, kingStreak: player.kingStreak, scars: player.scars, shields: player.shields },
  })
}
