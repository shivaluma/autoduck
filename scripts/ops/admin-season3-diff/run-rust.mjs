// Rust side of the admin Season 3 diff: the same plan over HTTP against `autoduck serve`.
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { buildPlan, resolver } from './spec.mjs'

const [base, db, outFile] = process.argv.slice(2)
const resolve = resolver()
const out = []
for (const raw of buildPlan()) {
  const step = resolve.resolve(raw)
  if (step.kind === 'sql') {
    execFileSync('sqlite3', [db, step.sql])
    out.push({ step })
    continue
  }
  const res = await fetch(`${base}${step.path}`, { method: step.method, headers: step.headers, body: step.method === 'POST' ? step.body : undefined })
  const response = { status: res.status, body: await res.text(), contentType: res.headers.get('content-type') }
  resolve.observe(step, response)
  out.push({ step, response })
}
writeFileSync(outFile, JSON.stringify(out))
