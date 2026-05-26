/* eslint-disable @typescript-eslint/no-explicit-any */
import { DRAGON_ITEM_LABEL, DRAGON_ITEM_SUBTITLE } from './naming'
import { DRAGON_ITEM_TYPE_SCALE, getOwnerUserIdForRaceEntry, isThomasUser, withDragonTransaction } from './utils'

export async function getEquippedDragonScaleForUserRace(prisma: any, userId: number, raceId: number) {
  return prisma.dragonItem.findFirst({
    where: {
      userId,
      type: DRAGON_ITEM_TYPE_SCALE,
      status: 'EQUIPPED',
      equippedForRaceId: raceId,
    },
  })
}

export async function equipDragonScaleForRace(
  prisma: any,
  userId: number,
  raceId: number,
  itemId: number
) {
  return withDragonTransaction(prisma, async (tx) => {
    const [user, race, item] = await Promise.all([
      tx.user.findUnique({ where: { id: userId } }),
      tx.race.findUnique({
        where: { id: raceId },
        include: { participants: true },
      }),
      tx.dragonItem.findFirst({ where: { id: itemId } }),
    ])

    if (!user || !race || !item) {
      return { equipped: false, reason: 'NOT_FOUND' }
    }
    if (isThomasUser(user)) {
      return { equipped: false, reason: 'THOMAS_BLOCKED' }
    }
    if (race.status === 'finished' || race.status === 'failed') {
      return { equipped: false, reason: 'RACE_CLOSED' }
    }
    if (item.userId !== userId || item.type !== DRAGON_ITEM_TYPE_SCALE) {
      return { equipped: false, reason: 'ITEM_NOT_OWNED' }
    }
    if (item.status === 'EQUIPPED' && item.equippedForRaceId === raceId) {
      return { equipped: true, item }
    }
    if (item.status === 'EQUIPPED') {
      return { equipped: false, reason: 'ITEM_EQUIPPED_ELSEWHERE' }
    }
    if (item.status !== 'ACTIVE') {
      return { equipped: false, reason: 'ITEM_NOT_ACTIVE' }
    }

    const ownsRaceEntry = (race.participants ?? []).some((participant: { userId: number; cloneOfUserId?: number | null }) => {
      return getOwnerUserIdForRaceEntry(participant) === userId
    })
    if (!ownsRaceEntry) {
      return { equipped: false, reason: 'USER_NOT_IN_RACE' }
    }

    const updated = await tx.dragonItem.update({
      where: { id: itemId },
      data: {
        status: 'EQUIPPED',
        equippedForRaceId: raceId,
        equippedAt: new Date(),
      },
    })
    await tx.dragonItemEvent.create({
      data: {
        itemId,
        userId,
        raceId,
        type: 'EQUIPPED',
        message: `${DRAGON_ITEM_LABEL} (${DRAGON_ITEM_SUBTITLE}) đã nhập trận.`,
      },
    })

    return { equipped: true, item: updated }
  })
}

export async function unequipDragonScaleForRace(
  prisma: any,
  userId: number,
  raceId: number,
  itemId: number
) {
  return withDragonTransaction(prisma, async (tx) => {
    const [race, item] = await Promise.all([
      tx.race.findUnique({ where: { id: raceId } }),
      tx.dragonItem.findFirst({ where: { id: itemId } }),
    ])

    if (!race || !item) {
      return { unequipped: false, reason: 'NOT_FOUND' }
    }
    if (race.status === 'finished' || race.status === 'failed') {
      return { unequipped: false, reason: 'RACE_CLOSED' }
    }
    if (item.userId !== userId || item.type !== DRAGON_ITEM_TYPE_SCALE || item.status !== 'EQUIPPED' || item.equippedForRaceId !== raceId) {
      return { unequipped: false, reason: 'ITEM_NOT_EQUIPPED_FOR_RACE' }
    }

    const updated = await tx.dragonItem.update({
      where: { id: itemId },
      data: {
        status: 'ACTIVE',
        equippedForRaceId: null,
        equippedAt: null,
      },
    })
    await tx.dragonItemEvent.create({
      data: {
        itemId,
        userId,
        raceId,
        type: 'UNEQUIPPED',
        message: `${DRAGON_ITEM_LABEL} đã rời trận.`,
      },
    })

    return { unequipped: true, item: updated }
  })
}

export async function adminGrantDragonScale(prisma: any, userId: number) {
  return withDragonTransaction(prisma, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } })
    if (!user) return { granted: false, reason: 'USER_NOT_FOUND' }
    if (isThomasUser(user)) return { granted: false, reason: 'THOMAS_BLOCKED' }

    const activeItems = await tx.dragonItem.findMany({
      where: {
        userId,
        type: DRAGON_ITEM_TYPE_SCALE,
      },
    })
    if (activeItems.some((item: { status: string }) => item.status === 'ACTIVE' || item.status === 'EQUIPPED')) {
      return { granted: false, reason: 'ACTIVE_SCALE_EXISTS' }
    }

    const item = await tx.dragonItem.create({
      data: {
        userId,
        type: DRAGON_ITEM_TYPE_SCALE,
        status: 'ACTIVE',
        source: 'ADMIN_GRANTED',
        label: DRAGON_ITEM_LABEL,
        subtitle: DRAGON_ITEM_SUBTITLE,
      },
    })
    await tx.dragonItemEvent.create({
      data: {
        itemId: item.id,
        userId,
        type: 'GRANTED',
        message: `Admin granted ${DRAGON_ITEM_LABEL}.`,
      },
    })

    return { granted: true, item }
  })
}
