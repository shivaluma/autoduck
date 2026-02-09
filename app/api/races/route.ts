import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/races - Lấy danh sách tất cả cuộc đua
export async function GET() {
  try {
    const races = await prisma.race.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        participants: {
          include: { user: true },
        },
        commentaries: {
          orderBy: { timestamp: 'asc' },
        },
      },
    })
    return NextResponse.json(races)
  } catch (error) {
    console.error('Failed to fetch races:', error)
    return NextResponse.json(
      { error: 'Failed to fetch races' },
      { status: 500 }
    )
  }
}
