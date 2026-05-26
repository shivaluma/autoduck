/* eslint-disable @typescript-eslint/no-explicit-any */
import { buildPenaltyVerdict } from '@/lib/shield-logic'
import {
  DRAGON_ITEM_LABEL,
} from './naming'
import {
  DRAGON_ITEM_TYPE_SCALE,
  getOwnerUserIdForRaceEntry,
  withDragonTransaction,
} from './utils'

type DragonScaleRaceEntry = {
  id?: number
  name: string
  userId: number
  initialRank: number
  usedShield?: boolean
  isImmortal?: boolean
  isClone?: boolean
  cloneOfUserId?: number | null
  cloneIndex?: number | null
}

type DragonScaleVictim = {
  id?: number
  name: string
  userId: number
  initialRank: number
  isClone?: boolean
  cloneOfUserId?: number | null
  cloneIndex?: number | null
}

function participantKey(entry: { userId: number; cloneIndex?: number | null }) {
  return `${entry.userId}:${entry.cloneIndex ?? 'main'}`
}

export async function applyDragonScaleProtection(
  prisma: any,
  raceId: number,
  raceResults: DragonScaleRaceEntry[],
  finalVictims: DragonScaleVictim[]
) {
  return withDragonTransaction(prisma, async (tx) => {
    const equippedItems = (await tx.dragonItem.findMany({
      where: {
        type: DRAGON_ITEM_TYPE_SCALE,
        status: 'EQUIPPED',
        equippedForRaceId: raceId,
      },
    })) as Array<{
      id: number
      userId: number
      status: string
    }>

    const protectedOwnerIds = new Set(equippedItems.map((item) => item.userId))
    const protectedVictims = finalVictims.filter((victim) => {
      const ownerId = getOwnerUserIdForRaceEntry(victim)
      return typeof ownerId === 'number' && protectedOwnerIds.has(ownerId)
    })

    if (protectedVictims.length === 0) {
      for (const item of equippedItems) {
        await tx.dragonItem.update({
          where: { id: item.id },
          data: {
            status: 'ACTIVE',
            equippedForRaceId: null,
            equippedAt: null,
          },
        })
        await tx.dragonItemEvent.create({
          data: {
            itemId: item.id,
            userId: item.userId,
            raceId,
            type: 'NOT_NEEDED',
            message: 'Long Lân chưa cần hộ mệnh, item vẫn còn nguyên.',
          },
        })
      }

      return {
        protectionApplied: false,
        protectedUserIds: [],
        protectedParticipantIds: [],
        consumedItemIds: [],
        events: [],
        finalVictims,
        finalVerdict: buildPenaltyVerdict(finalVictims),
      }
    }

    const triggeredOwnerIds = new Set(protectedVictims.map((victim) => getOwnerUserIdForRaceEntry(victim)).filter((id): id is number => typeof id === 'number'))
    const remainingVictims = finalVictims.filter((victim) => {
      const ownerId = getOwnerUserIdForRaceEntry(victim)
      return typeof ownerId !== 'number' || !triggeredOwnerIds.has(ownerId)
    })
    const seenVictimOwners = new Set(
      remainingVictims
        .map((victim) => getOwnerUserIdForRaceEntry(victim))
        .filter((id): id is number => typeof id === 'number')
    )
    const seenParticipantKeys = new Set(remainingVictims.map(participantKey))
    const desiredVictimCount = Math.max(finalVictims.length, remainingVictims.length)

    for (const candidate of [...raceResults].sort((left, right) => right.initialRank - left.initialRank)) {
      if (remainingVictims.length >= desiredVictimCount) {
        break
      }
      if (candidate.isImmortal) {
        continue
      }
      const ownerId = getOwnerUserIdForRaceEntry(candidate)
      if (typeof ownerId !== 'number') {
        continue
      }
      if (triggeredOwnerIds.has(ownerId) || seenVictimOwners.has(ownerId)) {
        continue
      }
      const key = participantKey(candidate)
      if (seenParticipantKeys.has(key)) {
        continue
      }

      remainingVictims.push({
        id: candidate.id,
        name: candidate.name,
        userId: candidate.userId,
        initialRank: candidate.initialRank,
        isClone: candidate.isClone,
        cloneOfUserId: candidate.cloneOfUserId,
        cloneIndex: candidate.cloneIndex,
      })
      seenVictimOwners.add(ownerId)
      seenParticipantKeys.add(key)
    }

    const protectedParticipantIds = raceResults
      .filter((entry) => {
        const ownerId = getOwnerUserIdForRaceEntry(entry)
        return typeof ownerId === 'number' && triggeredOwnerIds.has(ownerId)
      })
      .map((entry) => String(entry.id ?? participantKey(entry)))

    const consumedItemIds: number[] = []
    const events = []
    for (const item of equippedItems.filter((candidate) => triggeredOwnerIds.has(candidate.userId))) {
      await tx.dragonItem.update({
        where: { id: item.id },
        data: {
          status: 'CONSUMED',
          consumedAt: new Date(),
        },
      })
      consumedItemIds.push(item.id)

      const eventPayload = {
        type: 'dragonScaleProtected',
        userId: item.userId,
        itemId: item.id,
        participantIds: protectedParticipantIds,
      }
      events.push(eventPayload)

      await tx.dragonItemEvent.create({
        data: {
          itemId: item.id,
          userId: item.userId,
          raceId,
          type: 'PROTECTED',
          message: `${DRAGON_ITEM_LABEL} đã che chắn toàn bộ đàn vịt.`,
          payloadJson: JSON.stringify(eventPayload),
        },
      })
      await tx.dragonItemEvent.create({
        data: {
          itemId: item.id,
          userId: item.userId,
          raceId,
          type: 'CONSUMED',
          message: 'Long Lân đã tan thành ánh sáng sau khi cứu chủ nhân.',
        },
      })
      await tx.commentaryLog.create({
        data: {
          raceId,
          timestamp: 38 + consumedItemIds.length,
          content: 'Long Lân Hộ Mệnh đã phủ lên cả đàn vịt. Clone cũng là con, Long Lân bảo kê hết.',
        },
      })
    }

    for (const item of equippedItems.filter((candidate) => !triggeredOwnerIds.has(candidate.userId))) {
      await tx.dragonItem.update({
        where: { id: item.id },
        data: {
          status: 'ACTIVE',
          equippedForRaceId: null,
          equippedAt: null,
        },
      })
      await tx.dragonItemEvent.create({
        data: {
          itemId: item.id,
          userId: item.userId,
          raceId,
          type: 'NOT_NEEDED',
          message: 'Long Lân chưa cần hộ mệnh, item vẫn còn nguyên.',
        },
      })
    }

    return {
      protectionApplied: consumedItemIds.length > 0,
      protectedUserIds: Array.from(triggeredOwnerIds),
      protectedParticipantIds,
      consumedItemIds,
      events,
      finalVictims: remainingVictims,
      finalVerdict: buildPenaltyVerdict(remainingVictims),
    }
  })
}
