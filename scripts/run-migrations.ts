import path from 'path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../prisma/generated/prisma/client'
import { getIsoWeekKey, normalizeLegacyShieldState } from '../lib/shield-decay'

type Migration = {
  id: string
  name: string
  run: (prisma: PrismaClient) => Promise<void>
}

function createClient() {
  const dbUrl = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'prisma', 'dev.db')}`
  const adapter = new PrismaBetterSqlite3({ url: dbUrl })
  return new PrismaClient({ adapter })
}

async function ensureMigrationTable(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AppMigration" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

async function hasMigration(prisma: PrismaClient, id: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "AppMigration" WHERE "id" = ? LIMIT 1`,
    id
  )
  return rows.length > 0
}

async function markMigration(prisma: PrismaClient, migration: Migration) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "AppMigration" ("id", "name", "runAt") VALUES (?, ?, CURRENT_TIMESTAMP)`,
    migration.id,
    migration.name
  )
}

async function migrateShieldCharges(prisma: PrismaClient) {
  await normalizeLegacyShieldState(prisma)

  const activeCounts = await prisma.shield.groupBy({
    by: ['ownerId'],
    where: { status: 'active' },
    _count: { _all: true },
  })
  const countsByOwner = new Map(activeCounts.map((row) => [row.ownerId, Math.min(row._count._all, 1)]))

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      shields: true,
    },
  })

  for (const user of users) {
    const nextCount = user.name === 'Thomas' || user.shields >= 9999
      ? user.shields
      : countsByOwner.get(user.id) ?? 0

    if (nextCount !== user.shields) {
      await prisma.user.update({
        where: { id: user.id },
        data: { shields: nextCount },
      })
    }
  }
}

async function rebuildBossWatchFromOfficialRaces(prisma: PrismaClient, raceCount: number) {
  const races = await prisma.race.findMany({
    where: {
      status: 'finished',
      isTest: false,
    },
    orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
    take: raceCount,
    include: {
      participants: {
        select: {
          userId: true,
          gotScar: true,
        },
      },
    },
  })

  const orderedRaces = [...races].reverse()
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      isBoss: true,
      bossSince: true,
    },
  })

  for (const user of users) {
    if (user.name === 'Thomas' || user.id === 127) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          cleanStreak: 0,
          isBoss: false,
          bossSince: null,
        },
      })
      continue
    }

    let streak = 0
    let bossSince: Date | null = null

    for (const race of orderedRaces) {
      const entries = race.participants.filter((participant) => participant.userId === user.id)
      if (entries.length === 0) {
        continue
      }

      const gotScar = entries.some((participant) => participant.gotScar)
      if (gotScar) {
        streak = 0
        bossSince = null
        continue
      }

      streak += 1
      if (streak >= 3) {
        bossSince = race.finishedAt ?? race.createdAt
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        cleanStreak: streak,
        isBoss: streak >= 3,
        bossSince: streak >= 3 ? (bossSince ?? user.bossSince ?? new Date()) : null,
      },
    })
  }
}

async function rebuildBossWatchFromOfficialWeeks(prisma: PrismaClient, weekCount: number) {
  const candidateRaces = await prisma.race.findMany({
    where: {
      status: 'finished',
      isTest: false,
    },
    orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
    include: {
      participants: {
        select: {
          userId: true,
          gotScar: true,
        },
      },
    },
  })

  const racesByWeek = new Map<string, typeof candidateRaces[number]>()
  for (const race of candidateRaces) {
    const weekKey = getIsoWeekKey(race.finishedAt ?? race.createdAt)
    if (!racesByWeek.has(weekKey)) {
      racesByWeek.set(weekKey, race)
    }
    if (racesByWeek.size >= weekCount) {
      break
    }
  }

  const orderedRaces = Array.from(racesByWeek.values()).reverse()
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      isBoss: true,
      bossSince: true,
    },
  })

  for (const user of users) {
    if (user.name === 'Thomas' || user.id === 127) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          cleanStreak: 0,
          isBoss: false,
          bossSince: null,
        },
      })
      continue
    }

    let streak = 0
    let bossSince: Date | null = null

    for (const race of orderedRaces) {
      const entries = race.participants.filter((participant) => participant.userId === user.id)
      if (entries.length === 0) {
        continue
      }

      const gotScar = entries.some((participant) => participant.gotScar)
      if (gotScar) {
        streak = 0
        bossSince = null
        continue
      }

      streak += 1
      if (streak >= 3) {
        bossSince = race.finishedAt ?? race.createdAt
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        cleanStreak: streak,
        isBoss: streak >= 3,
        bossSince: streak >= 3 ? (bossSince ?? user.bossSince ?? new Date()) : null,
      },
    })
  }
}

async function migrateBossWatchFromOfficialRaces(prisma: PrismaClient) {
  await rebuildBossWatchFromOfficialRaces(prisma, 5)
}

async function migrateBossWatchFromLast8OfficialRaces(prisma: PrismaClient) {
  await rebuildBossWatchFromOfficialRaces(prisma, 8)
}

async function migrateBossWatchFromLast8OfficialWeeks(prisma: PrismaClient) {
  await rebuildBossWatchFromOfficialWeeks(prisma, 8)
}

async function migrateThomasOutOfBoss(prisma: PrismaClient) {
  await prisma.user.updateMany({
    where: {
      OR: [
        { name: 'Thomas' },
        { shields: { gte: 9999 } },
      ],
    },
    data: {
      cleanStreak: 0,
      isBoss: false,
      bossSince: null,
    },
  })
}

async function voidLegacyTargetedChests(prisma: PrismaClient) {
  await prisma.mysteryChest.updateMany({
    where: {
      status: 'active',
      effect: {
        in: [
          'NOTHING',
          'CURSE_SWAP',
          'INSURANCE_FRAUD',
          'IDENTITY_THEFT',
          'PUBLIC_SHIELD',
          'I_CHOOSE_YOU',
        ],
      },
    },
    data: {
      status: 'void',
      consumedAt: new Date(),
      targetUserId: null,
      rngSeed: JSON.stringify({
        migration: '2026-04-23-006-void-legacy-targeted-chests',
        reason: 'Reward Chest V2 removes targeted legacy effects',
      }),
    },
  })
}

const migrations: Migration[] = [
  {
    id: '2026-04-23-001-shield-charges-v1',
    name: 'Backfill shield charges, collapse legacy multi-shield stacks, sync counters',
    run: migrateShieldCharges,
  },
  {
    id: '2026-04-23-002-boss-watch-last-5-official',
    name: 'Rebuild boss watch from the latest 5 official finished races',
    run: migrateBossWatchFromOfficialRaces,
  },
  {
    id: '2026-04-23-003-thomas-never-boss',
    name: 'Force immortal Thomas out of Boss Duck state',
    run: migrateThomasOutOfBoss,
  },
  {
    id: '2026-04-23-004-boss-watch-last-8-official',
    name: 'Rebuild boss watch from the latest 8 official finished races',
    run: migrateBossWatchFromLast8OfficialRaces,
  },
  {
    id: '2026-04-23-005-boss-watch-last-8-official-weeks',
    name: 'Rebuild boss watch from the latest 8 official race weeks',
    run: migrateBossWatchFromLast8OfficialWeeks,
  },
  {
    id: '2026-04-23-006-void-legacy-targeted-chests',
    name: 'Void active legacy targeted chests before Reward Chest V2',
    run: voidLegacyTargetedChests,
  },
]

async function main() {
  const prisma = createClient()

  try {
    await ensureMigrationTable(prisma)
    console.log(`🧭 App migrations: ${migrations.length} registered`)

    for (const migration of migrations) {
      const alreadyRan = await hasMigration(prisma, migration.id)
      if (alreadyRan) {
        console.log(`  · SKIP ${migration.id} (${migration.name})`)
        continue
      }

      console.log(`  → RUN  ${migration.id} (${migration.name})`)
      await migration.run(prisma)
      await markMigration(prisma, migration)
      console.log(`  ✓ DONE ${migration.id}`)
    }

    const applied = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; runAt: string }>>(
      `SELECT "id", "name", "runAt" FROM "AppMigration" ORDER BY "runAt" ASC`
    )

    console.log(`\n✅ Applied migrations: ${applied.length}`)
    for (const row of applied) {
      console.log(`   - ${row.id} @ ${row.runAt}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('❌ App migration failed:', error)
  process.exit(1)
})
