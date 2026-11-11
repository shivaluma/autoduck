/**
 * The geometry file of the track the current engine races on (public/race-tracks/<id>.json). The canvas
 * draws a simulated or live race, and a recording made before geometry files existed, from it. It equals
 * race-core's `replay::TRACK_GEOMETRY_ID` (both are tested against the committed file).
 */
import { polylineTrack, trackGeometryUrl } from '@/src/race/polyline-track'
import type { RenderTrack, TrackGeometryFile } from '@/src/race/types'

export const CURRENT_TRACK_GEOMETRY_ID = 'river-01-v2@678a27dc'

let current: Promise<TrackGeometryFile> | null = null

/** Fetches the current geometry file once per page. */
export function loadCurrentTrackGeometry(): Promise<TrackGeometryFile> {
  current ??= fetch(trackGeometryUrl(CURRENT_TRACK_GEOMETRY_ID)!).then(async (response) => {
    if (!response.ok) throw new Error(`track geometry ${response.status}`)
    return (await response.json()) as TrackGeometryFile
  }).catch((error: unknown) => {
    current = null
    throw error
  })
  return current
}

/** The render track for `geometry`, or the current track when there is none. */
export async function renderTrack(geometry: TrackGeometryFile | null | undefined): Promise<RenderTrack> {
  return polylineTrack(geometry ?? (await loadCurrentTrackGeometry()))
}
