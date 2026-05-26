/* eslint-disable @typescript-eslint/no-explicit-any */
import { getOwnerUserIdForRaceEntry, isThomasUser } from './utils'

type DragonParticipant = {
  id?: number
  userId: number
  initialRank?: number | null
  isClone?: boolean | null
  cloneOfUserId?: number | null
  cloneIndex?: number | null
  dragonEligible?: boolean | null
  user?: {
    id: number
    name: string
    shields?: number | null
  } | null
}

export type EligibleDragonWinnerResult = {
  userId: number
  participantId?: number
  rank: number
} | null

export async function getEligibleDragonWinner(prisma: any, raceId: number): Promise<EligibleDragonWinnerResult> {
  const race = await prisma.race.findUnique({
    where: { id: raceId },
    include: {
      participants: {
        include: { user: true },
      },
    },
  })

  if (!race) {
    return null
  }

  const participants = (race.participants ?? []) as DragonParticipant[]
  const usersById = new Map<number, DragonParticipant['user']>()
  for (const participant of participants) {
    if (participant.user) {
      usersById.set(participant.user.id, participant.user)
      usersById.set(participant.userId, participant.user)
    }
  }

  const realNonThomasOwners = new Set<number>()
  for (const participant of participants) {
    const ownerId = getOwnerUserIdForRaceEntry(participant)
    if (typeof ownerId !== 'number') {
      continue
    }
    const owner = usersById.get(ownerId) ?? participant.user
    if (!isThomasUser(owner)) {
      realNonThomasOwners.add(ownerId)
    }
  }

  if (realNonThomasOwners.size < 2) {
    return null
  }

  const ranked = participants
    .filter((participant) => typeof participant.initialRank === 'number')
    .sort((left, right) => (left.initialRank ?? 9999) - (right.initialRank ?? 9999))

  for (const participant of ranked) {
    if (participant.dragonEligible === false) {
      continue
    }

    const ownerId = getOwnerUserIdForRaceEntry(participant)
    if (typeof ownerId !== 'number') {
      continue
    }

    const owner = usersById.get(ownerId) ?? participant.user
    if (isThomasUser(owner)) {
      continue
    }

    return {
      userId: ownerId,
      participantId: participant.id,
      rank: participant.initialRank as number,
    }
  }

  return null
}
