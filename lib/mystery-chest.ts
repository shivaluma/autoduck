import { randomUUID } from 'crypto'
import type { ChestEffect } from '@/lib/types'

const CHEST_TABLE: Array<{ effect: ChestEffect; weight: number }> = [
  { effect: 'NOTHING', weight: 50 },
  { effect: 'CURSE_SWAP', weight: 10 },
  { effect: 'INSURANCE_FRAUD', weight: 10 },
  { effect: 'IDENTITY_THEFT', weight: 10 },
  { effect: 'PUBLIC_SHIELD', weight: 10 },
  { effect: 'I_CHOOSE_YOU', weight: 10 },
]

const EFFECTS_REQUIRING_TARGET = new Set<ChestEffect>([
  'CURSE_SWAP',
  'INSURANCE_FRAUD',
  'PUBLIC_SHIELD',
  'I_CHOOSE_YOU',
])

export { CHEST_TABLE, EFFECTS_REQUIRING_TARGET }

type ParticipantInput = {
  userId: number
  useShield: boolean
  shieldId?: number
  isImmortal?: boolean
}

type ParticipantSetup = ParticipantInput & {
  name: string
  isClone?: boolean
  cloneOfUserId?: number
  cloneIndex?: number
  displayName?: string
  chestEffect?: ChestEffect | null
  chestTargetUserId?: number | null
  borrowedShieldFromUserId?: number | null
}

type RankingEntry = {
  userId: number
  rank: number
  isClone: boolean
  cloneOfUserId?: number | null
}

type PenaltyVictim = {
  userId: number
  initialRank: number
  isClone?: boolean
  cloneOfUserId?: number | null
}

type ActiveChestRecord = {
  id: number
  ownerId: number
  effect: ChestEffect
  targetUserId?: number | null
}

function hashSeed(seed: string) {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

export function rollChest(seed = randomUUID()): { effect: ChestEffect; seed: string } {
  const totalWeight = CHEST_TABLE.reduce((sum, entry) => sum + entry.weight, 0)
  const roll = hashSeed(seed) * totalWeight
  let cursor = 0

  for (const entry of CHEST_TABLE) {
    cursor += entry.weight
    if (roll < cursor) {
      return { effect: entry.effect, seed }
    }
  }

  return { effect: 'NOTHING', seed }
}

export async function issueChestsForVictims(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  raceId: number,
  victims: { userId: number }[]
) {
  const dedupedVictims = Array.from(new Set(victims.map((victim) => victim.userId)))
  const created = []

  for (const ownerId of dedupedVictims) {
    const rolled = rollChest()
    created.push(
      await prisma.mysteryChest.create({
        data: {
          ownerId,
          earnedFromRaceId: raceId,
          effect: rolled.effect,
          rngSeed: rolled.seed,
          status: rolled.effect === 'NOTHING' ? 'void' : 'active',
        },
      })
    )
  }

  return created
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getActiveChestsForUsers(prisma: any, userIds: number[]) {
  if (userIds.length === 0) {
    return []
  }

  return prisma.mysteryChest.findMany({
    where: {
      ownerId: { in: userIds },
      status: 'active',
    },
    orderBy: [{ createdAt: 'asc' }],
  })
}

export function validateChestConfig(
  chests: Array<{ id: number; ownerId: number; effect: ChestEffect }>,
  participants: ParticipantInput[],
  chestConfigs: Array<{ chestId: number; targetUserId?: number }>
) {
  const errors: string[] = []
  const participantIds = new Set(participants.map((participant) => participant.userId))
  const configMap = new Map(chestConfigs.map((config) => [config.chestId, config]))

  for (const chest of chests) {
    const config = configMap.get(chest.id)
    if (!config) {
      errors.push(`Thiếu cấu hình cho rương #${chest.id}`)
      continue
    }

    if (!EFFECTS_REQUIRING_TARGET.has(chest.effect)) {
      continue
    }

    if (!config.targetUserId) {
      errors.push(`Rương #${chest.id} cần chọn mục tiêu`)
      continue
    }

    if (config.targetUserId === chest.ownerId) {
      errors.push(`Rương #${chest.id} không thể chọn chính chủ rương`)
      continue
    }

    if (!participantIds.has(config.targetUserId)) {
      errors.push(`Mục tiêu của rương #${chest.id} phải nằm trong danh sách tham gia`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  }
}

export async function applyChestPreRace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  participants: ParticipantSetup[],
  activeChests: ActiveChestRecord[]
) {
  const updatedParticipants = [...participants]
  const borrowedShieldIds: number[] = []

  for (const chest of activeChests) {
    const ownerIndex = updatedParticipants.findIndex((participant) => participant.userId === chest.ownerId && !participant.isClone)
    if (ownerIndex === -1) {
      continue
    }

    if (chest.effect === 'CURSE_SWAP' && chest.targetUserId) {
      const targetIndex = updatedParticipants.findIndex((participant) => participant.userId === chest.targetUserId && !participant.isClone)
      if (targetIndex !== -1) {
        const ownerName = updatedParticipants[ownerIndex].displayName ?? updatedParticipants[ownerIndex].name
        const targetName = updatedParticipants[targetIndex].displayName ?? updatedParticipants[targetIndex].name
        updatedParticipants[ownerIndex] = {
          ...updatedParticipants[ownerIndex],
          displayName: targetName,
          chestEffect: chest.effect,
          chestTargetUserId: chest.targetUserId,
        }
        updatedParticipants[targetIndex] = {
          ...updatedParticipants[targetIndex],
          displayName: ownerName,
        }
      }
    }

    if (chest.effect === 'IDENTITY_THEFT') {
      const owner = updatedParticipants[ownerIndex]
      updatedParticipants.push({
        ...owner,
        useShield: false,
        shieldId: undefined,
        isClone: true,
        cloneOfUserId: owner.userId,
        cloneIndex: 99,
        displayName: `${owner.name} Shadow`,
        chestEffect: chest.effect,
      })
    }

    if (chest.effect === 'PUBLIC_SHIELD' && chest.targetUserId) {
      const shield = await prisma.shield.findFirst({
        where: {
          ownerId: chest.targetUserId,
          status: 'active',
        },
        orderBy: [{ weeksUnused: 'desc' }, { earnedAt: 'asc' }],
      })

      if (!shield) {
        throw new Error(`Public Shield requires an active shield from user ${chest.targetUserId}`)
      }

      borrowedShieldIds.push(shield.id)
      updatedParticipants[ownerIndex] = {
        ...updatedParticipants[ownerIndex],
        useShield: true,
        borrowedShieldFromUserId: chest.targetUserId,
        chestEffect: chest.effect,
        chestTargetUserId: chest.targetUserId,
      }
    }

    if (chest.effect === 'INSURANCE_FRAUD' || chest.effect === 'I_CHOOSE_YOU') {
      updatedParticipants[ownerIndex] = {
        ...updatedParticipants[ownerIndex],
        chestEffect: chest.effect,
        chestTargetUserId: chest.targetUserId ?? null,
      }
    }
  }

  return {
    participants: updatedParticipants,
    borrowedShieldIds,
  }
}

export async function resolveChestPostRace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  raceId: number,
  ranking: RankingEntry[],
  victims: PenaltyVictim[],
  activeChests: ActiveChestRecord[]
) {
  const modifiedVictims = [...victims]
  const shieldsToGrant: Array<{ userId: number }> = []
  const outcomes: Array<{ chestId: number; ownerId: number; effect: ChestEffect; targetUserId?: number | null; outcome: 'success' | 'fizzled' }> = []

  const isVictim = (userId: number) =>
    modifiedVictims.some((victim) => victim.userId === userId || (victim.isClone && victim.cloneOfUserId === userId))

  for (const chest of activeChests) {
    if (chest.effect === 'INSURANCE_FRAUD' && chest.targetUserId) {
      if (isVictim(chest.ownerId) && !modifiedVictims.some((victim) => victim.userId === chest.targetUserId)) {
        modifiedVictims.push({
          userId: chest.targetUserId,
          initialRank: ranking.find((entry) => entry.userId === chest.targetUserId && !entry.isClone)?.rank ?? 999,
        })
        outcomes.push({ chestId: chest.id, ownerId: chest.ownerId, effect: chest.effect, targetUserId: chest.targetUserId, outcome: 'success' })
      } else {
        outcomes.push({ chestId: chest.id, ownerId: chest.ownerId, effect: chest.effect, targetUserId: chest.targetUserId, outcome: 'fizzled' })
      }
    }

    if (chest.effect === 'I_CHOOSE_YOU' && chest.targetUserId) {
      const targetRank = ranking.find((entry) => entry.userId === chest.targetUserId && !entry.isClone)?.rank
      if (targetRank === 1) {
        shieldsToGrant.push({ userId: chest.ownerId })
        outcomes.push({ chestId: chest.id, ownerId: chest.ownerId, effect: chest.effect, targetUserId: chest.targetUserId, outcome: 'success' })
      } else {
        outcomes.push({ chestId: chest.id, ownerId: chest.ownerId, effect: chest.effect, targetUserId: chest.targetUserId, outcome: 'fizzled' })
      }
    }

    if (chest.effect === 'CURSE_SWAP' || chest.effect === 'IDENTITY_THEFT' || chest.effect === 'PUBLIC_SHIELD') {
      outcomes.push({ chestId: chest.id, ownerId: chest.ownerId, effect: chest.effect, targetUserId: chest.targetUserId ?? null, outcome: 'success' })
    }
  }

  const newChestsForThisRace = await issueChestsForVictims(
    prisma,
    raceId,
    modifiedVictims.map((victim) => ({ userId: victim.userId }))
  )

  return {
    modifiedVictims,
    shieldsToGrant,
    outcomes,
    newChestsForThisRace,
  }
}
