import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

// lib/test-ids.ts caches its mode on first use, so every case runs in a fresh Node process with
// exactly the env under test (nothing inherited from this process's NODE_ENV or seed).

const root = path.join(__dirname, '..')
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type Sample = { uuids: string[]; ints: number[]; jwks: string | null }

function sample(env: Record<string, string>): Sample {
  const script = `
    const ids = require('./lib/test-ids.ts')
    const out = {
      uuids: Array.from({ length: 4 }, () => ids.randomUUID()),
      ints: Array.from({ length: 8 }, () => ids.randomInt(1000000)),
      jwks: ids.testGoogleJwksUrl(),
    }
    process.stdout.write(JSON.stringify(out))
  `
  const base: Record<string, string> = { PATH: process.env.PATH ?? '' }
  const stdout = execFileSync(process.execPath, ['--import', 'tsx', '-e', script], { cwd: root, env: { ...base, ...env } as NodeJS.ProcessEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(stdout) as Sample
}

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

function assertCryptoRandom(env: Record<string, string>) {
  const first = sample(env)
  const second = sample(env)
  for (const uuid of [...first.uuids, ...second.uuids]) assert.match(uuid, UUID_V4)
  assert.equal(new Set([...first.uuids, ...second.uuids]).size, 8, 'crypto UUIDs never repeat')
  assert.notDeepEqual(first.ints, second.ints, 'crypto rolls differ between processes')
  for (const value of [...first.ints, ...second.ints]) assert.ok(Number.isInteger(value) && value >= 0 && value < 1_000_000)
  assert.equal(first.jwks, null)
}

test('without any env, ids and rolls come from node:crypto', () => {
  assertCryptoRandom({})
})

test('the seed is ignored outside NODE_ENV=test (production keeps crypto randomness)', () => {
  assertCryptoRandom({ NODE_ENV: 'production', AUTODUCK_TEST_RNG_SEED: '42', AUTODUCK_GOOGLE_JWKS_URL: 'http://127.0.0.1:1/jwks' })
  assertCryptoRandom({ NODE_ENV: 'development', AUTODUCK_TEST_RNG_SEED: '42' })
})

test('an invalid seed keeps crypto randomness even in the test env', () => {
  assertCryptoRandom({ NODE_ENV: 'test', AUTODUCK_TEST_RNG_SEED: 'abc' })
  assertCryptoRandom({ NODE_ENV: 'test', AUTODUCK_TEST_RNG_SEED: '4294967296' })
})

test('NODE_ENV=test with a u32 seed gives the mulberry32 stream shared with Rust', () => {
  const env = { NODE_ENV: 'test', AUTODUCK_TEST_RNG_SEED: '42', AUTODUCK_GOOGLE_JWKS_URL: ' http://127.0.0.1:1/jwks ' }
  const first = sample(env)
  assert.deepEqual(sample(env), first, 'the same seed reproduces the same ids and rolls')
  const rolls = mulberry32(42)
  assert.deepEqual(first.ints, Array.from({ length: 8 }, () => rolls() % 1_000_000))
  for (const uuid of first.uuids) assert.match(uuid, UUID_V4)
  assert.equal(new Set(first.uuids).size, 4)
  assert.equal(first.jwks, 'http://127.0.0.1:1/jwks')
  assert.notDeepEqual(sample({ ...env, AUTODUCK_TEST_RNG_SEED: '43' }).ints, first.ints)
})
