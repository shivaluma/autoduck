import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { prisma } from '@/lib/db'

export interface GoogleProfile {
  /** Google's stable account id (`sub`). Always a verified value. */
  googleId: string
  email: string | null
  name: string | null
  picture: string | null
  emailVerified: boolean
}

/** Google's signing keys couldn't be fetched; the credential was not judged either way. */
export class GoogleKeysUnavailableError extends Error {}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs')

let googleJwks: JWTVerifyGetKey | null = null
function defaultGoogleJwks() {
  googleJwks ??= createRemoteJWKSet(GOOGLE_JWKS_URL)
  return googleJwks
}

/**
 * OAuth client ids that Google ID tokens may be issued for. The browser button prefers
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID and the server GOOGLE_CLIENT_ID, so both are accepted.
 * Empty when Google sign-in isn't configured.
 */
export function googleAudiences(): string[] {
  const ids = [process.env.GOOGLE_CLIENT_ID, process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID]
    .map((id) => id?.trim() ?? '')
    .filter(Boolean)
  return [...new Set(ids)]
}

/** Client id the browser should use for the sign-in button. */
export function googleClientId() {
  return googleAudiences().at(-1) ?? ''
}

/**
 * True when jose failed to obtain Google's keys (network, non-200, bad JSON) rather than judging
 * the token. Token problems are JOSEError subclasses; key-download failures are JWKSTimeout,
 * JWKSInvalid, the base JOSEError itself, or a non-jose error from fetch.
 */
function isKeyFetchFailure(error: unknown) {
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) return true
  if (!(error instanceof errors.JOSEError)) return true
  return error.constructor === errors.JOSEError
}

/**
 * Verifies a Google Identity Services ID token (the `credential` from the sign-in button):
 * RS256 signature against Google's published keys, issuer, audience = one of our client ids,
 * and expiry. Returns null for anything that doesn't verify. Never accepts raw emails, JSON,
 * or unsigned tokens. Throws GoogleKeysUnavailableError when Google's keys can't be fetched.
 */
export async function verifyGoogleIdToken(
  credential: string,
  options: { audience: string | string[]; keys?: JWTVerifyGetKey },
): Promise<GoogleProfile | null> {
  const token = typeof credential === 'string' ? credential.trim() : ''
  const audience = (Array.isArray(options.audience) ? options.audience : [options.audience]).filter(Boolean)
  if (!token || audience.length === 0) return null
  try {
    const { payload } = await jwtVerify(token, options.keys ?? defaultGoogleJwks(), {
      issuer: GOOGLE_ISSUERS,
      audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
      clockTolerance: 30,
    })
    if (typeof payload.sub !== 'string' || !payload.sub) return null
    // When present, azp must be one of our clients too.
    if (payload.azp !== undefined && (typeof payload.azp !== 'string' || !audience.includes(payload.azp))) return null
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() || null : null
    return {
      googleId: payload.sub,
      email,
      name: typeof payload.name === 'string' ? payload.name : null,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
      emailVerified: payload.email_verified === true,
    }
  } catch (error) {
    if (isKeyFetchFailure(error)) {
      throw new GoogleKeysUnavailableError(error instanceof Error ? error.message : String(error), { cause: error })
    }
    return null
  }
}

/**
 * True when a stored googleId is a real Google account id. Real `sub` values are numeric strings;
 * older versions of this endpoint stored emails or other unverified strings, which don't count.
 */
export function hasGoogleLink(googleId: string | null | undefined): boolean {
  return typeof googleId === 'string' && /^\d+$/.test(googleId)
}

/** Finds the user linked to a verified Google account. Matches by Google id only, never by email. */
export async function findUserByGoogle(profile: GoogleProfile) {
  return prisma.user.findFirst({ where: { googleId: profile.googleId } })
}

/**
 * Finds SeasonPlayer token for a given user in the active season
 */
export async function getActiveSeasonPlayerToken(userId: number): Promise<string | null> {
  const activeSeason = await prisma.season.findFirst({
    where: { status: 'active' },
    include: {
      players: {
        where: { userId },
      },
    },
  })

  return activeSeason?.players[0]?.accessToken ?? null
}
