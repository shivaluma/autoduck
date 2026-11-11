import { createSimulation, simulateRace, stepSimulation } from '@/packages/race-core/src'
import type { RaceConfig, RaceEvent, RaceFinishEntry, RecordedWildItemInput } from '@/packages/race-protocol/src'
import { recordedWildInputsFromEvents } from '@/lib/racing/persistence'
import {
  aggregatePostRaceStats,
  type PostRaceMotion,
  type PostRacePlayerInput,
  type PostRaceStats,
} from '@/src/race/post-race-stats'

/** Per-duck average/peak speed over a TS re-simulation (samples after every step, capped at 180 s). */
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

/** Ranks of the same race without loadouts (TS engine), or null when it can't be simulated. */
export function collectPostRaceBaselineRank(config: RaceConfig): Map<string, number> | null {
  try {
    const baseline = simulateRace({ ...config, raceId: `${config.raceId}-post-race-baseline`, loadouts: [] }, { recordEvents: false })
    return new Map<string, number>(baseline.standings.map((entry: RaceFinishEntry) => [entry.playerId, entry.rank]))
  } catch {
    return null
  }
}

/**
 * Full post-race stats for a race the TS server just ran (frozen into RaceReplayTrack.statsJson): the event
 * aggregation (src/race/post-race-stats.ts) plus motion and baseline ranks from the TS engine. The engine's
 * version guard makes both engine parts unavailable for a config that isn't the current engine/balance pair;
 * the baseline then falls back to participant order and motion to zero. (The Rust server uses
 * `race_core::stats::build`; the browser uses the WASM engine.)
 */
export function buildPostRaceStats(
  config: RaceConfig,
  events: RaceEvent[],
  players: PostRacePlayerInput[],
): PostRaceStats {
  const baselineRank = collectPostRaceBaselineRank(config)
  let motion: PostRaceMotion | null = null
  try {
    motion = collectPostRaceMotion(config, recordedWildInputsFromEvents(events))
  } catch {
    motion = null
  }
  return aggregatePostRaceStats(config, events, players, { baselineRank, motion })
}

export type { PostRaceStats, PostRacePlayerInput } from '@/src/race/post-race-stats'
