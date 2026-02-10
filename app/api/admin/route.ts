import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Helper to check secret
const checkSecret = (req: Request) => {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  return secret === process.env.RACE_SECRET_KEY
}

export async function GET(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } })
    const races = await prisma.race.findMany({
      orderBy: { id: 'desc' },
      take: 50,
      include: { participants: true }
    })

    return NextResponse.json({ users, races })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { type, data } = body

    if (type === 'user') {
      const updatedUser = await prisma.user.update({
        where: { id: data.id },
        data: {
          name: data.name,
          scars: Number(data.scars),
          shields: Number(data.shields),
          shieldsUsed: Number(data.shieldsUsed),
          totalKhaos: Number(data.totalKhaos), // Allow manual override too
          avatarUrl: data.avatarUrl
        }
      })
      return NextResponse.json({ success: true, user: updatedUser })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'recalc_khaos') {
      const users = await prisma.user.findMany()
      const updates = []

      for (const user of users) {
        // Formula: scars + (shields * 2) + (shieldsUsed * 2)
        const newKhaos = user.scars + (user.shields * 2) + (user.shieldsUsed * 2)

        updates.push(prisma.user.update({
          where: { id: user.id },
          data: { totalKhaos: newKhaos }
        }))
      }

      await prisma.$transaction(updates)
      return NextResponse.json({ success: true, message: `Recalculated for ${updates.length} users` })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: 'Action failed' }, { status: 500 })
  }
}
