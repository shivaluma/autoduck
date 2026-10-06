import type { RaceItemId, WildItemId } from '../../../race-protocol/src'
import type { ChaosRuleId } from '../chaos'
import type { ChaosUtility } from './chaos-utility'
import type { AiIntent } from './brain'

export type AutoUseReason =
  | 'REACTIVE_DEFENSE'
  | 'OPPORTUNITY'
  | 'INVENTORY_PRESSURE'
  | 'LATE_RACE'
  | 'END_GAME_BURN'
  | 'OBJECTIVE'
  | 'DISCARD'

export interface AutoUseCandidate {
  playerId: string
  itemKey: string
  itemId: RaceItemId | WildItemId
  source: 'PREP' | 'WILD'
  action: 'USE' | 'DISCARD'
  score: number
  targetPlayerId?: string
  reason: AutoUseReason
  bypassThreshold?: boolean
  wildItemInstanceId?: string
  /** Why the brain wants this (shown as an AI_INTENT event when it fires). */
  intent?: AiIntent
  /** Banana: lane to toss the peel onto. */
  aimLateral?: number
  /** Quack Horn: side to blast. */
  hornSide?: -1 | 1
}

export type AutoUseCandidateDraft = Omit<AutoUseCandidate, 'playerId'>

export interface RaceObjectiveContext {
  mode: ChaosRuleId
  playerCount: number
  loserCutoff: number
  teammateIds: (playerId: string) => Set<string>
  isTeammate: (left: string, right: string) => boolean
  isCurrentlyLosing: (playerId: string, rank: number) => boolean
  dangerScore: (playerId: string, rank: number, progress: number, ducks: Array<{ playerId: string; progress: number; currentRank: number; finished: boolean }>) => number
  opponentThreat: (sourceId: string, targetId: string) => number
  positionImprovementValue: (playerId: string, fromRank: number, toRank: number) => number
  offensiveTargetRankBonus: (sourceId: string, targetRank: number) => number
  offensiveTargetPenalty: (sourceId: string, targetId: string) => number
  /** Chaos-accurate loss risk and action values (see chaos-utility.ts). */
  chaos: ChaosUtility
  /** Rank-cutoff view without team/bounty scoring, used by ablated brains (balance tooling). */
  naiveChaos: ChaosUtility
}
