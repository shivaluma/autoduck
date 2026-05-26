/* eslint-disable @typescript-eslint/no-explicit-any */
import { DRAGON_STARS, getDragonOrbName } from './naming'
import { DEFAULT_DRAGON_SEASON_KEY, DRAGON_ITEM_TYPE_SCALE, isThomasUser, isUnlockedDragonOrb, withDragonTransaction } from './utils'
import { getSummonReadiness } from './resolveDragonSummon'
import { getDragonOmenForDate } from './weekSchedule'

export type DragonInventory = {
  stars: Record<string, { count: number; orbs: any[] }>
  progress: number
  missingStars: number[]
  summonReady: boolean
  claimBlocked: boolean
  blockedReason?: string
  tradeLockedOrbs: any[]
  consumedOrbs: any[]
  activeScaleItem: any | null
  equippedScaleItem: any | null
  consumedScaleItems: any[]
}

export async function getDragonInventory(
  prisma: any,
  userId: number,
  seasonKey = DEFAULT_DRAGON_SEASON_KEY
): Promise<DragonInventory> {
  const [orbs, items, readiness] = await Promise.all([
    prisma.dragonOrb.findMany({
      where: { currentOwnerId: userId, seasonKey },
      orderBy: [{ status: 'asc' }, { star: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.dragonItem.findMany({
      where: {
        userId,
        type: DRAGON_ITEM_TYPE_SCALE,
      },
    }),
    getSummonReadiness(prisma, userId, seasonKey),
  ])

  const stars: DragonInventory['stars'] = {}
  for (const star of DRAGON_STARS) {
    const activeOrbs = orbs.filter((orb: { star: number; status: string }) => orb.star === star && orb.status === 'ACTIVE')
    stars[String(star)] = {
      count: activeOrbs.length,
      orbs: activeOrbs,
    }
  }

  return {
    stars,
    progress: readiness.progress,
    missingStars: readiness.missingStars,
    summonReady: readiness.ready,
    claimBlocked: readiness.claimBlocked,
    blockedReason: readiness.blockedReason,
    tradeLockedOrbs: orbs.filter((orb: { lockedByTradeId?: number | null }) => Boolean(orb.lockedByTradeId)),
    consumedOrbs: orbs.filter((orb: { status: string }) => orb.status === 'CONSUMED'),
    activeScaleItem: items.find((item: { status: string }) => item.status === 'ACTIVE') ?? null,
    equippedScaleItem: items.find((item: { status: string }) => item.status === 'EQUIPPED') ?? null,
    consumedScaleItems: items.filter((item: { status: string }) => item.status === 'CONSUMED'),
  }
}

export async function getDragonState(prisma: any, seasonKey = DEFAULT_DRAGON_SEASON_KEY) {
  const [users, trades, orbEvents, itemEvents, weeks, currentWeek] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: 'asc' } }),
    prisma.dragonTrade.findMany?.({
      where: { status: 'PENDING' },
      orderBy: [{ createdAt: 'desc' }],
      take: 50,
    }) ?? [],
    prisma.dragonOrbEvent.findMany?.({
      orderBy: [{ createdAt: 'desc' }],
      take: 40,
    }) ?? [],
    prisma.dragonItemEvent.findMany?.({
      orderBy: [{ createdAt: 'desc' }],
      take: 40,
    }) ?? [],
    prisma.dragonWeek.findMany?.({
      orderBy: [{ weekStart: 'desc' }],
      take: 12,
    }) ?? [],
    getDragonOmenForDate(prisma, new Date(), { seasonKey }),
  ])

  const currentWeekOrbName = getDragonOrbName(currentWeek.star)

  const realUsers = []
  const immortalUsers = []
  for (const user of users) {
    if (isThomasUser(user)) {
      immortalUsers.push({
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        title: 'Immortal Duck',
      })
      continue
    }

    realUsers.push({
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      inventory: await getDragonInventory(prisma, user.id, seasonKey),
    })
  }

  return {
    seasonKey,
    orbNames: Object.fromEntries(DRAGON_STARS.map((star) => [star, getDragonOrbName(star)])),
    currentWeek: {
      ...currentWeek,
      orbName: currentWeekOrbName,
      headline: `${currentWeekOrbName} xuất thế.`,
      subline: `Winner official race tuần này sẽ nhận ${currentWeekOrbName}.`,
    },
    users: realUsers,
    immortalUsers,
    trades,
    recentOrbEvents: orbEvents,
    recentItemEvents: itemEvents,
    weeks,
  }
}

export async function adminGrantDragonOrb(
  prisma: any,
  userId: number,
  star: number,
  seasonKey = DEFAULT_DRAGON_SEASON_KEY
) {
  return withDragonTransaction(prisma, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user) return { granted: false, reason: 'USER_NOT_FOUND' }
    if (isThomasUser(user)) return { granted: false, reason: 'THOMAS_BLOCKED' }
    if (!DRAGON_STARS.includes(star as any)) return { granted: false, reason: 'INVALID_STAR' }

    const orb = await tx.dragonOrb.create({
      data: {
        currentOwnerId: userId,
        originalOwnerId: userId,
        seasonKey,
        star,
        status: 'ACTIVE',
        source: 'ADMIN_GRANTED',
      },
    })
    await tx.dragonOrbEvent.create({
      data: {
        orbId: orb.id,
        userId,
        type: 'ADMIN_GRANTED',
        message: `Admin granted ${getDragonOrbName(star)} cho ${user.name}.`,
      },
    })
    return { granted: true, orb }
  })
}

export async function adminVoidDragonOrb(prisma: any, orbId: number, actorLabel = 'admin') {
  return withDragonTransaction(prisma, async (tx) => {
    const orb = await tx.dragonOrb.findFirst({ where: { id: orbId } })
    if (!orb) return { voided: false, reason: 'ORB_NOT_FOUND' }
    const updated = await tx.dragonOrb.update({
      where: { id: orbId },
      data: {
        status: 'VOIDED',
        voidedAt: new Date(),
        lockedByTradeId: null,
        lockedBySummonId: null,
      },
    })
    await tx.dragonOrbEvent.create({
      data: {
        orbId,
        userId: orb.currentOwnerId,
        type: 'ADMIN_VOIDED',
        message: `${actorLabel} voided ${getDragonOrbName(orb.star)}.`,
      },
    })
    return { voided: true, orb: updated }
  })
}

export function getOrbCountsByStar(orbs: Array<{ star: number; status: string; lockedByTradeId?: number | null; lockedBySummonId?: number | null }>) {
  return Object.fromEntries(
    DRAGON_STARS.map((star) => [
      star,
      orbs.filter((orb) => orb.star === star && orb.status === 'ACTIVE').length,
    ])
  )
}

export function countUnlockedUniqueStars(orbs: Array<{ star: number; status: string; lockedByTradeId?: number | null; lockedBySummonId?: number | null }>) {
  return new Set(orbs.filter(isUnlockedDragonOrb).map((orb) => orb.star)).size
}
