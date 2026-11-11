/**
 * The engine-backed inputs of post-race stats (motion and no-items baseline ranks) in the browser, from the
 * WASM engine's `postRaceStats` (src/engine, in a Web Worker). The server freezes full stats into
 * RaceReplayTrack.statsJson; the browser computes them only for a current-version race that has neither a
 * stored stats blob nor a track (Rust refuses any other version).
 */
import type { RaceConfig, RaceEvent } from '@/src/engine/protocol'
import { postRaceStats } from '@/src/engine'
import type { DecodedReplayTrack } from '@/src/race/replay-track/decode'
import {
  aggregatePostRaceStats,
  motionFromTrack,
  type PostRaceMotion,
  type PostRacePlayerInput,
  type PostRaceStats,
} from './post-race-stats'
import { canResimulate } from './replay-plan'

export interface PostRaceEngineInputs {
  motion: PostRaceMotion | null
  baselineRank: Map<string, number> | null
}

/** Motion and baseline ranks from one engine call (about two extra simulations in the worker). */
export async function loadPostRaceEngineInputs(
  config: RaceConfig | string,
  events: readonly RaceEvent[],
  players: readonly PostRacePlayerInput[],
): Promise<PostRaceEngineInputs> {
  const stats = await postRaceStats(config, events, players)
  return {
    motion: new Map(stats.players.map((player) => [player.playerId, { averageSpeed: player.averageSpeed, peakSpeed: player.peakSpeed }])),
    baselineRank: stats.hasBaseline ? new Map(stats.players.map((player) => [player.playerId, player.baselineRank])) : null,
  }
}

/**
 * What the race page's stats tab shows (PostRaceStatsPanel): the frozen stats blob when there is one;
 * otherwise an aggregation of the stored events, with motion from the recorded track or from `engine`
 * (loadPostRaceEngineInputs, current version pair only), and a baseline only from `engine`.
 * `showBaseline` is false when no baseline exists, so "Δ" and "Hạng không item" are hidden rather than shown
 * as invented values.
 */
export function postRaceStatsForView(input: {
  config: RaceConfig | null
  events: RaceEvent[]
  players: PostRacePlayerInput[]
  frozenStats?: PostRaceStats | null
  track?: DecodedReplayTrack | null
  engine?: PostRaceEngineInputs | null
}): { stats: PostRaceStats; showSpeed: boolean; showBaseline: boolean } {
  const { config, events, players, frozenStats = null, track = null } = input
  // Blobs frozen before `hasBaseline` existed were built with the engine (baseline included).
  if (frozenStats) return { stats: frozenStats, showSpeed: true, showBaseline: frozenStats.hasBaseline !== false }
  const engine = canResimulate(config) ? input.engine ?? null : null
  let motion: PostRaceMotion | null = null
  try {
    motion = track ? motionFromTrack(track) : engine?.motion ?? null
  } catch {
    motion = null
  }
  const stats = aggregatePostRaceStats({ tickRate: Number(config?.tickRate) || 60 }, events, players, { motion, baselineRank: engine?.baselineRank ?? null })
  return { stats, showSpeed: motion !== null, showBaseline: stats.hasBaseline }
}
