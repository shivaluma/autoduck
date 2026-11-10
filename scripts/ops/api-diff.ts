/**
 * API + mutation diff between two servers on separate copies of the same DB snapshot
 * (rewrite plan Phase 3 gate). A is the reference (TS `main`), B the candidate (Rust).
 *
 *   tsx scripts/ops/api-diff.ts get    --a URL --b URL --db COPY.db --secret S [--accept FILE] [--requests-out FILE] [--report FILE]
 *   tsx scripts/ops/api-diff.ts mutate --a URL --b URL --base-db SNAPSHOT.db --a-db A.db --b-db B.db --secret S
 *                                      --google-key KEY.pem --google-aud AUD [--accept FILE] [--report FILE]
 *   tsx scripts/ops/api-diff.ts serve-jwks --google-key KEY.pem --port N
 *
 * `get` builds its request list from a DB copy (opened read-only): every user and race id plus
 * malformed ids, every player's token, wrong tokens, with and without the admin secret.
 * Responses are compared on status and body: JSON key order is ignored, numbers are compared by
 * their source text (`1` ≠ `1.0`), other bodies by content type and SHA-256. The headers in
 * `COMPARED_HEADERS` are compared too (absent = '').
 *
 * `mutate` replays one request sequence (shop purchases, gacha pulls with fixed idempotency keys,
 * admin cosmetics actions, Google bind/login/unbind with ID tokens signed by a local key) against
 * both servers, step by step, then compares every table of the two DB files. Ids and timestamps
 * created during the run are masked (`<cuid>`, `<uuid>`, `<now:shape>`); everything else must be
 * identical, SQLite storage class included (`quote()`). Rows that B wrote (absent from the base
 * snapshot) must store every DATETIME as `YYYY-MM-DDTHH:MM:SS.mmm+00:00` (D13), except
 * `AppMigration.runAt`. Both servers must trust the local JWKS (`serve-jwks`): Rust with
 * `AUTODUCK_ENV=dev AUTODUCK_GOOGLE_JWKS_URL=…`, the TS reference with the test-only hook.
 *
 * Accept list (JSON array): `{ "id", "method"?, "path" (regex on path+query), "status"?, "bStatus"?,
 * "emptyReferenceBody"?, "header"?, "aValue"?, "bValue"?, "reason" }`. An entry without `header`
 * accepts a status/content-type/body difference; an entry with `header` (`a|b` for several)
 * accepts a difference in those headers only (optionally only between the exact values `aValue` → `bValue`). A row is
 * accepted only when every kind of difference it has is covered. Every entry needs a non-empty
 * reason; unused entries are reported as stale.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string, options?: { readonly?: boolean; fileMustExist?: boolean }) => Db
type Db = { prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }; close(): void }

// ---------------------------------------------------------------- args

const [mode, ...rest] = process.argv.slice(2)
const args = new Map<string, string>()
for (let index = 0; index < rest.length; index += 2) args.set(rest[index]!.replace(/^--/, ''), rest[index + 1] ?? '')
function arg(name: string): string {
  const value = args.get(name)
  if (!value) throw new Error(`missing --${name}`)
  return value
}

// ---------------------------------------------------------------- HTTP + comparison

type Step = { method: 'GET' | 'POST' | 'OPTIONS' | 'DELETE'; path: string; headers?: Record<string, string>; body?: string; label?: string }
type Outcome = { status: number; type: string; body: string; canonical: string; headers: Record<string, string> }

/** Response headers that are part of the API contract (caching, method lists, redirects). */
const COMPARED_HEADERS = ['cache-control', 'allow', 'etag', 'location', 'refresh', 'content-security-policy']

/** JSON with numbers kept as their source text (reviver `context.source`, V8 ≥ 11.4). */
function parseExact(text: string): unknown {
  return JSON.parse(text, function (_key, value, context?: { source?: string }) {
    return typeof value === 'number' ? { $num: context?.source ?? String(value) } : value
  })
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (typeof object.$num === 'string' && Object.keys(object).length === 1) return object.$num
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Paths where two exact-parsed JSON values differ (at most `limit`). */
function diffPaths(a: unknown, b: unknown, path = '$', out: string[] = [], limit = 8): string[] {
  if (out.length >= limit) return out
  if (canonical(a) === canonical(b)) return out
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v) && !('$num' in (v as object))
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`)
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diffPaths(a[i], b[i], `${path}[${i}]`, out, limit)
    return out
  }
  if (isObj(a) && isObj(b)) {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    for (const key of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      if (!(key in ao)) out.push(`${path}.${key}: only in B`)
      else if (!(key in bo)) out.push(`${path}.${key}: only in A`)
      else diffPaths(ao[key], bo[key], `${path}.${key}`, out, limit)
      if (out.length >= limit) break
    }
    return out
  }
  const show = (v: unknown) => canonical(v).slice(0, 160)
  out.push(`${path}: ${show(a)} vs ${show(b)}`)
  return out
}

async function send(base: string, step: Step, normalizeText: (text: string) => string = (text) => text): Promise<Outcome> {
  let response: Response
  try {
    response = await fetch(base + step.path, { method: step.method, headers: step.headers, body: step.body, redirect: 'manual' })
  } catch (error) {
    return { status: -1, type: 'error', body: String(error), canonical: `error:${String(error)}`, headers: {} }
  }
  const headers = Object.fromEntries(COMPARED_HEADERS.map((name) => [name, response.headers.get(name) ?? '']))
  const bytes = Buffer.from(await response.arrayBuffer())
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (type === 'application/json') {
    const body = normalizeText(bytes.toString('utf8'))
    try {
      return { status: response.status, type, body, canonical: canonical(parseExact(body)), headers }
    } catch {
      return { status: response.status, type, body, canonical: `invalid-json:${body}`, headers }
    }
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  const text = type.startsWith('text/') ? bytes.toString('utf8').slice(0, 200) : `${bytes.length} bytes`
  return { status: response.status, type, body: text, canonical: `${type}:${digest}`, headers }
}

/**
 * `status`: only when A answered this status (and B too, unless `bStatus` is given). `bStatus`: the
 * statuses B may answer. `emptyReferenceBody`: only when A's body was empty (a framework error page,
 * not route output). `header`/`aValue`/`bValue`: see the header comment.
 */
type AcceptEntry = {
  id: string
  method?: string
  path: string
  status?: number
  bStatus?: number[]
  emptyReferenceBody?: boolean
  header?: string
  aValue?: string
  bValue?: string
  reason: string
  regex: RegExp
  used: number
}

function loadAccept(file: string | undefined): AcceptEntry[] {
  if (!file) return []
  const entries = JSON.parse(readFileSync(file, 'utf8')) as Array<Omit<AcceptEntry, 'regex' | 'used'>>
  return entries.map((entry) => {
    if (!entry.id || !entry.path || typeof entry.reason !== 'string' || entry.reason.trim().length < 10) {
      throw new Error(`accept-list entry ${JSON.stringify(entry)} needs an id, a path regex and a justification`)
    }
    return { ...entry, regex: new RegExp(entry.path), used: 0 }
  })
}

/** The entry covering one kind of difference (`header` undefined = status/type/body). */
function accepting(accept: AcceptEntry[], step: Step, a: Outcome, b: Outcome, header?: string): AcceptEntry | undefined {
  return accept.find((entry) =>
    (!entry.method || entry.method === step.method) &&
    entry.regex.test(step.path) &&
    (entry.header === undefined ? header === undefined : header !== undefined && entry.header.split('|').includes(header)) &&
    (entry.status === undefined || (a.status === entry.status && (entry.bStatus ? true : b.status === entry.status))) &&
    (entry.bStatus === undefined || entry.bStatus.includes(b.status)) &&
    (!entry.emptyReferenceBody || a.body === '0 bytes') &&
    (header === undefined || entry.aValue === undefined || a.headers[header] === entry.aValue) &&
    (header === undefined || entry.bValue === undefined || b.headers[header] === entry.bValue))
}

/** All entries covering the row, or undefined when any difference is uncovered. */
function accepted(accept: AcceptEntry[], step: Step, a: Outcome, b: Outcome, responseDiffers: boolean, headers: string[]): AcceptEntry[] | undefined {
  const hits: AcceptEntry[] = []
  for (const header of [...(responseDiffers ? [undefined] : []), ...headers]) {
    const hit = accepting(accept, step, a, b, header)
    if (!hit) return undefined
    hits.push(hit)
  }
  for (const hit of hits) hit.used += 1
  return hits
}

type Row = { step: Step; a: Outcome; b: Outcome; same: boolean; accept?: AcceptEntry[]; detail: string[] }

function compareOutcomes(step: Step, a: Outcome, b: Outcome, accept: AcceptEntry[]): Row {
  const detail: string[] = []
  if (a.status !== b.status) detail.push(`status ${a.status} vs ${b.status}`)
  if (a.type !== b.type) detail.push(`content-type ${a.type || '-'} vs ${b.type || '-'}`)
  if (a.canonical !== b.canonical) {
    if (a.type === 'application/json' && b.type === 'application/json') {
      try {
        detail.push(...diffPaths(parseExact(a.body), parseExact(b.body)))
      } catch {
        detail.push('body differs (invalid JSON)')
      }
    } else detail.push(`body ${a.body.slice(0, 120)} vs ${b.body.slice(0, 120)}`)
  }
  const responseDiffers = detail.length > 0
  const headers = COMPARED_HEADERS.filter((name) => (a.headers[name] ?? '') !== (b.headers[name] ?? ''))
  for (const name of headers) detail.push(`header ${name}: ${JSON.stringify(a.headers[name] ?? '')} vs ${JSON.stringify(b.headers[name] ?? '')}`)
  const same = detail.length === 0
  return { step, a, b, same, accept: same ? undefined : accepted(accept, step, a, b, responseDiffers, headers), detail }
}

function redact(path: string) {
  return path.replace(/(token|secret)=([^&]{4})[^&]*/g, '$1=$2…')
}

function report(title: string, rows: Row[], accept: AcceptEntry[]): { lines: string[]; unaccepted: number } {
  const lines = [`# ${title}`, '']
  const differing = rows.filter((row) => !row.same)
  const unaccepted = differing.filter((row) => !row.accept)
  lines.push(`requests: ${rows.length}, identical: ${rows.length - differing.length}, accepted differences: ${differing.length - unaccepted.length}, UNACCEPTED: ${unaccepted.length}`)
  const statuses = new Map<string, number>()
  for (const row of rows) statuses.set(`${row.step.method} ${row.a.status}`, (statuses.get(`${row.step.method} ${row.a.status}`) ?? 0) + 1)
  lines.push(`reference statuses: ${[...statuses].map(([key, count]) => `${key}×${count}`).join(', ')}`)
  for (const row of unaccepted) {
    lines.push('', `UNACCEPTED ${row.step.method} ${redact(row.step.path)}${row.step.label ? ` [${row.step.label}]` : ''}`)
    if (row.step.body) lines.push(`  request body: ${row.step.body.length > 160 ? `${row.step.body.slice(0, 160)}…` : row.step.body}`)
    for (const line of row.detail) lines.push(`  ${line}`)
  }
  if (differing.length > unaccepted.length) {
    lines.push('', 'accepted differences:')
    for (const entry of accept.filter((e) => e.used > 0)) lines.push(`  ${entry.id} ×${entry.used}: ${entry.reason}`)
  }
  const stale = accept.filter((entry) => entry.used === 0)
  if (stale.length > 0) lines.push('', `stale accept-list entries (matched nothing): ${stale.map((e) => e.id).join(', ')}`)
  return { lines, unaccepted: unaccepted.length }
}

// ---------------------------------------------------------------- GET diff

function buildGetRequests(dbPath: string, secret: string): Step[] {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const users = (db.prepare('SELECT id FROM "User" ORDER BY id').all() as Array<{ id: number }>).map((u) => String(u.id))
  const players = db.prepare('SELECT p.id, p.userId, p.accessToken FROM "SeasonPlayer" p ORDER BY p.id').all() as Array<{ id: number; userId: number; accessToken: string }>
  const races = (db.prepare('SELECT id FROM "Race" ORDER BY id').all() as Array<{ id: number }>).map((r) => String(r.id))
  const tracks = (db.prepare('SELECT raceId FROM "RaceReplayTrack" ORDER BY raceId').all() as Array<{ raceId: number }>).map((r) => String(r.raceId))
  db.close()

  const steps: Step[] = []
  const get = (path: string, headers?: Record<string, string>, label?: string) => steps.push({ method: 'GET', path, headers, label })
  const q = (token: string) => `token=${encodeURIComponent(token)}`
  const tokens = players.map((p) => p.accessToken)
  const badIds = ['0', '-1', 'abc', '1.5', '1e0', '0x1', '%20', '-0', '99999', '9007199254740993', 'Infinity']

  get('/api/health')
  get('/api/does-not-exist')
  get('/api/cosmetics')
  // Next.js framework behaviour on paths and methods (review 3, findings 3 and 4).
  for (const path of ['/api/health/', '/api//health', '/api/races/1/', '/api/cosmetics/shop/?token=x']) get(path, undefined, 'non-canonical path')
  for (const path of ['/api/health', '/api/races/1', '/api/cosmetics/shop', '/api/gacha/pull', '/api/admin/cosmetics', '/api/auth/google', '/api/avatars/1']) {
    steps.push({ method: 'OPTIONS', path, label: 'preflight' })
  }
  for (const path of ['/api/health', '/api/races/1', '/api/cosmetics/shop']) steps.push({ method: 'DELETE', path, label: 'wrong method' })

  for (const id of [...users, ...badIds]) {
    get(`/api/cosmetics/profile/${id}`)
    get(`/api/cosmetics/profile/${id}?token=nope`)
    get(`/api/cosmetics/profile/${id}?token=`)
  }
  for (const player of players) {
    get(`/api/cosmetics/profile/${player.userId}?${q(player.accessToken)}`, undefined, 'own token')
    const other = players.find((p) => p.id !== player.id)
    if (other) get(`/api/cosmetics/profile/${player.userId}?${q(other.accessToken)}`, undefined, 'another player token')
  }

  get('/api/cosmetics/shop')
  get('/api/cosmetics/shop?token=')
  get('/api/cosmetics/shop?token=nope')
  for (const token of tokens) get(`/api/cosmetics/shop?${q(token)}`)

  get('/api/admin/cosmetics')
  get('/api/admin/cosmetics', { 'x-race-secret': 'wrong-secret-wrong-secret' })
  get('/api/admin/cosmetics', { 'x-race-secret': `  ${secret}  ` }, 'padded secret')
  get('/api/admin/cosmetics', { 'x-race-secret': secret })
  get(`/api/admin/cosmetics?secret=${encodeURIComponent(secret)}`, undefined, 'query secret (header only)')

  // Admin Season 3 (stage B): dashboard and ops report; POST actions are diffed by the admin harness.
  get('/api/admin/season3')
  get('/api/admin/season3', { 'x-race-secret': 'wrong-secret-wrong-secret' })
  get('/api/admin/season3', { 'x-race-secret': `  ${secret}  ` }, 'padded secret')
  get(`/api/admin/season3?secret=${encodeURIComponent(secret)}`, undefined, 'query secret')
  get('/api/admin/season3?report=ops')
  get('/api/admin/season3?report=ops', { 'x-race-secret': secret })
  get(`/api/admin/season3?report=ops&secret=${encodeURIComponent(secret)}`)
  get('/api/admin/season3/', { 'x-race-secret': secret }, 'non-canonical path')
  steps.push({ method: 'OPTIONS', path: '/api/admin/season3', label: 'preflight' })
  steps.push({ method: 'DELETE', path: '/api/admin/season3', label: 'wrong method' })

  // Season 3 player page (stage B): every token, none, empty and unknown. POST actions and
  // redeem are diffed by scripts/ops/season3-player-diff.ts.
  get('/api/season3')
  get('/api/season3?token=')
  get('/api/season3?token=nope')
  get('/api/season3?token=a&token=b')
  for (const token of tokens) get(`/api/season3?${q(token)}`)
  get('/api/season3/', undefined, 'non-canonical path')
  steps.push({ method: 'OPTIONS', path: '/api/season3', label: 'preflight' })
  steps.push({ method: 'DELETE', path: '/api/season3', label: 'wrong method' })
  steps.push({ method: 'GET', path: '/api/season3/redeem', label: 'redeem is POST only' })

  get('/api/auth/google')
  get('/api/auth/google?token=nope')
  for (const token of tokens) get(`/api/auth/google?${q(token)}`)

  // Canonical ids only on main since 8c0be4f (parseRaceIdParam): 400 for '041'/'+1'/'12abc', 404 above 2^31 - 1.
  const raceIds = [...races, ...badIds, '1e3', '0x1A', '12abc', ' 38', '041', '+1', '38 ', '2147483647', '2147483648', '9223372036854775807', '9223372036854775808']
  for (const id of raceIds) {
    const path = `/api/races/${encodeURIComponent(id)}`
    get(path)
    get(`${path}?token=nope`)
  }
  for (const id of races) for (const token of tokens.slice(0, 4)) get(`/api/races/${id}?${q(token)}`)
  for (const id of [...new Set([...tracks, ...races.slice(-3), 'abc', '99999', '0', '01', '0x1', '1.0', '2147483648', '9007199254740993'])]) get(`/api/races/${encodeURIComponent(id)}/track`)
  for (const id of tracks.slice(0, 2)) {
    get(`/api/races/${id}/track`, { 'accept-encoding': 'gzip' }, 'gzip')
    get(`/api/races/${id}/track`, { 'accept-encoding': 'identity' }, 'decompressed')
  }

  for (const id of [...users, ...badIds]) get(`/api/avatars/${encodeURIComponent(id)}`)
  return steps
}

/** The admin ops report's `generatedAt` is the request time on each server. */
function maskGeneratedAt(text: string): string {
  return text.replace(/^(\{"report":"ops","generatedAt":")[^"]*"/, '$1<now>"')
}

async function runGet() {
  const a = arg('a')
  const b = arg('b')
  const accept = loadAccept(args.get('accept'))
  const steps = args.has('requests') ? (JSON.parse(readFileSync(arg('requests'), 'utf8')) as Step[]) : buildGetRequests(arg('db'), arg('secret'))
  if (args.has('requests-out')) writeFileSync(arg('requests-out'), JSON.stringify(steps, null, 1))
  const rows: Row[] = []
  for (const step of steps) {
    const [ra, rb] = await Promise.all([send(a, step, maskGeneratedAt), send(b, step, maskGeneratedAt)])
    rows.push(compareOutcomes(step, ra, rb, accept))
  }
  const { lines, unaccepted } = report(`GET diff ${a} (A) vs ${b} (B)`, rows, accept)
  finish(lines, unaccepted)
}

// ---------------------------------------------------------------- mutation diff

const CUID = /\bc[a-z0-9]{24}\b/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/g
const ISO = /\b20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(Z|\+00:00)/g
const D13 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$/

/** Masks ids and timestamps minted during the run; keeps the timestamp's shape. */
function masker(startedAt: number) {
  return (text: string) =>
    text
      .replace(UUID, '<uuid>')
      .replace(CUID, (id) => (parseInt(id.slice(1, 9), 36) >= startedAt - 1000 ? '<cuid>' : id))
      .replace(ISO, (iso) => (Date.parse(iso.replace('+00:00', 'Z')) >= startedAt - 1000 ? `<now:${iso.replace(/\d/g, '9')}>` : iso))
}

async function googleSigner(keyFile: string, audience: string) {
  const { SignJWT, importPKCS8 } = require('jose') as typeof import('jose')
  const key = await importPKCS8(readFileSync(keyFile, 'utf8'), 'RS256')
  return (claims: Record<string, unknown>, options: { aud?: string; exp?: number | string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'api-diff-key', typ: 'JWT' })
      .setIssuer('https://accounts.google.com')
      .setAudience(options.aud ?? audience)
      .setIssuedAt()
      .setExpirationTime(options.exp ?? '1h')
      .sign(key)
}

async function serveJwks() {
  const { createPrivateKey, createPublicKey } = await import('node:crypto')
  const publicKey = createPublicKey(createPrivateKey(readFileSync(arg('google-key'), 'utf8')))
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'api-diff-key', alg: 'RS256', use: 'sig' }
  const body = JSON.stringify({ keys: [jwk] })
  createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(body)
  }).listen(Number(arg('port')), '127.0.0.1', () => console.log(`jwks on http://127.0.0.1:${arg('port')}/certs`))
}

type Player = { id: number; userId: number; token: string }

async function buildMutationPlan(players: Player[], secret: string, sign: Awaited<ReturnType<typeof googleSigner>>): Promise<Step[]> {
  const [p1, p2, p3, p4] = players as [Player, Player, Player, Player]
  const steps: Step[] = []
  const json = { 'content-type': 'application/json' }
  const admin = { 'x-race-secret': secret }
  const get = (path: string, headers: Record<string, string> = {}) => steps.push({ method: 'GET', path, headers })
  const post = (path: string, body: unknown, headers: Record<string, string> = {}, label?: string) =>
    steps.push({ method: 'POST', path, headers: { ...json, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), label })
  const adminPost = (body: unknown) => post('/api/admin/cosmetics', body, admin)
  const shop = (player: Player) => get(`/api/cosmetics/shop?token=${encodeURIComponent(player.token)}`)

  for (const player of players) shop(player)

  // Admin: QP and catalog configuration.
  post('/api/admin/cosmetics', { action: 'adjust-qp', playerId: p1.id, amount: 5 }, { 'x-race-secret': 'wrong' })
  adminPost({ action: 'adjust-qp', playerId: p1.id, amount: 200 })
  adminPost({ action: 'adjust-qp', playerId: p2.id, amount: 40.0 })
  adminPost({ action: 'adjust-qp', playerId: p3.id, amount: 2 })
  adminPost({ action: 'adjust-qp', playerId: p4.id, amount: 1.7 })
  adminPost({ action: 'adjust-qp', playerId: 99999, amount: 3 })
  adminPost({ action: 'adjust-qp', playerId: p3.id, amount: -50 })
  adminPost('{"action":"adjust-qp","playerId":"3","amount":1}')
  // Review 1, finding 1: a balance past 2^53−1 is unreadable by Prisma, so TS answers 409 and
  // rolls back; Rust must too (and write nothing).
  adminPost({ action: 'adjust-qp', playerId: p2.id, amount: 2147483647 })
  adminPost({ action: 'adjust-qp', playerId: p2.id, amount: 3000000000 })
  adminPost({ action: 'adjust-qp', playerId: p2.id, amount: 9007199254740991 })
  adminPost({ action: 'adjust-qp', playerId: p2.id, amount: -5147483647 })
  adminPost('{bad json')
  adminPost({ action: 'nope' })
  adminPost({ action: 'configure', cosmeticId: '$offer:p1:0', priceOverride: 1, limitedLabel: 'Hot' })
  adminPost({ action: 'configure', cosmeticId: '$offer:p1:1', enabled: false })
  adminPost({ action: 'configure', cosmeticId: '$offer:p1:2', shopEligible: false, limitedLabel: null })
  adminPost({ action: 'configure', cosmeticId: 'body-golden', gachaEligible: false })
  adminPost({ action: 'configure', cosmeticId: 'not-a-cosmetic' })
  shop(p1)

  // Shop purchases (`$offer:pN:i` = item i of player N's first shop response on that server).
  post('/api/cosmetics/shop', { token: p1.token, cosmeticId: '$offer:p1:0', idempotencyKey: 'buy-1' })
  post('/api/cosmetics/shop', { token: p1.token, cosmeticId: '$offer:p1:0', idempotencyKey: 'buy-1' }, {}, 'replay')
  post('/api/cosmetics/shop', { token: p1.token, cosmeticId: '$offer:p1:1', idempotencyKey: 'buy-2' })
  post('/api/cosmetics/shop', { token: p1.token, cosmeticId: '$offer:p1:2', idempotencyKey: 'buy-3' })
  post('/api/cosmetics/shop', { token: p1.token, cosmeticId: '$offer:p1:4', idempotencyKey: 'buy-4' })
  post('/api/cosmetics/shop', { token: p1.token, cosmeticId: 'nope', idempotencyKey: 'buy-5' })
  post('/api/cosmetics/shop', { token: 'bad', cosmeticId: 'body-sunshine', idempotencyKey: 'x' })
  post('/api/cosmetics/shop', { token: p3.token, cosmeticId: '$offer:p3:5', idempotencyKey: 'buy-p3' })
  post('/api/cosmetics/shop', { token: p2.token, cosmeticId: '$offer:p2:0', idempotencyKey: 'buy-1' }, {}, 'key owned by p1')
  post('/api/cosmetics/shop', '{oops')

  // Gacha with fixed idempotency keys (rolls come from AUTODUCK_TEST_RNG_SEED on both sides).
  post('/api/gacha/pull', {})
  post('/api/gacha/pull', { token: 'bad', idempotencyKey: 'g' })
  post('/api/gacha/pull', { token: p4.token, idempotencyKey: 'g-p4' })
  for (let index = 0; index < 40; index += 1) post('/api/gacha/pull', { token: p1.token, idempotencyKey: `g-p1-${index}` })
  post('/api/gacha/pull', { token: p1.token, idempotencyKey: 'g-p1-3' }, {}, 'replay')
  post('/api/gacha/pull', { token: p2.token, idempotencyKey: 'g-p1-4' }, {}, 'key owned by p1')
  for (let index = 0; index < 8; index += 1) post('/api/gacha/pull', { token: p2.token, idempotencyKey: `g-p2-${index}` })

  // Admin inventory.
  adminPost({ action: 'grant', playerId: p4.id, cosmeticId: 'body-golden' })
  adminPost({ action: 'grant', playerId: p4.id, cosmeticId: 'body-golden' })
  adminPost({ action: 'revoke', playerId: p4.id, cosmeticId: 'body-sunshine' })
  adminPost({ action: 'grant', playerId: p4.id, cosmeticId: 'nope' })
  adminPost({ action: 'grant-all', playerId: p4.id, slot: 'head' })
  adminPost({ action: 'grant-all', playerId: p3.id })
  adminPost({ action: 'revoke-all', playerId: p3.id, slot: 'pet' })
  adminPost({ action: 'revoke', playerId: p1.id, cosmeticId: '$offer:p1:0' })
  post('/api/cosmetics/shop', { token: p1.token, cosmeticId: '$offer:p1:0', idempotencyKey: 'buy-again' })

  // Google: bind, login, conflicts, unbind (tokens signed by the local test key).
  const base = { email: 'Duck@Example.com', email_verified: true, name: 'Dzịt Diff', picture: 'https://example.com/duck.png' }
  const s1 = await sign({ ...base, sub: '100000000000000000001' })
  const s2 = await sign({ ...base, sub: '100000000000000000002', name: 'Second', email: 'second@example.com' })
  const s3 = await sign({ ...base, sub: '100000000000000000003', email_verified: false, email: 'unverified@example.com' })
  const expired = await sign({ ...base, sub: '100000000000000000001' }, { exp: Math.floor(Date.now() / 1000) - 3600 })
  const wrongAud = await sign({ ...base, sub: '100000000000000000001' }, { aud: 'other.apps.googleusercontent.com' })
  const google = (body: unknown, label?: string) => post('/api/auth/google', body, {}, label)
  google({ credential: s1 }, 'login before bind')
  google({ action: 'bind', credential: s1 }, 'bind without token')
  google({ action: 'bind', credential: s1, token: 'nope' })
  google({ action: 'bind', credential: s1, token: p1.token })
  google({ action: 'bind', credential: s1, token: p2.token }, 'sub linked elsewhere')
  google({ action: 'bind', credential: s2, token: p2.token })
  google({ action: 'bind', credential: s3, token: p3.token }, 'unverified email')
  google({ action: 'bind', credential: expired, token: p4.token })
  google({ action: 'bind', credential: wrongAud, token: p4.token })
  google({ action: 'bind', credential: 'not.a.jwt', token: p4.token })
  google({ action: 'bind', token: p4.token }, 'missing credential')
  google({ action: 'fly', credential: s1 })
  google('[]')
  google({ credential: s1 }, 'login p1')
  google({ credential: s2 }, 'login p2')
  for (const player of players) get(`/api/auth/google?token=${encodeURIComponent(player.token)}`)
  google({ action: 'unbind', token: p1.token })
  google({ action: 'unbind' })
  google({ action: 'unbind', token: 'nope' })
  google({ credential: s1 }, 'login after unbind')
  google({ action: 'bind', credential: s1, token: p4.token }, 'rebind sub to another duck')
  google({ credential: s1 }, 'login p4')

  get('/api/admin/cosmetics', admin)
  for (const player of players) get(`/api/cosmetics/profile/${player.userId}?token=${encodeURIComponent(player.token)}`)
  for (const player of players) shop(player)
  return steps
}

/** Resolves `$offer:pN:i` from the first 200 shop response seen for player N on one server. */
function offerResolver(players: Player[]) {
  const offers = new Map<string, string[]>()
  return {
    observe(step: Step, outcome: Outcome) {
      const prefix = '/api/cosmetics/shop?token='
      if (step.method !== 'GET' || !step.path.startsWith(prefix) || outcome.status !== 200) return
      const token = decodeURIComponent(step.path.slice(prefix.length))
      if (!offers.has(token)) offers.set(token, (JSON.parse(outcome.body) as { items: Array<{ id: string }> }).items.map((item) => item.id))
    },
    resolve(step: Step): Step {
      if (!step.body) return step
      const body = step.body.replace(/\$offer:p(\d):(\d+)/g, (_, n: string, i: string) => offers.get(players[Number(n) - 1]!.token)?.[Number(i)] ?? `missing-p${n}-${i}`)
      return { ...step, body }
    },
  }
}

type TableDump = { columns: string[]; types: string[]; rows: string[][] }

function dumpTables(dbPath: string): Map<string, TableDump> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name`).all() as Array<{ name: string }>).map((t) => t.name)
  const out = new Map<string, TableDump>()
  for (const table of tables) {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string; type: string }>
    const select = info.map((column) => `quote("${column.name}")`).join(', ')
    const rows = (db.prepare(`SELECT ${select} FROM "${table}"`).all() as Array<Record<string, string>>).map((row) => Object.values(row).map(String))
    out.set(table, { columns: info.map((c) => c.name), types: info.map((c) => c.type.toUpperCase()), rows })
  }
  db.close()
  return out
}

function compareDbs(basePath: string, aPath: string, bPath: string, mask: (text: string) => string) {
  const lines: string[] = ['', '## DB rows (A vs B, run-minted ids and timestamps masked)']
  const base = dumpTables(basePath)
  const a = dumpTables(aPath)
  const b = dumpTables(bPath)
  let tableDiffs = 0
  for (const table of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const ta = a.get(table)
    const tb = b.get(table)
    if (!ta || !tb) {
      lines.push(`DIFF  ${table}: only in ${ta ? 'A' : 'B'}`)
      tableDiffs += 1
      continue
    }
    if (ta.columns.join() !== tb.columns.join()) {
      lines.push(`DIFF  ${table}: columns differ`)
      tableDiffs += 1
      continue
    }
    const norm = (rows: string[][]) => rows.map((row) => mask(row.join(' | '))).sort()
    const ra = norm(ta.rows)
    const rb = norm(tb.rows)
    const changed = ta.rows.length !== (base.get(table)?.rows.length ?? 0) || ra.join('\n') !== norm(base.get(table)?.rows ?? []).join('\n')
    if (ra.join('\n') === rb.join('\n')) {
      if (changed) lines.push(`same  ${table} (${ra.length} rows, changed by the run)`)
      continue
    }
    tableDiffs += 1
    const onlyA = ra.filter((row) => !rb.includes(row))
    const onlyB = rb.filter((row) => !ra.includes(row))
    lines.push(`DIFF  ${table}: ${ra.length} vs ${rb.length} rows; columns: ${ta.columns.join(', ')}`)
    for (const row of onlyA.slice(0, 6)) lines.push(`  A only: ${row.slice(0, 400)}`)
    for (const row of onlyB.slice(0, 6)) lines.push(`  B only: ${row.slice(0, 400)}`)
  }
  if (tableDiffs === 0) lines.push(`all ${a.size} tables identical after masking`)

  // D13: every DATETIME in a row B wrote or changed (absent from the base snapshot).
  lines.push('', '## DATETIME format of rows written by B (D13)')
  let badDatetimes = 0
  let checked = 0
  for (const [table, dump] of b) {
    const baseRows = new Set((base.get(table)?.rows ?? []).map((row) => row.join('\u0000')))
    const written = dump.rows.filter((row) => !baseRows.has(row.join('\u0000')))
    dump.types.forEach((type, index) => {
      if (type !== 'DATETIME' || (table === 'AppMigration' && dump.columns[index] === 'runAt')) return
      for (const row of written) {
        const value = row[index]!
        if (value === 'NULL') continue
        checked += 1
        const text = value.startsWith("'") ? value.slice(1, -1) : value
        if (!D13.test(text)) {
          badDatetimes += 1
          if (badDatetimes <= 10) lines.push(`BAD   ${table}.${dump.columns[index]} = ${value}`)
        }
      }
    })
  }
  lines.push(`${checked} DATETIME values in written rows checked, ${badDatetimes} not matching ${D13}`)
  return { lines, failures: tableDiffs + badDatetimes }
}

async function runMutate() {
  const a = arg('a')
  const b = arg('b')
  const secret = arg('secret')
  const accept = loadAccept(args.get('accept'))
  const db = new Database(arg('a-db'), { readonly: true, fileMustExist: true })
  const players = (db.prepare('SELECT id, userId, accessToken AS token FROM "SeasonPlayer" ORDER BY id').all() as Player[]).slice(0, 4)
  db.close()
  if (players.length < 4) throw new Error('mutation plan needs 4 season players')
  const sign = await googleSigner(arg('google-key'), arg('google-aud'))
  const startedAt = Date.now()
  const mask = masker(startedAt)
  const plan = await buildMutationPlan(players, secret, sign)
  const resolveA = offerResolver(players)
  const resolveB = offerResolver(players)
  const rows: Row[] = []
  for (const raw of plan) {
    const stepA = resolveA.resolve(raw)
    const stepB = resolveB.resolve(raw)
    const ra = await send(a, stepA, mask)
    const rb = await send(b, stepB, mask)
    resolveA.observe(stepA, ra)
    resolveB.observe(stepB, rb)
    const row = compareOutcomes(raw, ra, rb, accept)
    if (stepA.body !== stepB.body) row.detail.unshift(`resolved bodies differ: ${stepA.body} vs ${stepB.body}`)
    rows.push({ ...row, same: row.detail.length === 0 })
  }
  const http = report(`Mutation diff ${a} (A) vs ${b} (B): responses`, rows, accept)
  const dbs = compareDbs(arg('base-db'), arg('a-db'), arg('b-db'), mask)
  finish([...http.lines, ...dbs.lines], http.unaccepted + dbs.failures)
}

function finish(lines: string[], failures: number) {
  lines.push('', failures === 0 ? 'RESULT: clean' : `RESULT: ${failures} unaccepted difference(s)`)
  const text = lines.join('\n')
  console.log(text)
  if (args.has('report')) writeFileSync(arg('report'), `${text}\n`)
  process.exitCode = failures === 0 ? 0 : 1
}

const modes: Record<string, () => Promise<void>> = { get: runGet, mutate: runMutate, 'serve-jwks': serveJwks }
const run = modes[mode ?? '']
if (!run) {
  console.error('usage: api-diff.ts get|mutate|serve-jwks [--options] (see the header comment)')
  process.exit(2)
}
run().catch((error) => {
  console.error(error)
  process.exit(2)
})
