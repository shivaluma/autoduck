import type { RaceSetupPlayer } from '@/lib/types'

export interface BossSpawnPlan {
  ownerUserId: number
  cloneCount: 3
}

interface BossStatusArgs {
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

export function evaluateBossStatus(args: BossStatusArgs): { newCleanStreak: number; newIsBoss: boolean } {
  if (args.gotScarThisRace) {
    return {
      newCleanStreak: 0,
      newIsBoss: false,
    }
  }

  const newCleanStreak = args.currentCleanStreak + 1
  return {
    newCleanStreak,
    newIsBoss: newCleanStreak >= 3 || args.currentIsBoss,
  }
}

export function expandBossParticipants(
  participants: RaceSetupPlayer[],
  users: Array<{ id: number; isBoss: boolean }>
): RaceSetupPlayerWithBoss[] {
  const expanded: RaceSetupPlayerWithBoss[] = []

  for (const participant of participants) {
    expanded.push(participant)

    const user = users.find((candidate) => candidate.id === participant.userId)
    if (!user?.isBoss) {
      continue
    }

    for (let cloneIndex = 1; cloneIndex <= 3; cloneIndex += 1) {
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
