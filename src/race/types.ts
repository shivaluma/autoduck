/**
 * Browser-side race view types: render geometry and the replay descriptor served by GET /api/races/:id.
 * Shapes only; no engine imports beyond protocol types.
 */
import type { StateSnapshotMessage } from '@/src/engine/protocol'

/** What the canvas draws per tick (the shape `applyWorld` consumes and the DTRK decoder yields). */
export type RaceWorld = Pick<StateSnapshotMessage, 'ducks' | 'pickups' | 'hazards' | 'rockets' | 'bananas'>

export type BoostLaneTier = 'HYPER' | 'SUPER' | 'STANDARD' | 'NEUTRAL'

export interface TrackGeometryBoostLane {
  id: string
  tier: BoostLaneTier
  minLateral: number
  maxLateral: number
  centerLateral: number
  speedMultiplier: number
  durationSeconds: number
  colorHex: number
  colorName: string
  label: string
}

export interface TrackGeometryBoostGate { id: string; progress: number; lanes: TrackGeometryBoostLane[] }
export interface TrackGeometryCurrent { startProgress: number; endProgress: number; speedMultiplier: number; lateralForce: number }
export interface TrackGeometryPickupZone {
  id: string
  startProgress: number
  endProgress: number
  spawnRatio: number
  allowedTypes: string[]
  candidateAnchors: Array<{ id: string; lateralOffset: number; progressOffset: number }>
}
export interface TrackGeometryHazardZone {
  id: string
  allowedTypes: string[]
  anchors: Array<{ id: string; progress: number; lateralOffset: number; radius: number }>
}

export interface TrackPoint { x: number; y: number; tangentX: number; tangentY: number; width: number }

export const TRACK_GEOMETRY_FORMAT = 'race-track-geometry/1'

/**
 * public/race-tracks/<trackVersion>@<sha8>.json, where sha8 is the first 8 hex digits of sha256 over the
 * file's exact bytes (canonical JSON, keys sorted). `sim` is the sim-relevant definition; `render` is the
 * centreline sampled at `segments + 1` evenly spaced progress values, flattened as [x, y, tangentX, tangentY, width]
 * per point. A lateral offset l in [-1, 1] sits at `l · width · lateralScale` along the normal.
 */
export interface TrackGeometryFile {
  format: typeof TRACK_GEOMETRY_FORMAT
  trackVersion: string
  sim: {
    version: string
    length: number
    pickupLayoutVersion: string
    currents: TrackGeometryCurrent[]
    pickupZones: TrackGeometryPickupZone[]
    hazardZones: TrackGeometryHazardZone[]
    boostGates: TrackGeometryBoostGate[]
  }
  render: { segments: number; lateralScale: number; points: number[] }
}

/** The subset of a track the canvas and crowd draw from. HEAD `createRiverTrack` satisfies it structurally. */
export interface RenderTrack {
  version: string
  length: number
  boostGates: TrackGeometryBoostGate[]
  pickupZones: TrackGeometryPickupZone[]
  hazardZones: TrackGeometryHazardZone[]
  sample(progress: number, lateralOffset: number): TrackPoint
}

export type ReplayFidelity = 'RECORDED' | 'VERIFIED_DIGEST' | 'VERIFIED_EVENTS' | 'UNAVAILABLE'

/** `replay` in GET /api/races/:id (plan §4.6). */
export interface RaceReplayInfo {
  mode: 'track' | 'none'
  fidelity: ReplayFidelity | null
  /** `/api/races/:id/track?h=<byteSha256>` when mode is 'track'. */
  trackUrl: string | null
  /** `/race-tracks/<trackGeometry>.json` when the track names its geometry. */
  geometryUrl: string | null
  engineVersion: string | null
  balanceVersion: string | null
  byteSha256: string | null
  verify: 'none'
}
