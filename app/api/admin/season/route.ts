import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

function checkSecret(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  return secret === process.env.RACE_SECRET_KEY
}

export async function GET(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [bosses, activeShields, activeChests, chestHistory, weeklyTicks] = await Promise.all([
      prisma.user.findMany({
        where: { isBoss: true },
        orderBy: [{ cleanStreak: 'desc' }, { name: 'asc' }],
      }),
      prisma.shield.findMany({
        where: { status: 'active' },
        include: { owner: true },
        orderBy: [{ weeksUnused: 'desc' }, { earnedAt: 'asc' }],
      }),
      prisma.mysteryChest.findMany({
        where: { status: 'active' },
        include: { owner: true },
        orderBy: [{ createdAt: 'desc' }],
      }),
      prisma.mysteryChest.findMany({
        where: { status: { in: ['consumed', 'void'] } },
        include: { owner: true },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
      }),
      prisma.weeklyTick.findMany({
        orderBy: [{ runAt: 'desc' }],
        take: 12,
      }),
    ])

    return NextResponse.json({
      bosses,
      activeShields: activeShields.map((shield: {
        id: number
        ownerId: number
        earnedAt: Date
        earnedRaceId?: number | null
        weeksUnused: number
        status: string
        owner: { name: string }
      }) => ({
        id: shield.id,
        ownerId: shield.ownerId,
        ownerName: shield.owner.name,
        earnedAt: shield.earnedAt,
        earnedRaceId: shield.earnedRaceId,
        weeksUnused: shield.weeksUnused,
        status: shield.status,
      })),
      activeChests: activeChests.map((chest: {
        id: number
        ownerId: number
        earnedFromRaceId: number
        effect: string
        status: string
        targetUserId?: number | null
        createdAt: Date
        owner: { name: string }
      }) => ({
        id: chest.id,
        ownerId: chest.ownerId,
        ownerName: chest.owner.name,
        earnedFromRaceId: chest.earnedFromRaceId,
        effect: chest.effect,
        status: chest.status,
        targetUserId: chest.targetUserId,
        createdAt: chest.createdAt,
      })),
      chestHistory: chestHistory.map((chest: {
        id: number
        ownerId: number
        earnedFromRaceId: number
        consumedRaceId?: number | null
        effect: string
        status: string
        targetUserId?: number | null
        rngSeed: string
        createdAt: Date
        consumedAt?: Date | null
        owner: { name: string }
      }) => ({
        id: chest.id,
        ownerId: chest.ownerId,
        ownerName: chest.owner.name,
        earnedFromRaceId: chest.earnedFromRaceId,
        consumedRaceId: chest.consumedRaceId,
        effect: chest.effect,
        status: chest.status,
        targetUserId: chest.targetUserId,
        rngSeed: chest.rngSeed,
        createdAt: chest.createdAt,
        consumedAt: chest.consumedAt,
      })),
      weeklyTicks,
    })
  } catch (error) {
    console.error('Failed to fetch season data:', error)
    return NextResponse.json({ error: 'Failed to fetch season data' }, { status: 500 })
  }
}
