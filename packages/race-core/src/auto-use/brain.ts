import type { RaceConfig, RaceItemId } from '../../../race-protocol/src'
import { createRaceRng } from '../rng'

/**
 * Duck Brain: a seeded temperament plus race memory (grudges, rival) and a visible intent.
 * Everything is derived from the race seed and simulation events, so it stays deterministic.
 */

export const TEMPERAMENTS = ['AGGRESSIVE', 'TACTICIAN', 'OPPORTUNIST', 'SHOWMAN'] as const
export type Temperament = (typeof TEMPERAMENTS)[number]

export interface TemperamentTraits {
  /** Lowers the bar for attacks and favours hitting the leader. */
  aggression: number
  /** Weight of the "hold for the planned window" opportunity cost. */
  patience: number
  /** Bonus for punishing boosting ducks, packs and fresh openings. */
  opportunism: number
  /** Lowers the bar late and in photo finishes. */
  clutch: number
  /** Weight of grudges when choosing targets. */
  vengeance: number
  /** Multiplier on the reaction delay. */
  reactionScale: number
  /** Progress from which each item may be used without an opportunity cost. */
  plannedWindow: Partial<Record<RaceItemId, number>>
}

export const TEMPERAMENT_TRAITS: Record<Temperament, TemperamentTraits> = {
  AGGRESSIVE: {
    aggression: 1, patience: 0.2, opportunism: 0.4, clutch: 0.3, vengeance: 1, reactionScale: 0.85,
    plannedWindow: { NITRO: 0.3, HOMING_ROCKET: 0.25, BANANA: 0.2, QUACK_HORN: 0.22, DRAFT_FIN: 0.2, PADDLE_BURST: 0.65 },
  },
  TACTICIAN: {
    aggression: 0.4, patience: 1, opportunism: 0.5, clutch: 0.5, vengeance: 0.3, reactionScale: 1,
    plannedWindow: { NITRO: 0.45, HOMING_ROCKET: 0.35, BANANA: 0.35, QUACK_HORN: 0.35, DRAFT_FIN: 0.4, PADDLE_BURST: 0.7 },
  },
  OPPORTUNIST: {
    aggression: 0.6, patience: 0.5, opportunism: 1, clutch: 0.4, vengeance: 0.5, reactionScale: 0.75,
    plannedWindow: { NITRO: 0.4, HOMING_ROCKET: 0.25, BANANA: 0.25, QUACK_HORN: 0.25, DRAFT_FIN: 0.25, PADDLE_BURST: 0.65 },
  },
  SHOWMAN: {
    aggression: 0.5, patience: 0.8, opportunism: 0.4, clutch: 1, vengeance: 0.6, reactionScale: 1.1,
    plannedWindow: { NITRO: 0.55, HOMING_ROCKET: 0.45, BANANA: 0.45, QUACK_HORN: 0.4, DRAFT_FIN: 0.55, PADDLE_BURST: 0.8 },
  },
}

export type AiIntent =
  | 'HOLDING'
  | 'HUNTING'
  | 'RETALIATING'
  | 'RIVALRY'
  | 'TEAM_PLAY'
  | 'BOUNTY'
  | 'DESPERATE'
  | 'CLUTCH'
  | 'BREAKAWAY'

export interface DuckBrain {
  playerId: string
  temperament: Temperament
  traits: TemperamentTraits
  /** attackerId → { weight, tick } (decays with a 10s half-life). */
  grudges: Map<string, { weight: number; tick: number }>
  /** neighbourId → decision samples spent within a short gap of each other. */
  neighbourSamples: Map<string, number>
  rivalId: string | null
  intent: AiIntent | null
  intentTargetId: string | null
  intentItemId: string | null
  lastIntentTick: number
  /** Set by evaluation when an otherwise-ready item was held back for its planned window. */
  heldItemId: RaceItemId | null
  /** Balance tooling only: play with neutral traits, no memory and rank-cutoff (Chaos-blind) objectives. */
  ablated?: boolean
}

const GRUDGE_HALF_LIFE_SECONDS = 10

export function createDuckBrains(config: RaceConfig): Map<string, DuckBrain> {
  return new Map(config.players.map((player) => {
    const rng = createRaceRng(config.seed, `temperament:${config.raceId}:${player.playerId}`)
    const temperament = TEMPERAMENTS[rng.integer(0, TEMPERAMENTS.length - 1)]!
    return [player.playerId, newBrain(player.playerId, temperament)]
  }))
}

export function newBrain(playerId: string, temperament: Temperament): DuckBrain {
  return {
    playerId,
    temperament,
    traits: TEMPERAMENT_TRAITS[temperament],
    grudges: new Map(),
    neighbourSamples: new Map(),
    rivalId: null,
    intent: null,
    intentTargetId: null,
    intentItemId: null,
    lastIntentTick: -Infinity,
    heldItemId: null,
  }
}

/** Neutral brain used when an evaluation runs without race brains (unit tests, tooling). */
export const NEUTRAL_TRAITS: TemperamentTraits = {
  aggression: 0.5, patience: 0, opportunism: 0.5, clutch: 0.5, vengeance: 0, reactionScale: 1, plannedWindow: {},
}

export function grudgeWeight(brain: DuckBrain | undefined, attackerId: string, tick: number, tickRate: number) {
  const grudge = brain?.grudges.get(attackerId)
  if (!grudge) return 0
  return grudge.weight * Math.pow(0.5, (tick - grudge.tick) / (GRUDGE_HALF_LIFE_SECONDS * tickRate))
}

const HOSTILE_EVENTS = new Set(['ROCKET_HIT', 'BANANA_HIT', 'MINI_ROCKET_HIT', 'WILD_BANANA_HIT', 'MOMENTUM_STOLEN', 'BOOST_BROKEN'])

/** Feeds simulation events into race memory: whoever hurt you becomes a grudge. */
export function noteBrainEvent(brains: Map<string, DuckBrain> | undefined, type: string, sourcePlayerId: string | undefined, targetPlayerId: string | undefined, tick: number, tickRate: number) {
  if (!brains || !sourcePlayerId || !targetPlayerId || sourcePlayerId === targetPlayerId) return
  let attackerId: string
  let victimId: string
  if (HOSTILE_EVENTS.has(type)) {
    // MOMENTUM_STOLEN / ROCKET_HIT etc. are emitted attacker → victim; BOOST_BROKEN victim → attacker.
    if (type === 'BOOST_BROKEN') { attackerId = targetPlayerId; victimId = sourcePlayerId } else { attackerId = sourcePlayerId; victimId = targetPlayerId }
  } else if (type === 'ITEM_SILENCED') {
    attackerId = targetPlayerId; victimId = sourcePlayerId
  } else {
    return
  }
  const brain = brains.get(victimId)
  if (!brain) return
  const weight = grudgeWeight(brain, attackerId, tick, tickRate) + (type === 'BOOST_BROKEN' || type === 'ITEM_SILENCED' ? 0.5 : 1)
  brain.grudges.set(attackerId, { weight: Math.min(3, weight), tick })
}

/** Rival = the duck this duck keeps trading places with. Sampled at decision time. */
export function noteNeighbours(brain: DuckBrain, ducks: ReadonlyArray<{ playerId: string; progress: number; finished: boolean }>, me: { progress: number }) {
  for (const other of ducks) {
    if (other.playerId === brain.playerId || other.finished) continue
    if (Math.abs(other.progress - me.progress) > 0.015) continue
    const samples = (brain.neighbourSamples.get(other.playerId) ?? 0) + 1
    brain.neighbourSamples.set(other.playerId, samples)
    const rivalSamples = brain.rivalId ? brain.neighbourSamples.get(brain.rivalId) ?? 0 : 0
    if (samples >= 6 && samples > rivalSamples) brain.rivalId = other.playerId
  }
}
