import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/races - Lấy danh sách tất cả cuộc đua
export async function GET() {
  try {
    const races = await prisma.race.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        finalVerdict: true,
        createdAt: true,
        isTest: true,
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
