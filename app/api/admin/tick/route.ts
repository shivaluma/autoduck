import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { tickShieldDecay } from '@/lib/shield-decay'
import { isAdminSecret } from '@/lib/auth/admin-secret'

function checkSecret(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  return isAdminSecret(secret)
}

export async function POST(request: Request) {
  if (!checkSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await tickShieldDecay(prisma)
    return NextResponse.json({
      success: true,
      weekKey: result.weekKey,
      broken: result.broken,
      lost: result.lost,
    })
  } catch (error) {
    console.error('Failed to run weekly tick:', error)
    return NextResponse.json({ error: 'Failed to run weekly tick' }, { status: 500 })
  }
}
