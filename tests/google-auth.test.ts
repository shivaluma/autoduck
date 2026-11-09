import assert from 'node:assert/strict'
import test from 'node:test'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { GoogleKeysUnavailableError, googleAudiences, googleClientId, hasGoogleLink, verifyGoogleIdToken } from '../lib/auth/google'
import { isAdminRequest, isAdminSecret } from '../lib/auth/admin-secret'

const AUDIENCE = '1234567890-test.apps.googleusercontent.com'
const ISSUER = 'https://accounts.google.com'

async function keyFixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
  const keys = createLocalJWKSet({ keys: [jwk] })
  const other = await generateKeyPair('RS256')
  async function sign(payload: JWTPayload, opts: { iss?: string; aud?: string; exp?: number | string | null; iat?: boolean; key?: CryptoKey; kid?: string } = {}) {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? 'test-key' })
      .setIssuer(opts.iss ?? ISSUER)
      .setAudience(opts.aud ?? AUDIENCE)
    if (opts.iat !== false) jwt.setIssuedAt()
    if (opts.exp !== null) jwt.setExpirationTime(opts.exp ?? '1h')
    return jwt.sign(opts.key ?? privateKey)
  }
  return { keys, sign, otherKey: other.privateKey }
}

const fixture = keyFixture()
const GOOD_CLAIMS = { sub: '109876543210987654321', email: 'Duck@Example.com', email_verified: true, name: 'Dzịt Test', picture: 'https://example.com/a.png' }

function b64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

test('verifyGoogleIdToken accepts a correctly signed Google ID token', async () => {
  const { keys, sign } = await fixture
  const profile = await verifyGoogleIdToken(await sign(GOOD_CLAIMS), { audience: AUDIENCE, keys })
  assert.deepEqual(profile, {
    googleId: '109876543210987654321',
    email: 'duck@example.com',
    name: 'Dzịt Test',
    picture: 'https://example.com/a.png',
    emailVerified: true,
  })
})

test('verifyGoogleIdToken accepts the bare accounts.google.com issuer', async () => {
  const { keys, sign } = await fixture
  const profile = await verifyGoogleIdToken(await sign(GOOD_CLAIMS, { iss: 'accounts.google.com' }), { audience: AUDIENCE, keys })
  assert.equal(profile?.googleId, GOOD_CLAIMS.sub)
})

test('verifyGoogleIdToken rejects tokens for another audience, issuer, or expired', async () => {
  const { keys, sign } = await fixture
  assert.equal(await verifyGoogleIdToken(await sign(GOOD_CLAIMS, { aud: 'someone-else.apps.googleusercontent.com' }), { audience: AUDIENCE, keys }), null)
  assert.equal(await verifyGoogleIdToken(await sign(GOOD_CLAIMS, { iss: 'https://evil.example.com' }), { audience: AUDIENCE, keys }), null)
  assert.equal(await verifyGoogleIdToken(await sign(GOOD_CLAIMS, { exp: Math.floor(Date.now() / 1000) - 3600 }), { audience: AUDIENCE, keys }), null)
})

test('verifyGoogleIdToken rejects forged, unsigned, and tampered tokens', async () => {
  const { keys, sign, otherKey } = await fixture
  // Signed by a key that isn't Google's.
  assert.equal(await verifyGoogleIdToken(await sign(GOOD_CLAIMS, { key: otherKey }), { audience: AUDIENCE, keys }), null)
  // alg=none, no signature.
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ ...GOOD_CLAIMS, iss: ISSUER, aud: AUDIENCE, exp: now + 3600 })}.`
  assert.equal(await verifyGoogleIdToken(unsigned, { audience: AUDIENCE, keys }), null)
  // Valid signature, payload swapped for another account.
  const [header, , signature] = (await sign(GOOD_CLAIMS)).split('.')
  const tampered = `${header}.${b64url({ ...GOOD_CLAIMS, sub: '1', email: 'victim@example.com', iss: ISSUER, aud: AUDIENCE, exp: now + 3600 })}.${signature}`
  assert.equal(await verifyGoogleIdToken(tampered, { audience: AUDIENCE, keys }), null)
})

test('verifyGoogleIdToken rejects raw emails, JSON payloads, and missing subject', async () => {
  const { keys, sign } = await fixture
  assert.equal(await verifyGoogleIdToken('victim@example.com', { audience: AUDIENCE, keys }), null)
  assert.equal(await verifyGoogleIdToken(JSON.stringify({ sub: '1', email: 'victim@example.com' }), { audience: AUDIENCE, keys }), null)
  assert.equal(await verifyGoogleIdToken('', { audience: AUDIENCE, keys }), null)
  assert.equal(await verifyGoogleIdToken(await sign({ email: 'nosub@example.com', email_verified: true }), { audience: AUDIENCE, keys }), null)
})

test('verifyGoogleIdToken refuses to verify without a configured audience', async () => {
  const { keys, sign } = await fixture
  assert.equal(await verifyGoogleIdToken(await sign(GOOD_CLAIMS), { audience: '', keys }), null)
})

test('verifyGoogleIdToken treats only boolean email_verified=true as verified', async () => {
  const { keys, sign } = await fixture
  const profile = await verifyGoogleIdToken(await sign({ ...GOOD_CLAIMS, email_verified: 'true' }), { audience: AUDIENCE, keys })
  assert.equal(profile?.emailVerified, false)
})

test('verifyGoogleIdToken accepts any of our client ids and checks azp', async () => {
  const { keys, sign } = await fixture
  const other = 'second-client.apps.googleusercontent.com'
  assert.equal((await verifyGoogleIdToken(await sign(GOOD_CLAIMS, { aud: other }), { audience: [AUDIENCE, other], keys }))?.googleId, GOOD_CLAIMS.sub)
  assert.equal(await verifyGoogleIdToken(await sign({ ...GOOD_CLAIMS, azp: 'attacker.apps.googleusercontent.com' }), { audience: AUDIENCE, keys }), null)
  assert.equal((await verifyGoogleIdToken(await sign({ ...GOOD_CLAIMS, azp: AUDIENCE }), { audience: AUDIENCE, keys }))?.googleId, GOOD_CLAIMS.sub)
})

test('verifyGoogleIdToken requires exp and iat', async () => {
  const { keys, sign } = await fixture
  assert.equal(await verifyGoogleIdToken(await sign(GOOD_CLAIMS, { exp: null }), { audience: AUDIENCE, keys }), null)
  assert.equal(await verifyGoogleIdToken(await sign(GOOD_CLAIMS, { iat: false }), { audience: AUDIENCE, keys }), null)
})

test('verifyGoogleIdToken reports unreachable Google keys instead of rejecting the user', async () => {
  const { sign } = await fixture
  const unreachable: JWTVerifyGetKey = async () => {
    throw new TypeError('fetch failed')
  }
  await assert.rejects(verifyGoogleIdToken(await sign(GOOD_CLAIMS), { audience: AUDIENCE, keys: unreachable }), GoogleKeysUnavailableError)
})

test('hasGoogleLink only counts real numeric Google ids', () => {
  assert.equal(hasGoogleLink('109876543210987654321'), true)
  assert.equal(hasGoogleLink('duck@example.com'), false)
  assert.equal(hasGoogleLink('google-user-123'), false)
  assert.equal(hasGoogleLink(''), false)
  assert.equal(hasGoogleLink(null), false)
})

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
  const apply = (entries: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  apply(values)
  try {
    return run()
  } finally {
    apply(previous)
  }
}

test('googleAudiences accepts both configured client ids and the button uses the public one', () => {
  withEnv({ GOOGLE_CLIENT_ID: 'server-id', NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'public-id' }, () => {
    assert.deepEqual(googleAudiences(), ['server-id', 'public-id'])
    assert.equal(googleClientId(), 'public-id')
  })
  withEnv({ GOOGLE_CLIENT_ID: ' same-id ', NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'same-id' }, () => assert.deepEqual(googleAudiences(), ['same-id']))
  withEnv({ GOOGLE_CLIENT_ID: undefined, NEXT_PUBLIC_GOOGLE_CLIENT_ID: undefined }, () => {
    assert.deepEqual(googleAudiences(), [])
    assert.equal(googleClientId(), '')
  })
})

function withSecret<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.RACE_SECRET_KEY
  if (value === undefined) delete process.env.RACE_SECRET_KEY
  else process.env.RACE_SECRET_KEY = value
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.RACE_SECRET_KEY
    else process.env.RACE_SECRET_KEY = previous
  }
}

test('isAdminSecret fails closed when RACE_SECRET_KEY is unset or blank', () => {
  withSecret(undefined, () => {
    assert.equal(isAdminSecret(undefined), false)
    assert.equal(isAdminSecret(''), false)
    assert.equal(isAdminRequest(new Request('http://x/api/admin/season3'), {}), false)
  })
  withSecret('   ', () => assert.equal(isAdminSecret('   '), false))
})

test('isAdminSecret compares secrets of any length without throwing', () => {
  withSecret('correct-horse-battery-staple\n', () => assert.equal(isAdminSecret('correct-horse-battery-staple'), true))
  withSecret('correct-horse-battery-staple', () => {
    assert.equal(isAdminSecret('correct-horse-battery-staple'), true)
    assert.equal(isAdminSecret('wrong'), false)
    assert.equal(isAdminSecret('correct-horse-battery-staple-and-more'), false)
    assert.equal(isAdminSecret(null), false)
  })
})

test('isAdminRequest accepts the secret from query, header, or body', () => {
  withSecret('correct-horse-battery-staple', () => {
    assert.equal(isAdminRequest(new Request('http://x/api?secret=correct-horse-battery-staple')), true)
    assert.equal(isAdminRequest(new Request('http://x/api', { headers: { 'x-race-secret': 'correct-horse-battery-staple' } })), true)
    assert.equal(isAdminRequest(new Request('http://x/api'), { secret: 'correct-horse-battery-staple' }), true)
    assert.equal(isAdminRequest(new Request('http://x/api?secret=nope'), { secret: 'nope' }), false)
    assert.equal(isAdminRequest(new Request('http://x/api'), { secret: 42 }), false)
  })
})
