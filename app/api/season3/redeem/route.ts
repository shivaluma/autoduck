import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; rewardKey?: string }
    if (!body.token || !body.rewardKey) return NextResponse.json({ error: 'Token và rewardKey là bắt buộc' }, { status: 400 })

    const season = await prisma.season.findFirst({
      where: { status: { in: ['active', 'completed'] } },
      orderBy: { createdAt: 'desc' },
      include: { players: true, rewards: true },
    })
    if (!season) return NextResponse.json({ error: 'Chưa có Season 3' }, { status: 404 })
    const player = season.players.find((candidate: { accessToken: string }) => candidate.accessToken === body.token)
    const reward = season.rewards.find((candidate: { key: string; active: boolean }) => candidate.key === body.rewardKey && candidate.active)
    if (!player) return NextResponse.json({ error: 'Personal link không hợp lệ' }, { status: 401 })
    if (!reward) return NextResponse.json({ error: 'Reward không tồn tại hoặc đã tắt' }, { status: 404 })
    if (player.predictionPoints < reward.cost) return NextResponse.json({ error: `Cần ${reward.cost} 🔮` }, { status: 409 })
    if (reward.stock !== null && reward.stock <= 0) return NextResponse.json({ error: 'Reward đã hết stock' }, { status: 409 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const redemption = await prisma.$transaction(async (tx: any) => {
      await tx.seasonPlayer.update({ where: { id: player.id }, data: { predictionPoints: { decrement: reward.cost } } })
      if (reward.stock !== null) await tx.seasonReward.update({ where: { id: reward.id }, data: { stock: { decrement: 1 } } })
      return tx.seasonRedemption.create({ data: { seasonId: season.id, seasonPlayerId: player.id, rewardId: reward.id, pointsSpent: reward.cost } })
    })

    return NextResponse.json({ ok: true, redemption, reward: reward.name })
  } catch (error) {
    console.error('Season 3 redeem failed:', error)
    return NextResponse.json({ error: 'Redeem failed' }, { status: 500 })
  }
}
