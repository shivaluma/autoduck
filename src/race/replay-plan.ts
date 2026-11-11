/**
 * How the race page shows a finished race (plan §4.6):
 * - a recorded track whenever one exists (any engine version; nothing is simulated),
 * - otherwise a local re-simulation, only for the engine/balance pair the browser engine implements
 *   (src/engine/sim-versions.ts `SIM_VERSIONS`; never engine major ≥ 2 until Phase 5),
 * - otherwise no canvas: "Replay không khả dụng cho race này".
 */
import { SIM_VERSIONS } from '@/src/engine/sim-versions'
import { engineMajor } from './event-vocab'
import type { RaceReplayInfo } from './types'

export type ReplayPlan = 'track' | 'sim' | 'unavailable'

export function canResimulate(config: { engineVersion?: unknown; balanceVersion?: unknown } | null | undefined) {
  if (!config) return false
  const major = engineMajor(config.engineVersion)
  return major !== null && major < 2
    && config.engineVersion === SIM_VERSIONS.engineVersion
    && config.balanceVersion === SIM_VERSIONS.balanceVersion
}

export function planReplay(input: {
  replay: RaceReplayInfo | null | undefined
  config: { engineVersion?: unknown; balanceVersion?: unknown } | null | undefined
  /** False when the stored events failed the ordering check. */
  eventsUsable: boolean
  /** The track failed to load or decode. */
  trackFailed?: boolean
}): ReplayPlan {
  if (!input.eventsUsable) return 'unavailable'
  if (input.replay?.mode === 'track' && input.replay.trackUrl && !input.trackFailed) return 'track'
  return canResimulate(input.config) ? 'sim' : 'unavailable'
}

export const REPLAY_UNAVAILABLE_COPY = 'Replay không khả dụng cho race này'

/** The fidelity badge (§4.6), or null when there is none to show. */
export function fidelityBadge(replay: RaceReplayInfo | null | undefined): string | null {
  if (!replay || replay.mode !== 'track') return null
  if (replay.fidelity === 'RECORDED' || replay.fidelity === 'VERIFIED_DIGEST') {
    return `✓ Ghi hình khớp kết quả gốc · engine ${replay.engineVersion ?? '?'}/${replay.balanceVersion ?? '?'}`
  }
  if (replay.fidelity === 'VERIFIED_EVENTS') return '✓ Diễn biến khớp toàn bộ · digest gốc chưa tái lập được'
  return null
}
