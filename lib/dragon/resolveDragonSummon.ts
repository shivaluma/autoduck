/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  DRAGON_ITEM_LABEL,
  DRAGON_ITEM_SUBTITLE,
  DRAGON_STARS,
  getDragonOrbName,
} from './naming'
import {
  DEFAULT_DRAGON_SEASON_KEY,
  DRAGON_ITEM_TYPE_SCALE,
  isThomasUser,
  isUnlockedDragonOrb,
  withDragonTransaction,
} from './utils'

const BLOCKED_BY_ACTIVE_SCALE = 'Ngươi đang giữ Long Lân Hộ Mệnh. Dùng nó trước khi nhận cái tiếp theo.'

export type SummonReadiness = {
  ready: boolean
  claimBlocked: boolean
  blockedReason?: string
  selectedOrbIdsForClaim: number[]
  progress: number
  missingStars: number[]
}

async function getActiveScaleItems(prisma: any, userId: number) {
  const items = await prisma.dragonItem.findMany?.({
    where: {
      userId,
      type: DRAGON_ITEM_TYPE_SCALE,
    },
  }) ?? []

  return items.filter((item: { status: string }) => item.status === 'ACTIVE' || item.status === 'EQUIPPED')
}

export async function getSummonReadiness(
  prisma: any,
  userId: number,
  seasonKey = DEFAULT_DRAGON_SEASON_KEY
): Promise<SummonReadiness> {
  const orbs = await prisma.dragonOrb.findMany({
    where: {
      currentOwnerId: userId,
      seasonKey,
      status: 'ACTIVE',
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const unlocked = orbs.filter(isUnlockedDragonOrb)
  const selectedOrbIdsForClaim: number[] = []
  const presentStars = new Set<number>()

  for (const star of DRAGON_STARS) {
    const orb = unlocked.find((candidate: { star: number }) => candidate.star === star)
    if (orb) {
      presentStars.add(star)
      selectedOrbIdsForClaim.push(orb.id)
    }
  }

  const missingStars = DRAGON_STARS.filter((star) => !presentStars.has(star))
  const activeScaleItems = await getActiveScaleItems(prisma, userId)

  return {
    ready: missingStars.length === 0,
    claimBlocked: missingStars.length === 0 && activeScaleItems.length > 0,
    blockedReason: missingStars.length === 0 && activeScaleItems.length > 0 ? BLOCKED_BY_ACTIVE_SCALE : undefined,
    selectedOrbIdsForClaim,
    progress: presentStars.size,
    missingStars,
  }
}

export async function resolveDragonSummon(
  prisma: any,
  userId: number,
  actorUserId: number,
  options: { isAdmin?: boolean; seasonKey?: string } = {}
) {
  if (!options.isAdmin && actorUserId !== userId) {
    return { resolved: false, reason: 'NOT_ALLOWED' }
  }

  return withDragonTransaction(prisma, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user) {
      return { resolved: false, reason: 'USER_NOT_FOUND' }
    }
    if (isThomasUser(user)) {
      return { resolved: false, reason: 'THOMAS_BLOCKED' }
    }

    const seasonKey = options.seasonKey ?? DEFAULT_DRAGON_SEASON_KEY
    const readiness = await getSummonReadiness(tx, userId, seasonKey)
    if (!readiness.ready) {
      return {
        resolved: false,
        reason: 'MISSING_ORBS',
        missingStars: readiness.missingStars,
      }
    }
    if (readiness.claimBlocked) {
      return {
        resolved: false,
        blocked: true,
        reason: readiness.blockedReason,
      }
    }

    const summon = await tx.dragonSummon.create({
      data: {
        userId,
        seasonKey,
        status: 'PENDING',
        consumedOrbIdsJson: JSON.stringify(readiness.selectedOrbIdsForClaim),
      },
    })
    const consumedOrbIds: number[] = []

    for (const orbId of readiness.selectedOrbIdsForClaim) {
      const orb = await tx.dragonOrb.update({
        where: { id: orbId },
        data: {
          status: 'CONSUMED',
          lockedBySummonId: summon.id,
          consumedAt: new Date(),
        },
      })
      consumedOrbIds.push(orb.id)
      await tx.dragonOrbEvent.create({
        data: {
          orbId: orb.id,
          userId,
          summonId: summon.id,
          type: 'SUMMON_CONSUMED',
          message: `${getDragonOrbName(orb.star)} nhập vào cổng triệu hồi.`,
        },
      })
    }

    const item = await tx.dragonItem.create({
      data: {
        userId,
        summonId: summon.id,
        type: DRAGON_ITEM_TYPE_SCALE,
        status: 'ACTIVE',
        source: 'DRAGON_SUMMON',
        label: DRAGON_ITEM_LABEL,
        subtitle: DRAGON_ITEM_SUBTITLE,
        payloadJson: JSON.stringify({
          protects: ['MAIN_DUCK', 'BOSS_CLONE', 'CHEST_CLONE', 'OWNER_MAPPED_ENTRIES'],
          doesNotDecay: true,
          normalCharges: null,
          consumeRule: 'CONSUME_ONLY_WHEN_PROTECTION_TRIGGERS',
        }),
      },
    })

    await tx.dragonItemEvent.create({
      data: {
        itemId: item.id,
        userId,
        type: 'GRANTED',
        message: `${DRAGON_ITEM_LABEL} (${DRAGON_ITEM_SUBTITLE}) đã được ban.`,
      },
    })

    await tx.dragonSummon.update({
      where: { id: summon.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        grantedItemId: item.id,
      },
    })

    return {
      resolved: true,
      consumedOrbIds,
      item: {
        id: item.id,
        type: DRAGON_ITEM_TYPE_SCALE,
        label: DRAGON_ITEM_LABEL,
        subtitle: DRAGON_ITEM_SUBTITLE,
        status: 'ACTIVE',
      },
    }
  })
}
