import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId: rawUserId } = await context.params
  const userId = Number(rawUserId)
  if (!Number.isInteger(userId)) return NextResponse.json({ error: 'Dzịt không hợp lệ' }, { status: 400 })

  const player = await prisma.seasonPlayer.findFirst({
    where: { userId, season: { status: 'active' } },
    include: {
      user: true,
      appearance: true,
      cosmetics: { orderBy: { obtainedAt: 'desc' } },
      season: true,
    },
  })
  if (!player) return NextResponse.json({ error: 'Không tìm thấy dzịt' }, { status: 404 })

  const token = new URL(request.url).searchParams.get('token')
  const viewer = token
    ? await prisma.seasonPlayer.findFirst({
        where: { accessToken: token, season: { status: 'active' } },
        select: { id: true, userId: true, accessToken: true },
      })
    : null

  const isOwner = Boolean(viewer && viewer.userId === userId)

  return NextResponse.json({
    userId: player.userId,
    name: player.user.name,
    avatarUrl: player.user.avatarUrl,
    season: player.season.name,
    appearance: player.appearance,
    favoriteId: player.appearance?.favoriteId ?? null,
    collectionCount: player.cosmetics.length,
    recentCosmetics: player.cosmetics.slice(0, 24),
    stats: {
      raceWins: player.raceWins,
      raceCount: player.raceCount,
      kingStreak: player.kingStreak,
      scars: player.scars,
      shields: player.shields,
      championshipPoints: player.championshipPoints,
      predictionPoints: player.predictionPoints,
      quackPoints: player.quackPoints,
      isKing: player.isKing,
    },
    isOwner,
    personalLink: isOwner ? `/season-3?token=${encodeURIComponent(player.accessToken)}` : null,
  })
}
