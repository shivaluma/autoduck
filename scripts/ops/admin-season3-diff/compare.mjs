// Compares the TS and Rust runs of the admin Season 3 plan: every response (status, content type,
// JSON with numbers compared by source text, run-minted ids/timestamps masked) and every table.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const [tsOut, rsOut, tsDb, rsDb, baseDb, startedAtText, tsRef] = process.argv.slice(2)
const startedAt = Number(startedAtText)
const require = createRequire(`${tsRef}/package.json`)
const Database = require('better-sqlite3')

const CUID = /\bc[a-z0-9]{24}\b/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/g
const ISO = /\b20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}(Z|\+00:00)/g
const D13 = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$/
const mask = (text) => text
  .replace(UUID, '<uuid>')
  .replace(CUID, (id) => (parseInt(id.slice(1, 9), 36) >= startedAt - 1000 ? '<cuid>' : id))
  .replace(ISO, (iso) => (Date.parse(iso.replace('+00:00', 'Z')) >= startedAt - 1000 ? `<now:${iso.endsWith('Z') ? 'Z' : '+00:00'}>` : iso))

function parseExact(text) {
  return JSON.parse(text, (_key, value, context) => (typeof value === 'number' ? { $num: context?.source ?? String(value) } : value))
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    if (typeof value.$num === 'string' && Object.keys(value).length === 1) return value.$num
    return `{${Object.keys(value).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const body = (response) => {
  const text = mask(response.body)
  if ((response.contentType ?? '').startsWith('application/json')) {
    try { return canonical(parseExact(text)) } catch { return `invalid:${text}` }
  }
  return `${response.contentType}:${text}`
}

// Accepted differences, each pinned to exact responses on both sides.
const ACCEPT = {
  'reseed-week-rust-only': {
    ts: { status: 400, body: '{"error":"Unknown Season 3 admin action"}' },
    reason: 'reseed-week is new in Rust (rewrite plan Phase 3 stage B, risk R24); main has no such action. Only refusals are replayed (no DB effect on either side); the re-seed itself is covered by crates/server/tests/admin_season3.rs.',
  },
}
let accepted = 0

const a = JSON.parse(readFileSync(tsOut, 'utf8'))
const b = JSON.parse(readFileSync(rsOut, 'utf8'))
let failures = 0
let compared = 0
const statuses = new Map()
for (let i = 0; i < a.length; i += 1) {
  const step = a[i].step
  if (step.kind === 'sql') continue
  compared += 1
  const ra = a[i].response
  const rb = b[i].response
  statuses.set(ra.status, (statuses.get(ra.status) ?? 0) + 1)
  const ctA = (ra.contentType ?? '').split(';')[0]
  const ctB = (rb.contentType ?? '').split(';')[0]
  const diffs = []
  if (step.rustOnly) {
    const rule = ACCEPT['reseed-week-rust-only']
    if (ra.status === rule.ts.status && ra.body === rule.ts.body && rb.status === step.rustOnly.status && rb.body === step.rustOnly.body) {
      accepted += 1
      continue
    }
    failures += 1
    console.log(`DIFF #${i} (rust-only, unpinned) ${step.body} ${step.label ?? ''}\n    TS:   ${ra.status} ${ra.body}\n    Rust: ${rb.status} ${rb.body}`)
    continue
  }
  if (ra.status !== rb.status) diffs.push(`status ${ra.status} vs ${rb.status}`)
  if (ctA !== ctB) diffs.push(`content-type ${ctA} vs ${ctB}`)
  // Key order matters too (JSON text identical after masking).
  if (body(ra) !== body(rb)) diffs.push(`body\n    TS:   ${mask(ra.body).slice(0, 1500)}\n    Rust: ${mask(rb.body).slice(0, 1500)}`)
  if (diffs.length) {
    failures += 1
    console.log(`DIFF #${i} ${step.method} ${step.path} ${step.body ?? ''} ${step.label ?? ''}\n  ${diffs.join('\n  ')}`)
  }
}
console.log(`responses: ${compared}, differing: ${failures}, accepted (reseed-week-rust-only): ${accepted}, TS statuses: ${[...statuses].map(([k, v]) => `${k}×${v}`).join(' ')}`)

function dump(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((t) => t.name)
  const out = new Map()
  for (const table of tables) {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all()
    const rows = db.prepare(`SELECT ${info.map((c) => `quote("${c.name}")`).join(', ')} FROM "${table}"`).raw().all().map((row) => row.map(String))
    out.set(table, { columns: info.map((c) => c.name), types: info.map((c) => c.type.toUpperCase()), rows })
  }
  db.close()
  return out
}
const da = dump(tsDb)
const db = dump(rsDb)
const base = dump(baseDb)
let tableDiffs = 0
for (const table of [...new Set([...da.keys(), ...db.keys()])].sort()) {
  const ta = da.get(table)
  const tb = db.get(table)
  const norm = (t) => t.rows.map((row) => mask(row.join(' | '))).sort()
  const ra = norm(ta)
  const rb = norm(tb)
  const changed = ra.join('\n') !== norm(base.get(table)).join('\n')
  if (ra.join('\n') === rb.join('\n')) {
    if (changed) console.log(`same  ${table} (${ra.length} rows, changed by the run)`)
    continue
  }
  tableDiffs += 1
  console.log(`DIFF  ${table}: ${ra.length} vs ${rb.length}`)
  for (const row of ra.filter((r) => !rb.includes(r)).slice(0, 5)) console.log(`  TS only:   ${row.slice(0, 400)}`)
  for (const row of rb.filter((r) => !ra.includes(r)).slice(0, 5)) console.log(`  Rust only: ${row.slice(0, 400)}`)
}
let bad = 0
let checked = 0
for (const [table, dumpB] of db) {
  const baseRows = new Set(base.get(table).rows.map((row) => row.join('\u0000')))
  const written = dumpB.rows.filter((row) => !baseRows.has(row.join('\u0000')))
  dumpB.types.forEach((type, index) => {
    if (type !== 'DATETIME') return
    for (const row of written) {
      if (row[index] === 'NULL') continue
      checked += 1
      if (!D13.test(row[index].replace(/^'|'$/g, ''))) { bad += 1; console.log(`BAD DATETIME ${table}.${dumpB.columns[index]} = ${row[index]}`) }
    }
  })
}
console.log(`tables differing: ${tableDiffs}; DATETIME values in Rust-written rows: ${checked}, bad: ${bad}`)
console.log(failures + tableDiffs + bad === 0 ? 'RESULT: clean' : 'RESULT: DIFFERENCES')
process.exitCode = failures + tableDiffs + bad === 0 ? 0 : 1
