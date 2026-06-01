/* eslint-disable @typescript-eslint/no-explicit-any */
import { isImmortalDuck } from '@/lib/immortal-duck'

export const DEFAULT_DRAGON_SEASON_KEY = 'default'
export const DRAGON_ORB_LEGACY_RACE_SOURCE = 'RACE_WIN'
export const DRAGON_ORB_FEATURED_RACE_SOURCE = 'RACE_WIN_FEATURED'
export const DRAGON_ORB_BONUS_RACE_SOURCE = 'RACE_WIN_BONUS'
export const DRAGON_ORB_RACE_SOURCE = DRAGON_ORB_FEATURED_RACE_SOURCE
export const DRAGON_ORB_RACE_SOURCES = [
  DRAGON_ORB_LEGACY_RACE_SOURCE,
  DRAGON_ORB_FEATURED_RACE_SOURCE,
  DRAGON_ORB_BONUS_RACE_SOURCE,
]
export const DRAGON_ITEM_TYPE_SCALE = 'DRAGON_SCALE'

export type DragonOwnerParticipant = {
  userId: number
  isClone?: boolean | null
  cloneOfUserId?: number | null
}

export function getOwnerUserIdForRaceEntry(participant: DragonOwnerParticipant) {
  return participant.cloneOfUserId ?? participant.userId ?? null
}

export function isThomasUser(user?: { name?: string | null; shields?: number | null } | null) {
  if (!user) {
    return false
  }

  return isImmortalDuck({ name: user.name ?? '', shields: user.shields })
}

export function isUnlockedDragonOrb(orb: {
  status?: string | null
  lockedByTradeId?: number | null
  lockedBySummonId?: number | null
}) {
  return orb.status === 'ACTIVE' && !orb.lockedByTradeId && !orb.lockedBySummonId
}

export async function withDragonTransaction<T>(prisma: any, fn: (tx: any) => Promise<T>) {
  if (typeof prisma.$transaction === 'function') {
    return prisma.$transaction(fn)
  }

  return fn(prisma)
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
