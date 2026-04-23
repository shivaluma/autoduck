import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isImmortalDuck } from '@/lib/immortal-duck'
import { SHIELD_INITIAL_CHARGES, createShield, normalizeLegacyShieldState, syncOwnerShieldCount } from '@/lib/shield-decay'

function checkSecret(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  return secret === process.env.RACE_SECRET_KEY
}

export async function POST(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const ownerId = Number(body.ownerId)
    const charges = Number(body.charges ?? SHIELD_INITIAL_CHARGES)

    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      return NextResponse.json({ error: 'Invalid owner id' }, { status: 400 })
    }

    if (!Number.isInteger(charges) || charges < 1 || charges > SHIELD_INITIAL_CHARGES) {
      return NextResponse.json({ error: 'Charges must be from 1 to 3' }, { status: 400 })
    }

    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, name: true, shields: true },
    })

    if (!owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 })
    }

    if (isImmortalDuck(owner)) {
      return NextResponse.json(
        { error: 'Thomas is immortal and uses auto-shield, no Shield rows needed.' },
        { status: 400 }
      )
    }

    await normalizeLegacyShieldState(prisma, [ownerId])

    const existingShield = await prisma.shield.findFirst({
      where: {
        ownerId,
        status: 'active',
      },
    })

    if (existingShield) {
      return NextResponse.json(
        { error: 'Player already has an active shield. Max 1 shield per player.' },
        { status: 409 }
      )
    }

    const shield = await createShield(prisma, ownerId, undefined, charges)
    const activeCount = await syncOwnerShieldCount(prisma, ownerId)

    return NextResponse.json({
      success: true,
      shield,
      activeCount,
    })
  } catch (error) {
    console.error('Failed to create shields:', error)
    return NextResponse.json({ error: 'Failed to create shields' }, { status: 500 })
  }
}
