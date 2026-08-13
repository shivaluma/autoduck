export const CHAOS_RULE_IDS = ['NORMAL', 'REVERSE', 'DUO', 'TRIPLE_ELIMINATION', 'CUT_LINE', 'CONSTRUCTORS', 'BOUNTY_HUNT'] as const
export type ChaosRuleId = (typeof CHAOS_RULE_IDS)[number]

export interface ChaosPlayer {
  playerId: string
}

export interface RawChaosEntry {
  playerId: string
  rank: number
}

export interface ChaosPreparedState {
  targetPlayerId?: string | null
  groups?: string[][]
}

export interface ChaosResult {
  finalStandings?: string[]
  loserPlayerIds: string[]
  metadata: Record<string, unknown>
}

export interface ChaosRule {
  id: ChaosRuleId
  prepare(players: ChaosPlayer[], random: () => number): ChaosPreparedState
  resolve(rawResult: RawChaosEntry[], prepared: ChaosPreparedState): ChaosResult
}

function shuffle<T>(items: T[], random: () => number) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function ordered(rawResult: RawChaosEntry[]) {
  const ranking = [...rawResult].sort((left, right) => left.rank - right.rank || left.playerId.localeCompare(right.playerId))
  if (ranking.length < 2 || new Set(ranking.map((entry) => entry.playerId)).size !== ranking.length) throw new Error('Chaos requires a valid unique ranking')
  return ranking
}

function reasonMap(playerIds: string[], reason: string) {
  return Object.fromEntries(playerIds.map((playerId) => [playerId, reason]))
}

const normal: ChaosRule = {
  id: 'NORMAL',
  prepare: () => ({}),
  resolve(raw) {
    const ranking = ordered(raw)
    const losers = ranking.slice(-2).map((entry) => entry.playerId)
    return { loserPlayerIds: losers, metadata: { reasonByPlayer: reasonMap(losers, 'Raw Bottom 2') } }
  },
}

const reverse: ChaosRule = {
  id: 'REVERSE',
  prepare: () => ({}),
  resolve(raw) {
    const ranking = ordered(raw)
    const finalStandings = [...ranking].reverse().map((entry) => entry.playerId)
    const losers = finalStandings.slice(-2)
    return { finalStandings, loserPlayerIds: losers, metadata: { reasonByPlayer: reasonMap(losers, 'Reverse made raw Top 2 lose') } }
  },
}

const duo: ChaosRule = {
  id: 'DUO',
  prepare(players, random) {
    const shuffled = shuffle(players.map((player) => player.playerId), random)
    return { groups: Array.from({ length: Math.ceil(shuffled.length / 2) }, (_, index) => shuffled.slice(index * 2, index * 2 + 2)) }
  },
  resolve(raw, prepared) {
    const ranking = ordered(raw)
    const groups = prepared.groups ?? []
    if (groups.length === 0) throw new Error('Duo requires persisted pairs')
    const rankByPlayer = new Map(ranking.map((entry) => [entry.playerId, entry.rank]))
    const scored = groups.map((group, tieOrder) => {
      const ranks = group.map((playerId) => rankByPlayer.get(playerId)).filter((rank): rank is number => typeof rank === 'number')
      if (ranks.length !== group.length) throw new Error('Duo contains a player outside the ranking')
      return { group, total: ranks.reduce((sum, rank) => sum + rank, 0), worst: Math.max(...ranks), best: Math.min(...ranks), tieOrder }
    }).sort((left, right) => right.total - left.total || right.worst - left.worst || right.best - left.best || left.tieOrder - right.tieOrder)
    const losers = scored[0].group
    return { loserPlayerIds: losers, metadata: { scores: scored, reasonByPlayer: reasonMap(losers, 'Duo had the worst placement total') } }
  },
}

const triple: ChaosRule = {
  id: 'TRIPLE_ELIMINATION',
  prepare: () => ({}),
  resolve(raw) {
    const losers = ordered(raw).slice(-3).map((entry) => entry.playerId)
    return { loserPlayerIds: losers, metadata: { reasonByPlayer: reasonMap(losers, 'Raw Bottom 3') } }
  },
}

const cutLine: ChaosRule = {
  id: 'CUT_LINE',
  prepare: () => ({}),
  resolve(raw) {
    const ranking = ordered(raw)
    const losers = ranking.slice(Math.ceil(ranking.length / 2)).map((entry) => entry.playerId)
    return { loserPlayerIds: losers, metadata: { reasonByPlayer: reasonMap(losers, 'Finished below the Top 50% cut') } }
  },
}

const constructors: ChaosRule = {
  id: 'CONSTRUCTORS',
  prepare(players, random) {
    const shuffled = shuffle(players.map((player) => player.playerId), random)
    const split = Math.ceil(shuffled.length / 2)
    return { groups: [shuffled.slice(0, split), shuffled.slice(split)] }
  },
  resolve(raw, prepared) {
    const ranking = ordered(raw)
    const groups = prepared.groups ?? []
    if (groups.length !== 2) throw new Error('Constructors requires two persisted teams')
    const rankByPlayer = new Map(ranking.map((entry) => [entry.playerId, entry.rank]))
    const totals = groups.map((group) => group.reduce((sum, playerId) => {
      const rank = rankByPlayer.get(playerId)
      if (typeof rank !== 'number') throw new Error('Constructors contains a player outside the ranking')
      return sum + rank
    }, 0))
    const losingIndexes = totals[0] === totals[1] ? [0, 1] : [totals[0] > totals[1] ? 0 : 1]
    const losers = ranking.filter((entry) => losingIndexes.some((index) => groups[index].includes(entry.playerId))).map((entry) => entry.playerId)
    return { loserPlayerIds: losers, metadata: { totals, tie: totals[0] === totals[1], reasonByPlayer: reasonMap(losers, 'Constructors team had the worse placement total') } }
  },
}

const bounty: ChaosRule = {
  id: 'BOUNTY_HUNT',
  prepare(players, random) {
    const shuffled = shuffle(players.map((player) => player.playerId), random)
    return { targetPlayerId: shuffled[0] }
  },
  resolve(raw, prepared) {
    const ranking = ordered(raw)
    const wanted = ranking.find((entry) => entry.playerId === prepared.targetPlayerId)
    if (!wanted) throw new Error('Bounty Hunt requires a valid Wanted player')
    const cutoff = Math.ceil(ranking.length / 2)
    const escaped = wanted.rank <= cutoff
    const losers = escaped
      ? ranking.slice(-2).map((entry) => entry.playerId)
      : ranking.filter((entry) => entry.rank >= wanted.rank).map((entry) => entry.playerId)
    return {
      loserPlayerIds: losers,
      metadata: {
        wantedPlayerId: wanted.playerId,
        escaped,
        cutoff,
        reasonByPlayer: reasonMap(losers, escaped ? 'Wanted escaped; raw Bottom 2 lose' : 'Wanted failed; Wanted and everyone behind lose'),
      },
    }
  },
}

export const CHAOS_RULES: Record<ChaosRuleId, ChaosRule> = {
  NORMAL: normal,
  REVERSE: reverse,
  DUO: duo,
  TRIPLE_ELIMINATION: triple,
  CUT_LINE: cutLine,
  CONSTRUCTORS: constructors,
  BOUNTY_HUNT: bounty,
}

export function prepareChaosRule(id: ChaosRuleId, players: ChaosPlayer[], random: () => number) {
  return CHAOS_RULES[id].prepare(players, random)
}

export function resolveChaosRule(id: ChaosRuleId, rawResult: RawChaosEntry[], prepared: ChaosPreparedState) {
  return CHAOS_RULES[id].resolve(rawResult, prepared)
}
