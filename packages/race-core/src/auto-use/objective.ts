import type { RaceConfig } from '../../../race-protocol/src'
import type { ChaosRuleId } from '../chaos'
import type { RaceObjectiveContext } from './types'

function loserCutoffForMode(mode: ChaosRuleId, playerCount: number) {
  switch (mode) {
    case 'TRIPLE_ELIMINATION': return playerCount - 2
    case 'CUT_LINE': return Math.ceil(playerCount / 2)
    case 'BOUNTY_HUNT':
    case 'DUO':
    case 'CONSTRUCTORS':
    case 'REVERSE':
    case 'NORMAL':
    default:
      return playerCount - 1
  }
}

export function buildRaceObjectiveContext(config: RaceConfig): RaceObjectiveContext {
  const mode = (config.chaosConfig?.type ?? 'NORMAL') as ChaosRuleId
  const playerCount = config.players.length
  const groups = config.chaosConfig?.groups ?? []
  const teammateMap = new Map<string, Set<string>>()
  for (const group of groups) {
    for (const playerId of group) {
      teammateMap.set(playerId, new Set(group.filter((member) => member !== playerId)))
    }
  }

  return {
    mode,
    playerCount,
    loserCutoff: loserCutoffForMode(mode, playerCount),
    teammateIds: (playerId) => teammateMap.get(playerId) ?? new Set(),
    isTeammate: (left, right) => teammateMap.get(left)?.has(right) ?? false,
    isCurrentlyLosing(playerId, rank) {
      if (mode === 'REVERSE') return rank <= 2
      if (mode === 'CUT_LINE') return rank > Math.ceil(playerCount / 2)
      if (mode === 'TRIPLE_ELIMINATION') return rank >= playerCount - 2
      return rank >= playerCount - 1
    },
    dangerScore(_playerId, rank, progress, ducks) {
      const base = mode === 'REVERSE'
        ? Math.max(0, 100 - ((rank - 1) / Math.max(1, playerCount - 1)) * 100)
        : ((rank - 1) / Math.max(1, playerCount - 1)) * 100
      const duckAhead = ducks
        .filter((candidate) => !candidate.finished && candidate.currentRank < rank)
        .sort((left, right) => right.progress - left.progress)[0]
      const gapAhead = duckAhead ? Math.max(0, duckAhead.progress - progress) : 1
      const duckBehind = ducks
        .filter((candidate) => !candidate.finished && candidate.currentRank > rank)
        .sort((left, right) => left.progress - right.progress)[0]
      const gapBehind = duckBehind ? Math.max(0, progress - duckBehind.progress) : 1
      const squeeze = gapAhead < 0.008 && gapBehind < 0.008 ? 25 : gapAhead < 0.015 ? 12 : 0
      const late = progress > 0.75 ? 10 : 0
      return Math.min(100, base + squeeze + late)
    },
    opponentThreat(sourceId, targetId) {
      if (teammateMap.get(sourceId)?.has(targetId)) return 0
      return 1
    },
    positionImprovementValue(_playerId, fromRank, toRank) {
      if (mode === 'REVERSE') return Math.max(0, fromRank - toRank) * 12
      return Math.max(0, toRank - fromRank) * 12
    },
    offensiveTargetRankBonus(_sourceId, targetRank) {
      if (mode === 'REVERSE') {
        if (targetRank <= 2) return -30
        if (targetRank >= playerCount - 1) return 10
        return -10
      }
      if (targetRank <= 2) return 8
      if (targetRank >= playerCount - 1) return -8
      return 0
    },
    offensiveTargetPenalty(sourceId, targetId) {
      if (teammateMap.get(sourceId)?.has(targetId)) return Infinity
      return 0
    },
  }
}
