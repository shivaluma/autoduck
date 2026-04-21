import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isImmortalDuck } from '@/lib/immortal-duck'

function checkSecret(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  return secret === process.env.RACE_SECRET_KEY
}

async function syncOwnerShieldCount(ownerId: number) {
  const activeCount = await prisma.shield.count({
    where: {
      ownerId,
      status: 'active',
    },
  })

  await prisma.user.update({
    where: { id: ownerId },
    data: { shields: activeCount },
  })

  return activeCount
}

export async function POST(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const ownerId = Number(body.ownerId)
    const count = Number(body.count ?? 1)
    const weeksUnused = Number(body.weeksUnused ?? 0)

    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      return NextResponse.json({ error: 'Invalid owner id' }, { status: 400 })
    }

    if (!Number.isInteger(count) || count < 1 || count > 20) {
      return NextResponse.json({ error: 'Count must be from 1 to 20' }, { status: 400 })
    }

    if (!Number.isInteger(weeksUnused) || weeksUnused < 0 || weeksUnused > 3) {
      return NextResponse.json({ error: 'weeksUnused must be from 0 to 3' }, { status: 400 })
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

    await prisma.shield.createMany({
      data: Array.from({ length: count }, () => ({
        ownerId,
        weeksUnused,
        status: 'active',
      })),
    })

    const activeCount = await syncOwnerShieldCount(ownerId)

    return NextResponse.json({
      success: true,
      created: count,
      activeCount,
    })
  } catch (error) {
    console.error('Failed to create shields:', error)
    return NextResponse.json({ error: 'Failed to create shields' }, { status: 500 })
  }
}
