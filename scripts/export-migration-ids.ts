/**
 * Exports the ids of the TS app migrations (scripts/run-migrations.ts) for the Rust boot check
 * (rewrite plan D14, step 0.8).
 *
 *   pnpm db:export-migration-ids          # writes crates/server/data/required-ts-migrations.json
 *   pnpm db:export-migration-ids --check  # exits 1 if the committed file is stale
 *
 * run-migrations.ts runs on import, so its source is parsed instead: every `id: '<...>'` entry
 * inside the `const migrations: Migration[] = [` list, in declaration order.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'scripts', 'run-migrations.ts'), 'utf8')
const start = source.indexOf('const migrations: Migration[] = [')
if (start === -1) throw new Error('migration list not found in scripts/run-migrations.ts')
const end = source.indexOf('\n]\n', start)
if (end === -1) throw new Error('end of the migration list not found')
const block = source.slice(start, end)
const ids = [...block.matchAll(/^\s+id:\s*'([^']+)'/gm)].map((match) => match[1])
if (ids.length === 0) throw new Error('no migration ids found')
if (new Set(ids).size !== ids.length) throw new Error('duplicate migration ids')

const file = path.join(root, 'crates', 'server', 'data', 'required-ts-migrations.json')
const text = `${JSON.stringify({ format: 'autoduck-required-ts-migrations/1', source: 'scripts/run-migrations.ts', ids }, null, 2)}\n`
if (process.argv.includes('--check')) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (current !== text) {
    console.error(`stale: ${path.relative(process.cwd(), file)} (run pnpm db:export-migration-ids)`)
    process.exit(1)
  }
} else {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  console.log(`wrote ${path.relative(process.cwd(), file)} (${ids.length} ids)`)
}
