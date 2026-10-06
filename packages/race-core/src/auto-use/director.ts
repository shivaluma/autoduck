/**
 * Drama director: a cheap read of the race shape that nudges every brain toward a better show.
 * - Runaway leader: everyone behind leans toward attacking the leader.
 * - Final duel: the top two are neck and neck late; clutch temperaments unload.
 * - Desperation: a duck stuck in the loser set late stops saving items.
 */

export interface DirectorRead {
  leaderId: string | null
  /** Progress gap between first and second place. */
  leaderGap: number
  runawayLeaderId: string | null
  duelIds: readonly string[]
}

export const DIRECTOR_CONFIG = {
  runawayGap: 0.025,
  runawayMinProgress: 0.35,
  duelGap: 0.012,
  duelMinProgress: 0.82,
  desperationProgress: 0.7,
  desperationRisk: 0.55,
} as const

const cacheByDucks = new WeakMap<object, { fingerprint: number; read: DirectorRead }>()

export function readRace(ducks: ReadonlyArray<{ playerId: string; progress: number; finished: boolean; currentRank: number }>): DirectorRead {
  let fingerprint = ducks.length
  for (let index = 0; index < ducks.length; index++) fingerprint += ducks[index]!.progress * (index + 2.718) + (ducks[index]!.finished ? 11 : 0)
  const cache = cacheByDucks.get(ducks)
  if (cache && cache.fingerprint === fingerprint) return cache.read
  const racing = ducks.filter((duck) => !duck.finished).sort((left, right) => right.progress - left.progress || left.playerId.localeCompare(right.playerId))
  const first = racing[0]
  const second = racing[1]
  const leaderGap = first && second ? first.progress - second.progress : 0
  const anyFinished = ducks.some((duck) => duck.finished)
  const read: DirectorRead = {
    leaderId: first?.playerId ?? null,
    leaderGap,
    runawayLeaderId: first && !anyFinished && leaderGap > DIRECTOR_CONFIG.runawayGap && first.progress >= DIRECTOR_CONFIG.runawayMinProgress ? first.playerId : null,
    duelIds: first && second && !anyFinished && leaderGap <= DIRECTOR_CONFIG.duelGap && first.progress >= DIRECTOR_CONFIG.duelMinProgress ? [first.playerId, second.playerId] : [],
  }
  cacheByDucks.set(ducks, { fingerprint, read })
  return read
}
