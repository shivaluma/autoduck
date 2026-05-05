import type { RaceSetupPlayer } from '@/lib/types'
import { isImmortalDuck } from '@/lib/immortal-duck'

export const BOSS_STREAK_THRESHOLD = 4
export const BOSS_MAX_EXTRA_ENTRIES = 3

export interface BossSpawnPlan {
  ownerUserId: number
  cloneCount: number
}

interface BossStatusArgs {
  name?: string
  shields?: number | null
  userId: number
  gotScarThisRace: boolean
  currentCleanStreak: number
  currentIsBoss: boolean
}

interface RaceSetupPlayerWithBoss extends RaceSetupPlayer {
  isClone?: boolean
  cloneOfUserId?: number
  cloneIndex?: number
  displayName?: string
}

export function getBossExtraEntries(streak?: number | null) {
  const bossLevel = streak ?? 0
  if (bossLevel < BOSS_STREAK_THRESHOLD) {
    return 0
  }

  return Math.min(bossLevel - 1, BOSS_MAX_EXTRA_ENTRIES)
}

export function getBossTotalEntries(streak?: number | null) {
  return 1 + getBossExtraEntries(streak)
}

export function evaluateBossStatus(args: BossStatusArgs): { newCleanStreak: number; newIsBoss: boolean } {
  if (isImmortalDuck({ name: args.name ?? '', shields: args.shields })) {
    return {
      newCleanStreak: 0,
      newIsBoss: false,
    }
  }

  if (args.gotScarThisRace) {
    return {
      newCleanStreak: 0,
      newIsBoss: false,
    }
  }

  const newCleanStreak = args.currentCleanStreak + 1
  return {
    newCleanStreak,
    newIsBoss: newCleanStreak >= BOSS_STREAK_THRESHOLD,
  }
}

export function expandBossParticipants(
  participants: RaceSetupPlayer[],
  users: Array<{ id: number; name?: string; shields?: number | null; isBoss: boolean; cleanStreak?: number | null }>
): RaceSetupPlayerWithBoss[] {
  const expanded: RaceSetupPlayerWithBoss[] = []

  for (const participant of participants) {
    expanded.push(participant)

    const user = users.find((candidate) => candidate.id === participant.userId)
    if (!user?.isBoss || isImmortalDuck({ name: user.name ?? '', shields: user.shields })) {
      continue
    }

    const cloneCount = getBossExtraEntries(user.cleanStreak)
    for (let cloneIndex = 1; cloneIndex <= cloneCount; cloneIndex += 1) {
      expanded.push({
        ...participant,
        useShield: false,
        shieldId: undefined,
        isClone: true,
        cloneOfUserId: participant.userId,
        cloneIndex,
        displayName: `${participant.name} Clone ${cloneIndex}`,
      })
    }
  }

  return expanded
}

export function resolveBossOutcome(args: {
  bossUserId: number
  raceVictims: { userId: number; isClone: boolean; cloneIndex?: number | null; cloneOfUserId?: number | null }[]
}): { bossLost: boolean } {
  const bossLost = args.raceVictims.some((victim) => {
    if (victim.userId === args.bossUserId) {
      return true
    }

    return victim.isClone && victim.cloneOfUserId === args.bossUserId
  })

  return { bossLost }
}
