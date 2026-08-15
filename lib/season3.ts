import {
  prepareChaosRule,
  resolveChaosRule,
  type ChaosRuleId,
} from '@/packages/race-core/src'
import { filterOfficialRacers } from '@/lib/ghost-duck'

export const SEASON3_KEY = 'S3'
export const SEASON3_WEEKS = 12

export const CHAOS_CARDS = [
  'NORMAL',
  'REVERSE',
  'DUO',
  'TRIPLE_ELIMINATION',
  'CUT_LINE',
  'CONSTRUCTORS',
  'BOUNTY_HUNT',
] as const

export type ChaosType = (typeof CHAOS_CARDS)[number]

export interface ChaosCard {
  type: ChaosType
  targetUserId: number | null
  targetUserId2: number | null
  groups?: number[][]
}

export interface Season3Player {
  userId: number
  name: string
}

export interface Season3RankingEntry extends Season3Player {
  rank: number
  hasShield: boolean
}

export interface ScarOutcome {
  userId: number
  name: string
  rank: number
  scarPoints: number
  protectedByShield: boolean
  shieldConsumed: boolean
  reason: string
}

export interface Season3Resolution {
  ranking: Season3RankingEntry[]
  bottomTwo: Season3RankingEntry[]
  scarOutcomes: ScarOutcome[]
  scarVictims: Season3RankingEntry[]
  protectedPlayers: Season3RankingEntry[]
  kingUserId: number | null
  kingStreak: number
  kingChanged: boolean
}

export interface PredictionOutcome {
  predictorUserId: number
  targetUserId: number
  targetName: string
  correct: boolean
  pointsAwarded: number
}

export interface PreviousKing {
  userId: number
  streak: number
}

const byRank = (left: Season3RankingEntry, right: Season3RankingEntry) => left.rank - right.rank

export function chaosLabel(type: ChaosType) {
  return {
    NORMAL: '🏁 NORMAL',
    REVERSE: '🔄 REVERSE',
    DUO: '🤝 DUO',
    TRIPLE_ELIMINATION: '💀 TRIPLE ELIMINATION',
    CUT_LINE: '🚧 CUT LINE',
    CONSTRUCTORS: '🏎️ CONSTRUCTORS',
    BOUNTY_HUNT: '🎯 BOUNTY HUNT',
  }[type]
}

export function prepareChaosCard(type: ChaosType, players: Season3Player[], random: () => number): ChaosCard {
  if (players.length === 0) {
    throw new Error('Cannot select a chaos card without players')
  }
  const officialPlayers = filterOfficialRacers(players)
  const prepared = prepareChaosRule(
    type as ChaosRuleId,
    officialPlayers.map((player) => ({ playerId: String(player.userId) })),
    random,
  )

  return {
    type,
    targetUserId: prepared.targetPlayerId ? Number(prepared.targetPlayerId) : null,
    targetUserId2: null,
    groups: prepared.groups?.map((group) => group.map(Number)),
  }
}

export function selectChaosCard(players: Season3Player[], random: () => number): ChaosCard {
  const type = CHAOS_CARDS[Math.min(CHAOS_CARDS.length - 1, Math.floor(random() * CHAOS_CARDS.length))]
  return prepareChaosCard(type, players, random)
}

function assertRanking(ranking: Season3RankingEntry[]) {
  if (ranking.length < 2) {
    throw new Error('A Season 3 race needs at least two players')
  }

  const ranks = new Set<number>()
  const users = new Set<number>()
  for (const entry of ranking) {
    if (!Number.isInteger(entry.rank) || entry.rank < 1 || entry.rank > ranking.length) {
      throw new Error('Ranking must contain consecutive ranks from 1 to N')
    }
    if (ranks.has(entry.rank) || users.has(entry.userId)) {
      throw new Error('Ranking cannot contain duplicate ranks or players')
    }
    ranks.add(entry.rank)
    users.add(entry.userId)
  }
}

export function resolveSeason3Race(
  inputRanking: Season3RankingEntry[],
  chaos: ChaosCard,
  previousKing: PreviousKing | null = null,
): Season3Resolution {
  assertRanking(inputRanking)
  const ranking = [...inputRanking].sort(byRank)
  const bottomTwo = ranking.slice(-2)
  const chaosResult = resolveChaosRule(
    chaos.type as ChaosRuleId,
    ranking.map((entry) => ({ playerId: String(entry.userId), rank: entry.rank })),
    {
      targetPlayerId: chaos.targetUserId === null ? null : String(chaos.targetUserId),
      groups: chaos.groups?.map((group) => group.map(String)),
    },
  )
  const affectedIds = new Set(chaosResult.loserPlayerIds.map(Number))
  const reasonByPlayer = chaosResult.metadata.reasonByPlayer
  const reasons = typeof reasonByPlayer === 'object' && reasonByPlayer !== null
    ? reasonByPlayer as Record<string, string>
    : {}
  const affected = ranking.filter((entry) => affectedIds.has(entry.userId))

  affected.sort(byRank)

  const scarOutcomes = affected.map((entry) => {
    const scarPoints = 1
    const protectedByShield = entry.hasShield
    return {
      userId: entry.userId,
      name: entry.name,
      rank: entry.rank,
      scarPoints,
      protectedByShield,
      shieldConsumed: protectedByShield,
      reason: protectedByShield ? 'Shield saved this duck' : reasons[String(entry.userId)] ?? `${chaosLabel(chaos.type)} làm dzịt`,
    }
  })

  const winner = ranking[0] ?? null
  const previousKingEntry = previousKing ? ranking.find((entry) => entry.userId === previousKing.userId) : null
  const keepsCrown = Boolean(previousKing && previousKingEntry && previousKingEntry.rank <= 3)
  const kingUserId = keepsCrown ? previousKing!.userId : winner?.userId ?? null
  const kingStreak = keepsCrown ? previousKing!.streak + 1 : kingUserId === winner?.userId ? 1 : 0

  return {
    ranking,
    bottomTwo,
    scarOutcomes,
    scarVictims: scarOutcomes.filter((outcome) => !outcome.protectedByShield).map((outcome) => ranking.find((entry) => entry.userId === outcome.userId)!),
    protectedPlayers: scarOutcomes.filter((outcome) => outcome.protectedByShield).map((outcome) => ranking.find((entry) => entry.userId === outcome.userId)!),
    kingUserId,
    kingStreak,
    kingChanged: previousKing?.userId !== kingUserId,
  }
}

export function applyScarEconomy(currentScars: number, currentShields: number, scarPoints: number, shieldConsumed: boolean) {
  let scars = currentScars + (shieldConsumed ? 0 : scarPoints)
  let shields = Math.max(0, currentShields - (shieldConsumed ? 1 : 0))
  while (scars >= 2) {
    scars -= 2
    shields += 1
  }
  return { scars, shields }
}

export function resolvePredictions(
  predictions: Array<{ predictorUserId: number; targetUserId: number }>,
  bottomTwo: Season3RankingEntry[],
): PredictionOutcome[] {
  return predictions.map((prediction) => {
    const target = bottomTwo.find((entry) => entry.userId === prediction.targetUserId)
    return {
      predictorUserId: prediction.predictorUserId,
      targetUserId: prediction.targetUserId,
      targetName: target?.name ?? `User ${prediction.targetUserId}`,
      correct: Boolean(target),
      pointsAwarded: target ? 1 : 0,
    }
  })
}

export function generateDuckNews(args: {
  weekNumber: number
  scarVictims: Array<{ name: string }>
  protectedPlayers: Array<{ name: string }>
  chaos: ChaosCard
  chaosTargetName?: string | null
  kingName?: string | null
  predictionWinners: Array<{ name: string }>
}) {
  const victims = args.scarVictims.length > 0 ? args.scarVictims.map((entry) => entry.name).join(' & ') : 'Nobody'
  const protectedText = args.protectedPlayers.length > 0
    ? ` ${args.protectedPlayers.map((entry) => `${entry.name} mất Shield để không bị làm dzịt.`).join(' ')}`
    : ''
  const predictionText = args.predictionWinners.length > 0
    ? ` ${args.predictionWinners.map((entry) => entry.name).join(' & ')} prediction chính xác!`
    : ''
  const kingText = args.kingName ? ` ${args.kingName} chiếm ngôi King of the Pond.` : ''
  const targetText = args.chaosTargetName ? ` — ${args.chaosTargetName}` : ''
  return [
    `📰 DUCK NEWS — WEEK ${args.weekNumber}`,
    `☠️ ${victims} got ducked.`,
    `${chaosLabel(args.chaos.type)}${targetText}.`,
    `${kingText}${protectedText}${predictionText}`.trim(),
  ].filter(Boolean).join('\n\n')
}

export const DEFAULT_SEASON3_REWARDS = [
  { key: 'sticker', name: '🏷️ Sticker / badge vịt', cost: 2, stock: null },
  { key: 'keychain', name: '🦆 Móc khóa vịt', cost: 4, stock: null },
  { key: 'mini_statue', name: '🗿 Tượng vịt mini', cost: 6, stock: null },
  { key: 'plush', name: '🧸 Gấu bông vịt', cost: 8, stock: null },
  { key: 'limited_duck', name: '🎁 Limited S3 Duck', cost: 10, stock: 10 },
] as const

export function selectChampion(players: Array<{ userId: number; championshipPoints: number; raceWins: number }>) {
  return [...players].sort((left, right) =>
    right.championshipPoints - left.championshipPoints || right.raceWins - left.raceWins || left.userId - right.userId,
  )[0]?.userId ?? null
}
