// Shared types for the AutoDuck project

export interface PlayerData {
  id: number
  name: string
  avatarUrl?: string | null
  isImmortal?: boolean
  scars: number
  shields: number
  shieldsUsed: number
  totalKhaos: number
  cleanStreak: number
  isBoss: boolean
  bossSince?: string | null
  activeShields: ShieldData[]
  activeChest?: MysteryChestData | null
}

export interface RaceSetupPlayer {
  userId: number
  name: string
  useShield: boolean
  availableShields: number
  shieldId?: number
  isImmortal?: boolean
}

export interface ShieldData {
  id: number
  ownerId: number
  charges: number
  status: string
  loanedToId?: number | null
}

export type ChestEffect =
  | 'BONUS_SCAR'
  | 'FRAGILE_SHIELD'
  | 'CLONE_CHAOS'
  | 'SAFE_WEEK'
  | 'REVERSE_RESULTS'
  | 'LAST_LAUGH'
  | 'LUCKY_CLONE'
  | 'ANTI_SHIELD'
  | 'CANT_PASS_THOMAS'
  | 'GOLDEN_SHIELD'
  | 'MORE_PEOPLE_MORE_FUN'
  | 'NOTHING'
  | 'CURSE_SWAP'
  | 'INSURANCE_FRAUD'
  | 'IDENTITY_THEFT'
  | 'PUBLIC_SHIELD'
  | 'I_CHOOSE_YOU'

export interface MysteryChestData {
  id: number
  ownerId: number
  earnedFromRaceId: number
  status: string
  effect: ChestEffect
  rngSeed: string
  targetUserId?: number | null
  createdAt: string
}

export interface RaceMetaContext {
  boss?: {
    name: string
    cloneCount: number
  } | null
  underdogs?: Array<{
    name: string
    chest: ChestEffect
    target?: string | null
  }>
  shieldsAtRisk?: Array<{
    owner: string
    charges: number
  }>
  curseSwaps?: Array<{
    owner: string
    displayName: string
  }>
}

export interface RaceStatus {
  id: number
  status: 'pending' | 'running' | 'finished' | 'failed'
  videoUrl: string | null
  finalVerdict: string | null
  consumedChests?: {
    id: number
    ownerId: number
    ownerName: string
    effect: ChestEffect
    targetUserId?: number | null
    targetName?: string | null
    outcome: 'success' | 'fizzled'
  }[]
  awardedChests?: {
    id: number
    ownerId: number
    ownerName: string
    effect: ChestEffect
    status: string
  }[]
  participants: {
    userId: number
    name: string
    displayName?: string | null
    avatarUrl?: string | null
    usedShield: boolean
    initialRank: number | null
    gotScar: boolean
    isImmortal?: boolean
    isClone?: boolean
    cloneOfUserId?: number | null
    cloneIndex?: number | null
    chestEffect?: string | null
    chestTargetUserId?: number | null
  }[]
  commentaries: {
    timestamp: number
    content: string
  }[]
}

export interface RaceRecap {
  id: number
  videoUrl: string | null
  finalVerdict: string
  finishedAt: string
  participants: {
    name: string
    initialRank: number
    usedShield: boolean
    gotScar: boolean
  }[]
  commentaries: {
    timestamp: number
    content: string
  }[]
}
