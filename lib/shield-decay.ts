function getIsoWeekKey(date = new Date()) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utcDate.getUTCDay() || 7
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

export { getIsoWeekKey }

export const SHIELD_INITIAL_CHARGES = 3
export const SHIELD_CRAFT_COST = 2
export const SHIELD_MAX_ACTIVE = 1

type ShieldCounterRow = { ownerId: number; _count: { _all: number } }

type ActiveShieldRecord = {
  id: number
  ownerId: number
  charges: number
  weeksUnused: number
  earnedAt: Date
}

function chargesToLegacyWeeks(charges: number) {
  return Math.max(0, SHIELD_INITIAL_CHARGES - Math.max(0, charges))
}

function legacyWeeksToCharges(weeksUnused: number) {
  return Math.max(1, SHIELD_INITIAL_CHARGES - Math.max(0, weeksUnused))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withTransaction<T>(prisma: any, fn: (tx: any) => Promise<T>) {
  if (typeof prisma.$transaction === 'function') {
    return prisma.$transaction(fn)
  }

  return fn(prisma)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncOwnerShieldCount(prisma: any, ownerId: number) {
  const activeCount = await prisma.shield.count({
    where: {
      ownerId,
      status: 'active',
    },
  })

  await prisma.user.update({
    where: { id: ownerId },
    data: { shields: Math.min(activeCount, SHIELD_MAX_ACTIVE) },
  })

  return activeCount
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncShieldCounters(prisma: any, userIds: Array<number | null | undefined>) {
  const uniqueUserIds = Array.from(new Set(userIds.filter((userId): userId is number => typeof userId === 'number')))
  for (const ownerId of uniqueUserIds) {
    await syncOwnerShieldCount(prisma, ownerId)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function normalizeLegacyShieldState(prisma: any, ownerIds?: number[]) {
  const shields = await prisma.shield.findMany({
    where: {
      status: 'active',
      ...(ownerIds && ownerIds.length > 0 ? { ownerId: { in: ownerIds } } : {}),
    },
    orderBy: [{ ownerId: 'asc' }, { earnedAt: 'asc' }],
  })

  const grouped = new Map<number, ActiveShieldRecord[]>()
  for (const shield of shields as ActiveShieldRecord[]) {
    const ownerShields = grouped.get(shield.ownerId) ?? []
    ownerShields.push(shield)
    grouped.set(shield.ownerId, ownerShields)
  }

  if (grouped.size === 0) {
    return
  }

  const now = new Date()

  await withTransaction(prisma, async (tx) => {
    for (const [ownerId, ownerShields] of grouped) {
      for (const shield of ownerShields) {
        const shouldBackfillCharges = shield.charges === SHIELD_INITIAL_CHARGES && shield.weeksUnused > 0
        const nextCharges = shouldBackfillCharges
          ? legacyWeeksToCharges(shield.weeksUnused)
          : Math.min(Math.max(shield.charges, 1), SHIELD_INITIAL_CHARGES)
        const nextWeeksUnused = chargesToLegacyWeeks(nextCharges)

        if (nextCharges !== shield.charges || nextWeeksUnused !== shield.weeksUnused) {
          await tx.shield.update({
            where: { id: shield.id },
            data: {
              charges: nextCharges,
              weeksUnused: nextWeeksUnused,
            },
          })
          shield.charges = nextCharges
          shield.weeksUnused = nextWeeksUnused
        }
      }

      if (ownerShields.length > SHIELD_MAX_ACTIVE) {
        const sortedShields = [...ownerShields].sort((left, right) => {
          if (right.charges !== left.charges) {
            return right.charges - left.charges
          }
          return left.earnedAt.getTime() - right.earnedAt.getTime()
        })
        const extras = sortedShields.slice(SHIELD_MAX_ACTIVE)

        if (extras.length > 0) {
          for (const shield of extras) {
            await tx.shield.update({
              where: { id: shield.id },
              data: {
                charges: 0,
                weeksUnused: SHIELD_INITIAL_CHARGES,
                status: 'converted',
                consumedAt: now,
              },
            })
          }
        }
      }

      await syncOwnerShieldCount(tx, ownerId)
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tickShieldDecay(prisma: any, options: { skipDecayReason?: string } = {}): Promise<{
  broken: { shieldId: number; ownerId: number }[]
  lost: { shieldId: number; ownerId: number }[]
  weekKey: string
}> {
  const weekKey = getIsoWeekKey()
  const existingTick = await prisma.weeklyTick.findUnique({
    where: { weekKey },
  })

  if (existingTick) {
    return { broken: [], lost: [], weekKey }
  }

  await normalizeLegacyShieldState(prisma)

  if (options.skipDecayReason) {
    await prisma.weeklyTick.create({
      data: {
        weekKey,
        brokenShields: 0,
        lostShields: 0,
        details: JSON.stringify({ skipped: true, reason: options.skipDecayReason }),
      },
    })
    return { broken: [], lost: [], weekKey }
  }

  const activeShields = await prisma.shield.findMany({
    where: { status: 'active' },
    orderBy: [{ ownerId: 'asc' }, { charges: 'asc' }, { earnedAt: 'asc' }],
  })

  const broken: { shieldId: number; ownerId: number }[] = []
  const lost: { shieldId: number; ownerId: number }[] = []
  const decayed: { shieldId: number; ownerId: number; charges: number }[] = []
  const now = new Date()

  await withTransaction(prisma, async (tx) => {
    for (const shield of activeShields as ActiveShieldRecord[]) {
      const nextCharges = shield.charges - 1

      if (nextCharges <= 0) {
        await tx.shield.update({
          where: { id: shield.id },
          data: {
            charges: 0,
            weeksUnused: SHIELD_INITIAL_CHARGES,
            status: 'broken',
            consumedAt: now,
          },
        })

        broken.push({ shieldId: shield.id, ownerId: shield.ownerId })
        continue
      }

      await tx.shield.update({
        where: { id: shield.id },
        data: {
          charges: nextCharges,
          weeksUnused: chargesToLegacyWeeks(nextCharges),
        },
      })
      decayed.push({ shieldId: shield.id, ownerId: shield.ownerId, charges: nextCharges })
    }

    const userCounts = await tx.shield.groupBy({
      by: ['ownerId'],
      where: { status: 'active' },
      _count: { _all: true },
    })

    for (const row of userCounts as ShieldCounterRow[]) {
      await tx.user.update({
        where: { id: row.ownerId },
        data: {
          shields: Math.min(row._count._all, SHIELD_MAX_ACTIVE),
        },
      })
    }

    const ownersWithNoActiveShields = new Set<number>([...broken, ...lost].map((item) => item.ownerId))
    for (const ownerId of ownersWithNoActiveShields) {
      const activeCount = (userCounts as ShieldCounterRow[]).find((row) => row.ownerId === ownerId)?._count._all ?? 0
      if (activeCount === 0) {
        await tx.user.update({
          where: { id: ownerId },
          data: { shields: 0 },
        })
      }
    }

    await tx.weeklyTick.create({
      data: {
        weekKey,
        brokenShields: broken.length,
        lostShields: 0,
        details: JSON.stringify({ decayed, broken }),
      },
    })
  })

  return { broken, lost, weekKey }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function consumeShield(prisma: any, ownerId: number, shieldId?: number) {
  const shield = shieldId
    ? await prisma.shield.findFirst({
        where: {
          id: shieldId,
          ownerId,
          status: 'active',
        },
      })
    : await prisma.shield.findFirst({
        where: {
          ownerId,
          status: 'active',
        },
        orderBy: [{ charges: 'asc' }, { earnedAt: 'asc' }],
      })

  if (!shield) {
    return null
  }

  const now = new Date()
  await prisma.shield.update({
    where: { id: shield.id },
    data: {
      charges: 0,
      weeksUnused: SHIELD_INITIAL_CHARGES,
      status: 'used',
      consumedAt: now,
    },
  })

  await syncOwnerShieldCount(prisma, ownerId)

  return shield
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createShield(prisma: any, ownerId: number, earnedRaceId?: number, charges = SHIELD_INITIAL_CHARGES) {
  const existingShield = await prisma.shield.findFirst({
    where: {
      ownerId,
      status: 'active',
    },
    orderBy: [{ charges: 'asc' }, { earnedAt: 'asc' }],
  })

  if (existingShield) {
    await syncOwnerShieldCount(prisma, ownerId)
    return existingShield
  }

  const normalizedCharges = Math.min(Math.max(charges, 1), SHIELD_INITIAL_CHARGES)
  const shield = await prisma.shield.create({
    data: {
      ownerId,
      earnedRaceId,
      charges: normalizedCharges,
      weeksUnused: chargesToLegacyWeeks(normalizedCharges),
      status: 'active',
    },
  })

  await syncOwnerShieldCount(prisma, ownerId)

  return shield
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function craftShieldIfEligible(prisma: any, ownerId: number, earnedRaceId?: number) {
  const user = await prisma.user.findUnique({
    where: { id: ownerId },
    select: {
      id: true,
      scars: true,
    },
  })

  if (!user || user.scars < SHIELD_CRAFT_COST) {
    return null
  }

  const existingShield = await prisma.shield.findFirst({
    where: {
      ownerId,
      status: 'active',
    },
  })

  if (existingShield) {
    await syncOwnerShieldCount(prisma, ownerId)
    return null
  }

  await prisma.user.update({
    where: { id: ownerId },
    data: {
      scars: { decrement: SHIELD_CRAFT_COST },
    },
  })

  return createShield(prisma, ownerId, earnedRaceId, SHIELD_INITIAL_CHARGES)
}
