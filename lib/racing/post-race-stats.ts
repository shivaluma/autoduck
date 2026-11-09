import type { RaceConfig, RaceEvent } from '@/packages/race-protocol/src'
import { recordedWildInputsFromEvents } from '@/lib/racing/persistence'
import { collectPostRaceBaselineRank, collectPostRaceMotion } from '@/src/race/post-race-engine'
import {
  aggregatePostRaceStats,
  type PostRaceMotion,
  type PostRacePlayerInput,
  type PostRaceStats,
} from '@/src/race/post-race-stats'

/**
 * Full post-race stats for a race that just ran (frozen into RaceReplayTrack.statsJson): the event
 * aggregation (src/race/post-race-stats.ts) plus motion and baseline ranks from the TS engine
 * (src/race/post-race-engine.ts). The engine's version guard makes both engine parts unavailable for a
 * config that isn't the current engine/balance pair; the baseline then falls back to participant order
 * and motion to zero.
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
