import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getMemberStats } from '@/lib/member-stats'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    return NextResponse.json(await getMemberStats(prisma), {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    })
  } catch (error) {
    console.error('Failed to fetch member stats:', error)
    return NextResponse.json({ error: 'Failed to fetch member stats' }, { status: 500 })
  }
}
