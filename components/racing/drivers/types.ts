import type { RaceConfig, RaceEvent, RecordedWildItemInput } from '@/src/engine/protocol'
import type { DecodedReplayTrack } from '@/src/race/replay-track/decode'
import type { RaceWorld, TrackGeometryFile } from '@/src/race/types'

/**
 * What a driver hands the canvas for one step: the world at `tick` and the scene events in
 * (previous tick, tick], in emission order.
 */
export interface DriverFrame {
  tick: number
  finished: boolean
  world: RaceWorld
  events: RaceEvent[]
}

/**
 * A deterministic, replayable timeline: a recorded track (RecordingDriver) or a local re-simulation
 * (SimDriver, LiveDriver). Forward only; seeking backwards is reset() + advanceTo(t), see playback.ts.
 */
export interface TimelineDriver {
  readonly kind: 'recording' | 'sim' | 'live'
  readonly tickRate: number
  /** The last tick, when known before playing (recordings, or a sim whose RACE_FINISHED tick is known). */
  readonly endTick: number | null
  /** Ticks seek() may target; false for live races. */
  readonly seekable: boolean
  tick(): number
  finished(): boolean
  /** Back to tick 0, as freshly created. */
  reset(): void
  /** Moves to min(target, end) (never backwards) and returns the frame there. */
  advanceTo(targetTick: number): DriverFrame
}

/** Server-pushed snapshots for a live race whose config is hidden from the viewer. */
export interface SnapshotSink {
  world(world: RaceWorld, tick: number): void
  event(event: RaceEvent): void
  finished(): void
}

/**
 * Where the canvas gets its race from (the `source` prop of PhaserRaceCanvas):
 * - recording: a decoded DTRK/1 track plus the stored events (any engine version, no simulation)
 * - sim: re-simulate the config locally (current engine/balance pair only)
 * - live: re-simulate a running race, catching up to `syncTick`, with manual inputs from SSE
 * - snapshot: draw the server's SSE snapshots (no config)
 */
export type RaceSource =
  | { kind: 'recording'; track: DecodedReplayTrack; events: readonly RaceEvent[]; geometry?: TrackGeometryFile | null; chaosType?: string }
  | {
    kind: 'sim'
    config: RaceConfig
    manualInputs?: readonly RecordedWildItemInput[]
    endTick?: number | null
    geometry?: TrackGeometryFile | null
    /** /dev/race-lab only: its configs carry a "-LAB" balance label on the current engine. */
    allowVersion?: boolean
  }
  | { kind: 'live'; config: RaceConfig; syncTick?: number; manualInputs?: readonly RecordedWildItemInput[] }
  | { kind: 'snapshot'; trackVersion?: string | null }

/** Identity for a source: the canvas rebuilds when it changes (live sync state is deliberately excluded). */
export function raceSourceKey(source: RaceSource): string {
  if (source.kind === 'recording') {
    const header = source.track.header
    return `recording:${header.raceId}:${header.lastTick}:${header.resultDigest ?? ''}:${source.events.length}:${source.geometry ? 'g' : ''}`
  }
  if (source.kind === 'sim') return `sim:${JSON.stringify(source.config)}:${JSON.stringify(source.manualInputs ?? [])}:${source.geometry ? 'g' : ''}:${source.allowVersion ? 'v' : ''}`
  if (source.kind === 'live') return `live:${JSON.stringify(source.config)}`
  return `snapshot:${source.trackVersion ?? ''}`
}
