import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getLiveRaceSession, toWildActionApi } from '@/lib/racing/live-race-session'
import { raceConfigSchema } from '@/packages/race-protocol/src'

const useSchema = z.object({
  token: z.string().min(16),
  wildItemInstanceId: z.string().min(1).max(160),
  clientActionId: z.string().min(8).max(160),
})

async function getContext(raceId: number, token: string) {
  const [race, player] = await Promise.all([
    prisma.race.findUnique({ where: { id: raceId }, include: { participants: { select: { userId: true } }, seasonWeek: { select: { seasonId: true } } } }),
    prisma.seasonPlayer.findUnique({ where: { accessToken: token }, select: { id: true, userId: true, seasonId: true } }),
  ])
  if (!race || !player || !race.participants.some((entry: { userId: number }) => entry.userId === player.userId)) return null
  if (race.seasonWeek && race.seasonWeek.seasonId !== player.seasonId) return null
  const config = race.engineConfigJson ? raceConfigSchema.parse(JSON.parse(race.engineConfigJson)) : null
  if (!config?.players.some((entry) => entry.playerId === String(player.userId))) return null
  return { race, player, config }
}

function duckFromDbSnapshot(liveSnapshotJson: string | null, playerId: string) {
  try {
    const snapshot = liveSnapshotJson ? JSON.parse(liveSnapshotJson) as { ducks?: Array<{ playerId: string }> } : null
    return snapshot?.ducks?.find((entry) => entry.playerId === playerId) ?? null
  } catch {
    return null
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const raceId = Number((await params).id)
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!Number.isInteger(raceId)) return NextResponse.json({ error: 'Race không hợp lệ' }, { status: 400 })
  const value = await getContext(raceId, token)
  if (!value) return NextResponse.json({ error: 'Không có quyền xem dzịt này' }, { status: 403 })

  const playerId = String(value.player.userId)
  const session = getLiveRaceSession(raceId)
  const duck = session?.getDuck(playerId) ?? duckFromDbSnapshot(value.race.liveSnapshotJson, playerId)
  const sessionAction = session?.getLatestAction(value.player.id)
  const latestAction = sessionAction
    ? toWildActionApi(sessionAction)
    : await prisma.raceWildAction.findFirst({
      where: { raceId, seasonPlayerId: value.player.id },
      orderBy: { requestedAt: 'desc' },
      select: { clientActionId: true, wildItemInstanceId: true, status: true, authoritativeTick: true, resultJson: true },
    })

  return NextResponse.json({
    raceId,
    status: value.race.status,
    engineState: value.race.engineState,
    manualUseEnabled: value.config.pickupConfig?.manualItemsEnabled ?? false,
    autoUseEnabled: value.config.pickupConfig?.autoItemsEnabled ?? false,
    duck,
    latestAction,
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const raceId = Number((await params).id)
    const body = useSchema.parse(await request.json())
    if (!Number.isInteger(raceId)) return NextResponse.json({ error: 'Race không hợp lệ' }, { status: 400 })
    const value = await getContext(raceId, body.token)
    if (!value) return NextResponse.json({ error: 'Không có quyền điều khiển dzịt này' }, { status: 403 })
    if (value.race.status !== 'running' || value.race.engineState !== 'RACING') return NextResponse.json({ error: 'Race không còn nhận item' }, { status: 409 })
    if (value.config.pickupConfig?.manualItemsEnabled === false) return NextResponse.json({ error: 'Manual item đang tắt' }, { status: 409 })

    const session = getLiveRaceSession(raceId)
    if (!session) return NextResponse.json({ error: 'Race không chạy trên server này' }, { status: 409 })

    const playerId = String(value.player.userId)
    const existing = session.getWildAction(playerId, body.clientActionId)
    if (existing) return NextResponse.json({ accepted: true, action: toWildActionApi(existing) }, { status: 202 })

    if (session.recentRequestCount(value.player.id, 1000) >= 5) {
      return NextResponse.json({ error: 'Bấm chậm lại một chút' }, { status: 429 })
    }

    const liveItem = session.getWildItem(playerId)
    if (liveItem?.instanceId !== body.wildItemInstanceId) {
      return NextResponse.json({ error: 'Wild Item đã đổi hoặc đã được dùng' }, { status: 409 })
    }

    const action = session.acceptWildAction({
      raceId,
      seasonPlayerId: value.player.id,
      playerId,
      wildItemInstanceId: body.wildItemInstanceId,
      clientActionId: body.clientActionId,
    })
    return NextResponse.json({ accepted: true, action: toWildActionApi(action) }, { status: 202 })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 })
    return NextResponse.json({ error: 'Không gửi được Wild Item action' }, { status: 500 })
  }
}
