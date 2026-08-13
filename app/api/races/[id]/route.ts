import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { ChestEffect } from '@/lib/types'
import { isImmortalDuck } from '@/lib/immortal-duck'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'
import { getDragonInventory } from '@/lib/dragon/getDragonState'
import { getDragonOrbName } from '@/lib/dragon/naming'
import { publicRaceEngineVisibility } from '@/lib/racing/public-engine'
import { getLiveRaceSession, liveManualInputsFromSession } from '@/lib/racing/live-race-session'
import {
  DRAGON_ORB_BONUS_RACE_SOURCE,
  DRAGON_ORB_FEATURED_RACE_SOURCE,
  DRAGON_ORB_LEGACY_RACE_SOURCE,
  DRAGON_ORB_RACE_SOURCES,
} from '@/lib/dragon/utils'

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
        engineEvents: {
          orderBy: [{ tick: 'asc' }, { id: 'asc' }],
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

    const [consumedChests, awardedChests] = MYSTERY_CHESTS_ENABLED ? await Promise.all([
      prisma.mysteryChest.findMany({
        where: {
          consumedRaceId: raceId,
          earnedFromRaceId: { not: raceId },
        },
        include: { owner: true },
        orderBy: { id: 'asc' },
      }),
      prisma.mysteryChest.findMany({
        where: { earnedFromRaceId: raceId },
        include: { owner: true },
        orderBy: { id: 'asc' },
      }),
    ]) : [[], []]
    const [dragonOrbs, dragonItemEvents] = await Promise.all([
      prisma.dragonOrb.findMany({
        where: {
          originalRaceId: raceId,
          source: { in: DRAGON_ORB_RACE_SOURCES },
        },
        include: {
          currentOwner: true,
          originalOwner: true,
          dragonWeek: true,
        },
        orderBy: [{ source: 'asc' }, { id: 'asc' }],
      }),
      prisma.dragonItemEvent.findMany({
        where: {
          raceId,
          type: { in: ['PROTECTED', 'NOT_NEEDED', 'CONSUMED'] },
        },
        include: {
          user: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    const sourceOrder = new Map([
      [DRAGON_ORB_FEATURED_RACE_SOURCE, 0],
      [DRAGON_ORB_LEGACY_RACE_SOURCE, 1],
      [DRAGON_ORB_BONUS_RACE_SOURCE, 2],
    ])
    const sortedDragonOrbs = [...dragonOrbs].sort((left: { source: string; id: number }, right: { source: string; id: number }) =>
      (sourceOrder.get(left.source) ?? 99) - (sourceOrder.get(right.source) ?? 99) || left.id - right.id
    )
    const primaryDragonOrb = sortedDragonOrbs[0] ?? null
    const dragonAwardOwnerId = primaryDragonOrb?.originalOwnerId ?? primaryDragonOrb?.currentOwnerId ?? null
    const dragonInventory = dragonAwardOwnerId && primaryDragonOrb
      ? await getDragonInventory(prisma, dragonAwardOwnerId, primaryDragonOrb.seasonKey)
      : null

    const targetUserIds = Array.from(
      new Set(
        consumedChests
          .map((chest: { targetUserId?: number | null }) => chest.targetUserId)
          .filter((userId: number | null | undefined): userId is number => typeof userId === 'number')
      )
    )
    const targetUsers = targetUserIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: targetUserIds } } })
      : []

    const participantByUserId = new Map<number, {
      userId: number
      gotScar: boolean
      initialRank: number | null
      usedShield: boolean
    }>()
    for (const participant of race.participants as Array<{ userId: number; gotScar: boolean; initialRank: number | null; usedShield: boolean }>) {
      if (!participantByUserId.has(participant.userId)) {
        participantByUserId.set(participant.userId, participant)
      }
    }

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
      consumedChests: consumedChests.map((chest: {
        id: number
        ownerId: number
        targetUserId?: number | null
        effect: ChestEffect
        owner: { name: string }
      }) => {
        const ownerParticipant = participantByUserId.get(chest.ownerId)
        const targetParticipant = chest.targetUserId ? participantByUserId.get(chest.targetUserId) : null
        const targetName = targetUsers.find((user: { id: number; name: string }) => user.id === chest.targetUserId)?.name ?? null
        let outcome: 'success' | 'fizzled' = 'success'

        if (chest.effect === 'INSURANCE_FRAUD') {
          outcome = ownerParticipant?.gotScar ? 'success' : 'fizzled'
        }

        if (chest.effect === 'I_CHOOSE_YOU') {
          outcome = targetParticipant?.initialRank === 1 ? 'success' : 'fizzled'
        }

        if (chest.effect === 'LAST_LAUGH') {
          outcome = ownerParticipant?.gotScar ? 'success' : 'fizzled'
        }

        return {
          id: chest.id,
          ownerId: chest.ownerId,
          ownerName: chest.owner.name,
          effect: chest.effect,
          targetUserId: chest.targetUserId ?? null,
          targetName,
          outcome,
        }
      }),
      awardedChests: awardedChests.map((chest: {
        id: number
        ownerId: number
        status: string
        effect: ChestEffect
        owner: { name: string }
      }) => ({
        id: chest.id,
        ownerId: chest.ownerId,
        ownerName: chest.owner.name,
        effect: chest.effect,
        status: chest.status,
      })),
      dragonAward: primaryDragonOrb ? {
        awarded: true,
        winnerUserId: dragonAwardOwnerId ?? primaryDragonOrb.currentOwnerId,
        winnerName: primaryDragonOrb.originalOwner?.name ?? primaryDragonOrb.currentOwner?.name ?? null,
        awardedStar: primaryDragonOrb.star,
        awardedOrbName: getDragonOrbName(primaryDragonOrb.star),
        awardedOrbs: sortedDragonOrbs.map((orb: {
          id: number
          star: number
          source: string
        }) => ({
          id: orb.id,
          star: orb.star,
          orbName: getDragonOrbName(orb.star),
          source: orb.source,
          kind: orb.source === DRAGON_ORB_BONUS_RACE_SOURCE ? 'BONUS' : 'FEATURED',
          duplicateCountForStar: dragonInventory?.stars[String(orb.star)]?.count ?? undefined,
        })),
        dragonWeekId: primaryDragonOrb.dragonWeekId,
        orbId: primaryDragonOrb.id,
        duplicateCountForStar: dragonInventory?.stars[String(primaryDragonOrb.star)]?.count ?? undefined,
        setProgressAfter: dragonInventory?.progress ?? undefined,
        summonReady: dragonInventory?.summonReady ?? undefined,
        reason: dragonInventory?.claimBlocked ? dragonInventory.blockedReason : undefined,
      } : null,
      dragonScaleEvents: dragonItemEvents.map((event: {
        type: string
        userId: number
        itemId: number
        message?: string | null
        payloadJson?: string | null
        user?: { name: string } | null
      }) => {
        let participantIds: string[] = []
        try {
          const payload = event.payloadJson ? JSON.parse(event.payloadJson) : null
          participantIds = Array.isArray(payload?.participantIds) ? payload.participantIds.map(String) : []
        } catch {
          participantIds = []
        }

        return {
          type: event.type,
          userId: event.userId,
          userName: event.user?.name ?? null,
          itemId: event.itemId,
          participantIds,
          message: event.message ?? null,
        }
      }),
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
        isClone: p.isClone,
        cloneOfUserId: p.cloneOfUserId,
        cloneIndex: p.cloneIndex,
        chestEffect: MYSTERY_CHESTS_ENABLED ? p.chestEffect : null,
        chestTargetUserId: MYSTERY_CHESTS_ENABLED ? p.chestTargetUserId : null,
        dragonEligible: p.dragonEligible,
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
