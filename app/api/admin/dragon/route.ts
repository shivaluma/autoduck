import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { adminGrantDragonOrb, adminVoidDragonOrb, getDragonState } from '@/lib/dragon/getDragonState'
import { adminGrantDragonScale, unequipDragonScaleForRace } from '@/lib/dragon/dragonScale'
import { cancelDragonTradeOffer } from '@/lib/dragon/tradeDragonOrb'
import { resolveDragonSummon } from '@/lib/dragon/resolveDragonSummon'
import { adminSetDragonWeekStar } from '@/lib/dragon/weekSchedule'

function checkSecret(req: Request) {
  const { searchParams } = new URL(req.url)
  return searchParams.get('secret') === process.env.RACE_SECRET_KEY
}

export async function GET(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json(await getDragonState(prisma))
}

export async function POST(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const action = body?.action

    if (action === 'setWeekStar') {
      return NextResponse.json(await adminSetDragonWeekStar(prisma, Number(body.dragonWeekId), Number(body.star)))
    }

    if (action === 'grantOrb') {
      const result = await adminGrantDragonOrb(prisma, Number(body.userId), Number(body.star))
      return NextResponse.json(result, { status: result.granted ? 200 : 400 })
    }

    if (action === 'voidOrb') {
      const result = await adminVoidDragonOrb(prisma, Number(body.orbId))
      return NextResponse.json(result, { status: result.voided ? 200 : 400 })
    }

    if (action === 'cancelTrade') {
      const result = await cancelDragonTradeOffer(prisma, Number(body.tradeId), Number(body.actorUserId ?? 0), { isAdmin: true })
      return NextResponse.json(result, { status: result.cancelled ? 200 : 400 })
    }

    if (action === 'resolveSummon') {
      const result = await resolveDragonSummon(prisma, Number(body.userId), Number(body.actorUserId ?? body.userId), { isAdmin: true })
      return NextResponse.json(result, { status: result.resolved || result.blocked ? 200 : 400 })
    }

    if (action === 'grantScale') {
      const result = await adminGrantDragonScale(prisma, Number(body.userId))
      return NextResponse.json(result, { status: result.granted ? 200 : 400 })
    }

    if (action === 'voidScale') {
      const itemId = Number(body.itemId)
      const item = await prisma.dragonItem.update({
        where: { id: itemId },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          equippedForRaceId: null,
        },
      })
      await prisma.dragonItemEvent.create({
        data: {
          itemId,
          userId: item.userId,
          type: 'VOIDED',
          message: 'Admin voided Long Lân Hộ Mệnh.',
        },
      })
      return NextResponse.json({ voided: true, item })
    }

    if (action === 'unequipScale') {
      const result = await unequipDragonScaleForRace(prisma, Number(body.userId), Number(body.raceId), Number(body.itemId))
      return NextResponse.json(result, { status: result.unequipped ? 200 : 400 })
    }

    return NextResponse.json({ error: 'Unknown admin Dragon action' }, { status: 400 })
  } catch (error) {
    console.error('Admin Dragon action failed:', error)
    return NextResponse.json({ error: 'Admin Dragon action failed' }, { status: 500 })
  }
}
