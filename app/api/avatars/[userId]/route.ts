import { prisma } from '@/lib/db'

// GET /api/avatars/[userId] - Serves a user's avatar from our own origin.
// The race canvas (WebGL) can only read images whose host sends CORS headers; Google, Slack and R2
// avatars don't, so the canvas loads them through here. Only the URL stored on the user is ever
// fetched, never one from the request, so this can't be used to proxy arbitrary hosts.

const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 6000

// Remote SVGs are served same-origin: forbid scripts in case one is opened directly.
const SAFE_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
}

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const userId = Number.parseInt((await params).userId, 10)
  if (!Number.isSafeInteger(userId)) return new Response('Invalid user', { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } }) as { avatarUrl: string | null } | null
  const avatarUrl = user?.avatarUrl?.trim()
  if (!avatarUrl) return new Response('No avatar', { status: 404 })

  if (avatarUrl.startsWith('data:image/')) {
    const match = /^data:(image\/[\w.+-]+)(;base64)?,([\s\S]*)$/.exec(avatarUrl)
    if (!match) return new Response('Bad avatar', { status: 422 })
    const body = match[2] ? Buffer.from(match[3]!, 'base64') : Buffer.from(decodeURIComponent(match[3]!))
    return new Response(body, { headers: { ...SAFE_HEADERS, 'Content-Type': match[1]! } })
  }

  let target: URL
  try {
    target = new URL(avatarUrl)
  } catch {
    return new Response('Bad avatar', { status: 422 })
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return new Response('Bad avatar', { status: 422 })

  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'image/*' } })
    const contentType = upstream.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!upstream.ok || !contentType.startsWith('image/')) return new Response('Avatar unavailable', { status: 502 })
    const declared = Number(upstream.headers.get('content-length') ?? 0)
    if (declared > MAX_BYTES) return new Response('Avatar too large', { status: 413 })
    const body = await upstream.arrayBuffer()
    if (body.byteLength > MAX_BYTES) return new Response('Avatar too large', { status: 413 })
    return new Response(body, { headers: { ...SAFE_HEADERS, 'Content-Type': contentType } })
  } catch {
    return new Response('Avatar unavailable', { status: 502 })
  }
}
