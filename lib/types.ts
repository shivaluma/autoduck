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
  dragonItems?: DragonItemData[]
}

export interface RaceSetupPlayer {
  userId: number
  name: string
  useShield: boolean
  availableShields?: number
  shieldId?: number
  isImmortal?: boolean
  dragonScaleItemId?: number
  dragonEligible?: boolean
}

export interface ShieldData {
  id: number
  ownerId: number
  charges: number
  status: string
  earnedRaceId?: number | null
  earnedAt?: string | null
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

export interface DragonItemData {
  id: number
  userId: number
  type: string
  status: string
  label: string
  subtitle: string
  equippedForRaceId?: number | null
  grantedAt?: string | null
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
  dragonEvents?: string[]
}

export interface RaceStatus {
  id: number
  status: 'pending' | 'running' | 'finished' | 'failed'
  videoUrl: string | null
  finalVerdict: string | null
  engine?: {
    state: string
    protocolVersion: string | null
    engineVersion: string | null
    balanceVersion: string | null
    trackVersion: string | null
    seedCommit: string | null
    seed: string | null
    config: import('@/packages/race-protocol/src').RaceConfig | null
    players: import('@/packages/race-protocol/src').RacePlayerConfig[]
    chaosConfig: import('@/packages/race-protocol/src').RaceChaosConfig | null
    resultDigest: string | null
    events: import('@/packages/race-protocol/src').RaceEvent[]
    loadouts: import('@/packages/race-protocol/src').RaceLoadout[]
    liveTick?: number | null
    liveManualInputs?: import('@/packages/race-protocol/src').RecordedWildItemInput[]
  } | null
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
  dragonAward?: {
    awarded: boolean
    reason?: string
    winnerUserId?: number
    awardedStar?: number
    awardedOrbName?: string
    awardedOrbs?: Array<{
      id: number
      star: number
      orbName: string
      source: string
      kind: 'FEATURED' | 'BONUS'
      duplicateCountForStar?: number
    }>
    dragonWeekId?: number
    duplicateCountForStar?: number
    setProgressAfter?: number
    summonReady?: boolean
    orbId?: number
    winnerName?: string | null
  } | null
  dragonScaleEvents?: Array<{
    type: string
    userId: number
    userName?: string | null
    itemId: number
    participantIds: string[]
    message?: string | null
  }>
  participants: {
    userId: number
    name: string
    displayName?: string | null
    avatarUrl?: string | null
    usedShield: boolean
    shieldId?: number | null
    shieldChargesAtStart?: number | null
    shieldBackfired?: boolean | null
    initialRank: number | null
    gotScar: boolean
    isImmortal?: boolean
    isGhost?: boolean
    isClone?: boolean
    cloneOfUserId?: number | null
    cloneIndex?: number | null
    chestEffect?: string | null
    chestTargetUserId?: number | null
    dragonEligible?: boolean | null
  }[]
  commentaries: {
    timestamp: number
    content: string
  }[]
  seasonPrediction?: {
    predictorName: string
    targetUserId: number
    targetName: string
    targetAvatarUrl?: string | null
    pointsAwarded?: number
  } | null
  seasonPredictions?: {
    predictorName: string
    targetUserId: number
    targetName: string
    targetAvatarUrl?: string | null
    pointsAwarded: number
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
