/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDragonOrbName } from './naming'
import { getEligibleDragonWinner } from './getEligibleDragonWinner'
import { getDragonWeekForRace } from './weekSchedule'
import {
  DEFAULT_DRAGON_SEASON_KEY,
  DRAGON_ORB_BONUS_RACE_SOURCE,
  DRAGON_ORB_FEATURED_RACE_SOURCE,
  DRAGON_ORB_RACE_SOURCES,
  isThomasUser,
  withDragonTransaction,
} from './utils'
import { getSummonReadiness } from './resolveDragonSummon'

export type AwardedDragonOrb = {
  id: number
  star: number
  orbName: string
  source: string
  kind: 'FEATURED' | 'BONUS'
  duplicateCountForStar?: number
}

export type AwardDragonOrbResult = {
  awarded: boolean
  reason?: string
  winnerUserId?: number
  awardedStar?: number
  awardedOrbName?: string
  awardedOrbs?: AwardedDragonOrb[]
  dragonWeekId?: number
  duplicateCountForStar?: number
  setProgressAfter?: number
  summonReady?: boolean
  orbId?: number
}

function getRandomBonusStar(options: { bonusStar?: number; random?: () => number }) {
  if (typeof options.bonusStar === 'number') {
    return Math.min(7, Math.max(1, Math.floor(options.bonusStar)))
  }

  const random = options.random ?? Math.random
  return Math.floor(random() * 7) + 1
}

export async function awardDragonOrbForRace(
  prisma: any,
  raceId: number,
  options: { seasonKey?: string; seasonStart?: Date; bonusStar?: number; random?: () => number } = {}
): Promise<AwardDragonOrbResult> {
  return withDragonTransaction(prisma, async (tx) => {
    const race = await tx.race.findUnique({
      where: { id: raceId },
      include: {
        participants: {
          include: { user: true },
        },
      },
    })

    if (!race) {
      return { awarded: false, reason: 'RACE_NOT_FOUND' }
    }

    if (race.isTest) {
      return { awarded: false, reason: 'TEST_RACE' }
    }

    if (race.status !== 'finished') {
      return { awarded: false, reason: 'RACE_NOT_FINISHED' }
    }

    const existingOrb = await tx.dragonOrb.findFirst({
      where: {
        originalRaceId: raceId,
        source: { in: DRAGON_ORB_RACE_SOURCES },
      },
    })

    if (existingOrb) {
      return { awarded: false, reason: 'ALREADY_AWARDED', orbId: existingOrb.id }
    }

    const eligibleWinner = await getEligibleDragonWinner(tx, raceId)
    if (!eligibleWinner) {
      return { awarded: false, reason: 'NO_ELIGIBLE_WINNER' }
    }

    const winner = await tx.user.findUnique({ where: { id: eligibleWinner.userId } })
    if (isThomasUser(winner)) {
      return { awarded: false, reason: 'THOMAS_BLOCKED' }
    }

    const dragonWeek = await getDragonWeekForRace(tx, race, options)
    const seasonKey = dragonWeek.seasonKey ?? options.seasonKey ?? DEFAULT_DRAGON_SEASON_KEY
    const drops = [
      {
        star: dragonWeek.star,
        source: DRAGON_ORB_FEATURED_RACE_SOURCE,
        kind: 'FEATURED' as const,
      },
      {
        star: getRandomBonusStar(options),
        source: DRAGON_ORB_BONUS_RACE_SOURCE,
        kind: 'BONUS' as const,
      },
    ]
    const awardedOrbs: AwardedDragonOrb[] = []

    for (const drop of drops) {
      const orb = await tx.dragonOrb.create({
        data: {
          currentOwnerId: eligibleWinner.userId,
          originalOwnerId: eligibleWinner.userId,
          originalRaceId: raceId,
          dragonWeekId: dragonWeek.id,
          seasonKey,
          star: drop.star,
          source: drop.source,
          status: 'ACTIVE',
        },
      })

      awardedOrbs.push({
        id: orb.id,
        star: drop.star,
        orbName: getDragonOrbName(drop.star),
        source: drop.source,
        kind: drop.kind,
      })

      await tx.dragonOrbEvent.create({
        data: {
          orbId: orb.id,
          userId: eligibleWinner.userId,
          raceId,
          type: 'AWARDED',
          message: drop.kind === 'FEATURED'
            ? `${winner?.name ?? `User ${eligibleWinner.userId}`} đoạt được thiên tượng ${getDragonOrbName(drop.star)}.`
            : `${winner?.name ?? `User ${eligibleWinner.userId}`} nhận thêm ${getDragonOrbName(drop.star)} từ La Bàn.`,
          payloadJson: JSON.stringify({
            awardedStar: drop.star,
            dropKind: drop.kind,
            participantId: eligibleWinner.participantId ?? null,
            rank: eligibleWinner.rank,
          }),
        },
      })
    }

    await tx.dragonWeek.update({
      where: { id: dragonWeek.id },
      data: {
        raceId,
        awardedOrbId: awardedOrbs[0]?.id,
        status: 'AWARDED',
      },
    })

    for (const awardedOrb of awardedOrbs) {
      awardedOrb.duplicateCountForStar = await tx.dragonOrb.count({
        where: {
          currentOwnerId: eligibleWinner.userId,
          seasonKey,
          status: 'ACTIVE',
          star: awardedOrb.star,
        },
      })
    }

    const readiness = await getSummonReadiness(tx, eligibleWinner.userId, seasonKey)

    return {
      awarded: true,
      winnerUserId: eligibleWinner.userId,
      awardedStar: dragonWeek.star,
      awardedOrbName: getDragonOrbName(dragonWeek.star),
      awardedOrbs,
      dragonWeekId: dragonWeek.id,
      duplicateCountForStar: awardedOrbs[0]?.duplicateCountForStar,
      setProgressAfter: readiness.progress,
      summonReady: readiness.ready,
      orbId: awardedOrbs[0]?.id,
    }
  }) as Promise<AwardDragonOrbResult>
}
