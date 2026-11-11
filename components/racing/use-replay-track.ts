import { useEffect, useState } from 'react'
import { decodeReplayTrack, type DecodedReplayTrack } from '@/src/race/replay-track/decode'
import { polylineTrack } from '@/src/race/polyline-track'
import type { RaceReplayInfo, TrackGeometryFile } from '@/src/race/types'

export type ReplayTrackState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; track: DecodedReplayTrack; geometry: TrackGeometryFile | null }
  | { status: 'error'; message: string }

async function gunzip(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

/**
 * Loads a race's recorded DTRK/1 track (and its geometry file) when GET /api/races/:id says there is one.
 * The body arrives gzip-encoded and the browser inflates it; a raw gzip body is inflated here. When
 * WebCrypto is available the payload must hash to `byteSha256`.
 */
export function useReplayTrack(replay: RaceReplayInfo | null | undefined): ReplayTrackState {
  const trackUrl = replay?.mode === 'track' ? replay.trackUrl : null
  const geometryUrl = replay?.mode === 'track' ? replay.geometryUrl : null
  const byteSha256 = replay?.byteSha256 ?? null
  const [loaded, setLoaded] = useState<{ url: string; state: ReplayTrackState } | null>(null)

  useEffect(() => {
    if (!trackUrl) return
    let cancelled = false
    void (async () => {
      const response = await fetch(trackUrl)
      if (!response.ok) throw new Error(`track HTTP ${response.status}`)
      let bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes)
      if (byteSha256 && typeof crypto !== 'undefined' && crypto.subtle) {
        const actual = await sha256Hex(bytes)
        if (actual !== byteSha256) throw new Error('track hash mismatch')
      }
      const track = decodeReplayTrack(bytes)
      let geometry: TrackGeometryFile | null = null
      if (geometryUrl) {
        try {
          const geometryResponse = await fetch(geometryUrl)
          if (geometryResponse.ok) geometry = await geometryResponse.json() as TrackGeometryFile
          // A malformed file falls back to HEAD geometry rather than breaking the canvas.
          if (geometry) polylineTrack(geometry)
        } catch {
          geometry = null
        }
      }
      if (!cancelled) setLoaded({ url: trackUrl, state: { status: 'ready', track, geometry } })
    })().catch((error: unknown) => {
      if (!cancelled) setLoaded({ url: trackUrl, state: { status: 'error', message: error instanceof Error ? error.message : String(error) } })
    })
    return () => { cancelled = true }
  }, [trackUrl, geometryUrl, byteSha256])

  if (!trackUrl) return { status: 'none' }
  if (!loaded || loaded.url !== trackUrl) return { status: 'loading' }
  return loaded.state
}
