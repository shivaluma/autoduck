import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { ChestEffect } from '@/lib/types'
import { isImmortalDuck } from '@/lib/immortal-duck'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'
import { getDragonInventory } from '@/lib/dragon/getDragonState'

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
    const [dragonOrb, dragonItemEvents] = await Promise.all([
      prisma.dragonOrb.findFirst({
        where: {
          originalRaceId: raceId,
          source: 'RACE_WIN',
        },
        include: {
          currentOwner: true,
          dragonWeek: true,
        },
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
    const dragonInventory = dragonOrb ? await getDragonInventory(prisma, dragonOrb.currentOwnerId, dragonOrb.seasonKey) : null

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
      dragonAward: dragonOrb ? {
        awarded: true,
        winnerUserId: dragonOrb.currentOwnerId,
        winnerName: dragonOrb.currentOwner?.name ?? null,
        awardedStar: dragonOrb.star,
        awardedOrbName: (() => {
          const names: Record<number, string> = {
            1: 'Nhất Tinh Châu',
            2: 'Nhị Tinh Châu',
            3: 'Tam Tinh Châu',
            4: 'Tứ Tinh Châu',
            5: 'Ngũ Tinh Châu',
            6: 'Lục Tinh Châu',
            7: 'Thất Tinh Châu',
          }
          return names[dragonOrb.star] ?? `${dragonOrb.star} Tinh Châu`
        })(),
        dragonWeekId: dragonOrb.dragonWeekId,
        orbId: dragonOrb.id,
        duplicateCountForStar: dragonInventory?.stars[String(dragonOrb.star)]?.count ?? undefined,
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
