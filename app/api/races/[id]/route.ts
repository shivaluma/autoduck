import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/races/[id] - Chi tiết cuộc đua
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const raceId = parseInt(id)

    if (isNaN(raceId)) {
      return NextResponse.json(
        { error: 'Invalid race ID' },
        { status: 400 }
      )
    }

    const race = await prisma.race.findUnique({
      where: { id: raceId },
      include: {
        participants: {
          include: { user: true },
          orderBy: { initialRank: 'asc' },
        },
        commentaries: {
          orderBy: { timestamp: 'asc' },
        },
      },
    })

    if (!race) {
      return NextResponse.json(
        { error: 'Race not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: race.id,
      status: race.status,
      videoUrl: race.videoUrl,
      finalVerdict: race.finalVerdict,
      createdAt: race.createdAt,
      finishedAt: race.finishedAt,
      participants: race.participants.map((p: { userId: number; user: { name: string }; usedShield: boolean; initialRank: number | null; gotScar: boolean }) => ({
        userId: p.userId,
        name: p.user.name,
        usedShield: p.usedShield,
        initialRank: p.initialRank,
        gotScar: p.gotScar,
      })),
      commentaries: race.commentaries.map((c: { timestamp: number; content: string }) => ({
        timestamp: c.timestamp,
        content: c.content,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch race:', error)
    return NextResponse.json(
      { error: 'Failed to fetch race' },
      { status: 500 }
    )
  }
}
