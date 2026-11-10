// Admin Season 3 diff plan (stage B): one request/SQL sequence replayed on TS (route handlers
// in-process) and Rust (autoduck serve, test-rng), then responses and DB rows are compared.
export const SECRET = 'admin-s3-diff-secret-0123456789'
export const SEED = '20261109'
const RESEED_REFUSED = 'Chỉ re-seed được khi tuần đang locked và race gần nhất của seed hiện tại đã failed'
const P = '/api/admin/season3'
const H = { 'content-type': 'application/json' }
const A = { ...H, 'x-race-secret': SECRET }

export function buildPlan() {
  const s = []
  const get = (path, headers = {}, label) => s.push({ kind: 'http', method: 'GET', path, headers, label })
  const raw = (body, headers = A, label) => s.push({ kind: 'http', method: 'POST', path: P, headers, body, label })
  const post = (body, label) => raw(JSON.stringify(body), A, label)
  const sql = (text, label) => s.push({ kind: 'sql', sql: text, label })
  const dash = (label) => get(P, { 'x-race-secret': SECRET }, label)
  const rustOnly = (body, status, error, label) => s.push({ kind: 'http', method: 'POST', path: P, headers: A, body: JSON.stringify(body), label, rustOnly: { status, body: JSON.stringify({ error }) } })
  const resolve = (weekNumber, raceId) => sql(`UPDATE SeasonWeek SET status='resolved', raceId=${raceId}, recap='Recap ${weekNumber}', resolvedAt='2026-08-20T00:00:00.000+00:00' WHERE weekNumber=${weekNumber} AND seasonId=(SELECT id FROM Season WHERE status='active')`, `resolve week ${weekNumber}`)

  // Auth and body parsing.
  get(P)
  get(`${P}?secret=wrong`)
  get(`${P}?secret=${SECRET}`)
  dash('header')
  get(`${P}?report=ops`, { 'x-race-secret': SECRET })
  get(`${P}?report=ops`)
  get(`${P}?report=OPS&secret=${SECRET}`)
  raw('{bad', H, 'invalid json, no secret')
  raw('', A, 'empty body')
  raw('{}', H, 'no secret')
  raw(JSON.stringify({ secret: SECRET }), H, 'body secret')
  raw(JSON.stringify({ secret: 123 }), H, 'numeric body secret')
  raw(JSON.stringify({ secret: ` ${SECRET} ` }), H, 'padded body secret')
  raw('null', A, 'null body')
  raw('[]', A)
  raw('5', A)
  raw('"x"', A)
  post({ action: 'nope' })
  post({ action: 'start-race' })
  // Stored re-seed history (schema 0.8): every week object carries previousRaceSeeds.
  sql(`UPDATE SeasonWeek SET previousRaceSeeds='["seed-a","seed-b"]' WHERE id=1`, 'stored previousRaceSeeds')
  dash('previousRaceSeeds')
  // reseed-week is Rust-only (plan Phase 3); only its refusals are replayed here (no DB effect on
  // either side). TS answers 400 "Unknown Season 3 admin action" (accept list in compare.mjs).
  rustOnly({ action: 'reseed-week' }, 400, 'weekId là bắt buộc')
  rustOnly({ action: 'reseed-week', weekId: 999 }, 404, 'Tuần không tồn tại')
  rustOnly({ action: 'reseed-week', weekId: 1 }, 409, RESEED_REFUSED, 'open week')

  // toggle-skip
  post({ action: 'toggle-skip' })
  post({ action: 'toggle-skip', weekId: 1 })
  post({ action: 'toggle-skip', weekId: 1, userId: 999 })
  post({ action: 'toggle-skip', weekId: 1, userId: '3' })
  post({ action: 'toggle-skip', weekId: 999, userId: 3 })
  post({ action: 'toggle-skip', weekId: '1', userId: 3 })
  post({ action: 'toggle-skip', weekId: 1.7, userId: 3 })
  dash('after skip 3')
  post({ action: 'toggle-skip', weekId: 1, userId: 14 })
  post({ action: 'toggle-skip', weekId: 1, userId: 3.0 })
  dash('after skip 14, unskip 3')
  sql(`UPDATE SeasonWeek SET skippedPlayerIdsJson='[14, 2.5, "4", -0, 1e21, 14, null]' WHERE id=1`, 'odd skipped json')
  dash('odd skipped json')
  post({ action: 'toggle-skip', weekId: 1, userId: 5 })
  sql(`UPDATE SeasonWeek SET skippedPlayerIdsJson='[14]' WHERE id=1`)

  // set-chaos
  post({ action: 'set-chaos' })
  post({ action: 'set-chaos', weekId: 999 })
  post({ action: 'set-chaos', weekId: 1 })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'RANDOM' })
  post({ action: 'set-chaos', weekId: 1, chaosType: '' })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'DUO' })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'CONSTRUCTORS' })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'CONSTRUCTORS', groups: [[1, 2], [3, 'x', null], { a: 1 }] })
  dash('manual groups')
  post({ action: 'set-chaos', weekId: 1, chaosType: 'DUO', groups: [[1, 2], 7] })
  dash('groups with a non-array')
  post({ action: 'set-chaos', weekId: 1, chaosType: 'DUO', groups: [] })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'DUO', groups: 'abc' })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'BOUNTY_HUNT', targetUserId: 5 })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'BOUNTY_HUNT', targetUserId: 14 }, 'skipped ghost')
  post({ action: 'set-chaos', weekId: 1, chaosType: 'BOUNTY_HUNT', targetUserId: 999 })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'BOUNTY_HUNT', targetUserId: -1 })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'BOUNTY_HUNT', targetUserId: '5' })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'BOUNTY_HUNT' })
  for (const type of ['NORMAL', 'REVERSE', 'TRIPLE_ELIMINATION', 'CUT_LINE']) post({ action: 'set-chaos', weekId: 1, chaosType: type })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'normal' })
  post({ action: 'set-chaos', weekId: 1, chaosType: 5 })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'CONSTRUCTORS' })
  dash('after set-chaos')

  // lock / unlock
  post({ action: 'lock', weekId: 999 })
  post({ action: 'lock', weekId: '1' })
  post({ action: 'lock' })
  dash('locked')
  post({ action: 'lock' })
  post({ action: 'toggle-skip', weekId: 1, userId: 2 })
  post({ action: 'set-chaos', weekId: 1, chaosType: 'DUO' }, 'set-chaos on a locked week')
  rustOnly({ action: 'reseed-week', weekId: 1 }, 409, RESEED_REFUSED, 'locked, no failed race')
  rustOnly({ action: 'reseed-week', weekId: '1' }, 500, 'Season 3 action failed', 'string weekId (Prisma Int)')
  post({ action: 'unlock', weekId: 1 })
  post({ action: 'unlock' })
  post({ action: 'lock', weekId: 1 }, 'relock reuses the race seed')
  post({ action: 'unlock' })
  post({ action: 'toggle-skip', weekId: 1, userId: 14 }, 'unskip the ghost')
  post({ action: 'lock' })
  post({ action: 'unlock' })

  // open-week
  post({ action: 'open-week' })
  resolve(1, 37)
  dash('week 1 resolved with telemetry')
  post({ action: 'open-week', chaosType: 'BOUNTY_HUNT', targetUserId: 999 })
  post({ action: 'open-week', chaosType: 'BOUNTY_HUNT', targetUserId: 5 })
  resolve(2, 36)
  post({ action: 'open-week', chaosType: 'DUO', groups: [[1, 2]] })
  resolve(3, 35)
  post({ action: 'open-week', chaosType: 'DUO' })
  resolve(4, 34)
  post({ action: 'open-week', chaosType: 'RANDOM' })
  resolve(5, 33)
  post({ action: 'open-week', chaosType: 'bogus' })
  resolve(6, 32)
  post({ action: 'open-week', chaosType: 'NORMAL' })
  resolve(7, 31)
  post({ action: 'open-week', chaosType: 'CONSTRUCTORS' })
  resolve(8, 30)
  post({ action: 'open-week', chaosType: 'BOUNTY_HUNT' })
  dash('nine weeks')
  get(`${P}?report=ops`, { 'x-race-secret': SECRET })

  // extend-season
  post({ action: 'extend-season', weeks: 'x' })
  post({ action: 'extend-season', weeks: 14.5 })
  post({ action: 'extend-season', weeks: 53 })
  post({ action: 'extend-season', weeks: 12 })
  post({ action: 'extend-season', weeks: 13 })
  post({ action: 'extend-season' })
  post({ action: 'extend-season', weeks: null })
  resolve(9, 29)
  sql(`UPDATE Season SET weeks=9 WHERE status='active'`)
  post({ action: 'open-week' }, 'season full')
  post({ action: 'extend-season', weeks: 8 }, 'below played weeks')

  // end-season
  post({ action: 'end-season', championUserId: '3' })
  post({ action: 'end-season', championUserId: 99999 })
  post({ action: 'end-season', championUserId: true })
  sql(`UPDATE SeasonPlayer SET championshipPoints = CASE userId WHEN 2 THEN 30 WHEN 5 THEN 30 WHEN 6 THEN 12 ELSE 3 END, raceWins = CASE userId WHEN 2 THEN 1 WHEN 5 THEN 1 ELSE 0 END`)
  post({ action: 'end-season' })
  dash('no season')
  get(`${P}?report=ops`, { 'x-race-secret': SECRET })
  post({ action: 'set-chaos', weekId: 1 })
  post({ action: 'nope' })

  // create-season
  post({ action: 'create-season' }, 'key S3 taken')
  post({ action: 'create-season', key: 'S4', userIds: [1] })
  post({ action: 'create-season', key: 'S4', userIds: 'ab' })
  post({ action: 'create-season', key: 5 })
  post({ action: 'create-season', key: 'S4', userIds: [1.5, 2] }, 'fractional ids')
  post({ action: 'create-season', key: 'S4', userIds: [7, 3, 14, 1], weeks: '6', year: 2030.9, name: 'Mùa 4' })
  post({ action: 'create-season', key: 'S5' })
  dash('season 4')
  post({ action: 'toggle-skip', weekId: '$W', userId: 7 })
  post({ action: 'set-chaos', weekId: '$W', chaosType: 'DUO' })
  post({ action: 'lock' })
  post({ action: 'end-season', championUserId: 1.7 })
  post({ action: 'create-season', key: 'S6', userIds: [], weeks: [3], year: null })
  dash('season 6')
  post({ action: 'end-season' })
  post({ action: 'create-season', key: 'S7', userIds: [2, 2, 4], weeks: -5, name: null })
  dash('season 7')
  post({ action: 'end-season' })
  post({ action: 'create-season', key: 'S8', userIds: { length: 0 }, weeks: true })
  post({ action: 'open-week' })
  dash('season 8')
  return s
}

/** `$W` → the weekId of the last successful create-season on that side. */
export function resolver() {
  let week = 'none'
  return {
    observe(step, response) {
      if (step.kind !== 'http' || step.method !== 'POST' || response.status !== 201) return
      week = String(JSON.parse(response.body).weekId)
    },
    resolve(step) {
      return step.body ? { ...step, body: step.body.replace('"$W"', week) } : step
    },
  }
}
