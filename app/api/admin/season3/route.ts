import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import {
  DEFAULT_SEASON3_REWARDS,
  prepareChaosCard,
  selectChampion,
  selectChaosCard,
  type ChaosType,
} from '@/lib/season3'
import { startSeason3Race } from '@/lib/season3-race'
import { Season3ScheduleError } from '@/lib/season3-schedule'
import { createRaceSeed } from '@/lib/racing/audit'
import { selectAutoLoadout, serializeItemIds } from '@/lib/racing/loadout'
import { createRaceRng } from '@/packages/race-core/src'
import { grantStarterCosmetics } from '@/lib/cosmetics/inventory'

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

function parseSkippedPlayerIds(payload: string | null | undefined) {
  if (!payload) return []
  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) ? parsed.filter((value): value is number => Number.isInteger(value)) : []
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  if (!authorized(request)) return fail('Unauthorized', 401)
  const season = await prisma.season.findFirst({
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: {
      players: { include: { user: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { user: { name: 'asc' } } },
      weeksPlan: { orderBy: { weekNumber: 'asc' }, include: { predictions: true, loadouts: true, shieldChoices: { include: { seasonPlayer: { include: { user: true } } } }, race: { select: { id: true, status: true } } } },
      rewards: { orderBy: { cost: 'asc' } },
    },
  })
  if (!season) return NextResponse.json({ season: null })
  const raceIds = season.weeksPlan.flatMap((week: { race: { id: number } | null }) => week.race ? [week.race.id] : [])
  const telemetry = raceIds.length > 0
    ? await prisma.raceItemTelemetry.findMany({ where: { raceId: { in: raceIds } } })
    : []
  const pickupTelemetry = raceIds.length > 0
    ? await prisma.racePickupTelemetry.findMany({ where: { raceId: { in: raceIds } } })
    : []
  const summarizeTelemetry = (key: 'itemId' | 'loadoutKey') => {
    const groups = new Map<string, typeof telemetry>()
    for (const row of telemetry) groups.set(row[key], [...(groups.get(row[key]) ?? []), row])
    return [...groups].map(([name, rows]) => {
      const playerPicks = key === 'itemId' ? rows.length : rows.length / 2
      const normalize = key === 'itemId' ? 1 : 2
      return {
        name,
        picks: playerPicks,
        winRate: rows.filter((row: { won: boolean }) => row.won).length / normalize / playerPicks,
        bottom2Rate: rows.filter((row: { bottomTwo: boolean }) => row.bottomTwo).length / normalize / playerPicks,
        averageFinish: rows.reduce((sum: number, row: { finalRank: number }) => sum + row.finalRank, 0) / normalize / playerPicks,
        averageRankDelta: rows.reduce((sum: number, row: { rankDelta: number }) => sum + row.rankDelta, 0) / normalize / playerPicks,
        activationRate: rows.filter((row: { activated: boolean }) => row.activated).length / rows.length,
        successRate: rows.filter((row: { succeeded: boolean }) => row.succeeded).length / Math.max(1, rows.filter((row: { activated: boolean }) => row.activated).length),
      }
    }).sort((left, right) => right.winRate - left.winRate)
  }
  return NextResponse.json({
    season: {
      id: season.id,
      key: season.key,
      name: season.name,
      year: season.year,
      weeks: season.weeks,
      status: season.status,
    },
    players: season.players.map((player: { id: number; userId: number; accessToken: string; user: { name: string; avatarUrl: string | null }; scars: number; shields: number; predictionPoints: number; isKing: boolean; kingStreak: number }) => ({
      id: player.userId,
      name: player.user.name,
      avatarUrl: player.user.avatarUrl,
      personalLink: `/season-3?token=${encodeURIComponent(player.accessToken)}`,
      scars: player.scars,
      shields: player.shields,
      predictionPoints: player.predictionPoints,
      isKing: player.isKing,
      kingStreak: player.kingStreak,
    })),
    weeks: season.weeksPlan.map((week: { id: number; weekNumber: number; status: string; chaosType: string; chaosTargetUserId: number | null; chaosTargetUserId2: number | null; chaosPayload: string | null; skippedPlayerIdsJson: string | null; predictions: Array<{ predictorUserId: number }>; loadouts: Array<{ status: string; userId: number }>; shieldChoices: Array<{ userId: number; seasonPlayer: { user: { name: string } } }>; recap: string | null; race: { id: number; status: string } | null }) => {
      const skippedPlayerIds = parseSkippedPlayerIds(week.skippedPlayerIdsJson)
      const activePlayers = season.players.filter((player: { userId: number }) => !skippedPlayerIds.includes(player.userId))

      const loadoutReadyUserIds = week.loadouts
        .filter((loadout) => !skippedPlayerIds.includes(loadout.userId) && (loadout.status === 'ready' || loadout.status === 'auto'))
        .map((loadout) => loadout.userId)

      const predictionUserIds = week.predictions
        .filter((prediction) => !skippedPlayerIds.includes(prediction.predictorUserId))
        .map((prediction) => prediction.predictorUserId)

      const missingLoadoutUserIds = activePlayers
        .filter((player: { userId: number }) => !loadoutReadyUserIds.includes(player.userId))
        .map((player: { userId: number }) => player.userId)

      const missingPredictionUserIds = activePlayers
        .filter((player: { userId: number }) => !predictionUserIds.includes(player.userId))
        .map((player: { userId: number }) => player.userId)

      const missingLoadoutNames = missingLoadoutUserIds.map((userId: number) => season.players.find((p: { userId: number; user: { name: string } }) => p.userId === userId)?.user.name ?? String(userId))
      const missingPredictionNames = missingPredictionUserIds.map((userId: number) => season.players.find((p: { userId: number; user: { name: string } }) => p.userId === userId)?.user.name ?? String(userId))
      const fullyReadyUserIds = activePlayers
        .filter((player: { userId: number }) => loadoutReadyUserIds.includes(player.userId) && predictionUserIds.includes(player.userId))
        .map((player: { userId: number }) => player.userId)

      return {
        id: week.id,
        weekNumber: week.weekNumber,
        status: week.status,
        chaosType: week.chaosType,
        chaosTargetUserId: week.chaosTargetUserId,
        chaosTargetUserId2: week.chaosTargetUserId2,
        chaosGroups: parseChaosGroups(week.chaosPayload),
        skippedPlayerIds,
        predictionCount: week.predictions.length,
        loadoutReadyCount: loadoutReadyUserIds.length,
        loadoutReadyUserIds,
        predictionUserIds,
        missingLoadoutUserIds,
        missingPredictionUserIds,
        missingLoadoutNames,
        missingPredictionNames,
        fullyReadyUserIds,
        shieldConfirmations: week.shieldChoices.filter((choice) => !skippedPlayerIds.includes(choice.userId)).map((choice) => choice.seasonPlayer.user.name),
        recap: week.recap,
        raceId: week.race?.id ?? null,
        raceStatus: week.race?.status ?? null,
      }
    }),
    rewards: season.rewards,
    balance: {
      items: summarizeTelemetry('itemId'),
      loadouts: summarizeTelemetry('loadoutKey'),
      pickups: [...new Set(pickupTelemetry.map((row: { itemId: string }) => row.itemId))].map((itemId) => {
        const rows = pickupTelemetry.filter((row: { itemId: string }) => row.itemId === itemId)
        const activations = rows.filter((row: { activated: boolean }) => row.activated).length
        return {
          name: itemId,
          picks: rows.length,
          activationRate: activations / Math.max(1, rows.length),
          hitRate: rows.reduce((sum: number, row: { hitCount: number }) => sum + row.hitCount, 0) / Math.max(1, activations),
          manualRate: rows.filter((row: { manualUsed: boolean }) => row.manualUsed).length / Math.max(1, activations),
          autoRate: rows.filter((row: { autoUsed: boolean }) => row.autoUsed).length / Math.max(1, activations),
          averageRankDelta: rows.reduce((sum: number, row: { rankDelta: number }) => sum + row.rankDelta, 0) / Math.max(1, rows.length),
        }
      }).sort((left, right) => right.picks - left.picks),
    },
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
    userId?: number
    test?: boolean
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
      const chaosSeed = createRaceSeed()
      const chaosRng = createRaceRng(chaosSeed, 'chaos:week:1')
      const chaos = selectChaosCard(users.map((user: { id: number; name: string }) => ({ userId: user.id, name: user.name })), () => chaosRng.next())
      const season = await prisma.$transaction(async (tx: typeof prisma) => {
        const created = await tx.season.create({
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
                chaosSeed,
              },
            },
          },
          include: { players: { include: { user: true } }, weeksPlan: true },
        })
        for (const player of created.players) await grantStarterCosmetics(tx, player.id)
        return created
      })
      return NextResponse.json({ ok: true, seasonId: season.id, weekId: season.weeksPlan[0]?.id, players: season.players.map((player: { user: { name: string }; accessToken: string }) => ({ name: player.user.name, token: player.accessToken })) }, { status: 201 })
    }

    const season = await prisma.season.findFirst({ where: { status: 'active' }, include: { players: { include: { user: true } }, weeksPlan: { orderBy: { weekNumber: 'desc' }, include: { predictions: true } } } })
    if (!season) return fail('Chưa có Season active', 404)

    if (body.action === 'start-race') {
      if (!body.weekId) return fail('weekId là bắt buộc')
      try {
        const testMode = body.test === true
        const race = await startSeason3Race(body.weekId, { allowOffSchedule: testMode, testMode })
        return NextResponse.json({ ok: true, raceId: race.id, status: race.status })
      } catch (error) {
        if (error instanceof Season3ScheduleError) return fail(error.message, 403)
        throw error
      }
    }

    if (body.action === 'open-week') {
      const latest = season.weeksPlan[0]
      if (latest && latest.status !== 'resolved') return fail('Tuần hiện tại chưa resolve', 409)
      const nextWeekNumber = (latest?.weekNumber ?? 0) + 1
      if (nextWeekNumber > season.weeks) return fail('Season đã đủ số tuần')
      const chaosSeed = createRaceSeed()
      const chaosRng = createRaceRng(chaosSeed, `chaos:week:${nextWeekNumber}`)
      const chaos = selectChaosCard(season.players.map((player: { userId: number; user: { name: string } }) => ({ userId: player.userId, name: player.user.name })), () => chaosRng.next())
      const week = await prisma.seasonWeek.create({ data: { seasonId: season.id, weekNumber: nextWeekNumber, chaosType: chaos.type, chaosTargetUserId: chaos.targetUserId, chaosTargetUserId2: chaos.targetUserId2, chaosPayload: chaosPayload(chaos.groups), chaosSeed } })
      return NextResponse.json({ ok: true, week })
    }

    if (body.action === 'toggle-skip') {
      if (!body.weekId || !body.userId) return fail('weekId và userId là bắt buộc')
      const week = await prisma.seasonWeek.findUnique({ where: { id: body.weekId } })
      if (!week || week.status !== 'open') return fail('Chỉ đổi roster khi prep đang mở', 409)
      if (!season.players.some((player: { userId: number }) => player.userId === body.userId)) return fail('Dzịt không thuộc Season')
      const skipped = new Set(parseSkippedPlayerIds(week.skippedPlayerIdsJson))
      if (skipped.has(body.userId)) skipped.delete(body.userId)
      else skipped.add(body.userId)
      const activePlayers = season.players.filter((player: { userId: number }) => !skipped.has(player.userId))
      if (activePlayers.length < 2 || activePlayers.length > 16) return fail('Race cần 2–16 dzịt active')
      const chaosSeed = week.chaosSeed ?? createRaceSeed()
      const rng = createRaceRng(chaosSeed, `chaos:week:${week.weekNumber}`)
      rng.next() // Keep the preparation stream aligned after the persisted card draw.
      const chaos = prepareChaosCard(week.chaosType as ChaosType, activePlayers.map((player: { userId: number; user: { name: string } }) => ({ userId: player.userId, name: player.user.name })), () => rng.next())
      await prisma.$transaction([
        prisma.seasonWeek.update({ where: { id: week.id }, data: { skippedPlayerIdsJson: JSON.stringify([...skipped].sort((left, right) => left - right)), chaosSeed, chaosTargetUserId: chaos.targetUserId, chaosTargetUserId2: chaos.targetUserId2, chaosPayload: chaosPayload(chaos.groups) } }),
        prisma.seasonPrediction.deleteMany({ where: { weekId: week.id, OR: [{ predictorUserId: { in: [...skipped] } }, { targetUserId: { in: [...skipped] } }] } }),
        prisma.seasonLoadout.deleteMany({ where: { weekId: week.id, userId: { in: [...skipped] } } }),
        prisma.seasonShieldChoice.deleteMany({ where: { weekId: week.id, userId: { in: [...skipped] } } }),
      ])
      return NextResponse.json({ ok: true, skippedPlayerIds: [...skipped], chaos })
    }

    if (body.action === 'lock') {
      const week = body.weekId ? await prisma.seasonWeek.findUnique({ where: { id: body.weekId } }) : season.weeksPlan.find((candidate: { status: string }) => candidate.status === 'open')
      if (!week || week.status !== 'open') return fail('Tuần không ở trạng thái open', 409)
      const seed = week.raceSeed ?? createRaceSeed()
      const skippedPlayerIds = new Set(parseSkippedPlayerIds(week.skippedPlayerIdsJson))
      const activePlayers = season.players.filter((player: { userId: number }) => !skippedPlayerIds.has(player.userId))
      const existing = await prisma.seasonLoadout.findMany({ where: { weekId: week.id } })
      const existingByPlayer = new Map<number, { seasonPlayerId: number; status: string }>(existing.map((loadout: { seasonPlayerId: number; status: string }) => [loadout.seasonPlayerId, loadout] as const))
      const updated = await prisma.$transaction(async (tx: typeof prisma) => {
        for (const player of activePlayers) {
          const loadout = existingByPlayer.get(player.id)
          if (loadout?.status === 'ready') continue
          const itemIds = selectAutoLoadout(seed, String(player.userId))
          await tx.seasonLoadout.upsert({
            where: { weekId_seasonPlayerId: { weekId: week.id, seasonPlayerId: player.id } },
            create: { weekId: week.id, seasonPlayerId: player.id, userId: player.userId, itemIdsJson: serializeItemIds(itemIds), status: 'auto', lockedAt: new Date() },
            update: { itemIdsJson: serializeItemIds(itemIds), status: 'auto', lockedAt: new Date() },
          })
        }
        return tx.seasonWeek.update({ where: { id: week.id }, data: { status: 'locked', predictionsLockedAt: new Date(), raceSeed: seed } })
      })
      return NextResponse.json({ ok: true, week: updated })
    }

    if (body.action === 'unlock') {
      const week = body.weekId ? await prisma.seasonWeek.findUnique({ where: { id: body.weekId } }) : season.weeksPlan.find((candidate: { status: string }) => candidate.status === 'locked')
      if (!week || week.status !== 'locked' || week.raceId) return fail('Chỉ có thể mở lại trước khi race bắt đầu', 409)
      const updated = await prisma.seasonWeek.update({ where: { id: week.id }, data: { status: 'open', predictionsLockedAt: null } })
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
