/* eslint-disable @typescript-eslint/no-explicit-any */
import { getDragonOrbName } from './naming'
import { getEligibleDragonWinner } from './getEligibleDragonWinner'
import { getDragonWeekForRace } from './weekSchedule'
import { DEFAULT_DRAGON_SEASON_KEY, DRAGON_ORB_RACE_SOURCE, isThomasUser, withDragonTransaction } from './utils'
import { getSummonReadiness } from './resolveDragonSummon'

export type AwardDragonOrbResult = {
  awarded: boolean
  reason?: string
  winnerUserId?: number
  awardedStar?: number
  awardedOrbName?: string
  dragonWeekId?: number
  duplicateCountForStar?: number
  setProgressAfter?: number
  summonReady?: boolean
  orbId?: number
}

export async function awardDragonOrbForRace(
  prisma: any,
  raceId: number,
  options: { seasonKey?: string; seasonStart?: Date } = {}
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
        source: DRAGON_ORB_RACE_SOURCE,
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
    const orb = await tx.dragonOrb.create({
      data: {
        currentOwnerId: eligibleWinner.userId,
        originalOwnerId: eligibleWinner.userId,
        originalRaceId: raceId,
        dragonWeekId: dragonWeek.id,
        seasonKey,
        star: dragonWeek.star,
        source: DRAGON_ORB_RACE_SOURCE,
        status: 'ACTIVE',
      },
    })

    await tx.dragonWeek.update({
      where: { id: dragonWeek.id },
      data: {
        raceId,
        awardedOrbId: orb.id,
        status: 'AWARDED',
      },
    })

    await tx.dragonOrbEvent.create({
      data: {
        orbId: orb.id,
        userId: eligibleWinner.userId,
        raceId,
        type: 'AWARDED',
        message: `${winner?.name ?? `User ${eligibleWinner.userId}`} đoạt được ${getDragonOrbName(dragonWeek.star)}.`,
        payloadJson: JSON.stringify({
          awardedStar: dragonWeek.star,
          participantId: eligibleWinner.participantId ?? null,
          rank: eligibleWinner.rank,
        }),
      },
    })

    const duplicateCountForStar = await tx.dragonOrb.count({
      where: {
        currentOwnerId: eligibleWinner.userId,
        seasonKey,
        status: 'ACTIVE',
        star: dragonWeek.star,
      },
    })
    const readiness = await getSummonReadiness(tx, eligibleWinner.userId, seasonKey)

    return {
      awarded: true,
      winnerUserId: eligibleWinner.userId,
      awardedStar: dragonWeek.star,
      awardedOrbName: getDragonOrbName(dragonWeek.star),
      dragonWeekId: dragonWeek.id,
      duplicateCountForStar,
      setProgressAfter: readiness.progress,
      summonReady: readiness.ready,
      orbId: orb.id,
    }
  }) as Promise<AwardDragonOrbResult>
}
