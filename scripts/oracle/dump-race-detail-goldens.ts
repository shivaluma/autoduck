/**
 * Golden bodies for the Rust port of GET /api/races/[id] (crates/server/tests/races.rs).
 *
 * Calls the TS route handler on main directly (no Next server) against a fixture DB and writes
 * one JSON line per case: {"path","status","body"} with the body exactly as NextResponse sends it.
 *
 *   # fixture DB = baseline schema + the rows common::populated_db inserts + fixture.sql
 *   env DATABASE_URL=file:/abs/fixture.db node --import tsx scripts/oracle/dump-race-detail-goldens.ts \
 *     crates/server/tests/fixtures/races/detail-cases.txt > crates/server/tests/fixtures/races/detail-golden.jsonl
 *
 * Needs `prisma generate`. The route has no live race session here, which is also the Rust
 * server's state in stage A.
 */
import { readFileSync } from 'node:fs'
import { GET } from '@/app/api/races/[id]/route'

async function main() {
  const casesFile = process.argv[2]
  if (!casesFile) throw new Error('usage: dump-race-detail-goldens.ts <cases.txt>')
  const paths = readFileSync(casesFile, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean)
  for (const path of paths) {
    const url = new URL(`http://localhost${path}`)
    // Next decodes the dynamic segment before handing it to the route.
    const id = decodeURIComponent(url.pathname.split('/')[3] ?? '')
    const response = await GET(new Request(url), { params: Promise.resolve({ id }) })
    process.stdout.write(`${JSON.stringify({ path, status: response.status, body: await response.text() })}\n`)
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
