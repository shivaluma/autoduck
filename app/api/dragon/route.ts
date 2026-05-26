import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getDragonInventory, getDragonState } from '@/lib/dragon/getDragonState'
import { acceptDragonTradeOffer, cancelDragonTradeOffer, createDragonTradeOffer } from '@/lib/dragon/tradeDragonOrb'
import { resolveDragonSummon } from '@/lib/dragon/resolveDragonSummon'
import { equipDragonScaleForRace, unequipDragonScaleForRace } from '@/lib/dragon/dragonScale'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = Number(searchParams.get('userId'))
    if (Number.isFinite(userId) && userId > 0) {
      return NextResponse.json(await getDragonInventory(prisma, userId))
    }

    return NextResponse.json(await getDragonState(prisma), {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
  } catch (error) {
    console.error('Failed to fetch Dragon state:', error)
    return NextResponse.json({ error: 'Failed to fetch Dragon state' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const action = body?.action

    if (action === 'createTrade') {
      const result = await createDragonTradeOffer(
        prisma,
        Number(body.proposerId),
        Number(body.offeredOrbId),
        Number(body.requestedStar),
        body.counterpartyId ? Number(body.counterpartyId) : null,
        typeof body.message === 'string' ? body.message : null
      )
      return NextResponse.json(result, { status: result.created ? 200 : 400 })
    }

    if (action === 'cancelTrade') {
      const result = await cancelDragonTradeOffer(prisma, Number(body.tradeId), Number(body.actorUserId))
      return NextResponse.json(result, { status: result.cancelled ? 200 : 400 })
    }

    if (action === 'acceptTrade') {
      const result = await acceptDragonTradeOffer(
        prisma,
        Number(body.tradeId),
        Number(body.accepterId),
        Number(body.acceptedOrbId)
      )
      return NextResponse.json(result, { status: result.accepted ? 200 : 400 })
    }

    if (action === 'summon') {
      const result = await resolveDragonSummon(prisma, Number(body.userId), Number(body.actorUserId ?? body.userId))
      return NextResponse.json(result, { status: result.resolved || result.blocked ? 200 : 400 })
    }

    if (action === 'equipScale') {
      const result = await equipDragonScaleForRace(prisma, Number(body.userId), Number(body.raceId), Number(body.itemId))
      return NextResponse.json(result, { status: result.equipped ? 200 : 400 })
    }

    if (action === 'unequipScale') {
      const result = await unequipDragonScaleForRace(prisma, Number(body.userId), Number(body.raceId), Number(body.itemId))
      return NextResponse.json(result, { status: result.unequipped ? 200 : 400 })
    }

    return NextResponse.json({ error: 'Unknown Dragon action' }, { status: 400 })
  } catch (error) {
    console.error('Dragon action failed:', error)
    return NextResponse.json({ error: 'Dragon action failed' }, { status: 500 })
  }
}
