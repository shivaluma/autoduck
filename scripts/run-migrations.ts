import path from 'path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../prisma/generated/prisma/client'
import { getIsoWeekKey, normalizeLegacyShieldState } from '../lib/shield-decay'

type Migration = {
  id: string
  name: string
  run: (prisma: PrismaClient) => Promise<void>
}

const BOSS_STREAK_THRESHOLD = 4

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
      if (streak >= BOSS_STREAK_THRESHOLD) {
        bossSince = race.finishedAt ?? race.createdAt
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        cleanStreak: streak,
        isBoss: streak >= BOSS_STREAK_THRESHOLD,
        bossSince: streak >= BOSS_STREAK_THRESHOLD ? (bossSince ?? user.bossSince ?? new Date()) : null,
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
      if (streak >= BOSS_STREAK_THRESHOLD) {
        bossSince = race.finishedAt ?? race.createdAt
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        cleanStreak: streak,
        isBoss: streak >= BOSS_STREAK_THRESHOLD,
        bossSince: streak >= BOSS_STREAK_THRESHOLD ? (bossSince ?? user.bossSince ?? new Date()) : null,
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

async function hasColumn(prisma: PrismaClient, tableName: string, columnName: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${tableName}")`)
  return rows.some((row) => row.name === columnName)
}

async function createDragonMetaSystem(prisma: PrismaClient) {
  if (!(await hasColumn(prisma, 'RaceParticipant', 'dragonEligible'))) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "RaceParticipant" ADD COLUMN "dragonEligible" BOOLEAN NOT NULL DEFAULT true`)
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DragonWeek" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "seasonKey" TEXT NOT NULL DEFAULT 'default',
      "weekKey" TEXT NOT NULL,
      "weekStart" DATETIME NOT NULL,
      "weekEnd" DATETIME NOT NULL,
      "star" INTEGER NOT NULL,
      "raceId" INTEGER,
      "awardedOrbId" INTEGER,
      "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "DragonWeek_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "DragonWeek_seasonKey_weekKey_key" ON "DragonWeek"("seasonKey", "weekKey")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonWeek_star_idx" ON "DragonWeek"("star")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonWeek_raceId_idx" ON "DragonWeek"("raceId")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DragonOrb" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "currentOwnerId" INTEGER NOT NULL,
      "originalOwnerId" INTEGER,
      "originalRaceId" INTEGER,
      "dragonWeekId" INTEGER,
      "seasonKey" TEXT NOT NULL DEFAULT 'default',
      "star" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "source" TEXT NOT NULL DEFAULT 'RACE_WIN',
      "lockedByTradeId" INTEGER,
      "lockedBySummonId" INTEGER,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      "consumedAt" DATETIME,
      "voidedAt" DATETIME,
      CONSTRAINT "DragonOrb_currentOwnerId_fkey" FOREIGN KEY ("currentOwnerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "DragonOrb_originalOwnerId_fkey" FOREIGN KEY ("originalOwnerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonOrb_originalRaceId_fkey" FOREIGN KEY ("originalRaceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonOrb_dragonWeekId_fkey" FOREIGN KEY ("dragonWeekId") REFERENCES "DragonWeek" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "DragonOrb_originalRaceId_source_key" ON "DragonOrb"("originalRaceId", "source")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrb_currentOwnerId_status_idx" ON "DragonOrb"("currentOwnerId", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrb_currentOwnerId_seasonKey_status_idx" ON "DragonOrb"("currentOwnerId", "seasonKey", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrb_originalRaceId_idx" ON "DragonOrb"("originalRaceId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrb_dragonWeekId_idx" ON "DragonOrb"("dragonWeekId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrb_star_idx" ON "DragonOrb"("star")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrb_lockedByTradeId_idx" ON "DragonOrb"("lockedByTradeId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrb_lockedBySummonId_idx" ON "DragonOrb"("lockedBySummonId")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DragonTrade" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "proposerId" INTEGER NOT NULL,
      "counterpartyId" INTEGER,
      "offeredOrbId" INTEGER NOT NULL,
      "requestedStar" INTEGER NOT NULL,
      "acceptedById" INTEGER,
      "acceptedOrbId" INTEGER,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "message" TEXT,
      "expiresAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "acceptedAt" DATETIME,
      "cancelledAt" DATETIME,
      "voidedAt" DATETIME,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "DragonTrade_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "DragonTrade_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonTrade_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonTrade_offeredOrbId_fkey" FOREIGN KEY ("offeredOrbId") REFERENCES "DragonOrb" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "DragonTrade_acceptedOrbId_fkey" FOREIGN KEY ("acceptedOrbId") REFERENCES "DragonOrb" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonTrade_proposerId_status_idx" ON "DragonTrade"("proposerId", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonTrade_counterpartyId_status_idx" ON "DragonTrade"("counterpartyId", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonTrade_requestedStar_status_idx" ON "DragonTrade"("requestedStar", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonTrade_offeredOrbId_idx" ON "DragonTrade"("offeredOrbId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonTrade_acceptedOrbId_idx" ON "DragonTrade"("acceptedOrbId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonTrade_status_createdAt_idx" ON "DragonTrade"("status", "createdAt")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DragonSummon" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "userId" INTEGER NOT NULL,
      "seasonKey" TEXT NOT NULL DEFAULT 'default',
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "consumedOrbIdsJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "resolvedAt" DATETIME,
      "blockedReason" TEXT,
      "grantedItemId" INTEGER,
      CONSTRAINT "DragonSummon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonSummon_userId_status_idx" ON "DragonSummon"("userId", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonSummon_status_idx" ON "DragonSummon"("status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonSummon_grantedItemId_idx" ON "DragonSummon"("grantedItemId")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DragonItem" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "userId" INTEGER NOT NULL,
      "summonId" INTEGER,
      "type" TEXT NOT NULL DEFAULT 'DRAGON_SCALE',
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "source" TEXT NOT NULL DEFAULT 'DRAGON_SUMMON',
      "label" TEXT NOT NULL DEFAULT 'Long Lân Hộ Mệnh',
      "subtitle" TEXT NOT NULL DEFAULT 'Vảy Rồng',
      "payloadJson" TEXT,
      "equippedForRaceId" INTEGER,
      "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "equippedAt" DATETIME,
      "consumedAt" DATETIME,
      "voidedAt" DATETIME,
      CONSTRAINT "DragonItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "DragonItem_summonId_fkey" FOREIGN KEY ("summonId") REFERENCES "DragonSummon" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonItem_equippedForRaceId_fkey" FOREIGN KEY ("equippedForRaceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonItem_userId_status_idx" ON "DragonItem"("userId", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonItem_type_status_idx" ON "DragonItem"("type", "status")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonItem_equippedForRaceId_idx" ON "DragonItem"("equippedForRaceId")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DragonOrbEvent" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "orbId" INTEGER,
      "userId" INTEGER,
      "raceId" INTEGER,
      "tradeId" INTEGER,
      "summonId" INTEGER,
      "type" TEXT NOT NULL,
      "message" TEXT,
      "payloadJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "DragonOrbEvent_orbId_fkey" FOREIGN KEY ("orbId") REFERENCES "DragonOrb" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonOrbEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonOrbEvent_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonOrbEvent_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "DragonTrade" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
      CONSTRAINT "DragonOrbEvent_summonId_fkey" FOREIGN KEY ("summonId") REFERENCES "DragonSummon" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrbEvent_orbId_idx" ON "DragonOrbEvent"("orbId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrbEvent_userId_createdAt_idx" ON "DragonOrbEvent"("userId", "createdAt")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrbEvent_raceId_idx" ON "DragonOrbEvent"("raceId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrbEvent_tradeId_idx" ON "DragonOrbEvent"("tradeId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrbEvent_summonId_idx" ON "DragonOrbEvent"("summonId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonOrbEvent_type_createdAt_idx" ON "DragonOrbEvent"("type", "createdAt")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "DragonItemEvent" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "itemId" INTEGER NOT NULL,
      "userId" INTEGER NOT NULL,
      "raceId" INTEGER,
      "type" TEXT NOT NULL,
      "message" TEXT,
      "payloadJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "DragonItemEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "DragonItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "DragonItemEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "DragonItemEvent_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonItemEvent_itemId_idx" ON "DragonItemEvent"("itemId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonItemEvent_userId_createdAt_idx" ON "DragonItemEvent"("userId", "createdAt")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonItemEvent_raceId_idx" ON "DragonItemEvent"("raceId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DragonItemEvent_type_createdAt_idx" ON "DragonItemEvent"("type", "createdAt")`)
}

async function createSeason3System(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Season" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "key" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "year" INTEGER NOT NULL,
      "weeks" INTEGER NOT NULL DEFAULT 12,
      "status" TEXT NOT NULL DEFAULT 'active',
      "championUserId" INTEGER,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "endedAt" DATETIME,
      CONSTRAINT "Season_championUserId_fkey" FOREIGN KEY ("championUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Season_key_key" ON "Season"("key")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Season_status_createdAt_idx" ON "Season"("status", "createdAt")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SeasonPlayer" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "seasonId" INTEGER NOT NULL,
      "userId" INTEGER NOT NULL,
      "accessToken" TEXT NOT NULL,
      "scars" INTEGER NOT NULL DEFAULT 0,
      "shields" INTEGER NOT NULL DEFAULT 0,
      "shieldsUsed" INTEGER NOT NULL DEFAULT 0,
      "predictionPoints" INTEGER NOT NULL DEFAULT 0,
      "kingStreak" INTEGER NOT NULL DEFAULT 0,
      "isKing" BOOLEAN NOT NULL DEFAULT false,
      "raceWins" INTEGER NOT NULL DEFAULT 0,
      "raceCount" INTEGER NOT NULL DEFAULT 0,
      "championshipPoints" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "SeasonPlayer_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "SeasonPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SeasonPlayer_accessToken_key" ON "SeasonPlayer"("accessToken")`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SeasonPlayer_seasonId_userId_key" ON "SeasonPlayer"("seasonId", "userId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SeasonPlayer_seasonId_predictionPoints_idx" ON "SeasonPlayer"("seasonId", "predictionPoints")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SeasonPlayer_seasonId_isKing_idx" ON "SeasonPlayer"("seasonId", "isKing")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SeasonWeek" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "seasonId" INTEGER NOT NULL,
      "weekNumber" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'open',
      "chaosType" TEXT NOT NULL,
      "chaosTargetUserId" INTEGER,
      "chaosTargetUserId2" INTEGER,
      "chaosRevealedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "predictionsLockedAt" DATETIME,
      "raceId" INTEGER,
      "recap" TEXT,
      "resolvedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "SeasonWeek_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "SeasonWeek_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SeasonWeek_raceId_key" ON "SeasonWeek"("raceId")`)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SeasonWeek_seasonId_weekNumber_key" ON "SeasonWeek"("seasonId", "weekNumber")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SeasonWeek_seasonId_status_idx" ON "SeasonWeek"("seasonId", "status")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SeasonPrediction" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "weekId" INTEGER NOT NULL,
      "predictorPlayerId" INTEGER NOT NULL,
      "predictorUserId" INTEGER NOT NULL,
      "targetUserId" INTEGER NOT NULL,
      "pointsAwarded" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SeasonPrediction_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "SeasonWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "SeasonPrediction_predictorPlayerId_fkey" FOREIGN KEY ("predictorPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "SeasonPrediction_predictorUserId_fkey" FOREIGN KEY ("predictorUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "SeasonPrediction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SeasonPrediction_weekId_predictorPlayerId_key" ON "SeasonPrediction"("weekId", "predictorPlayerId")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SeasonPrediction_weekId_targetUserId_idx" ON "SeasonPrediction"("weekId", "targetUserId")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SeasonReward" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "seasonId" INTEGER NOT NULL,
      "key" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "cost" INTEGER NOT NULL,
      "stock" INTEGER,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SeasonReward_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SeasonReward_seasonId_key_key" ON "SeasonReward"("seasonId", "key")`)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SeasonRedemption" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "seasonId" INTEGER NOT NULL,
      "seasonPlayerId" INTEGER NOT NULL,
      "rewardId" INTEGER NOT NULL,
      "pointsSpent" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'requested',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SeasonRedemption_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "SeasonRedemption_seasonPlayerId_fkey" FOREIGN KEY ("seasonPlayerId") REFERENCES "SeasonPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "SeasonRedemption_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "SeasonReward" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SeasonRedemption_seasonId_createdAt_idx" ON "SeasonRedemption"("seasonId", "createdAt")`)
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SeasonRedemption_seasonPlayerId_createdAt_idx" ON "SeasonRedemption"("seasonPlayerId", "createdAt")`)
}

async function addSeason3ChaosPayload(prisma: PrismaClient) {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "SeasonWeek" ADD COLUMN "chaosPayload" TEXT`)
  } catch (error) {
    // SQLite has no IF NOT EXISTS for ADD COLUMN. A repeat run is safe.
    if (!String(error).toLowerCase().includes('duplicate column')) throw error
  }
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
  {
    id: '2026-05-26-001-dragon-meta-system',
    name: 'Create Thất Tinh Dzịt Châu Dragon Orb, trade, summon, and item tables',
    run: createDragonMetaSystem,
  },
  {
    id: '2026-08-12-001-season-3-domain',
    name: 'Create Đua Dzịt Season 3 chaos, prediction, king, and merch tables',
    run: createSeason3System,
  },
  {
    id: '2026-08-12-002-season-3-chaos-payload',
    name: 'Persist Season 3 Duo and Constructors groupings',
    run: addSeason3ChaosPayload,
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
