/**
 * The engine-backed inputs of post-race stats (motion and no-items baseline ranks), via the sim seam.
 * The server freezes them into RaceReplayTrack.statsJson; the browser uses them only for current-version
 * races that have neither a stored stats blob nor a track (the version guard throws otherwise).
 */
import type { RaceConfig, RaceEvent, RaceFinishEntry, RecordedWildItemInput } from '@/src/engine/protocol'
import { createSimulation, simulateRace, stepSimulation } from '@/src/engine/sim'
import type { DecodedReplayTrack } from '@/src/race/replay-track/decode'
import { manualInputsFromEvents } from './event-vocab'
import {
  aggregatePostRaceStats,
  motionFromTrack,
  type PostRaceMotion,
  type PostRacePlayerInput,
  type PostRaceStats,
} from './post-race-stats'
import { canResimulate } from './replay-plan'

/** Per-duck average/peak speed over a re-simulation (samples after every step, capped at 180 s). */
export function collectPostRaceMotion(config: RaceConfig, manualInputs: readonly RecordedWildItemInput[]): PostRaceMotion {
  const state = createSimulation(config, { recordEvents: false, manualInputs: [...manualInputs] })
  const speedTotals = new Map<string, { sum: number; peak: number; samples: number }>()
  const maximumTicks = 180 * config.tickRate

  while (!state.finished && state.tick < maximumTicks) {
    stepSimulation(state)
    for (const duck of state.ducks) {
      if (duck.finished && duck.speed <= 0) continue
      const bucket = speedTotals.get(duck.playerId) ?? { sum: 0, peak: 0, samples: 0 }
      bucket.sum += duck.speed
      bucket.peak = Math.max(bucket.peak, duck.speed)
      bucket.samples += 1
      speedTotals.set(duck.playerId, bucket)
    }
  }

  const averages: PostRaceMotion = new Map()
  for (const [playerId, bucket] of speedTotals) {
    averages.set(playerId, {
      averageSpeed: bucket.samples > 0 ? bucket.sum / bucket.samples : 0,
      peakSpeed: bucket.peak,
    })
  }
  return averages
}

/** Ranks of the same race without loadouts, or null when it can't be simulated. */
export function collectPostRaceBaselineRank(config: RaceConfig): Map<string, number> | null {
  try {
    const baseline = simulateRace({ ...config, raceId: `${config.raceId}-post-race-baseline`, loadouts: [] }, { recordEvents: false })
    return new Map<string, number>(baseline.standings.map((entry: RaceFinishEntry) => [entry.playerId, entry.rank]))
  } catch {
    return null
  }
}

/**
 * What the race page's stats tab shows (PostRaceStatsPanel): the frozen stats blob when there is one;
 * otherwise an aggregation of the stored events, with motion from the recorded track or, for the
 * current engine/balance pair only, a local re-simulation, and a no-items baseline only for that pair.
 * Never simulates another version (the engine's version guard would throw). `showBaseline` is false
 * when no baseline exists, so "Δ" and "Hạng không item" are hidden rather than shown as invented values.
 */
export function postRaceStatsForView(input: {
  config: RaceConfig | null
  events: RaceEvent[]
  players: PostRacePlayerInput[]
  frozenStats?: PostRaceStats | null
  track?: DecodedReplayTrack | null
}): { stats: PostRaceStats; showSpeed: boolean; showBaseline: boolean } {
  const { config, events, players, frozenStats = null, track = null } = input
  // Blobs frozen before `hasBaseline` existed were built with the engine (baseline included).
  if (frozenStats) return { stats: frozenStats, showSpeed: true, showBaseline: frozenStats.hasBaseline !== false }
  const simulatable = canResimulate(config)
  let motion: PostRaceMotion | null = null
  try {
    motion = track ? motionFromTrack(track) : simulatable && config ? collectPostRaceMotion(config, manualInputsFromEvents(events)) : null
  } catch {
    motion = null
  }
  const baselineRank = simulatable && config ? collectPostRaceBaselineRank(config) : null
  const stats = aggregatePostRaceStats({ tickRate: Number(config?.tickRate) || 60 }, events, players, { motion, baselineRank })
  return { stats, showSpeed: motion !== null, showBaseline: stats.hasBaseline }
}
