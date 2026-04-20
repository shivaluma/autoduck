import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { ChestEffect } from '@/lib/types'

interface UserWithV2State {
  id: number
  name: string
  avatarUrl?: string | null
  scars: number
  shieldsUsed: number
  totalKhaos: number
  cleanStreak: number
  isBoss: boolean
  bossSince?: Date | null
  ownedShields: Array<{
    id: number
    ownerId: number
    weeksUnused: number
    status: string
    loanedToId?: number | null
  }>
  mysteryChests: Array<{
    id: number
    ownerId: number
    earnedFromRaceId: number
    status: string
    effect: ChestEffect
    rngSeed: string
    targetUserId?: number | null
    createdAt: Date
  }>
}

// GET /api/users - Lấy danh sách tất cả người chơi
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      include: {
        ownedShields: {
          where: { status: 'active' },
          orderBy: [{ weeksUnused: 'desc' }, { earnedAt: 'asc' }],
        },
        mysteryChests: {
          where: { status: 'active' },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    })
    return NextResponse.json(
      (users as UserWithV2State[]).map((user) => ({
        id: user.id,
        name: user.name,
        avatarUrl: user.avatarUrl,
        scars: user.scars,
        shields: user.ownedShields.length,
        shieldsUsed: user.shieldsUsed,
        totalKhaos: user.totalKhaos,
        cleanStreak: user.cleanStreak,
        isBoss: user.isBoss,
        bossSince: user.bossSince,
        activeShields: user.ownedShields.map((shield) => ({
          id: shield.id,
          ownerId: shield.ownerId,
          weeksUnused: shield.weeksUnused,
          status: shield.status,
          loanedToId: shield.loanedToId,
        })),
        activeChest: user.mysteryChests[0]
          ? {
              id: user.mysteryChests[0].id,
              ownerId: user.mysteryChests[0].ownerId,
              earnedFromRaceId: user.mysteryChests[0].earnedFromRaceId,
              status: user.mysteryChests[0].status,
              effect: user.mysteryChests[0].effect,
              rngSeed: user.mysteryChests[0].rngSeed,
              targetUserId: user.mysteryChests[0].targetUserId,
              createdAt: user.mysteryChests[0].createdAt,
            }
          : null,
      }))
    )
  } catch (error) {
    console.error('Failed to fetch users:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}

// POST /api/users - Thêm người chơi mới
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    const user = await prisma.user.create({
      data: { name: name.trim() },
    })

    return NextResponse.json(user, { status: 201 })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Tên người chơi đã tồn tại' },
        { status: 409 }
      )
    }
    console.error('Failed to create user:', error)
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    )
  }
}
