import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

function parseChaosGroups(payload: string | null | undefined) {
  if (!payload) return undefined
  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) && parsed.every((group) => Array.isArray(group)) ? parsed as number[][] : undefined
  } catch {
    return undefined
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
      weeksPlan: { orderBy: { weekNumber: 'asc' }, include: { predictions: { include: { predictor: true, target: true } } } },
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
    const latestResolvedWeek = [...season.weeksPlan].reverse().find((week: { status: string }) => week.status === 'resolved') ?? null
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
        predictionPoints: viewer.predictionPoints,
        scars: viewer.scars,
        shields: viewer.shields,
        isKing: viewer.isKing,
        kingStreak: viewer.kingStreak,
      } : null,
      personalLink: viewer ? `/season-3?token=${encodeURIComponent(viewer.accessToken)}` : null,
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
        chaosTargetName: currentWeek.chaosTargetUserId === null ? null : season.players.find((player: { userId: number }) => player.userId === currentWeek.chaosTargetUserId)?.user.name ?? null,
        chaosTargetName2: currentWeek.chaosTargetUserId2 === null ? null : season.players.find((player: { userId: number }) => player.userId === currentWeek.chaosTargetUserId2)?.user.name ?? null,
        predictionsLockedAt: currentWeek.predictionsLockedAt,
        predictionCount: currentWeek.predictions.length,
        predictionSubmitted: Boolean(viewer && currentWeek.predictions.some((prediction: { predictorPlayerId: number }) => prediction.predictorPlayerId === viewer.id)),
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
    const body = await request.json() as { token?: string; targetUserId?: number }
    if (!body.token || typeof body.targetUserId !== 'number') return jsonError('Token và targetUserId là bắt buộc')

    const season = await getActiveSeason()
    if (!season) return jsonError('Chưa có Season 3 active', 404)
    const player = season.players.find((candidate: { accessToken: string }) => candidate.accessToken === body.token)
    if (!player) return jsonError('Personal link không hợp lệ', 401)
    const week = season.weeksPlan.find((candidate: { status: string }) => candidate.status === 'open')
    if (!week) return jsonError('Prediction đã đóng hoặc tuần đã resolve', 409)
    if (player.userId === body.targetUserId) return jsonError('Không được pick bản thân')
    if (!season.players.some((candidate: { userId: number }) => candidate.userId === body.targetUserId)) return jsonError('Target không thuộc Season 3')

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
