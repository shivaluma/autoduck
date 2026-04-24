import { MYSTERY_CHESTS_ENABLED } from './feature-flags'
import { isImmortalDuck } from './immortal-duck'
import { COMMON_CHEST_TABLE, RARE_CHEST_TABLE } from './mystery-chest'
import type { ChestEffect, PlayerData } from './types'
import type { PrismaClient } from '@/prisma/generated/prisma/client'

const DASHBOARD_RACE_LIMIT = 8

const v2Effects = new Set([
  ...COMMON_CHEST_TABLE.map((entry) => entry.effect),
  ...RARE_CHEST_TABLE.map((entry) => entry.effect),
])

const rareEffects = new Set(RARE_CHEST_TABLE.map((entry) => entry.effect))

export interface DashboardRaceItem {
  id: number
  status: string
  finalVerdict: string | null
  createdAt: Date
  isTest: boolean
}

export interface DashboardRaceLists {
  recentAll: DashboardRaceItem[]
  recentOfficial: DashboardRaceItem[]
  totalAll: number
  totalOfficial: number
}

export interface DashboardSummary {
  rareRolledCount: number
  bossesDefeated: number
  longestStreak: {
    value: number
    ownerName: string
  }
  mostUnluckyDuck: {
    name: string
    totalKhaos: number
  } | null
}

interface UserWithDashboardState {
  id: number
  name: string
  avatarUrl?: string | null
  scars: number
  shieldsUsed: number
  shields: number
  totalKhaos: number
  cleanStreak: number
  isBoss: boolean
  bossSince?: Date | null
  ownedShields: Array<{
    id: number
    ownerId: number
    charges: number
    status: string
    loanedToId?: number | null
  }>
  mysteryChests: Array<{
    id: number
    ownerId: number
    earnedFromRaceId: number
    status: string
    effect: ChestEffect
    rngSeed: string
    targetUserId?: number | null
    createdAt: Date
  }>
}

export async function getDashboardUsers(prisma: PrismaClient): Promise<PlayerData[]> {
  const users = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      scars: true,
      shieldsUsed: true,
      shields: true,
      totalKhaos: true,
      cleanStreak: true,
      isBoss: true,
      bossSince: true,
      ownedShields: {
        where: { status: 'active' },
        orderBy: [{ charges: 'asc' }, { earnedAt: 'asc' }],
        select: {
          id: true,
          ownerId: true,
          charges: true,
          status: true,
          loanedToId: true,
        },
      },
      mysteryChests: {
        where: { status: 'active' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: {
          id: true,
          ownerId: true,
          earnedFromRaceId: true,
          status: true,
          effect: true,
          rngSeed: true,
          targetUserId: true,
          createdAt: true,
        },
      },
    },
  })

  return (users as UserWithDashboardState[]).map((user) => {
    const immortal = isImmortalDuck({ name: user.name, shields: user.shields })
    const activeShieldCount = user.ownedShields.length
    const displayShieldCount = immortal
      ? user.shields
      : activeShieldCount > 0
        ? activeShieldCount
        : user.shields

    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isImmortal: immortal,
      scars: user.scars,
      shields: displayShieldCount,
      shieldsUsed: user.shieldsUsed,
      totalKhaos: user.totalKhaos,
      cleanStreak: immortal ? 0 : user.cleanStreak,
      isBoss: immortal ? false : user.isBoss,
      bossSince: user.bossSince ? user.bossSince.toISOString() : null,
      activeShields: user.ownedShields.map((shield) => ({
        id: shield.id,
        ownerId: shield.ownerId,
        charges: shield.charges,
        status: shield.status,
        loanedToId: shield.loanedToId,
      })),
      activeChest: MYSTERY_CHESTS_ENABLED && user.mysteryChests[0]
        ? {
            id: user.mysteryChests[0].id,
            ownerId: user.mysteryChests[0].ownerId,
            earnedFromRaceId: user.mysteryChests[0].earnedFromRaceId,
            status: user.mysteryChests[0].status,
            effect: user.mysteryChests[0].effect,
            rngSeed: user.mysteryChests[0].rngSeed,
            targetUserId: user.mysteryChests[0].targetUserId,
            createdAt: user.mysteryChests[0].createdAt.toISOString(),
          }
        : null,
    }
  })
}

export async function getDashboardRaceLists(prisma: PrismaClient): Promise<DashboardRaceLists> {
  const raceSelect = {
    id: true,
    status: true,
    finalVerdict: true,
    createdAt: true,
    isTest: true,
  }

  const [recentAll, recentOfficial, totalAll, totalOfficial] = await Promise.all([
    prisma.race.findMany({
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_RACE_LIMIT,
      select: raceSelect,
    }),
    prisma.race.findMany({
      where: { isTest: false },
      orderBy: { createdAt: 'desc' },
      take: DASHBOARD_RACE_LIMIT,
      select: raceSelect,
    }),
    prisma.race.count(),
    prisma.race.count({ where: { isTest: false } }),
  ])

  return {
    recentAll,
    recentOfficial,
    totalAll,
    totalOfficial,
  }
}

export async function getDashboardSummary(prisma: PrismaClient): Promise<DashboardSummary> {
  const [officialRaces, users] = await Promise.all([
    prisma.race.findMany({
      where: {
        status: 'finished',
        isTest: false,
      },
      orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        participants: {
          select: {
            userId: true,
            gotScar: true,
            user: {
              select: {
                name: true,
                shields: true,
              },
            },
          },
        },
      },
    }) as Promise<Array<{
      id: number
      participants: Array<{
        userId: number
        gotScar: boolean
        user: {
          name: string
          shields: number
        }
      }>
    }>>,
    prisma.user.findMany({
      select: {
        id: true,
        name: true,
        totalKhaos: true,
        scars: true,
        shields: true,
      },
    }),
  ])

  const officialRaceIds = officialRaces.map((race) => race.id)
  const [rareRolledCount, bossesDefeated] = officialRaceIds.length > 0
    ? await Promise.all([
        prisma.mysteryChest.count({
          where: {
            earnedFromRaceId: { in: officialRaceIds },
            effect: { in: Array.from(rareEffects) },
          },
        }),
        prisma.mysteryChest.count({
          where: {
            earnedFromRaceId: { in: officialRaceIds },
            effect: { in: Array.from(v2Effects) },
          },
        }),
      ])
    : [0, 0]

  const streakByUser = new Map<number, number>()
  let longestStreak = 0
  let longestStreakOwner = '-'

  for (const race of officialRaces) {
    const entriesByUser = new Map<number, { gotScar: boolean; name: string; shields: number }>()
    for (const participant of race.participants) {
      const existing = entriesByUser.get(participant.userId)
      entriesByUser.set(participant.userId, {
        gotScar: (existing?.gotScar ?? false) || participant.gotScar,
        name: participant.user.name,
        shields: participant.user.shields,
      })
    }

    for (const [userId, entry] of entriesByUser) {
      if (isImmortalDuck({ name: entry.name, shields: entry.shields })) {
        streakByUser.set(userId, 0)
        continue
      }

      const nextStreak = entry.gotScar ? 0 : (streakByUser.get(userId) ?? 0) + 1
      streakByUser.set(userId, nextStreak)

      if (nextStreak > longestStreak) {
        longestStreak = nextStreak
        longestStreakOwner = entry.name
      }
    }
  }

  const unluckyDuck = [...users]
    .filter((user) => !isImmortalDuck({ name: user.name, shields: user.shields }))
    .sort((left, right) => {
      if (right.totalKhaos !== left.totalKhaos) {
        return right.totalKhaos - left.totalKhaos
      }
      if (right.scars !== left.scars) {
        return right.scars - left.scars
      }
      return left.name.localeCompare(right.name, 'vi')
    })[0] ?? null

  return {
    rareRolledCount,
    bossesDefeated,
    longestStreak: {
      value: longestStreak,
      ownerName: longestStreakOwner,
    },
    mostUnluckyDuck: unluckyDuck
      ? {
          name: unluckyDuck.name,
          totalKhaos: unluckyDuck.totalKhaos,
        }
      : null,
  }
}
