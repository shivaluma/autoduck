import type { RenderTrack, TrackGeometryFile, TrackPoint } from './types'

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

/**
 * A render track from an exported geometry file (public/race-tracks/*.json): the centreline is linearly
 * interpolated between the stored samples, then offset along the normal exactly like the engine's
 * `track.sample` (lateral clamped to [-1, 1]). With 1024 segments the drawn path stays within ~0.01 px of HEAD.
 */
export function polylineTrack(file: TrackGeometryFile): RenderTrack {
  const { segments, lateralScale, points } = file.render
  if (!Number.isInteger(segments) || segments < 1 || points.length !== (segments + 1) * 5) {
    throw new Error(`Bad track geometry: ${segments} segments, ${points.length} values`)
  }
  return {
    version: file.sim.version,
    length: file.sim.length,
    boostGates: file.sim.boostGates,
    pickupZones: file.sim.pickupZones,
    hazardZones: file.sim.hazardZones,
    sample(progress: number, lateralOffset: number): TrackPoint {
      const position = clamp(progress, 0, 1) * segments
      const index = Math.min(segments - 1, Math.floor(position))
      const t = position - index
      const a = index * 5
      const b = a + 5
      const lerp = (offset: number) => points[a + offset]! + (points[b + offset]! - points[a + offset]!) * t
      const centerX = lerp(0)
      const centerY = lerp(1)
      let tangentX = lerp(2)
      let tangentY = lerp(3)
      const magnitude = Math.hypot(tangentX, tangentY) || 1
      tangentX /= magnitude
      tangentY /= magnitude
      const width = lerp(4)
      const offset = clamp(lateralOffset, -1, 1) * width * lateralScale
      return { x: centerX - tangentY * offset, y: centerY + tangentX * offset, tangentX, tangentY, width }
    },
  }
}

const TRACK_GEOMETRY_ID = /^[A-Za-z0-9._-]+@[0-9a-f]{8}$/

/** `/race-tracks/<trackVersion>@<sha8>.json`, or null for a malformed id. */
export function trackGeometryUrl(trackGeometry: string | null | undefined) {
  return trackGeometry && TRACK_GEOMETRY_ID.test(trackGeometry) ? `/race-tracks/${trackGeometry}.json` : null
}
