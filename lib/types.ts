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
    config: import('@/src/engine/protocol').RaceConfig | null
    players: import('@/src/engine/protocol').RacePlayerConfig[]
    chaosConfig: import('@/src/engine/protocol').RaceChaosConfig | null
    resultDigest: string | null
    events: import('@/src/engine/protocol').RaceEvent[]
    loadouts: import('@/src/engine/protocol').RaceLoadout[]
    liveTick?: number | null
    liveManualInputs?: import('@/src/engine/protocol').RecordedWildItemInput[]
    /** How a finished race is replayed (plan §4.6). */
    replay?: import('@/src/race/types').RaceReplayInfo | null
    /** Frozen post-race stats (RaceReplayTrack.statsJson), when stored. */
    postRaceStats?: import('@/src/race/post-race-stats').PostRaceStats | null
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
