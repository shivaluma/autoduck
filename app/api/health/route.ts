import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Liveness plus a trivial DB round trip. No auth, always 200, never throws. */
export async function GET() {
  let db = false
  try {
    const { prisma } = await import('@/lib/db')
    await prisma.$queryRaw`SELECT 1`
    db = true
  } catch (error) {
    console.error('Health check: database query failed', error)
  }
  return NextResponse.json({ ok: true, db }, { headers: { 'Cache-Control': 'no-store' } })
}
