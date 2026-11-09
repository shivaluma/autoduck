import { createHash, timingSafeEqual } from 'node:crypto'

let warnedShortSecret = false

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Constant-time check of an admin secret against RACE_SECRET_KEY.
 * Fails closed: when RACE_SECRET_KEY is unset or blank, nothing is authorized.
 */
export function isAdminSecret(given: string | null | undefined): boolean {
  const expected = (process.env.RACE_SECRET_KEY ?? '').trim()
  if (!expected) return false
  if (expected.length < 16 && !warnedShortSecret) {
    warnedShortSecret = true
    console.warn('RACE_SECRET_KEY is shorter than 16 characters; rotate it to a longer random value.')
  }
  if (typeof given !== 'string' || !given) return false
  return timingSafeEqual(digest(given.trim()), digest(expected))
}

/** Admin secret from `?secret=`, the `x-race-secret` header, or `body.secret`. */
export function isAdminRequest(request: Request, body?: { secret?: unknown } | null): boolean {
  const candidates = [
    new URL(request.url).searchParams.get('secret'),
    request.headers.get('x-race-secret'),
    typeof body?.secret === 'string' ? body.secret : null,
  ]
  return candidates.some((candidate) => isAdminSecret(candidate))
}
