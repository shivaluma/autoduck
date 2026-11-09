import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isImmortalDuck } from '@/lib/immortal-duck'
import { isGhostDuck } from '@/lib/ghost-duck'
import { publicRaceEngineVisibility } from '@/lib/racing/public-engine'
import { getLiveRaceSession, liveManualInputsFromSession } from '@/lib/racing/live-race-session'
import { trackGeometryUrl } from '@/src/race/polyline-track'
import type { RaceReplayInfo, ReplayFidelity } from '@/src/race/types'

type ReplayTrackSummary = {
  fidelity: string
  engineVersion: string
  balanceVersion: string
  trackGeometry: string | null
  byteSha256: string | null
  statsJson: string | null
}

/** `replay` per plan §4.6. verify stays 'none' on main (WASM verification arrives with the Rust engine). */
function replayInfo(raceId: number, status: string, track: ReplayTrackSummary | null): RaceReplayInfo {
  const playable = status === 'finished' && track !== null && track.byteSha256 !== null && track.fidelity !== 'UNAVAILABLE'
  return {
    mode: playable ? 'track' : 'none',
    fidelity: (track?.fidelity as ReplayFidelity | undefined) ?? null,
    trackUrl: playable ? `/api/races/${raceId}/track?h=${track!.byteSha256}` : null,
    geometryUrl: playable ? trackGeometryUrl(track!.trackGeometry) : null,
    engineVersion: track?.engineVersion ?? null,
    balanceVersion: track?.balanceVersion ?? null,
    byteSha256: playable ? track!.byteSha256 : null,
    verify: 'none',
  }
}

function parseJsonOr<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

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
        // Emission order. Meta events (CHAOS_RESOLVED, QP_TRACK_REWARD_GRANTED) come last with their own tick;
        // the viewer splits them off (src/race/event-vocab.ts).
        engineEvents: {
          orderBy: { id: 'asc' },
        },
        replayTrack: {
          select: { fidelity: true, engineVersion: true, balanceVersion: true, trackGeometry: true, byteSha256: true, statsJson: true },
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

    // Never Zod-parsed here: configs from other engine versions (e.g. 2.0.0) must still be served as-is.
    const engineConfig = parseJsonOr<Parameters<typeof publicRaceEngineVisibility>[2]>(race.engineConfigJson, null)
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
        replay: replayInfo(race.id, race.status, race.replayTrack ?? null),
        postRaceStats: race.status === 'finished' ? parseJsonOr(race.replayTrack?.statsJson, null) : null,
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
          metadata: parseJsonOr<Record<string, unknown>>(event.metadataJson, {}),
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
