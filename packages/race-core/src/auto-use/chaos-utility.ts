import type { RaceConfig } from '../../../race-protocol/src'
import { resolveChaosRule, type ChaosPreparedState, type ChaosRuleId } from '../chaos'

/**
 * Chaos-aware utility. Instead of hand-coding tactics per Chaos card, the AI asks the real Chaos rule
 * "who loses if the ranking looks like this?" and compares the current ranking with the projected one.
 * BOUNTY_HUNT hunting/escaping, DUO/CONSTRUCTORS team play and CUT_LINE/TRIPLE fights all fall out of it.
 */

export interface RankedDuck {
  playerId: string
  progress: number
  currentRank: number
  finished: boolean
}

interface RankingSnapshot {
  fingerprint: number
  order: string[]
  progressById: Map<string, number>
  indexById: Map<string, number>
}

// Utility of one outcome: avoiding the loser set dominates; a better finishing slot is a tiebreaker.
const LOSS_WEIGHT = 1
const PLACE_WEIGHT = 0.15
// Gap (progress) at which a neighbouring swap is considered ~37% likely before the finish.
const SWAP_GAP_SCALE = 0.02

export class ChaosUtility {
  private readonly mode: ChaosRuleId
  private readonly prepared: ChaosPreparedState
  private snapshot: RankingSnapshot | null = null
  private readonly outcomeCache = new Map<string, { losers: Set<string>; finalIndex: Map<string, number> }>()

  constructor(config: RaceConfig) {
    this.mode = (config.chaosConfig?.type ?? 'NORMAL') as ChaosRuleId
    this.prepared = {
      targetPlayerId: config.chaosConfig?.targetPlayerId ?? null,
      groups: config.chaosConfig?.groups ?? [],
    }
  }

  /** Current ranking, memoised on a cheap fingerprint of every duck's progress. */
  private observe(ducks: readonly RankedDuck[]): RankingSnapshot {
    let fingerprint = ducks.length
    for (let index = 0; index < ducks.length; index++) fingerprint += ducks[index]!.progress * (index + 1.618) + (ducks[index]!.finished ? 7 : 0)
    if (this.snapshot && this.snapshot.fingerprint === fingerprint) return this.snapshot
    const order = [...ducks]
      .sort((left, right) => left.currentRank - right.currentRank || right.progress - left.progress || left.playerId.localeCompare(right.playerId))
      .map((duck) => duck.playerId)
    this.snapshot = {
      fingerprint,
      order,
      progressById: new Map(ducks.map((duck) => [duck.playerId, duck.progress])),
      indexById: new Map(order.map((playerId, index) => [playerId, index])),
    }
    this.outcomeCache.clear()
    return this.snapshot
  }

  private outcome(order: readonly string[]) {
    const key = order.join('|')
    const cached = this.outcomeCache.get(key)
    if (cached) return cached
    let losers: Set<string>
    let finalOrder: readonly string[] = order
    if (this.mode === 'BOUNTY_HUNT' && !this.prepared.targetPlayerId) {
      losers = new Set(order.slice(-2))
    } else if ((this.mode === 'DUO' || this.mode === 'CONSTRUCTORS') && (this.prepared.groups?.length ?? 0) === 0) {
      losers = new Set(order.slice(-2))
    } else {
      try {
        const result = resolveChaosRule(this.mode, order.map((playerId, index) => ({ playerId, rank: index + 1 })), this.prepared)
        losers = new Set(result.loserPlayerIds)
        if (result.finalStandings) finalOrder = result.finalStandings
      } catch {
        losers = new Set(order.slice(-2))
      }
    }
    const value = { losers, finalIndex: new Map(finalOrder.map((playerId, index) => [playerId, index])) }
    if (this.outcomeCache.size > 512) this.outcomeCache.clear()
    this.outcomeCache.set(key, value)
    return value
  }

  private utility(order: readonly string[], playerId: string) {
    const { losers, finalIndex } = this.outcome(order)
    const n = Math.max(1, order.length - 1)
    const place = 1 - (finalIndex.get(playerId) ?? order.length - 1) / n
    return -(losers.has(playerId) ? LOSS_WEIGHT : 0) + PLACE_WEIGHT * place
  }

  /** Expected utility for `playerId`, softened over ±2 neighbour swaps weighted by how close those neighbours are. */
  private softUtility(order: string[], playerId: string, snapshot: RankingSnapshot) {
    const index = order.indexOf(playerId)
    if (index < 0) return 0
    const me = snapshot.progressById.get(playerId) ?? 0
    let total = this.utility(order, playerId)
    let weight = 1
    for (const direction of [-1, 1] as const) {
      let chain = 1
      for (let step = 1; step <= 2; step++) {
        const neighbourIndex = index + direction * step
        if (neighbourIndex < 0 || neighbourIndex >= order.length) break
        const gap = Math.abs((snapshot.progressById.get(order[neighbourIndex]!) ?? me) - me)
        chain *= Math.exp(-gap / SWAP_GAP_SCALE)
        if (chain < 0.02) break
        total += chain * this.utility(moved(order, index, neighbourIndex), playerId)
        weight += chain
      }
    }
    return total / weight
  }

  /** Probability-like loss risk in [0, 1] for `playerId` at the current ranking. */
  lossRisk(playerId: string, ducks: readonly RankedDuck[]) {
    const snapshot = this.observe(ducks)
    const order = snapshot.order
    const index = snapshot.indexById.get(playerId)
    if (index === undefined) return 0
    const me = snapshot.progressById.get(playerId) ?? 0
    let total = this.outcome(order).losers.has(playerId) ? 1 : 0
    let weight = 1
    for (const direction of [-1, 1] as const) {
      let chain = 1
      for (let step = 1; step <= 2; step++) {
        const neighbourIndex = index + direction * step
        if (neighbourIndex < 0 || neighbourIndex >= order.length) break
        const gap = Math.abs((snapshot.progressById.get(order[neighbourIndex]!) ?? me) - me)
        chain *= Math.exp(-gap / SWAP_GAP_SCALE)
        if (chain < 0.02) break
        total += chain * (this.outcome(moved(order, index, neighbourIndex)).losers.has(playerId) ? 1 : 0)
        weight += chain
      }
    }
    return total / weight
  }

  /** True when `playerId` is in the loser set of the current ranking (Chaos-accurate, team-aware). */
  isLosingNow(playerId: string, ducks: readonly RankedDuck[]) {
    const snapshot = this.observe(ducks)
    return this.outcome(snapshot.order).losers.has(playerId)
  }

  /**
   * Utility gain (≈ 0..100) for `playerId` if it climbs `selfGain` places and/or `targetId` drops `targetDrop`
   * places. Team modes count automatically because the Chaos rule decides the whole loser set.
   */
  actionValue(playerId: string, ducks: readonly RankedDuck[], selfGain: number, targetId?: string, targetDrop = 0) {
    const snapshot = this.observe(ducks)
    const before = this.softUtility(snapshot.order, playerId, snapshot)
    let order = snapshot.order
    if (targetId && targetDrop > 0) {
      const from = order.indexOf(targetId)
      if (from >= 0) order = moved(order, from, Math.min(order.length - 1, from + targetDrop))
    }
    if (selfGain > 0) {
      const from = order.indexOf(playerId)
      if (from >= 0) order = moved(order, from, Math.max(0, from - selfGain))
    }
    if (order === snapshot.order) return 0
    return (this.softUtility(order, playerId, snapshot) - before) * 100
  }

  get chaosMode() {
    return this.mode
  }

  get wantedPlayerId() {
    return this.mode === 'BOUNTY_HUNT' ? this.prepared.targetPlayerId ?? null : null
  }
}

function moved(order: readonly string[], from: number, to: number) {
  const next = [...order]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}
