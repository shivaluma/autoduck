import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isImmortalDuck } from '@/lib/immortal-duck'
import { isGhostDuck } from '@/lib/ghost-duck'
import { publicRaceEngineVisibility } from '@/lib/racing/public-engine'
import { getLiveRaceSession, liveManualInputsFromSession } from '@/lib/racing/live-race-session'

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

    const token = new URL(request.url).searchParams.get('token')
    const viewerPlayer = token ? await prisma.seasonPlayer.findUnique({
      where: { accessToken: token },
      include: { user: true },
    }) : null

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
        engineEvents: {
          orderBy: [{ tick: 'asc' }, { id: 'asc' }],
        },
        seasonWeek: {
          include: {
            predictions: {
              include: {
                predictor: true,
                target: true,
              },
            },
          },
        },
      },
    })

    if (!race) {
      return NextResponse.json(
        { error: 'Race not found' },
        { status: 404 }
      )
    }

    const engineConfig = race.engineConfigJson ? JSON.parse(race.engineConfigJson) : null
    const engineVisibility = publicRaceEngineVisibility(race.status, race.raceSeed, engineConfig)

    return NextResponse.json({
      id: race.id,
      status: race.status,
      videoUrl: race.videoUrl,
      finalVerdict: race.finalVerdict,
      createdAt: race.createdAt,
      finishedAt: race.finishedAt,
      engine: race.engineVersion ? {
        state: race.engineState,
        protocolVersion: race.protocolVersion,
        engineVersion: race.engineVersion,
        balanceVersion: race.balanceVersion,
        trackVersion: race.trackVersion,
        seedCommit: race.seedCommit,
        seed: engineVisibility.seed,
        config: engineVisibility.config,
        players: engineVisibility.players,
        chaosConfig: engineConfig?.chaosConfig ?? null,
        loadouts: engineConfig?.loadouts ?? [],
        liveTick: race.status === 'running' ? (getLiveRaceSession(race.id)?.latestSnapshot?.tick ?? null) : null,
        liveManualInputs: race.status === 'running' ? liveManualInputsFromSession(race.id) : [],
        resultDigest: race.resultDigest,
        events: race.engineEvents.map((event: {
          type: string
          tick: number
          timestampWithinRaceMs: number
          sourcePlayerId: string | null
          targetPlayerId: string | null
          metadataJson: string
        }) => ({
          raceId: String(race.id),
          type: event.type,
          tick: event.tick,
          timestampWithinRaceMs: event.timestampWithinRaceMs,
          sourcePlayerId: event.sourcePlayerId,
          targetPlayerId: event.targetPlayerId,
          metadata: JSON.parse(event.metadataJson),
        })),
      } : null,
      // Legacy v2 keys (chests, dragon) were removed; kept as constants so older clients don't break.
      consumedChests: [],
      awardedChests: [],
      dragonAward: null,
      dragonScaleEvents: [],
      participants: race.participants.map((p: {
        userId: number
        user: { name: string; avatarUrl?: string | null; shields?: number | null }
        usedShield: boolean
        shieldId?: number | null
        shieldChargesAtStart?: number | null
        shieldBackfired?: boolean | null
        initialRank: number | null
        gotScar: boolean
        isClone: boolean
        cloneOfUserId?: number | null
        cloneIndex?: number | null
        displayName?: string | null
        chestEffect?: string | null
        chestTargetUserId?: number | null
        dragonEligible?: boolean | null
      }) => ({
        userId: p.userId,
        name: p.user.name,
        displayName: p.displayName,
        avatarUrl: p.user.avatarUrl,
        usedShield: p.usedShield,
        shieldId: p.shieldId ?? null,
        shieldChargesAtStart: p.shieldChargesAtStart ?? null,
        shieldBackfired: Boolean(p.shieldBackfired),
        initialRank: p.initialRank,
        gotScar: p.gotScar,
        isImmortal: isImmortalDuck({ name: p.user.name, shields: p.user.shields }),
        isGhost: isGhostDuck({ name: p.user.name }),
        isClone: p.isClone,
        cloneOfUserId: p.cloneOfUserId,
        cloneIndex: p.cloneIndex,
        chestEffect: p.chestEffect,
        chestTargetUserId: p.chestTargetUserId,
        dragonEligible: p.dragonEligible,
      })),
      commentaries: race.commentaries.map((c: { timestamp: number; content: string }) => ({
        timestamp: c.timestamp,
        content: c.content,
      })),
      seasonPrediction: viewerPlayer && race.seasonWeek ? (() => {
        const viewerPred = race.seasonWeek.predictions.find((p: { predictorPlayerId: number; targetUserId: number; target: { name: string; avatarUrl: string | null }; pointsAwarded: number | null }) => p.predictorPlayerId === viewerPlayer.id)
        if (!viewerPred) return null
        return {
          predictorName: viewerPlayer.user.name,
          targetUserId: viewerPred.targetUserId,
          targetName: viewerPred.target.name,
          targetAvatarUrl: viewerPred.target.avatarUrl,
          pointsAwarded: viewerPred.pointsAwarded,
        }
      })() : null,
      seasonPredictions: race.status === 'finished' && race.seasonWeek ? race.seasonWeek.predictions.map((p: {
        predictor: { name: string }
        targetUserId: number
        target: { name: string; avatarUrl: string | null }
        pointsAwarded: number | null
      }) => ({
        predictorName: p.predictor.name,
        targetUserId: p.targetUserId,
        targetName: p.target.name,
        targetAvatarUrl: p.target.avatarUrl,
        pointsAwarded: p.pointsAwarded,
      })) : [],
    })
  } catch (error) {
    console.error('Failed to fetch race:', error)
    return NextResponse.json(
      { error: 'Failed to fetch race' },
      { status: 500 }
    )
  }
}
