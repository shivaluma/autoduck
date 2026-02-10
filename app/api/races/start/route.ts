import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { runRaceWorker } from '@/lib/race-worker'
import { calculatePenalties, calculateNewStats } from '@/lib/shield-logic'

interface ParticipantInput {
  userId: number
  useShield: boolean
}

// POST /api/races/start - Bắt đầu cuộc đua mới
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { participants } = body as { participants: ParticipantInput[] }

    if (!participants || participants.length < 2) {
      return NextResponse.json(
        { error: 'Cần ít nhất 2 người chơi' },
        { status: 400 }
      )
    }

    // Validate users exist and have enough shields
    const userIds = participants.map((p: ParticipantInput) => p.userId)
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
    })

    if (users.length !== participants.length) {
      return NextResponse.json(
        { error: 'Một số người chơi không tồn tại' },
        { status: 400 }
      )
    }

    // Check shield availability
    for (const p of participants) {
      if (p.useShield) {
        const user = users.find((u: { id: number; shields: number; name: string }) => u.id === p.userId)
        if (!user || user.shields <= 0) {
          return NextResponse.json(
            { error: `${user?.name || 'Unknown'} không có khiên để sử dụng` },
            { status: 400 }
          )
        }
      }
    }

    // Create race record
    const race = await prisma.race.create({
      data: {
        status: 'pending',
        participants: {
          create: participants.map((p: ParticipantInput) => ({
            userId: p.userId,
            usedShield: p.useShield,
          })),
        },
      },
      include: {
        participants: {
          include: { user: true },
        },
      },
    })

    // Build player list for the worker - map userId to name
    const playerInputs: { name: string; useShield: boolean; userId: number }[] =
      race.participants.map((p: { user: { name: string }; usedShield: boolean; userId: number }) => ({
        name: p.user.name,
        useShield: p.usedShield,
        userId: p.userId,
      }))

    // Start the race asynchronously (don't await - let it run in background)
    executeRace(race.id, playerInputs).catch((error: unknown) => {
      console.error('Race execution failed:', error)
    })

    return NextResponse.json({
      raceId: race.id,
      status: 'pending',
      message: 'Cuộc đua đã được khởi tạo! Đang chuẩn bị...',
    })
  } catch (error) {
    console.error('Failed to start race:', error)
    return NextResponse.json(
      { error: 'Failed to start race' },
      { status: 500 }
    )
  }
}

async function executeRace(
  raceId: number,
  playerInputs: { name: string; useShield: boolean; userId: number }[]
) {
  try {
    // Update status to running
    await prisma.race.update({
      where: { id: raceId },
      data: { status: 'running' },
    })

    // Run the Playwright worker (or simulation in dev)
    // Pass raceId so screenshots can be queued for async commentary generation
    const result = await runRaceWorker(playerInputs, raceId)

    // Commentaries are now queued for async processing by the commentary worker
    // No need to save them here - the worker will create CommentaryLog entries
    console.log(`Race ${raceId}: ${result.commentaryJobsQueued} commentary jobs queued`)

    // Map ranking results to participants using name matching
    const raceResults = result.rawRanking.map((r: { rank: number; name: string }) => {
      const matched = playerInputs.find((p) => p.name === r.name)
      return {
        name: r.name,
        userId: matched?.userId ?? 0,
        initialRank: r.rank,
        usedShield: matched?.useShield ?? false,
      }
    })

    // Calculate penalties using shield logic
    const penalties = calculatePenalties(raceResults)

    // Update race participants with results
    for (const rr of raceResults) {
      const isVictim = penalties.victims.some((v) => v.userId === rr.userId)

      await prisma.raceParticipant.updateMany({
        where: { raceId, userId: rr.userId },
        data: {
          initialRank: rr.initialRank,
          gotScar: isVictim,
        },
      })

      // Update user stats
      const user = await prisma.user.findUnique({ where: { id: rr.userId } })
      if (user) {
        const { newScars, newShields } = calculateNewStats(
          user.scars,
          user.shields,
          isVictim,
          rr.usedShield
        )

        await prisma.user.update({
          where: { id: rr.userId },
          data: {
            scars: newScars,
            shields: newShields,
            shieldsUsed: rr.usedShield ? user.shieldsUsed + 1 : user.shieldsUsed,
            totalKhaos: isVictim ? user.totalKhaos + 1 : user.totalKhaos,
          },
        })
      }
    }

    // Finalize race
    await prisma.race.update({
      where: { id: raceId },
      data: {
        status: 'finished',
        videoUrl: result.videoUrl,
        finalVerdict: penalties.finalVerdict,
        finishedAt: new Date(),
      },
    })

    console.log(`Race ${raceId} completed! ${penalties.finalVerdict}`)
  } catch (error) {
    console.error(`Race ${raceId} failed:`, error)
    await prisma.race.update({
      where: { id: raceId },
      data: { status: 'failed' },
    })
  }
}
