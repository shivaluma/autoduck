import { NextResponse } from 'next/server'
import { getDashboardRaceLists, getDashboardSummary, getDashboardUsers } from '@/lib/dashboard-data'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const [players, races, summary] = await Promise.all([
      getDashboardUsers(prisma),
      getDashboardRaceLists(prisma),
      getDashboardSummary(prisma),
    ])

    return NextResponse.json({
      players,
      races,
      summary,
    })
  } catch (error) {
    console.error('Failed to fetch dashboard:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard' },
      { status: 500 }
    )
  }
}
