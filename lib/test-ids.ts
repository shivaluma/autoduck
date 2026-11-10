import { randomInt as cryptoRandomInt, randomUUID as cryptoRandomUUID } from 'node:crypto'

// Deterministic-id hook for the Rust/TS mutation diff (rewrite plan Phase 3). Honoured only when
// NODE_ENV === 'test' and AUTODUCK_TEST_RNG_SEED is a u32. The env is read through a computed key
// so the bundler cannot inline NODE_ENV at build time.
// Rolls: mulberry32(seed), randomInt(n) = next() % n — the same stream as the Rust `test-rng`
// feature (crates/server/src/cosmetics/ids.rs). UUIDs come from a second mulberry32 stream; the
// diff compares them structurally (Rust's id stream is a different generator).
const env = (name: string) => process.env[name]

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
}

type Streams = { rolls: () => number; ids: () => number }
let streams: Streams | null | undefined

function seeded(): Streams | null {
  if (streams !== undefined) return streams
  const raw = env('AUTODUCK_TEST_RNG_SEED')?.trim()
  const seed = raw && /^\d+$/.test(raw) ? Number(raw) : NaN
  streams = env(['NODE', 'ENV'].join('_')) === 'test' && Number.isInteger(seed) && seed <= 0xffffffff
    ? { rolls: mulberry32(seed), ids: mulberry32((seed ^ 0x9e3779b9) >>> 0) }
    : null
  if (streams) console.warn(`AUTODUCK_TEST_RNG_SEED=${seed}: gacha rolls and ids are deterministic`)
  return streams
}

export function randomInt(max: number): number {
  const s = seeded()
  return s ? s.rolls() % max : cryptoRandomInt(max)
}

export function randomUUID(): string {
  const s = seeded()
  if (!s) return cryptoRandomUUID()
  const hex = Array.from({ length: 4 }, () => s.ids().toString(16).padStart(8, '0')).join('').split('')
  hex[12] = '4'
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const h = hex.join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** Google JWKS endpoint override for the local test JWKS (test env only). */
export function testGoogleJwksUrl(): string | null {
  return env(['NODE', 'ENV'].join('_')) === 'test' ? env('AUTODUCK_GOOGLE_JWKS_URL')?.trim() || null : null
}
