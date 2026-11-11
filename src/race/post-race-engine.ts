/**
 * The engine-backed inputs of post-race stats (motion and no-items baseline ranks), via the sim seam.
 * The server freezes them into RaceReplayTrack.statsJson; the browser uses them only for current-version
 * races that have neither a stored stats blob nor a track (the version guard throws otherwise).
 */
import type { RaceConfig, RaceFinishEntry, RecordedWildItemInput } from '@/src/engine/protocol'
import { createSimulation, simulateRace, stepSimulation } from '@/src/engine/sim'
import type { PostRaceMotion } from './post-race-stats'

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
