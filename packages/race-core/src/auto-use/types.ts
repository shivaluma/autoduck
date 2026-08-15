import type { RaceItemId, WildItemId } from '../../../race-protocol/src'
import type { ChaosRuleId } from '../chaos'

export type AutoUseReason =
  | 'REACTIVE_DEFENSE'
  | 'OPPORTUNITY'
  | 'INVENTORY_PRESSURE'
  | 'LATE_RACE'
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
  offensiveTargetPenalty: (sourceId: string, targetId: string) => number
}
