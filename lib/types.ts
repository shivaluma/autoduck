// Shared types for the AutoDuck project

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
  // Legacy v2 keys, always empty since legacy v2 was removed.
  consumedChests?: []
  awardedChests?: []
  dragonAward?: null
  dragonScaleEvents?: []
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
