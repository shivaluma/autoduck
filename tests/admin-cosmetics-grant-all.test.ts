import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { COSMETIC_CATALOG } from '../lib/cosmetics/catalog'

// The admin "grant-all" action used createMany({ skipDuplicates }), which Prisma rejects on
// SQLite, so the route always answered 500. These tests run the real route against a fresh
// SQLite file built from prisma/schema.prisma.

const root = path.join(__dirname, '..')
// better-sqlite3 ships no types (and @types/better-sqlite3 isn't installed); only these two calls are used.
const Database = createRequire(__filename)('better-sqlite3') as new (file: string) => { exec(sql: string): void; close(): void }
const dir = mkdtempSync(path.join(tmpdir(), 'autoduck-grant-all-'))
const dbFile = path.join(dir, 'test.db')
const secret = 'grant-all-test-secret-0123456789'

/* eslint-disable @typescript-eslint/no-explicit-any */
let prisma: any
let POST: (request: Request) => Promise<Response>
let playerId: number

function grantAll(body: Record<string, unknown>, headers: Record<string, string> = { 'x-race-secret': secret }) {
  return POST(new Request('http://localhost/api/admin/cosmetics', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ action: 'grant-all', playerId, ...body }),
  }))
}

before(async () => {
  const ddlFile = path.join(dir, 'schema.sql')
  execFileSync(path.join(root, 'node_modules', '.bin', 'prisma'), ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script', '--output', ddlFile], { cwd: root, stdio: 'pipe' })
  const db = new Database(dbFile)
  db.exec(readFileSync(ddlFile, 'utf8'))
  db.close()

  process.env.DATABASE_URL = `file:${dbFile}`
  process.env.RACE_SECRET_KEY = secret
  prisma = (await import('../lib/db')).prisma
  POST = (await import('../app/api/admin/cosmetics/route')).POST

  const user = await prisma.user.create({ data: { name: 'Grant Tester' } })
  const season = await prisma.season.create({ data: { key: 'grant-all-test', name: 'Test', year: 2026 } })
  const player = await prisma.seasonPlayer.create({ data: { seasonId: season.id, userId: user.id, accessToken: 'grant-all-token' } })
  playerId = player.id
})

after(async () => {
  await prisma?.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

test('grant-all inserts only the missing cosmetics and keeps the response shape', async () => {
  const preOwned = COSMETIC_CATALOG[0]!
  await prisma.playerCosmetic.create({ data: { seasonPlayerId: playerId, cosmeticId: preOwned.id, source: 'DEFAULT', isNew: false } })

  const response = await grantAll({ slot: 'all' })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, count: COSMETIC_CATALOG.length })

  const rows = await prisma.playerCosmetic.findMany({ where: { seasonPlayerId: playerId } })
  assert.equal(rows.length, COSMETIC_CATALOG.length)
  assert.deepEqual(new Set(rows.map((row: { cosmeticId: string }) => row.cosmeticId)), new Set(COSMETIC_CATALOG.map((item) => item.id)))
  const kept = rows.find((row: { cosmeticId: string }) => row.cosmeticId === preOwned.id)
  assert.equal(kept.source, 'DEFAULT', 'an owned cosmetic is left untouched')
  assert.equal(kept.isNew, false)
  assert.ok(rows.filter((row: { source: string }) => row.source === 'ADMIN_GRANT_ALL').every((row: { isNew: boolean }) => row.isNew))
})

test('a second grant-all is idempotent', async () => {
  const response = await grantAll({})
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, count: COSMETIC_CATALOG.length })
  assert.equal(await prisma.playerCosmetic.count({ where: { seasonPlayerId: playerId } }), COSMETIC_CATALOG.length)
  assert.equal(await prisma.cosmeticAdminEvent.count({ where: { action: 'GRANT_ALL_COSMETICS', playerId } }), 2)
})

test('grant-all for one slot only grants that slot', async () => {
  await prisma.playerCosmetic.deleteMany({ where: { seasonPlayerId: playerId } })
  const slot = COSMETIC_CATALOG[0]!.slot
  const expected = COSMETIC_CATALOG.filter((item) => item.slot === slot)
  const response = await grantAll({ slot })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, count: expected.length })
  const rows = await prisma.playerCosmetic.findMany({ where: { seasonPlayerId: playerId } })
  assert.deepEqual(rows.map((row: { cosmeticId: string }) => row.cosmeticId).sort(), expected.map((item) => item.id).sort())
})

test('grant-all still needs the admin secret and a valid player', async () => {
  assert.equal((await grantAll({}, {})).status, 401)
  assert.equal((await grantAll({ playerId: 999_999 })).status, 400)
})
