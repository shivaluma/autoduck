import { randomUUID } from 'crypto'
import type { ChestEffect } from '@/lib/types'
import { createShield, craftShieldIfEligible } from '@/lib/shield-decay'

export type ChestRarity = 'common' | 'rare'

export const COMMON_CHEST_TABLE: Array<{ effect: ChestEffect; weight: number }> = [
  { effect: 'BONUS_SCAR', weight: 28 },
  { effect: 'FRAGILE_SHIELD', weight: 24 },
  { effect: 'CLONE_CHAOS', weight: 18 },
  { effect: 'SAFE_WEEK', weight: 15 },
  { effect: 'REVERSE_RESULTS', weight: 15 },
]

export const RARE_CHEST_TABLE: Array<{ effect: ChestEffect; weight: number }> = [
  { effect: 'LAST_LAUGH', weight: 28 },
  { effect: 'ANTI_SHIELD', weight: 22 },
  { effect: 'CANT_PASS_THOMAS', weight: 18 },
  { effect: 'GOLDEN_SHIELD', weight: 17 },
  { effect: 'MORE_PEOPLE_MORE_FUN', weight: 15 },
]

const INVENTORY_EFFECTS = new Set<ChestEffect>([
  'BONUS_SCAR',
  'FRAGILE_SHIELD',
  'GOLDEN_SHIELD',
])

const LEGACY_EFFECTS = new Set<ChestEffect>([
  'LUCKY_CLONE',
  'NOTHING',
  'CURSE_SWAP',
  'INSURANCE_FRAUD',
  'IDENTITY_THEFT',
  'PUBLIC_SHIELD',
  'I_CHOOSE_YOU',
])

const MUTUALLY_EXCLUSIVE_RARE_EFFECTS: Array<Set<ChestEffect>> = [
  new Set(['CANT_PASS_THOMAS', 'MORE_PEOPLE_MORE_FUN']),
]

export const EFFECTS_REQUIRING_TARGET = new Set<ChestEffect>()
export const CHEST_TABLE = COMMON_CHEST_TABLE

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
  isImmortal?: boolean
  name?: string
  cloneIndex?: number | null
}

type PenaltyVictim = {
  name?: string
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
  rngSeed?: string
}

export type ItemRaceModifiers = {
  cloneChaos: boolean
  safeWeek: boolean
  reverseResults: boolean
  antiShield: boolean
  cantPassThomas: boolean
  morePeopleMoreFun: number | null
  lastLaughOwnerIds: number[]
}

export type BossRewardInput = {
  ownerId: number
  bossStreak: number
}

function hashSeed(seed: string) {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 4294967295
}

function rollWeighted<T extends string>(table: Array<{ effect: T; weight: number }>, seed: string): T {
  const totalWeight = table.reduce((sum, entry) => sum + entry.weight, 0)
  const roll = hashSeed(seed) * totalWeight
  let cursor = 0

  for (const entry of table) {
    cursor += entry.weight
    if (roll < cursor) {
      return entry.effect
    }
  }

  return table[table.length - 1].effect
}

function rareRateForBossStreak(streak: number) {
  if (streak >= 7) return 70
  if (streak >= 6) return 60
  if (streak >= 5) return 50
  if (streak >= 4) return 40
  return 30
}

function rollRarity(streak: number, seed: string): ChestRarity {
  return hashSeed(seed) * 100 < rareRateForBossStreak(streak) ? 'rare' : 'common'
}

export function getChestRarity(effect: ChestEffect): ChestRarity | 'legacy' {
  if (COMMON_CHEST_TABLE.some((entry) => entry.effect === effect)) {
    return 'common'
  }
  if (RARE_CHEST_TABLE.some((entry) => entry.effect === effect)) {
    return 'rare'
  }
  return 'legacy'
}

export function isInventoryChestEffect(effect: ChestEffect) {
  return INVENTORY_EFFECTS.has(effect)
}

export function isLegacyChestEffect(effect: ChestEffect) {
  return LEGACY_EFFECTS.has(effect)
}

function expandExcludedRareEffects(excludedRareEffects: Set<ChestEffect>) {
  const expanded = new Set(excludedRareEffects)
  for (const group of MUTUALLY_EXCLUSIVE_RARE_EFFECTS) {
    if ([...group].some((effect) => excludedRareEffects.has(effect))) {
      for (const effect of group) {
        expanded.add(effect)
      }
    }
  }
  return expanded
}

export function rollChest(
  seed: string = randomUUID(),
  options: { bossStreak?: number; excludedRareEffects?: Set<ChestEffect> } = {}
): { effect: ChestEffect; seed: string; rarity: ChestRarity } {
  const bossStreak = options.bossStreak ?? 3
  const rarity = rollRarity(bossStreak, `${seed}:rarity`)

  if (rarity === 'rare') {
    const excludedRareEffects = expandExcludedRareEffects(options.excludedRareEffects ?? new Set<ChestEffect>())
    const availableRareTable = RARE_CHEST_TABLE.filter((entry) => !excludedRareEffects.has(entry.effect))
    if (availableRareTable.length > 0) {
      return {
        effect: rollWeighted(availableRareTable, `${seed}:rare`),
        seed,
        rarity,
      }
    }
  }

  return {
    effect: rollWeighted(COMMON_CHEST_TABLE, `${seed}:common`),
    seed,
    rarity: 'common',
  }
}

// Kept for old call sites/tests. New V2 rewards are issued by issueBossRewardChests.
export async function issueChestsForVictims(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  raceId: number,
  victims: { userId: number }[],
  options: { forceVoid?: boolean } = {}
) {
  const dedupedVictims = Array.from(new Set(victims.map((victim) => victim.userId)))
  const created = []

  for (const ownerId of dedupedVictims) {
    const rolled = rollChest(randomUUID(), { bossStreak: 3 })
    created.push(
      await prisma.mysteryChest.create({
        data: {
          ownerId,
          earnedFromRaceId: raceId,
          effect: rolled.effect,
          rngSeed: `${rolled.seed}|${rolled.rarity}`,
          status: options.forceVoid ? 'void' : isInventoryChestEffect(rolled.effect) ? 'consumed' : 'active',
          consumedRaceId: options.forceVoid || isInventoryChestEffect(rolled.effect) ? raceId : null,
          consumedAt: options.forceVoid || isInventoryChestEffect(rolled.effect) ? new Date() : null,
        },
      })
    )
  }

  return created
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function issueBossRewardChests(prisma: any, raceId: number, rewards: BossRewardInput[], options: { forceVoid?: boolean } = {}) {
  const dedupedRewards = Array.from(
    new Map(rewards.map((reward) => [reward.ownerId, reward])).values()
  )
  const created = []
  const rareRolledThisRace = new Set<ChestEffect>()
  const now = new Date()

  for (const reward of dedupedRewards) {
    const rolled = rollChest(randomUUID(), {
      bossStreak: reward.bossStreak,
      excludedRareEffects: rareRolledThisRace,
    })
    if (rolled.rarity === 'rare') {
      rareRolledThisRace.add(rolled.effect)
    }

    const forceVoid = options.forceVoid === true
    const inventoryEffect = isInventoryChestEffect(rolled.effect)
    const chest = await prisma.mysteryChest.create({
      data: {
        ownerId: reward.ownerId,
        earnedFromRaceId: raceId,
        effect: rolled.effect,
        rngSeed: `${rolled.seed}|${rolled.rarity}|bossStreak:${reward.bossStreak}`,
        status: forceVoid ? 'void' : inventoryEffect ? 'consumed' : 'active',
        consumedRaceId: forceVoid || inventoryEffect ? raceId : null,
        consumedAt: forceVoid || inventoryEffect ? now : null,
      },
    })
    created.push(chest)

    if (forceVoid) {
      continue
    }

    if (rolled.effect === 'BONUS_SCAR') {
      await prisma.user.update({
        where: { id: reward.ownerId },
        data: { scars: { increment: 1 } },
      })
      await craftShieldIfEligible(prisma, reward.ownerId, raceId)
    }

    if (rolled.effect === 'FRAGILE_SHIELD') {
      await createShield(prisma, reward.ownerId, raceId, 1)
    }

    if (rolled.effect === 'GOLDEN_SHIELD') {
      await createShield(prisma, reward.ownerId, raceId, 3)
    }
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
  void participants
  void chestConfigs

  const errors = chests
    .filter((chest) => isLegacyChestEffect(chest.effect))
    .map((chest) => `Rương #${chest.id} là effect cũ (${chest.effect}), hãy void/reroll trước khi chạy race.`)

  return {
    ok: errors.length === 0,
    errors,
  }
}

function summarizeItemModifiers(activeChests: ActiveChestRecord[]): ItemRaceModifiers {
  const effects = new Set(activeChests.map((chest) => chest.effect))
  const morePeopleChest = activeChests.find((chest) => chest.effect === 'MORE_PEOPLE_MORE_FUN')
  const morePeopleRoll = morePeopleChest
    ? hashSeed(`${morePeopleChest.rngSeed ?? morePeopleChest.id}:more-people`) < 0.5 ? 3 : 4
    : null

  return {
    cloneChaos: effects.has('CLONE_CHAOS'),
    safeWeek: effects.has('SAFE_WEEK'),
    reverseResults: effects.has('REVERSE_RESULTS'),
    antiShield: effects.has('ANTI_SHIELD'),
    cantPassThomas: effects.has('CANT_PASS_THOMAS'),
    morePeopleMoreFun: morePeopleRoll,
    lastLaughOwnerIds: activeChests
      .filter((chest) => chest.effect === 'LAST_LAUGH')
      .map((chest) => chest.ownerId),
  }
}

export async function applyChestPreRace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _prisma: any,
  participants: ParticipantSetup[],
  activeChests: ActiveChestRecord[]
) {
  const modifiers = summarizeItemModifiers(activeChests)
  const updatedParticipants = participants.map((participant) => ({
    ...participant,
    useShield: modifiers.antiShield && !participant.isImmortal ? false : participant.useShield,
    shieldId: modifiers.antiShield && !participant.isImmortal ? undefined : participant.shieldId,
    chestEffect: activeChests.find((chest) => chest.ownerId === participant.userId && !participant.isClone)?.effect ?? participant.chestEffect ?? null,
  }))

  const cloneIndexByOwner = new Map<number, number>()
  const nextCloneIndex = (ownerId: number, base: number) => {
    const next = (cloneIndexByOwner.get(ownerId) ?? base) + 1
    cloneIndexByOwner.set(ownerId, next)
    return next
  }

  const originals = updatedParticipants.filter((participant) => !participant.isClone)
  if (modifiers.cloneChaos) {
    for (const owner of originals) {
      updatedParticipants.push({
        ...owner,
        useShield: false,
        shieldId: undefined,
        isClone: true,
        cloneOfUserId: owner.userId,
        cloneIndex: nextCloneIndex(owner.userId, 200),
        displayName: `${owner.name} Chaos`,
        chestEffect: 'CLONE_CHAOS',
      })
    }
  }

  return {
    participants: updatedParticipants,
    borrowedShieldIds: [] as number[],
    modifiers,
  }
}

export async function resolveChestPostRace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _prisma: any,
  _raceId: number,
  ranking: RankingEntry[],
  victims: PenaltyVictim[],
  activeChests: ActiveChestRecord[],
  options: { forceVoid?: boolean } = {}
) {
  void options
  const modifiedVictims = [...victims]
  const victimOwnerIds = new Set(victims.map((victim) => victim.cloneOfUserId ?? victim.userId))
  const lastLaughOwnerIds = activeChests
    .filter((chest) => chest.effect === 'LAST_LAUGH' && victimOwnerIds.has(chest.ownerId))
    .map((chest) => chest.ownerId)

  if (lastLaughOwnerIds.length > 0) {
    const rankedFromBottom = [...ranking].sort((left, right) => right.rank - left.rank)
    for (const ownerId of lastLaughOwnerIds) {
      const dragged = rankedFromBottom.find((entry) => {
        const effectiveOwnerId = entry.cloneOfUserId ?? entry.userId
        return effectiveOwnerId !== ownerId && !victimOwnerIds.has(effectiveOwnerId) && !entry.isImmortal
      })

      if (!dragged) {
        continue
      }

      modifiedVictims.push({
        name: dragged.name,
        userId: dragged.userId,
        initialRank: dragged.rank,
        isClone: dragged.isClone,
        cloneOfUserId: dragged.cloneOfUserId ?? undefined,
      })
      victimOwnerIds.add(dragged.cloneOfUserId ?? dragged.userId)
    }
  }

  return {
    modifiedVictims,
    shieldsToGrant: [],
    outcomes: activeChests.map((chest) => ({
      chestId: chest.id,
      ownerId: chest.ownerId,
      effect: chest.effect,
      targetUserId: null,
      outcome: 'success' as const,
    })),
    newChestsForThisRace: [],
  }
}
