import { gunzipSync } from 'node:zlib'

/** The stored columns the track endpoint serves. */
export interface ServableReplayTrack {
  byteSha256: string | null
  bytes: Uint8Array | null
}

export interface TrackRequest {
  /** `?h=` from the URL: the byteSha256 the client expects. */
  h: string | null
  acceptEncoding: string | null
  ifNoneMatch: string | null
}

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

function acceptsGzip(header: string | null) {
  if (!header) return false
  return header.split(',').some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(';')
    if (coding !== 'gzip' && coding !== '*') return false
    const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='))
    return !q || Number(q.slice(2)) > 0
  })
}

function etagMatches(header: string | null, etag: string) {
  if (!header) return false
  return header.split(',').some((candidate) => {
    const value = candidate.trim().replace(/^W\//, '')
    return value === etag || value === '*'
  })
}

/**
 * GET /api/races/:id/track (plan §4.6): the stored gzip DTRK/1 bytes.
 * - `Content-Encoding: gzip` when the client accepts it, otherwise decompressed on the server.
 * - `ETag: "<byteSha256>"` (sha256 of the uncompressed payload); a matching If-None-Match gets 304.
 * - Immutable caching only when `?h=` equals byteSha256; without `h`, or with a stale one, `no-cache`.
 */
export function replayTrackResponse(row: ServableReplayTrack | null, request: TrackRequest): Response {
  if (!row || !row.bytes || !row.byteSha256) {
    return Response.json({ error: 'No replay track for this race' }, { status: 404, headers: { 'Cache-Control': 'no-cache' } })
  }
  const etag = `"${row.byteSha256}"`
  const headers = new Headers({
    'Cache-Control': request.h === row.byteSha256 ? IMMUTABLE_CACHE : 'no-cache',
    ETag: etag,
    Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
  })
  if (etagMatches(request.ifNoneMatch, etag)) return new Response(null, { status: 304, headers })
  headers.set('Content-Type', 'application/octet-stream')
  if (acceptsGzip(request.acceptEncoding)) {
    headers.set('Content-Encoding', 'gzip')
    headers.set('Content-Length', String(row.bytes.byteLength))
    return new Response(Buffer.from(row.bytes), { status: 200, headers })
  }
  const payload = gunzipSync(row.bytes)
  headers.set('Content-Length', String(payload.byteLength))
  return new Response(payload, { status: 200, headers })
}
