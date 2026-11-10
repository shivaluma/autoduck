/**
 * Season 3 player routes (`/api/season3`, `/api/season3/redeem`): TS (A) vs Rust (B) on copies of one
 * base DB, step by step (rewrite plan Phase 3 stage B). The base is a dev.db snapshot plus one of the
 * scenario files in `scripts/ops/season3-player-diff/` (`main`, `closed`, `noseason`), applied with
 * `sqlite3 base.db < scenario.sql`; A and B each serve their own `.backup` copy of it.
 * Bodies compared byte for byte after masking run-minted cuids and timestamps; then every table.
 *   node --import tsx scripts/ops/season3-player-diff.ts --a URL --b URL --base BASE.db --a-db A.db --b-db B.db --scenario main --report FILE
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const args = new Map<string, string>()
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) args.set(argv[i]!.replace(/^--/, ''), argv[i + 1]!)
const arg = (k: string) => { const v = args.get(k); if (!v) throw new Error(`missing --${k}`); return v }

type Step = { method: string; path: string; body?: string; label?: string }
const CUID = /\bc[a-z0-9]{24}\b/g
const ISO = /\b20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(Z|\+00:00)/g
const startedAt = Date.now()
const mask = (t: string) => t
  .replace(CUID, (id) => (parseInt(id.slice(1, 9), 36) >= startedAt - 1000 ? '<cuid>' : id))
  .replace(ISO, (iso) => (Date.parse(iso.replace('+00:00', 'Z')) >= startedAt - 1000 ? `<now:${iso.replace(/\d/g, '9')}>` : iso))

const base = new Database(arg('base'), { readonly: true })
const players = base.prepare('SELECT id, userId, accessToken AS token FROM "SeasonPlayer" ORDER BY id').all() as Array<{ id: number; userId: number; token: string }>
base.close()
const tok = (n: number) => players[n - 1]!.token

const steps: Step[] = []
const get = (q = '', label?: string) => steps.push({ method: 'GET', path: `/api/season3${q}`, label })
const post = (body: unknown, label?: string, path = '/api/season3') => steps.push({ method: 'POST', path, body: typeof body === 'string' ? body : JSON.stringify(body), label })
const redeem = (body: unknown, label?: string) => post(body, label, '/api/season3/redeem')
const s3 = (n: number, extra: Record<string, unknown>, label?: string) => post({ token: tok(n), ...extra }, label)

const scenario = arg('scenario')
if (scenario === 'main') {
  // Before any GET grants starters to p4/p6.
  s3(6, { action: 'favorite', cosmeticId: null }, 'favorite without appearance row')
  s3(4, { action: 'seen-cosmetics' })
  get(); get('?token='); get('?token=nope'); get('?token=a&token=b')
  for (let n = 1; n <= 8; n += 1) get(`?token=${encodeURIComponent(tok(n))}`)
  for (const raw of ['{bad', 'null', '[]', '"str"', '5', 'true', '{}', '{"token":""}', '{"token":5}', '{"token":"nope"}', '{"token":["x"]}']) post(raw, `raw ${raw}`)
  // appearance
  s3(1, { action: 'appearance' })
  s3(1, { action: 'appearance', appearance: true })
  s3(1, { action: 'appearance', appearance: 'body-sunshine' })
  s3(1, { action: 'appearance', appearance: [] })
  s3(1, { action: 'appearance', appearance: {} })
  s3(1, { action: 'appearance', appearance: { bodyColorId: 'nope' } })
  s3(1, { action: 'appearance', appearance: { bodyColorId: 'face-happy' } })
  s3(1, { action: 'appearance', appearance: { bodyColorId: 'body-golden' } }, 'not owned')
  s3(1, { action: 'appearance', appearance: { bodyColorId: 'body-sunshine', faceId: 'face-happy', headId: '', petId: 5, exploitId: 'x' } })
  s3(5, { action: 'appearance', appearance: { bodyColorId: 'body-sunshine' } }, 'player whose inventory was emptied')
  // favorite
  s3(1, { action: 'favorite', cosmeticId: 'face-happy' })
  s3(1, { action: 'favorite', cosmeticId: 'body-golden' }, 'not owned')
  s3(1, { action: 'favorite', cosmeticId: 'nope' })
  s3(1, { action: 'favorite', cosmeticId: 5 })
  s3(1, { action: 'favorite', cosmeticId: 0 })
  s3(1, { action: 'favorite', cosmeticId: false })
  s3(1, { action: 'favorite', cosmeticId: '' })
  s3(1, { action: 'favorite' })
  s3(2, { action: 'favorite', cosmeticId: 'face-happy' })
  // presets
  for (const presetIndex of [0, 4, 1.5, '1', null, -0, 2]) s3(1, { action: 'save-preset', presetIndex, appearance: presetIndex === 2 ? undefined : { bodyColorId: 'body-sunshine' } }, `save-preset ${presetIndex}`)
  s3(1, { action: 'save-preset', presetIndex: 2, appearance: { bodyColorId: 'body-sunshine', faceId: 'face-happy' }, presetName: '  Hi  ' })
  s3(1, { action: 'save-preset', presetIndex: 2.0, appearance: { bodyColorId: 'body-sunshine' }, presetName: '   ' })
  s3(1, { action: 'save-preset', presetIndex: 3, appearance: { bodyColorId: 'body-sunshine' }, presetName: `  ${'a'.repeat(29)}😀xyz` })
  s3(1, { action: 'save-preset', presetIndex: 1, appearance: { bodyColorId: 'body-sunshine' }, presetName: `${'ĐUA DZỊT '.repeat(5)}` })
  s3(1, { action: 'save-preset', presetIndex: 1, appearance: { bodyColorId: 'body-sunshine', headId: 'head-cap-red' }, presetName: 5 }, 'non-string name saves appearance then 500')
  s3(1, { action: 'save-preset', presetIndex: 1, appearance: { bodyColorId: 'nope' }, presetName: 'x' })
  s3(1, { action: 'save-preset', presetIndex: 1, appearance: { bodyColorId: 'body-sunshine' }, presetName: null })
  for (const presetIndex of ['x', 1.5, 9, 1, 2, 3, 4, 5, 1e19, 3e10, -0]) s3(1, { action: 'load-preset', presetIndex }, `load-preset ${presetIndex}`)
  s3(2, { action: 'load-preset', presetIndex: 2 })
  s3(1, { action: 'seen-cosmetics' })
  // week actions
  s3(3, { action: 'shield' }, 'no shields')
  s3(7, { action: 'shield' }, 'skipped player')
  s3(8, { action: 'loadout', itemIds: ['NITRO'] }, 'skipped player 8')
  s3(1, { action: 'shield' })
  s3(1, { action: 'shield', useShield: true })
  s3(1, { action: 'shield', useShield: 'false' })
  s3(2, { action: 'shield', useShield: false })
  s3(2, { action: 'shield', useShield: false }, 'again')
  for (const itemIds of ['x', { a: 1 }, 5, ['NOPE'], [1], ['NITRO', 'HOMING_ROCKET'], ['NITRO', 'BANANA', 'FEATHER'], ['BANANA', 'BANANA']]) s3(1, { action: 'loadout', itemIds }, `loadout ${JSON.stringify(itemIds)}`)
  s3(1, { action: 'loadout', itemIds: ['NITRO'], ready: true })
  s3(1, { action: 'loadout', itemIds: ['NITRO'], ready: 1 })
  s3(1, { action: 'loadout', itemIds: ['NITRO'], ready: 0 })
  s3(1, { action: 'loadout', itemIds: null })
  s3(1, { action: 'loadout' })
  s3(1, { action: 'loadout', itemIds: ['NITRO', 'BANANA'], ready: true })
  s3(1, { action: 'loadout', itemIds: ['FEATHER', 'QUACK_HORN'], ready: 'yes' }, 'two minors ready')
  s3(3, { action: 'loadout', itemIds: ['HOMING_ROCKET', 'FEATHER'], ready: true })
  s3(3, { action: 'loadout', itemIds: ['DRAFT_FIN'], ready: false })
  // predictions
  s3(1, {})
  s3(1, { targetUserId: '7' })
  s3(1, { targetUserId: 14 }, 'self')
  s3(1, { targetUserId: 9999 })
  s3(1, { targetUserId: 4 }, 'skipped target')
  s3(1, { targetUserId: 3 }, 'skipped target 3')
  s3(1, { targetUserId: 1.5 })
  s3(1, { targetUserId: 7.0 })
  s3(1, { targetUserId: 1 }, 'change target')
  s3(2, { action: 'nope', targetUserId: 14 }, 'unknown action falls through')
  s3(3, { action: null, targetUserId: 14 })
  s3(4, { targetUserId: 6 })
  // redeem
  for (const raw of ['{bad', 'null', '[]', '{}', `{"token":"${tok(1)}"}`, '{"rewardKey":"sticker"}', '{"token":"nope","rewardKey":"sticker"}', '{"token":5,"rewardKey":"sticker"}']) redeem(raw, `redeem raw ${raw}`)
  redeem({ token: tok(1), rewardKey: 'nope' })
  redeem({ token: tok(1), rewardKey: 5 })
  redeem({ token: tok(1), rewardKey: 'plush' }, 'inactive')
  redeem({ token: tok(1), rewardKey: 'sold_out' })
  redeem({ token: tok(1), rewardKey: 'limited_duck' })
  redeem({ token: tok(1), rewardKey: 'limited_duck' }, 'again: not enough points')
  redeem({ token: tok(2), rewardKey: 'sticker' })
  redeem({ token: tok(2), rewardKey: 'two_left' })
  redeem({ token: tok(3), rewardKey: 'two_left' })
  redeem({ token: tok(3), rewardKey: 'two_left' }, 'stock exhausted')
  redeem({ token: tok(4), rewardKey: 'sticker' }, 'no points')
  steps.push({ method: 'GET', path: '/api/season3/redeem', label: 'wrong method' })
  for (let n = 1; n <= 8; n += 1) get(`?token=${encodeURIComponent(tok(n))}`)
  get()
} else if (scenario === 'closed') {
  get(); get(`?token=${encodeURIComponent(tok(1))}`)
  s3(1, { action: 'shield' })
  s3(1, { action: 'loadout', itemIds: ['NITRO'] })
  s3(1, { targetUserId: 7 })
  s3(1, { action: 'seen-cosmetics' })
  s3(1, { action: 'favorite', cosmeticId: 'face-happy' })
} else if (scenario === 'noseason') {
  get(); get(`?token=${encodeURIComponent(tok(1))}`)
  s3(1, { action: 'seen-cosmetics' })
  post('{}')
  redeem({ token: tok(1), rewardKey: 'sticker' })
  redeem({ token: tok(1), rewardKey: 'limited_duck' })
} else throw new Error(`unknown scenario ${scenario}`)

async function send(baseUrl: string, step: Step) {
  const response = await fetch(baseUrl + step.path, { method: step.method, headers: step.body === undefined ? {} : { 'content-type': 'application/json' }, body: step.body })
  const text = await response.text()
  return { status: response.status, type: (response.headers.get('content-type') ?? '').split(';')[0], body: mask(text) }
}

function dump(path: string) {
  const db = new Database(path, { readonly: true })
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name`).all() as Array<{ name: string }>).map((t) => t.name)
  const out = new Map<string, string[]>()
  for (const table of tables) {
    const cols = (db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => `quote("${c.name}")`).join(', ')
    out.set(table, (db.prepare(`SELECT ${cols} FROM "${table}"`).raw().all() as unknown[][]).map((r) => mask(r.map(String).join(' | '))).sort())
  }
  db.close()
  return out
}

async function main() {
  const lines: string[] = []
  let failures = 0
  for (const step of steps) {
    const a = await send(arg('a'), step)
    const b = await send(arg('b'), step)
    const same = a.status === b.status && a.type === b.type && a.body === b.body
    const head = `${same ? 'same' : 'DIFF'}  ${step.method} ${step.path.replace(/token=[^&]+/, 'token=…')} ${step.body ? step.body.replace(/"token":"[^"]+"/, '"token":"…"').slice(0, 120) : ''} ${step.label ? `(${step.label})` : ''} → ${a.status}`
    lines.push(head)
    if (!same) {
      failures += 1
      lines.push(`   A ${a.status} ${a.type} ${a.body.slice(0, 600)}`)
      lines.push(`   B ${b.status} ${b.type} ${b.body.slice(0, 600)}`)
      if (a.body.length > 600) {
        let i = 0
        while (i < a.body.length && a.body[i] === b.body[i]) i += 1
        lines.push(`   first difference at ${i}: A …${a.body.slice(Math.max(0, i - 80), i + 120)}`)
        lines.push(`                          B …${b.body.slice(Math.max(0, i - 80), i + 120)}`)
      }
    }
  }
  const before = dump(arg('base'))
  const da = dump(arg('a-db'))
  const db = dump(arg('b-db'))
  lines.push('', '## DB')
  for (const table of [...new Set([...da.keys(), ...db.keys()])].sort()) {
    const ra = da.get(table) ?? []
    const rb = db.get(table) ?? []
    const changed = ra.join('\n') !== (before.get(table) ?? []).join('\n')
    if (ra.join('\n') === rb.join('\n')) { if (changed) lines.push(`same  ${table} (${ra.length} rows, changed)`); continue }
    failures += 1
    lines.push(`DIFF  ${table}: ${ra.length} vs ${rb.length}`)
    for (const r of ra.filter((x) => !rb.includes(x)).slice(0, 5)) lines.push(`  A only: ${r.slice(0, 400)}`)
    for (const r of rb.filter((x) => !ra.includes(x)).slice(0, 5)) lines.push(`  B only: ${r.slice(0, 400)}`)
  }
  lines.push('', `${steps.length} steps; ${failures === 0 ? 'RESULT: clean' : `RESULT: ${failures} difference(s)`}`)
  writeFileSync(arg('report'), lines.join('\n') + '\n')
  console.log(lines.filter((l) => !l.startsWith('same')).join('\n'))
  process.exitCode = failures === 0 ? 0 : 1
}
main()
