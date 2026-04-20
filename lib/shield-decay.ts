function getIsoWeekKey(date = new Date()) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utcDate.getUTCDay() || 7
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

export { getIsoWeekKey }

type ShieldCounterRow = { ownerId: number; _count: { _all: number } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function tickShieldDecay(prisma: any): Promise<{
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

  const activeShields = await prisma.shield.findMany({
    where: { status: 'active' },
    orderBy: [{ ownerId: 'asc' }, { earnedAt: 'asc' }],
  })

  const broken: { shieldId: number; ownerId: number }[] = []
  const lost: { shieldId: number; ownerId: number }[] = []
  const now = new Date()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.$transaction(async (tx: any) => {
    for (const shield of activeShields) {
      const nextWeeksUnused = shield.weeksUnused + 1

      if (nextWeeksUnused >= 5) {
        await tx.shield.update({
          where: { id: shield.id },
          data: {
            weeksUnused: nextWeeksUnused,
            status: 'lost',
            consumedAt: now,
          },
        })

        lost.push({ shieldId: shield.id, ownerId: shield.ownerId })
        continue
      }

      if (nextWeeksUnused === 3) {
        await tx.shield.update({
          where: { id: shield.id },
          data: {
            weeksUnused: nextWeeksUnused,
            status: 'broken',
            consumedAt: now,
          },
        })

        await tx.user.update({
          where: { id: shield.ownerId },
          data: {
            scars: { increment: 1 },
          },
        })

        broken.push({ shieldId: shield.id, ownerId: shield.ownerId })
        continue
      }

      await tx.shield.update({
        where: { id: shield.id },
        data: {
          weeksUnused: nextWeeksUnused,
        },
      })
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
          shields: row._count._all,
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
        lostShields: lost.length,
        details: JSON.stringify({ broken, lost }),
      },
    })
  })

  return { broken, lost, weekKey }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function consumeOldestShield(prisma: any, ownerId: number) {
  const shield = await prisma.shield.findFirst({
    where: {
      ownerId,
      status: 'active',
    },
    orderBy: [{ weeksUnused: 'desc' }, { earnedAt: 'asc' }],
  })

  if (!shield) {
    return null
  }

  const now = new Date()
  await prisma.shield.update({
    where: { id: shield.id },
    data: {
      status: 'used',
      consumedAt: now,
      weeksUnused: 0,
    },
  })

  const activeCount = await prisma.shield.count({
    where: {
      ownerId,
      status: 'active',
    },
  })

  await prisma.user.update({
    where: { id: ownerId },
    data: {
      shields: activeCount,
    },
  })

  return shield
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createShield(prisma: any, ownerId: number, earnedRaceId?: number) {
  const shield = await prisma.shield.create({
    data: {
      ownerId,
      earnedRaceId,
      weeksUnused: 0,
      status: 'active',
    },
  })

  const activeCount = await prisma.shield.count({
    where: {
      ownerId,
      status: 'active',
    },
  })

  await prisma.user.update({
    where: { id: ownerId },
    data: { shields: activeCount },
  })

  return shield
}
