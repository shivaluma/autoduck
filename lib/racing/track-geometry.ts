import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRiverTrack } from '@/packages/race-core/src/track'
import { canonicalHeaderJson } from '@/src/race/replay-track/format'
import { TRACK_GEOMETRY_FORMAT, type TrackGeometryFile } from '@/src/race/types'

/** Centreline samples in an exported geometry file (render half). */
export const TRACK_GEOMETRY_SEGMENTS = 1024
/** Same factor as the engine's track.sample: lateral 1.0 is 42% of the river width from the centreline. */
const LATERAL_SCALE = 0.42

const round = (value: number, digits: number) => {
  const scale = 10 ** digits
  const rounded = Math.round(value * scale) / scale
  return Object.is(rounded, -0) ? 0 : rounded
}

/** The parts of a `createRiverTrack` result the export reads; older commits may lack the zone and gate lists. */
export interface ExportableTrack {
  version: string
  length: number
  pickupLayoutVersion?: string
  currents?: unknown
  pickupZones?: unknown
  hazardZones?: unknown
  boostGates?: unknown
  sample(progress: number, lateralOffset: number): { x: number; y: number; tangentX: number; tangentY: number; width: number }
}

/**
 * Plain-data copy of a track object: sim definition plus a sampled centreline. Takes the track rather than
 * calling HEAD `createRiverTrack`, so the historical resolver can export the geometry of the commit that
 * actually ran a race (plan D10). Lists an old commit didn't have are exported as [].
 */
export function exportTrackGeometryFromTrack(track: ExportableTrack, trackVersion: string): TrackGeometryFile {
  const points: number[] = []
  for (let index = 0; index <= TRACK_GEOMETRY_SEGMENTS; index += 1) {
    const point = track.sample(index / TRACK_GEOMETRY_SEGMENTS, 0)
    points.push(round(point.x, 4), round(point.y, 4), round(point.tangentX, 7), round(point.tangentY, 7), round(point.width, 4))
  }
  return {
    format: TRACK_GEOMETRY_FORMAT,
    trackVersion,
    sim: JSON.parse(JSON.stringify({
      version: track.version,
      length: track.length,
      pickupLayoutVersion: track.pickupLayoutVersion ?? '',
      currents: track.currents ?? [],
      pickupZones: track.pickupZones ?? [],
      hazardZones: track.hazardZones ?? [],
      boostGates: track.boostGates ?? [],
    })) as TrackGeometryFile['sim'],
    render: { segments: TRACK_GEOMETRY_SEGMENTS, lateralScale: LATERAL_SCALE, points },
  }
}

/** Plain-data copy of a HEAD `createRiverTrack(trackVersion)`: sim definition plus a sampled centreline. */
export function exportTrackGeometry(trackVersion: string): TrackGeometryFile {
  return exportTrackGeometryFromTrack(createRiverTrack(trackVersion), trackVersion)
}

/** The exact file bytes and their content address `<trackVersion>@<sha8>`. */
export function serializeTrackGeometry(geometry: TrackGeometryFile) {
  const json = `${canonicalHeaderJson(geometry)}\n`
  const sha256 = createHash('sha256').update(json).digest('hex')
  return { json, sha256, id: `${geometry.trackVersion}@${sha256.slice(0, 8)}` }
}

export function trackGeometryPath(id: string, root = process.cwd()) {
  return path.join(root, 'public', 'race-tracks', `${id}.json`)
}

const headIds = new Map<string, string | null>()

/**
 * The geometry id HEAD's `createRiverTrack(trackVersion)` exports to, if that file is committed under
 * public/race-tracks (written by `pnpm race:tracks`). New recordings name it in their header; null otherwise.
 */
export function resolveHeadTrackGeometryId(trackVersion: string): string | null {
  if (headIds.has(trackVersion)) return headIds.get(trackVersion)!
  let id: string | null = null
  try {
    const exported = serializeTrackGeometry(exportTrackGeometry(trackVersion)).id
    id = existsSync(trackGeometryPath(exported)) ? exported : null
  } catch {
    id = null
  }
  headIds.set(trackVersion, id)
  return id
}
