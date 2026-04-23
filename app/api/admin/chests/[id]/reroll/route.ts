import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isInventoryChestEffect, rollChest } from '@/lib/mystery-chest'

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

    const chest = await prisma.mysteryChest.findUnique({
      where: { id: chestId },
    })

    if (!chest) {
      return NextResponse.json({ error: 'Chest not found' }, { status: 404 })
    }

    if (chest.status !== 'active') {
      return NextResponse.json({ error: 'Only active chests can be rerolled' }, { status: 400 })
    }

    let rerolled = rollChest()
    for (let attempt = 0; attempt < 10 && isInventoryChestEffect(rerolled.effect); attempt += 1) {
      rerolled = rollChest(`${rerolled.seed}:active-reroll:${attempt}`)
    }
    if (isInventoryChestEffect(rerolled.effect)) {
      rerolled = { effect: 'CLONE_CHAOS', seed: `${rerolled.seed}:fallback`, rarity: 'common' }
    }
    const auditSeed = JSON.stringify({
      previousSeed: chest.rngSeed,
      previousEffect: chest.effect,
      rerolledSeed: rerolled.seed,
      rerolledEffect: rerolled.effect,
      rerolledAt: new Date().toISOString(),
    })

    const updated = await prisma.mysteryChest.update({
      where: { id: chestId },
      data: {
        effect: rerolled.effect,
        status: 'active',
        rngSeed: auditSeed,
        targetUserId: null,
      },
    })

    return NextResponse.json({ success: true, chest: updated })
  } catch (error) {
    console.error('Failed to reroll chest:', error)
    return NextResponse.json({ error: 'Failed to reroll chest' }, { status: 500 })
  }
}
