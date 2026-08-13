import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { RACE_ITEM_CATALOG, validateLoadout } from '@/packages/race-core/src'
import { raceItemIdSchema } from '@/packages/race-protocol/src'
import { parseItemIds, serializeItemIds } from '@/lib/racing/loadout'

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

function jsonError(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

async function getActiveSeason() {
  return prisma.season.findFirst({
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: {
      players: { include: { user: { select: { id: true, name: true, avatarUrl: true } } }, orderBy: { user: { name: 'asc' } } },
      weeksPlan: { orderBy: { weekNumber: 'asc' }, include: { predictions: { include: { predictor: true, target: true } }, shieldChoices: true, loadouts: true, race: { select: { id: true, status: true } } } },
      rewards: { where: { active: true }, orderBy: { cost: 'asc' } },
    },
  })
}

export async function GET(request: Request) {
  try {
    const season = await getActiveSeason()
    if (!season) return NextResponse.json({ season: null })

    const token = new URL(request.url).searchParams.get('token')
    const viewer = token ? season.players.find((player: { accessToken: string }) => player.accessToken === token) : null
    const currentWeek = season.weeksPlan.find((week: { status: string }) => week.status !== 'resolved') ?? null
    const skippedPlayerIds = parseSkippedPlayerIds(currentWeek?.skippedPlayerIdsJson)
    const latestResolvedWeek = [...season.weeksPlan].reverse().find((week: { status: string }) => week.status === 'resolved') ?? null
    const viewerLoadout = viewer && currentWeek ? currentWeek.loadouts.find((loadout: { seasonPlayerId: number }) => loadout.seasonPlayerId === viewer.id) : null
    const revealPredictions = (resolvedWeek: typeof latestResolvedWeek) => resolvedWeek
      ? resolvedWeek.predictions.map((prediction: { predictor: { name: string }; target: { name: string }; pointsAwarded: number }) => ({
          predictorName: prediction.predictor.name,
          targetName: prediction.target.name,
          pointsAwarded: prediction.pointsAwarded,
        }))
      : []

    return NextResponse.json({
      season: {
        key: season.key,
        name: season.name,
        year: season.year,
        weeks: season.weeks,
        status: season.status,
      },
      viewer: viewer ? {
        userId: viewer.userId,
        name: viewer.user.name,
        avatarUrl: viewer.user.avatarUrl,
        predictionPoints: viewer.predictionPoints,
        scars: viewer.scars,
        shields: viewer.shields,
        isKing: viewer.isKing,
        kingStreak: viewer.kingStreak,
      } : null,
      personalLink: viewer ? `/season-3?token=${encodeURIComponent(viewer.accessToken)}` : null,
      raceItems: RACE_ITEM_CATALOG,
      players: season.players.map((player: { user: { id: number; name: string; avatarUrl: string | null }; userId: number; predictionPoints: number; scars: number; shields: number; isKing: boolean; kingStreak: number }) => ({
        id: player.user.id,
        name: player.user.name,
        avatarUrl: player.user.avatarUrl,
        predictionPoints: player.predictionPoints,
        scars: player.scars,
        shields: player.shields,
        isKing: player.isKing,
        kingStreak: player.kingStreak,
      })),
      currentWeek: currentWeek ? {
        id: currentWeek.id,
        weekNumber: currentWeek.weekNumber,
        status: currentWeek.status,
        chaosType: currentWeek.chaosType,
        chaosTargetUserId: currentWeek.chaosTargetUserId,
        chaosTargetUserId2: currentWeek.chaosTargetUserId2,
        chaosGroups: parseChaosGroups(currentWeek.chaosPayload),
        skippedPlayerIds,
        viewerSkipped: Boolean(viewer && skippedPlayerIds.includes(viewer.userId)),
        chaosTargetName: currentWeek.chaosTargetUserId === null ? null : season.players.find((player: { userId: number }) => player.userId === currentWeek.chaosTargetUserId)?.user.name ?? null,
        chaosTargetName2: currentWeek.chaosTargetUserId2 === null ? null : season.players.find((player: { userId: number }) => player.userId === currentWeek.chaosTargetUserId2)?.user.name ?? null,
        predictionsLockedAt: currentWeek.predictionsLockedAt,
        predictionCount: currentWeek.predictions.length,
        predictionSubmitted: Boolean(viewer && currentWeek.predictions.some((prediction: { predictorPlayerId: number }) => prediction.predictorPlayerId === viewer.id)),
        shieldConfirmed: Boolean(viewer && currentWeek.shieldChoices.some((choice: { seasonPlayerId: number }) => choice.seasonPlayerId === viewer.id)),
        loadoutReadyCount: currentWeek.loadouts.filter((loadout: { status: string }) => loadout.status === 'ready' || loadout.status === 'auto').length,
        loadout: viewerLoadout ? { itemIds: parseItemIds(viewerLoadout.itemIdsJson), status: viewerLoadout.status } : { itemIds: [], status: 'draft' },
        raceId: currentWeek.race?.id ?? null,
        raceStatus: currentWeek.race?.status ?? null,
        predictions: [],
      } : null,
      latestReveal: latestResolvedWeek ? {
        weekNumber: latestResolvedWeek.weekNumber,
        recap: latestResolvedWeek.recap,
        predictions: revealPredictions(latestResolvedWeek),
      } : null,
      history: season.weeksPlan.filter((week: { status: string }) => week.status === 'resolved').map((week: { id: number; weekNumber: number; chaosType: string; recap: string | null; resolvedAt: Date | null }) => ({
        id: week.id,
        weekNumber: week.weekNumber,
        chaosType: week.chaosType,
        recap: week.recap,
        resolvedAt: week.resolvedAt,
      })),
      rewards: season.rewards,
    })
  } catch (error) {
    console.error('Failed to fetch Season 3:', error)
    return jsonError('Failed to fetch Season 3', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; targetUserId?: number; action?: string; useShield?: boolean; itemIds?: unknown[]; ready?: boolean }
    if (!body.token) return jsonError('Token là bắt buộc')

    const season = await getActiveSeason()
    if (!season) return jsonError('Chưa có Season 3 active', 404)
    const player = season.players.find((candidate: { accessToken: string }) => candidate.accessToken === body.token)
    if (!player) return jsonError('Personal link không hợp lệ', 401)
    const week = season.weeksPlan.find((candidate: { status: string }) => candidate.status === 'open')
    if (!week) return jsonError('Tuần đã đóng hoặc đã resolve', 409)
    const skippedPlayerIds = parseSkippedPlayerIds(week.skippedPlayerIdsJson)
    if (skippedPlayerIds.includes(player.userId)) return jsonError('Host đã cho bạn nghỉ race tuần này', 409)

    if (body.action === 'shield') {
      if (player.shields < 1) return jsonError('Bạn không có Shield để xác nhận')
      if (body.useShield === false) {
        await prisma.seasonShieldChoice.deleteMany({ where: { weekId: week.id, seasonPlayerId: player.id } })
        return NextResponse.json({ ok: true, shieldConfirmed: false, message: 'Đã bỏ xác nhận dùng Shield.' })
      }
      await prisma.seasonShieldChoice.upsert({
        where: { weekId_seasonPlayerId: { weekId: week.id, seasonPlayerId: player.id } },
        create: { weekId: week.id, seasonPlayerId: player.id, userId: player.userId },
        update: { confirmedAt: new Date() },
      })
      return NextResponse.json({ ok: true, shieldConfirmed: true, message: 'Đã xác nhận dùng Shield tuần này.' })
    }

    if (body.action === 'loadout') {
      const itemIds = (body.itemIds ?? []).map((item) => raceItemIdSchema.parse(item))
      const validation = validateLoadout(itemIds)
      if (body.ready && !validation.ready) return jsonError('Loadout cần dùng đủ 3 Prep Credits với 1 Major + 1 Minor')
      const status = body.ready ? 'ready' : 'draft'
      await prisma.seasonLoadout.upsert({
        where: { weekId_seasonPlayerId: { weekId: week.id, seasonPlayerId: player.id } },
        create: { weekId: week.id, seasonPlayerId: player.id, userId: player.userId, itemIdsJson: serializeItemIds(itemIds), status, lockedAt: body.ready ? new Date() : null },
        update: { itemIdsJson: serializeItemIds(itemIds), status, lockedAt: body.ready ? new Date() : null },
      })
      return NextResponse.json({ ok: true, status, message: body.ready ? 'Loadout đã khóa.' : 'Đã lưu loadout.' })
    }

    if (typeof body.targetUserId !== 'number') return jsonError('targetUserId là bắt buộc')
    if (player.userId === body.targetUserId) return jsonError('Không được pick bản thân')
    if (!season.players.some((candidate: { userId: number }) => candidate.userId === body.targetUserId) || skippedPlayerIds.includes(body.targetUserId)) return jsonError('Target không đua tuần này')

    await prisma.seasonPrediction.upsert({
      where: { weekId_predictorPlayerId: { weekId: week.id, predictorPlayerId: player.id } },
      create: {
        weekId: week.id,
        predictorPlayerId: player.id,
        predictorUserId: player.userId,
        targetUserId: body.targetUserId,
      },
      update: { targetUserId: body.targetUserId, pointsAwarded: 0 },
    })

    return NextResponse.json({ ok: true, message: 'Prediction đã khóa cho tuần này.' })
  } catch (error) {
    console.error('Failed to save Season 3 prediction:', error)
    return jsonError('Failed to save prediction', 500)
  }
}
