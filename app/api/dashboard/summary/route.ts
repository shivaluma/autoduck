import { NextResponse } from 'next/server'
import { getDashboardSummary } from '@/lib/dashboard-data'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    return NextResponse.json(await getDashboardSummary(prisma))
  } catch (error) {
    console.error('Failed to fetch dashboard summary:', error)
    return NextResponse.json({ error: 'Failed to fetch dashboard summary' }, { status: 500 })
  }
}
