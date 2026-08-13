import { prisma } from '@/lib/db'
import { runRaceWorker } from '@/lib/race-worker'
import { mapSeason3RaceRanking } from '@/lib/season3-race-mapping'
import {
  applyScarEconomy,
  generateDuckNews,
  resolvePredictions,
  resolveSeason3Race,
  type ChaosCard,
  type ChaosType,
} from '@/lib/season3'

type Season3RacePlayer = {
  id: number
  userId: number
  scars: number
  shields: number
  shieldConfirmed?: boolean
  isKing: boolean
  kingStreak: number
  user: { name: string }
}

function parseChaosGroups(payload: string | null | undefined) {
  if (!payload) return undefined
  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) ? parsed as number[][] : undefined
  } catch {
    return undefined
  }
}

function chaosFromWeek(week: {
  chaosType: string
  chaosTargetUserId: number | null
  chaosTargetUserId2: number | null
  chaosPayload: string | null
}): ChaosCard {
  return {
    type: week.chaosType as ChaosType,
    targetUserId: week.chaosTargetUserId,
    targetUserId2: week.chaosTargetUserId2,
    groups: parseChaosGroups(week.chaosPayload),
  }
}

export async function startSeason3Race(weekId: number) {
  const week = await prisma.seasonWeek.findUnique({
    where: { id: weekId },
    include: {
      race: true,
      season: { include: { players: { include: { user: true } } } },
    },
  })

  if (!week || week.season.status !== 'active') throw new Error('Season không active')
  if (week.status !== 'locked') throw new Error('Phải lock prediction trước khi đua')
  if (week.race && week.race.status !== 'failed') return week.race

  const claimedRaceId = week.race?.id ?? null
  const claim = await prisma.$transaction(async (tx: typeof prisma) => {
    const created = await tx.race.create({
      data: {
        status: 'pending',
        participants: {
          create: week.season.players.map((player: Season3RacePlayer) => ({
            userId: player.userId,
            displayName: player.user.name,
            initialRank: null,
            gotScar: false,
            usedShield: false,
          })),
        },
      },
    })

    const claimed = await tx.seasonWeek.updateMany({
      where: { id: week.id, status: 'locked', raceId: claimedRaceId },
      data: { status: 'racing', raceId: created.id },
    })

    if (claimed.count !== 1) {
      await tx.race.delete({ where: { id: created.id } })
      const current = await tx.seasonWeek.findUnique({ where: { id: week.id }, include: { race: true } })
      if (!current?.race) throw new Error('Không thể claim Season 3 week để start race')
      return { race: current.race, claimed: false }
    }

    return { race: created, claimed: true }
  })

  if (claim.claimed) {
    void executeSeason3Race(claim.race.id, week.id).catch((error: unknown) => {
      console.error(`Season 3 race ${claim.race.id} failed:`, error)
    })
  }

  return claim.race
}

export async function executeSeason3Race(raceId: number, weekId: number) {
  try {
    const week = await prisma.seasonWeek.findUnique({
      where: { id: weekId },
      include: {
      predictions: true,
        shieldChoices: true,
        season: { include: { players: { include: { user: true } } } },
      },
    })
    const race = await prisma.race.findUnique({ where: { id: raceId } })

    if (!week || !race || week.status !== 'racing' || week.raceId !== raceId) {
      throw new Error('Season 3 race không còn hợp lệ')
    }

    await prisma.race.update({ where: { id: raceId }, data: { status: 'running' } })

    const shieldConfirmedIds = new Set(week.shieldChoices.map((choice: { seasonPlayerId: number }) => choice.seasonPlayerId))
    const players = (week.season.players as Season3RacePlayer[]).map((player) => ({
      ...player,
      shieldConfirmed: shieldConfirmedIds.has(player.id),
    }))
    const result = await runRaceWorker(
      players.map((player) => ({ name: player.user.name, useShield: false })),
      raceId,
    )

    const ranking = mapSeason3RaceRanking(result.rawRanking, players)

    const previousKing = players.find((player) => player.isKing)
    const chaos = chaosFromWeek(week)
    const resolved = resolveSeason3Race(
      ranking,
      chaos,
      previousKing ? { userId: previousKing.userId, streak: previousKing.kingStreak } : null,
    )
    const predictionOutcomes = resolvePredictions(week.predictions, resolved.bottomTwo)
    const playerName = (userId: number | null) => players.find((player) => player.userId === userId)?.user.name ?? null
    const predictionWinners = predictionOutcomes
      .filter((outcome) => outcome.correct)
      .map((outcome) => ({ name: playerName(outcome.predictorUserId) ?? `User ${outcome.predictorUserId}` }))
    const recap = generateDuckNews({
      weekNumber: week.weekNumber,
      scarVictims: resolved.scarVictims,
      protectedPlayers: resolved.protectedPlayers,
      chaos,
      chaosTargetName: playerName(chaos.targetUserId),
      kingName: playerName(resolved.kingUserId),
      predictionWinners,
    })

    await prisma.$transaction(async (tx: typeof prisma) => {
      for (const entry of resolved.ranking) {
        const player = players.find((candidate) => candidate.userId === entry.userId)
        const shieldWasUsed = player?.shieldConfirmed === true && player.shields > 0
        await tx.raceParticipant.updateMany({
          where: { raceId, userId: entry.userId, cloneIndex: null },
          data: {
            initialRank: entry.rank,
            gotScar: resolved.scarVictims.some((victim) => victim.userId === entry.userId),
            usedShield: shieldWasUsed,
          },
        })
      }

      for (const player of players) {
        const outcome = resolved.scarOutcomes.find((candidate) => candidate.userId === player.userId)
        const entry = resolved.ranking.find((candidate) => candidate.userId === player.userId)!
        const shieldWasUsed = player.shieldConfirmed === true && player.shields > 0
        const economy = applyScarEconomy(player.scars, player.shields, outcome?.scarPoints ?? 0, shieldWasUsed)
        const predictionPoints = predictionOutcomes
          .filter((prediction) => prediction.predictorUserId === player.userId && prediction.correct)
          .length

        await tx.seasonPlayer.update({
          where: { id: player.id },
          data: {
            scars: economy.scars,
            shields: economy.shields,
            shieldsUsed: shieldWasUsed ? { increment: 1 } : undefined,
            predictionPoints: predictionPoints ? { increment: predictionPoints } : undefined,
            raceCount: { increment: 1 },
            raceWins: entry.rank === 1 ? { increment: 1 } : undefined,
            championshipPoints: { increment: resolved.ranking.length - entry.rank + 1 },
            isKing: player.userId === resolved.kingUserId,
            kingStreak: player.userId === resolved.kingUserId ? resolved.kingStreak : 0,
          },
        })
      }

      for (const outcome of predictionOutcomes) {
        const prediction = week.predictions.find((candidate: { predictorUserId: number }) => candidate.predictorUserId === outcome.predictorUserId)
        if (prediction) await tx.seasonPrediction.update({ where: { id: prediction.id }, data: { pointsAwarded: outcome.pointsAwarded } })
      }

      await tx.race.update({
        where: { id: raceId },
        data: {
          status: 'finished',
          videoUrl: result.videoUrl,
          finalVerdict: resolved.scarVictims.map((entry) => `${entry.name} bị làm dzịt`).join(' & ') || 'Khiên đã cứu hết người bị phạt.',
          finishedAt: new Date(),
        },
      })
      await tx.seasonWeek.update({ where: { id: week.id }, data: { status: 'resolved', recap, resolvedAt: new Date() } })
    })

    return { raceId, recap, resolution: resolved, predictions: predictionOutcomes }
  } catch (error) {
    await prisma.race.update({ where: { id: raceId }, data: { status: 'failed' } }).catch(() => undefined)
    await prisma.seasonWeek.update({ where: { id: weekId }, data: { status: 'locked', raceId: null } }).catch(() => undefined)
    throw error
  }
}
