import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { SHIELD_INITIAL_CHARGES, syncOwnerShieldCount } from '@/lib/shield-decay'

function checkSecret(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  return secret === process.env.RACE_SECRET_KEY
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const shieldId = Number(id)
    if (Number.isNaN(shieldId)) {
      return NextResponse.json({ error: 'Invalid shield id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const action = body.action

    if (!['break', 'lose', 'reset_age'].includes(action)) {
      return NextResponse.json({ error: 'Invalid shield action' }, { status: 400 })
    }

    const shield = await prisma.shield.findUnique({
      where: { id: shieldId },
    })

    if (!shield) {
      return NextResponse.json({ error: 'Shield not found' }, { status: 404 })
    }

    if (action === 'break') {
      const updated = await prisma.$transaction(async (tx: typeof prisma) => {
        const nextShield = await tx.shield.update({
          where: { id: shieldId },
          data: {
            charges: 0,
            weeksUnused: SHIELD_INITIAL_CHARGES,
            status: 'broken',
            consumedAt: new Date(),
          },
        })

        await tx.user.update({
          where: { id: shield.ownerId },
          data: {
            scars: { increment: 1 },
          },
        })

        return nextShield
      })

      await syncOwnerShieldCount(prisma, shield.ownerId)
      return NextResponse.json({ success: true, shield: updated })
    }

    if (action === 'lose') {
      const updated = await prisma.shield.update({
        where: { id: shieldId },
        data: {
          charges: 0,
          weeksUnused: SHIELD_INITIAL_CHARGES,
          status: 'lost',
          consumedAt: new Date(),
        },
      })

      await syncOwnerShieldCount(prisma, shield.ownerId)
      return NextResponse.json({ success: true, shield: updated })
    }

    const updated = await prisma.shield.update({
      where: { id: shieldId },
      data: {
        charges: SHIELD_INITIAL_CHARGES,
        weeksUnused: 0,
      },
    })

    return NextResponse.json({ success: true, shield: updated })
  } catch (error) {
    console.error('Failed to mutate shield:', error)
    return NextResponse.json({ error: 'Failed to mutate shield' }, { status: 500 })
  }
}
