import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

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
    const chestId = Number(id)
    if (Number.isNaN(chestId)) {
      return NextResponse.json({ error: 'Invalid chest id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim()
      : 'Cancelled by admin'

    const chest = await prisma.mysteryChest.findUnique({
      where: { id: chestId },
    })

    if (!chest) {
      return NextResponse.json({ error: 'Chest not found' }, { status: 404 })
    }

    if (chest.status !== 'active') {
      return NextResponse.json({ error: 'Only active chests can be cancelled' }, { status: 400 })
    }

    const updated = await prisma.mysteryChest.update({
      where: { id: chestId },
      data: {
        status: 'void',
        targetUserId: null,
        rngSeed: JSON.stringify({
          previousSeed: chest.rngSeed,
          cancelledAt: new Date().toISOString(),
          reason,
        }),
      },
    })

    return NextResponse.json({ success: true, chest: updated })
  } catch (error) {
    console.error('Failed to cancel chest:', error)
    return NextResponse.json({ error: 'Failed to cancel chest' }, { status: 500 })
  }
}
