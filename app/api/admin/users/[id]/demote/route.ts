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
    const userId = Number(id)
    if (Number.isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        cleanStreak: 0,
        isBoss: false,
        bossSince: null,
      },
    })

    return NextResponse.json({ success: true, user: updated })
  } catch (error) {
    console.error('Failed to demote boss:', error)
    return NextResponse.json({ error: 'Failed to demote boss' }, { status: 500 })
  }
}
