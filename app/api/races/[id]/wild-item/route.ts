import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const raceId = Number((await params).id)
  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!Number.isInteger(raceId)) return NextResponse.json({ error: 'Race không hợp lệ' }, { status: 400 })
  const value = await getContext(raceId, token)
  if (!value) return NextResponse.json({ error: 'Không có quyền xem dzịt này' }, { status: 403 })
  let duck: unknown = null
  try {
    const snapshot = value.race.liveSnapshotJson ? JSON.parse(value.race.liveSnapshotJson) as { ducks?: Array<{ playerId: string }> } : null
    duck = snapshot?.ducks?.find((entry) => entry.playerId === String(value.player.userId)) ?? null
  } catch {
    duck = null
  }
  const latestAction = await prisma.raceWildAction.findFirst({
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

    const identity = { raceId_playerId_clientActionId: { raceId, playerId: String(value.player.userId), clientActionId: body.clientActionId } }
    const existing = await prisma.raceWildAction.findUnique({ where: identity })
    if (existing) return NextResponse.json({ accepted: true, action: existing })
    const recent = await prisma.raceWildAction.count({ where: { raceId, seasonPlayerId: value.player.id, requestedAt: { gte: new Date(Date.now() - 1000) } } })
    if (recent >= 5) return NextResponse.json({ error: 'Bấm chậm lại một chút' }, { status: 429 })

    let liveItem: { instanceId?: string } | null = null
    try {
      const snapshot = value.race.liveSnapshotJson ? JSON.parse(value.race.liveSnapshotJson) as { ducks?: Array<{ playerId: string; wildItem?: { instanceId?: string } | null }> } : null
      liveItem = snapshot?.ducks?.find((entry) => entry.playerId === String(value.player.userId))?.wildItem ?? null
    } catch {
      liveItem = null
    }
    if (liveItem?.instanceId !== body.wildItemInstanceId) return NextResponse.json({ error: 'Wild Item đã đổi hoặc đã được dùng' }, { status: 409 })

    const action = await prisma.raceWildAction.upsert({
      where: identity,
      update: {},
      create: { raceId, seasonPlayerId: value.player.id, playerId: String(value.player.userId), wildItemInstanceId: body.wildItemInstanceId, clientActionId: body.clientActionId },
    })
    return NextResponse.json({ accepted: true, action }, { status: 202 })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Action không hợp lệ' }, { status: 400 })
    return NextResponse.json({ error: 'Không gửi được Wild Item action' }, { status: 500 })
  }
}
