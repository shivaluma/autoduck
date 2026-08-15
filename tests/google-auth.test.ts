import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeGoogleJwt,
  verifyGoogleToken,
} from '../lib/auth/google'

test('decodeGoogleJwt parses valid Google ID token payload', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'google-user-123456',
      email: 'duadzit.tester@gmail.com',
      name: 'Tester Dzịt',
      picture: 'https://example.com/avatar.png',
      email_verified: true,
    }),
  ).toString('base64url')
  const mockJwt = `${header}.${payload}.mockSignature`

  const decoded = decodeGoogleJwt(mockJwt)
  assert.ok(decoded)
  assert.equal(decoded?.googleId, 'google-user-123456')
  assert.equal(decoded?.email, 'duadzit.tester@gmail.com')
  assert.equal(decoded?.name, 'Tester Dzịt')
  assert.equal(decoded?.picture, 'https://example.com/avatar.png')
  assert.equal(decoded?.emailVerified, true)
})

test('decodeGoogleJwt returns null for malformed token', () => {
  assert.equal(decodeGoogleJwt(''), null)
  assert.equal(decodeGoogleJwt('invalid-token'), null)
  assert.equal(decodeGoogleJwt('part1.invalidbase64!'), null)
})

test('verifyGoogleToken parses direct email and mock tokens', async () => {
  const emailResult = await verifyGoogleToken('thanh@gmail.com')
  assert.ok(emailResult)
  assert.equal(emailResult.email, 'thanh@gmail.com')
  assert.equal(emailResult.googleId, 'thanh@gmail.com')

  const jsonResult = await verifyGoogleToken(
    JSON.stringify({
      sub: 'google-id-789',
      email: 'duck@gmail.com',
      name: 'Duck 789',
    }),
  )
  assert.ok(jsonResult)
  assert.equal(jsonResult.googleId, 'google-id-789')
  assert.equal(jsonResult.email, 'duck@gmail.com')
})

test('verifyGoogleToken handles JWT strings gracefully', async () => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'google-sub-999',
      email: 'kingduck@gmail.com',
      name: 'King Duck',
    }),
  ).toString('base64url')
  const jwt = `${header}.${payload}.mockSignature`

  const result = await verifyGoogleToken(jwt)
  assert.ok(result)
  assert.equal(result.googleId, 'google-sub-999')
  assert.equal(result.email, 'kingduck@gmail.com')
  assert.equal(result.name, 'King Duck')
})

test('Google Account Binding collision prevention logic', () => {
  type MockUser = { id: number; name: string; googleId: string | null; email: string | null }
  const users: MockUser[] = [
    { id: 1, name: 'Thanh', googleId: 'google-thanh-123', email: 'thanh@gmail.com' },
    { id: 2, name: 'Huy', googleId: null, email: null },
  ]

  function attemptBind(userId: number, profile: { googleId: string; email: string }) {
    const existing = users.find(
      (u) => u.googleId === profile.googleId || (u.email && u.email.toLowerCase() === profile.email.toLowerCase()),
    )
    if (existing && existing.id !== userId) {
      return { ok: false, error: `Tài khoản Google đã liên kết với ${existing.name}` }
    }
    const current = users.find((u) => u.id === userId)
    if (!current) return { ok: false, error: 'User không tồn tại' }
    current.googleId = profile.googleId
    current.email = profile.email
    return { ok: true, user: current }
  }

  // Binding existing google account to a different user fails with conflict
  const conflict = attemptBind(2, { googleId: 'google-thanh-123', email: 'thanh@gmail.com' })
  assert.equal(conflict.ok, false)
  assert.ok(conflict.error?.includes('Thanh'))

  // Binding new google account to user 2 succeeds
  const success = attemptBind(2, { googleId: 'google-huy-456', email: 'huy@gmail.com' })
  assert.equal(success.ok, true)
  assert.equal(users[1].googleId, 'google-huy-456')
  assert.equal(users[1].email, 'huy@gmail.com')
})
