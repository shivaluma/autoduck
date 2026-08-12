import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  applyScarEconomy,
  DEFAULT_SEASON3_REWARDS,
  generateDuckNews,
  resolvePredictions,
  resolveSeason3Race,
  selectChampion,
  selectChaosCard,
  type ChaosType,
  type Season3RankingEntry,
} from '@/lib/season3'

function authorized(request: Request, body?: { secret?: string }) {
  const urlSecret = new URL(request.url).searchParams.get('secret')
  const headerSecret = request.headers.get('x-race-secret')
  return urlSecret === process.env.RACE_SECRET_KEY || headerSecret === process.env.RACE_SECRET_KEY || body?.secret === process.env.RACE_SECRET_KEY
}

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function chaosPayload(groups?: number[][]) {
  return groups ? JSON.stringify(groups) : null
}

function parseChaosGroups(payload: string | null | undefined) {
  if (!payload) return undefined
  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) && parsed.every((group) => Array.isArray(group)) ? parsed as number[][] : undefined
  } catch {
    return undefined
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return fail('Unauthorized', 401)
  const season = await prisma.season.findFirst({
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: {
      players: { include: { user: { select: { id: true, name: true } } }, orderBy: { user: { name: 'asc' } } },
      weeksPlan: { orderBy: { weekNumber: 'asc' }, include: { predictions: true } },
      rewards: { orderBy: { cost: 'asc' } },
    },
  })
  if (!season) return NextResponse.json({ season: null })
  return NextResponse.json({
    season: {
      id: season.id,
      key: season.key,
      name: season.name,
      year: season.year,
      weeks: season.weeks,
      status: season.status,
    },
    players: season.players.map((player: { id: number; userId: number; accessToken: string; user: { name: string }; scars: number; shields: number; predictionPoints: number; isKing: boolean; kingStreak: number }) => ({
      id: player.userId,
      name: player.user.name,
      personalLink: `/season-3?token=${encodeURIComponent(player.accessToken)}`,
      scars: player.scars,
      shields: player.shields,
      predictionPoints: player.predictionPoints,
      isKing: player.isKing,
      kingStreak: player.kingStreak,
    })),
    weeks: season.weeksPlan.map((week: { id: number; weekNumber: number; status: string; chaosType: string; chaosTargetUserId: number | null; chaosTargetUserId2: number | null; chaosPayload: string | null; predictions: unknown[]; recap: string | null }) => ({
      id: week.id,
      weekNumber: week.weekNumber,
      status: week.status,
      chaosType: week.chaosType,
      chaosTargetUserId: week.chaosTargetUserId,
      chaosTargetUserId2: week.chaosTargetUserId2,
      chaosGroups: parseChaosGroups(week.chaosPayload),
      predictionCount: week.predictions.length,
      recap: week.recap,
    })),
    rewards: season.rewards,
  })
}

export async function POST(request: Request) {
  let body: {
    action?: string
    secret?: string
    key?: string
    name?: string
    year?: number
    weeks?: number
    userIds?: number[]
    weekId?: number
    ranking?: Array<{ userId: number; rank: number }>
    shieldUserIds?: number[]
    championUserId?: number
  }

  try {
    body = await request.json()
  } catch {
    return fail('Invalid JSON')
  }

  if (!authorized(request, body)) return fail('Unauthorized', 401)

  try {
    if (body.action === 'create-season') {
      const active = await prisma.season.findFirst({ where: { status: 'active' } })
      if (active) return fail('Đã có Season active', 409)
      const users = body.userIds?.length
        ? await prisma.user.findMany({ where: { id: { in: body.userIds } }, orderBy: { name: 'asc' } })
        : await prisma.user.findMany({ orderBy: { name: 'asc' } })
      if (users.length < 2) return fail('Season cần ít nhất 2 players')
      const chaos = selectChaosCard(users.map((user: { id: number; name: string }) => ({ userId: user.id, name: user.name })))
      const season = await prisma.season.create({
        data: {
          key: body.key ?? 'S3',
          name: body.name ?? 'ĐUA DZỊT — SEASON 3',
          year: body.year ?? new Date().getFullYear(),
          weeks: Math.max(1, body.weeks ?? 12),
          players: { create: users.map((user: { id: number }) => ({ userId: user.id, accessToken: randomUUID() })) },
          rewards: { create: DEFAULT_SEASON3_REWARDS.map((reward) => ({ ...reward })) },
          weeksPlan: {
            create: {
              weekNumber: 1,
              chaosType: chaos.type,
              chaosTargetUserId: chaos.targetUserId,
              chaosTargetUserId2: chaos.targetUserId2,
              chaosPayload: chaosPayload(chaos.groups),
            },
          },
        },
        include: { players: { include: { user: true } }, weeksPlan: true },
      })
      return NextResponse.json({ ok: true, seasonId: season.id, weekId: season.weeksPlan[0]?.id, players: season.players.map((player: { user: { name: string }; accessToken: string }) => ({ name: player.user.name, token: player.accessToken })) }, { status: 201 })
    }

    const season = await prisma.season.findFirst({ where: { status: 'active' }, include: { players: { include: { user: true } }, weeksPlan: { orderBy: { weekNumber: 'desc' }, include: { predictions: true } } } })
    if (!season) return fail('Chưa có Season active', 404)

    if (body.action === 'open-week') {
      const latest = season.weeksPlan[0]
      if (latest && latest.status !== 'resolved') return fail('Tuần hiện tại chưa resolve', 409)
      const nextWeekNumber = (latest?.weekNumber ?? 0) + 1
      if (nextWeekNumber > season.weeks) return fail('Season đã đủ số tuần')
      const chaos = selectChaosCard(season.players.map((player: { userId: number; user: { name: string } }) => ({ userId: player.userId, name: player.user.name })))
      const week = await prisma.seasonWeek.create({ data: { seasonId: season.id, weekNumber: nextWeekNumber, chaosType: chaos.type, chaosTargetUserId: chaos.targetUserId, chaosTargetUserId2: chaos.targetUserId2, chaosPayload: chaosPayload(chaos.groups) } })
      return NextResponse.json({ ok: true, week })
    }

    if (body.action === 'lock') {
      const week = body.weekId ? await prisma.seasonWeek.findUnique({ where: { id: body.weekId } }) : season.weeksPlan.find((candidate: { status: string }) => candidate.status === 'open')
      if (!week || week.status !== 'open') return fail('Tuần không ở trạng thái open', 409)
      const updated = await prisma.seasonWeek.update({ where: { id: week.id }, data: { status: 'locked', predictionsLockedAt: new Date() } })
      return NextResponse.json({ ok: true, week: updated })
    }

    if (body.action === 'resolve') {
      if (!body.weekId || !body.ranking) return fail('weekId và ranking là bắt buộc')
      const week = await prisma.seasonWeek.findUnique({ where: { id: body.weekId }, include: { predictions: true } })
      if (!week || week.seasonId !== season.id || week.status !== 'locked') return fail('Tuần phải được lock trước khi resolve', 409)
      const playersById = new Map(season.players.map((player: { userId: number; user: { name: string }; shields: number }) => [player.userId, player]))
      if (body.ranking.length !== season.players.length || body.ranking.some((entry) => !playersById.has(entry.userId))) return fail('Ranking phải chứa đúng toàn bộ Season players')
      const shieldUserIds = new Set(body.shieldUserIds ?? [])
      for (const userId of shieldUserIds) {
        const player = playersById.get(userId) as { shields: number } | undefined
        if (!player || player.shields < 1) return fail(`Player ${userId} không có Shield để dùng`)
      }
      const ranking: Season3RankingEntry[] = body.ranking.map((entry) => ({
        userId: entry.userId,
        name: (playersById.get(entry.userId) as { user: { name: string } }).user.name,
        rank: entry.rank,
        hasShield: shieldUserIds.has(entry.userId),
      }))
      const previousKing = season.players.find((player: { isKing: boolean }) => player.isKing)
      const chaos = { type: week.chaosType as ChaosType, targetUserId: week.chaosTargetUserId, targetUserId2: week.chaosTargetUserId2, groups: parseChaosGroups(week.chaosPayload) }
      const resolved = resolveSeason3Race(ranking, chaos, previousKing ? { userId: previousKing.userId, streak: previousKing.kingStreak } : null)
      const predictionOutcomes = resolvePredictions(week.predictions, resolved.bottomTwo)
      const targetName = (userId: number | null) => userId === null ? null : (playersById.get(userId) as { user: { name: string } } | undefined)?.user.name ?? null
      const predictionWinners = predictionOutcomes.filter((outcome) => outcome.correct).map((outcome) => ({ name: (playersById.get(outcome.predictorUserId) as { user: { name: string } }).user.name }))
      const recap = generateDuckNews({
        weekNumber: week.weekNumber,
        scarVictims: resolved.scarVictims,
        protectedPlayers: resolved.protectedPlayers,
        chaos,
        chaosTargetName: targetName(week.chaosTargetUserId),
        kingName: targetName(resolved.kingUserId),
        predictionWinners,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await prisma.$transaction(async (tx: any) => {
        const race = await tx.race.create({
          data: {
            status: 'finished',
            finalVerdict: resolved.scarVictims.map((entry) => entry.name).join(' & ') || 'Không ai bị phạt hôm nay!',
            finishedAt: new Date(),
            participants: {
              create: resolved.ranking.map((entry) => ({
                userId: entry.userId,
                initialRank: entry.rank,
                gotScar: resolved.scarVictims.some((victim) => victim.userId === entry.userId),
                usedShield: entry.hasShield && resolved.protectedPlayers.some((player) => player.userId === entry.userId),
              })),
            },
          },
        })
        const outcomeByUser = new Map(resolved.scarOutcomes.map((outcome) => [outcome.userId, outcome]))
        for (const player of season.players as Array<{ id: number; userId: number; scars: number; shields: number }>) {
          const entry = resolved.ranking.find((candidate) => candidate.userId === player.userId)!
          const outcome = outcomeByUser.get(player.userId)
          const economy = applyScarEconomy(player.scars, player.shields, outcome?.scarPoints ?? 0, outcome?.shieldConsumed ?? false)
          const predictionPoints = predictionOutcomes.filter((prediction) => prediction.predictorUserId === player.userId && prediction.correct).length
          await tx.seasonPlayer.update({
            where: { id: player.id },
            data: {
              scars: economy.scars,
              shields: economy.shields,
              shieldsUsed: outcome?.shieldConsumed ? { increment: 1 } : undefined,
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
        await tx.seasonWeek.update({ where: { id: week.id }, data: { status: 'resolved', raceId: race.id, recap, resolvedAt: new Date() } })
        return { raceId: race.id, recap }
      })
      return NextResponse.json({ ok: true, ...result, resolution: resolved, predictions: predictionOutcomes })
    }

    if (body.action === 'end-season') {
      const championUserId = body.championUserId ?? selectChampion(season.players.map((player: { userId: number; championshipPoints: number; raceWins: number }) => ({ userId: player.userId, championshipPoints: player.championshipPoints, raceWins: player.raceWins })))
      const updated = await prisma.season.update({ where: { id: season.id }, data: { status: 'completed', championUserId, endedAt: new Date() } })
      return NextResponse.json({ ok: true, championUserId, season: updated })
    }

    return fail('Unknown Season 3 admin action')
  } catch (error) {
    console.error('Season 3 admin action failed:', error)
    return fail('Season 3 action failed', 500)
  }
}
