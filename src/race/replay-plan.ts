/**
 * How the race page shows a finished race (plan §4.6):
 * - a recorded track whenever one exists (any engine version; nothing is simulated),
 * - otherwise a local re-simulation, only for a version pair the browser engine (race-core as WASM,
 *   src/engine) implements: the current engine version and a supported balance version,
 * - otherwise no canvas: "Replay không khả dụng cho race này".
 */
import { RACE_ENGINE_VERSION, SUPPORTED_BALANCE_VERSIONS } from '@/src/engine/protocol'
import type { RaceReplayInfo } from './types'

export type ReplayPlan = 'track' | 'sim' | 'unavailable'

export function canResimulate(config: { engineVersion?: unknown; balanceVersion?: unknown } | null | undefined) {
  if (!config) return false
  return config.engineVersion === RACE_ENGINE_VERSION
    && typeof config.balanceVersion === 'string'
    && SUPPORTED_BALANCE_VERSIONS.includes(config.balanceVersion)
}

/**
 * How the v1 live canvas (`kind: 'live'`) follows a running race: re-simulate locally only when the browser
 * engine runs the config, otherwise draw the server's SSE snapshots. TS-era races (1.x) therefore always use
 * snapshots; Rust-server races use the SSE v2 view (`kind: 'live-v2'`).
 */
export function planLiveView(config: { engineVersion?: unknown; balanceVersion?: unknown } | null | undefined): 'live' | 'snapshot' {
  return canResimulate(config) ? 'live' : 'snapshot'
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
