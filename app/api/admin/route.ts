import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isImmortalDuck } from '@/lib/immortal-duck'

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
    const rawUsers = await prisma.user.findMany({
      orderBy: { id: 'asc' },
      include: {
        ownedShields: {
          where: { status: 'active' },
          select: { id: true },
        },
      },
    })
    const users = rawUsers.map((user: {
      ownedShields: { id: number }[]
      shields: number
      name: string
    }) => {
      const { ownedShields, ...rest } = user
      const activeShieldCount = ownedShields.length
      const isImmortal = isImmortalDuck(rest)

      return {
        ...rest,
        legacyShields: rest.shields,
        activeShieldCount,
        shields: isImmortal ? rest.shields : activeShieldCount,
      }
    })
    const races = await prisma.race.findMany({
      orderBy: { id: 'desc' },
      take: 50,
      include: { participants: true }
    })

    return NextResponse.json({ users, races })
  } catch (error) {
    console.error('Failed to fetch admin data:', error)
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
          shieldsUsed: Number(data.shieldsUsed),
          totalKhaos: Number(data.totalKhaos),
          avatarUrl: data.avatarUrl,
          cleanStreak: Number(data.cleanStreak ?? 0),
          isBoss: Boolean(data.isBoss),
        }
      })
      return NextResponse.json({ success: true, user: updatedUser })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (error) {
    console.error('Failed to update admin entity:', error)
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
      const users = await prisma.user.findMany({
        include: {
          ownedShields: {
            where: { status: 'active' },
            select: { id: true },
          },
        },
      })
      const updates = []

      for (const user of users as Array<{
        id: number
        name: string
        scars: number
        shields: number
        shieldsUsed: number
        ownedShields: { id: number }[]
      }>) {
        // Formula: scars + (shields * 2) + (shieldsUsed * 2)
        const shieldCount = isImmortalDuck(user) ? user.shields : user.ownedShields.length
        const newKhaos = user.scars + (shieldCount * 2) + (user.shieldsUsed * 2)

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
    console.error('Failed to run admin action:', error)
    return NextResponse.json({ error: 'Action failed' }, { status: 500 })
  }
}
