// TS side of the admin Season 3 diff: the main-branch route handler, in-process. run.sh copies this
// file into <TS checkout>/.admin-s3-harness/ (it imports the route relative to that directory).
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const SPEC = process.env.ADMIN_S3_SPEC!
async function main() {
  const { buildPlan, resolver, SECRET } = await import(SPEC)
  process.env.RACE_SECRET_KEY = SECRET
  const generated = require('../prisma/generated/prisma/client')
  const prisma = new generated.PrismaClient({ adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }) })
  ;(globalThis as any).prisma = prisma
  const db = process.env.DATABASE_URL!.replace(/^file:/, '')
  const route = await import('../app/api/admin/season3/route')
  const resolve = resolver()
  const out: unknown[] = []
  for (const raw of buildPlan()) {
    const step = resolve.resolve(raw)
    if (step.kind === 'sql') {
      execFileSync('sqlite3', [db, step.sql])
      out.push({ step })
      continue
    }
    const request = new Request(`http://localhost${step.path}`, { method: step.method, headers: step.headers, body: step.method === 'POST' ? step.body : undefined })
    let response: { status: number; body: string; contentType?: string | null }
    try {
      const res = step.method === 'GET' ? await route.GET(request) : await route.POST(request)
      response = { status: res.status, body: await res.text(), contentType: res.headers.get('content-type') }
    } catch (error) {
      response = { status: 500, body: '', contentType: null }
      console.error('THROWN', String(error).split('\n')[0])
    }
    resolve.observe(step, response)
    out.push({ step, response })
  }
  writeFileSync(process.argv[2]!, JSON.stringify(out))
  await prisma.$disconnect()
}
main()
