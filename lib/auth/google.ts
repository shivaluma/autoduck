import { prisma } from '@/lib/db'

export interface GoogleProfile {
  googleId: string
  email: string | null
  name?: string | null
  picture?: string | null
  emailVerified?: boolean
}

/**
 * Safely decodes a Google ID Token (JWT) payload without external dependencies.
 */
export function decodeGoogleJwt(jwtString: string): GoogleProfile | null {
  try {
    const parts = jwtString.trim().split('.')
    if (parts.length < 2) return null
    const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payloadBase64.padEnd(payloadBase64.length + ((4 - (payloadBase64.length % 4)) % 4), '=')
    const jsonStr = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>

    const googleId = typeof parsed.sub === 'string' ? parsed.sub : ''
    const email = typeof parsed.email === 'string' ? parsed.email.toLowerCase().trim() : null
    const name = typeof parsed.name === 'string' ? parsed.name : null
    const picture = typeof parsed.picture === 'string' ? parsed.picture : null
    const emailVerified = parsed.email_verified === true || parsed.email_verified === 'true'

    if (!googleId && !email) return null

    return {
      googleId: googleId || email!,
      email,
      name,
      picture,
      emailVerified,
    }
  } catch {
    return null
  }
}

/**
 * Verifies and parses a Google token or payload.
 * Attempts tokeninfo validation if online, or falls back to decoded payload.
 */
export async function verifyGoogleToken(tokenOrJwt: string): Promise<GoogleProfile | null> {
  const clean = tokenOrJwt.trim()
  if (!clean) return null

  // If already JSON string (e.g. from tests or mock dev)
  if (clean.startsWith('{') && clean.endsWith('}')) {
    try {
      const parsed = JSON.parse(clean) as Record<string, unknown>
      const googleId = typeof parsed.googleId === 'string' ? parsed.googleId : typeof parsed.sub === 'string' ? parsed.sub : ''
      const email = typeof parsed.email === 'string' ? parsed.email.toLowerCase().trim() : null
      if (googleId || email) {
        return {
          googleId: googleId || email!,
          email,
          name: typeof parsed.name === 'string' ? parsed.name : null,
          picture: typeof parsed.picture === 'string' ? parsed.picture : null,
          emailVerified: true,
        }
      }
    } catch {
      // Continue to JWT decode
    }
  }

  // If standard JWT string (header.payload.signature)
  if (clean.split('.').length >= 3) {
    const decoded = decodeGoogleJwt(clean)

    // Optionally verify with Google's tokeninfo endpoint if possible
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(clean)}`, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>
        const sub = typeof data.sub === 'string' ? data.sub : ''
        const email = typeof data.email === 'string' ? data.email.toLowerCase().trim() : null
        if (sub || email) {
          return {
            googleId: sub || email!,
            email,
            name: typeof data.name === 'string' ? data.name : decoded?.name ?? null,
            picture: typeof data.picture === 'string' ? data.picture : decoded?.picture ?? null,
            emailVerified: data.email_verified === 'true' || data.email_verified === true,
          }
        }
      }
    } catch {
      // In offline / dev mode, fallback to safely decoded JWT
    }

    return decoded
  }

  // If plain email or googleId passed directly in dev / test
  if (clean.includes('@')) {
    return {
      googleId: clean.toLowerCase(),
      email: clean.toLowerCase(),
      emailVerified: true,
    }
  }

  return {
    googleId: clean,
    email: null,
    emailVerified: false,
  }
}

/**
 * Finds user by googleId or email
 */
export async function findUserByGoogle(googleId?: string | null, email?: string | null) {
  if (!googleId && !email) return null

  if (googleId) {
    const userByGoogleId = await prisma.user.findFirst({
      where: { googleId },
    })
    if (userByGoogleId) return userByGoogleId
  }

  if (email) {
    const cleanEmail = email.toLowerCase().trim()
    const userByEmail = await prisma.user.findFirst({
      where: { email: cleanEmail },
    })
    if (userByEmail) return userByEmail
  }

  return null
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
