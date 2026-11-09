// Frozen copies of legacy v2 helpers (formerly lib/shield-decay.ts) used only by
// historical app migrations in scripts/run-migrations.ts. Legacy v2 was removed;
// do not change behaviour here, or already-applied migrations stop being reproducible.

export function getIsoWeekKey(date = new Date()) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utcDate.getUTCDay() || 7
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

const SHIELD_INITIAL_CHARGES = 5
const LEGACY_SHIELD_INITIAL_CHARGES = 3
const SHIELD_MAX_ACTIVE = 12

type ActiveShieldRecord = {
  id: number
  ownerId: number
  charges: number
  weeksUnused: number
  earnedAt: Date
  earnedRaceId?: number | null
}

function chargesToLegacyWeeks(charges: number) {
  return Math.max(0, SHIELD_INITIAL_CHARGES - Math.max(0, charges))
}

function legacyWeeksToCharges(weeksUnused: number) {
  return Math.max(1, SHIELD_INITIAL_CHARGES - Math.max(0, weeksUnused))
}

function shouldUpgradeLegacyLifetime(shield: Pick<ActiveShieldRecord, 'charges' | 'weeksUnused'>) {
  if (shield.weeksUnused < 0 || shield.weeksUnused >= LEGACY_SHIELD_INITIAL_CHARGES) {
    return false
  }

  return shield.charges === LEGACY_SHIELD_INITIAL_CHARGES - shield.weeksUnused
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withTransaction<T>(prisma: any, fn: (tx: any) => Promise<T>) {
  if (typeof prisma.$transaction === 'function') {
    return prisma.$transaction(fn)
  }

  return fn(prisma)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncOwnerShieldCount(prisma: any, ownerId: number) {
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
        const shouldBackfillCharges = shouldUpgradeLegacyLifetime(shield) || (shield.charges === SHIELD_INITIAL_CHARGES && shield.weeksUnused > 0)
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
