import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { ChestEffect } from '@/lib/types'
import { isImmortalDuck } from '@/lib/immortal-duck'
import { MYSTERY_CHESTS_ENABLED } from '@/lib/feature-flags'

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
        where: { consumedRaceId: raceId },
        include: { owner: true },
        orderBy: { id: 'asc' },
      }),
      prisma.mysteryChest.findMany({
        where: { earnedFromRaceId: raceId },
        include: { owner: true },
        orderBy: { id: 'asc' },
      }),
    ]) : [[], []]

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
      participants: race.participants.map((p: {
        userId: number
        user: { name: string; avatarUrl?: string | null }
        usedShield: boolean
        initialRank: number | null
        gotScar: boolean
        isClone: boolean
        cloneOfUserId?: number | null
        cloneIndex?: number | null
        displayName?: string | null
        chestEffect?: string | null
        chestTargetUserId?: number | null
      }) => ({
        userId: p.userId,
        name: p.user.name,
        displayName: p.displayName,
        avatarUrl: p.user.avatarUrl,
        usedShield: p.usedShield,
        initialRank: p.initialRank,
        gotScar: p.gotScar,
        isImmortal: isImmortalDuck({ name: p.user.name }),
        isClone: p.isClone,
        cloneOfUserId: p.cloneOfUserId,
        cloneIndex: p.cloneIndex,
          chestEffect: MYSTERY_CHESTS_ENABLED ? p.chestEffect : null,
          chestTargetUserId: MYSTERY_CHESTS_ENABLED ? p.chestTargetUserId : null,
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
