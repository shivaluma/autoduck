import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { COMMON_CHEST_TABLE, RARE_CHEST_TABLE } from '@/lib/mystery-chest'
import { isImmortalDuck } from '@/lib/immortal-duck'
import type { ChestEffect } from '@/lib/types'

const v2Effects = new Set([
  ...COMMON_CHEST_TABLE.map((entry) => entry.effect),
  ...RARE_CHEST_TABLE.map((entry) => entry.effect),
])

const rareEffects = new Set(RARE_CHEST_TABLE.map((entry) => entry.effect))

export async function GET() {
  try {
    const officialRaces = await prisma.race.findMany({
      where: {
        status: 'finished',
        isTest: false,
      },
      orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
      include: {
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
    }) as Array<{
      id: number
      participants: Array<{
        userId: number
        gotScar: boolean
        user: {
          name: string
          shields: number
        }
      }>
    }>

    const officialRaceIds = officialRaces.map((race: { id: number }) => race.id)
    const rewardChests = officialRaceIds.length > 0
      ? await prisma.mysteryChest.findMany({
          where: {
            earnedFromRaceId: { in: officialRaceIds },
            effect: { in: Array.from(v2Effects) },
          },
          select: {
            id: true,
            effect: true,
          },
        }) as Array<{
          id: number
          effect: ChestEffect
        }>
      : []

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        totalKhaos: true,
        scars: true,
        shields: true,
      },
    })

    const streakByUser = new Map<number, number>()
    let longestStreak = 0
    let longestStreakOwner = '—'

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

    return NextResponse.json({
      rareRolledCount: rewardChests.filter((chest) => rareEffects.has(chest.effect)).length,
      bossesDefeated: rewardChests.length,
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
    })
  } catch (error) {
    console.error('Failed to fetch dashboard summary:', error)
    return NextResponse.json({ error: 'Failed to fetch dashboard summary' }, { status: 500 })
  }
}
