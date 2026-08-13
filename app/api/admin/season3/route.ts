import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  DEFAULT_SEASON3_REWARDS,
  selectChampion,
  selectChaosCard,
} from '@/lib/season3'
import { startSeason3Race } from '@/lib/season3-race'

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
      weeksPlan: { orderBy: { weekNumber: 'asc' }, include: { predictions: true, shieldChoices: { include: { seasonPlayer: { include: { user: true } } } }, race: { select: { id: true, status: true } } } },
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
    weeks: season.weeksPlan.map((week: { id: number; weekNumber: number; status: string; chaosType: string; chaosTargetUserId: number | null; chaosTargetUserId2: number | null; chaosPayload: string | null; predictions: unknown[]; shieldChoices: Array<{ seasonPlayer: { user: { name: string } } }>; recap: string | null; race: { id: number; status: string } | null }) => ({
      id: week.id,
      weekNumber: week.weekNumber,
      status: week.status,
      chaosType: week.chaosType,
      chaosTargetUserId: week.chaosTargetUserId,
      chaosTargetUserId2: week.chaosTargetUserId2,
      chaosGroups: parseChaosGroups(week.chaosPayload),
      predictionCount: week.predictions.length,
      shieldConfirmations: week.shieldChoices.map((choice) => choice.seasonPlayer.user.name),
      recap: week.recap,
      raceId: week.race?.id ?? null,
      raceStatus: week.race?.status ?? null,
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

    if (body.action === 'start-race') {
      if (!body.weekId) return fail('weekId là bắt buộc')
      const race = await startSeason3Race(body.weekId)
      return NextResponse.json({ ok: true, raceId: race.id, status: race.status })
    }

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
