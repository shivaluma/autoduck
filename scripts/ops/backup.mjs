#!/usr/bin/env node
// Pre-migration SQLite backup (rewrite plan D29, step 0.1).
//
// Writes <db dir>/backups/pre-migrate-<UTC timestamp>.db with better-sqlite3's
// online .backup() API (never `cp`: a copy of a DELETE-mode DB after an unclean
// kill can capture a half-applied transaction).
//
// Rules:
// - skip when the DB file does not exist yet (first boot)
// - skip when a backup newer than 6h already exists (crash loops must not fill the disk)
// - skip, loudly, when free disk space is under 3x the DB size
// - keep only the newest 10 pre-migrate backups
// - NEVER block boot: every failure is logged and the process exits 0
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const BACKUP_PREFIX = 'pre-migrate-'
const BACKUP_SUFFIX = '.db'
const MIN_BACKUP_AGE_MS = 6 * 60 * 60 * 1000
const FREE_SPACE_FACTOR = 3
const KEEP_BACKUPS = 10

function log(message) {
  console.log(`💾 [backup] ${message}`)
}

function warn(message) {
  console.warn(`⚠️  [backup] ${message}`)
}

// Mirror prisma.config.ts (dotenv/config, then DATABASE_URL || file:./prisma/dev.db)
// and lib/db.ts (file: URL resolved against the process cwd).
async function resolveDbPath() {
  if (!process.env.DATABASE_URL) {
    try {
      await import('dotenv/config')
    } catch {
      // dotenv is optional here; the runtime image sets DATABASE_URL explicitly.
    }
  }
  const url = process.env.DATABASE_URL || 'file:./prisma/dev.db'
  if (!url.startsWith('file:')) {
    throw new Error(`DATABASE_URL is not a sqlite file: URL (${url.split(':')[0]}:...)`)
  }
  let filePath = url.slice('file:'.length)
  const queryIndex = filePath.indexOf('?')
  if (queryIndex !== -1) filePath = filePath.slice(0, queryIndex)
  if (filePath.startsWith('//')) filePath = fileURLToPath(url.split('?')[0])
  return path.resolve(process.cwd(), filePath)
}

// The runtime image is a Next standalone layout where better-sqlite3 lives under
// node_modules/.pnpm/better-sqlite3@<ver>; a bare require may or may not resolve
// there, so fall back to locating the package directory directly.
function loadBetterSqlite3() {
  const require = createRequire(import.meta.url)
  const candidates = []
  for (const base of [import.meta.url, path.join(process.cwd(), 'noop.js')]) {
    try {
      candidates.push(path.dirname(createRequire(base).resolve('better-sqlite3/package.json')))
    } catch {
      // try next strategy
    }
  }
  for (const root of [process.cwd(), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')]) {
    const pnpmDir = path.join(root, 'node_modules', '.pnpm')
    let entries = []
    try {
      entries = fs.readdirSync(pnpmDir).filter((name) => name.startsWith('better-sqlite3@')).sort().reverse()
    } catch {
      continue
    }
    for (const entry of entries) {
      candidates.push(path.join(pnpmDir, entry, 'node_modules', 'better-sqlite3'))
    }
  }

  const errors = []
  for (const dir of candidates) {
    try {
      const Database = require(dir)
      // Point straight at the compiled addon so we don't depend on the
      // `bindings` helper package being resolvable in a trimmed image.
      const addon = path.join(dir, 'build', 'Release', 'better_sqlite3.node')
      const nativeBinding = fs.existsSync(addon) ? addon : undefined
      return { Database, nativeBinding, dir }
    } catch (error) {
      errors.push(`${dir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`better-sqlite3 not found (${errors.join('; ') || 'no candidates'})`)
}

function timestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

function listBackups(backupDir) {
  let names = []
  try {
    names = fs.readdirSync(backupDir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX))
    .map((name) => {
      const file = path.join(backupDir, name)
      try {
        return { name, file, mtimeMs: fs.statSync(file).mtimeMs }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
}

function prune(backupDir) {
  const stale = listBackups(backupDir).slice(KEEP_BACKUPS)
  for (const backup of stale) {
    try {
      fs.unlinkSync(backup.file)
      log(`pruned old backup ${backup.name}`)
    } catch (error) {
      warn(`could not prune ${backup.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// A boot killed mid-backup leaves <name>.db.partial behind; it is never a valid
// backup, so drop it instead of letting it accumulate outside the prune set.
function removeLeftoverPartials(backupDir) {
  let names = []
  try {
    names = fs.readdirSync(backupDir)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(`${BACKUP_SUFFIX}.partial`)) continue
    try {
      fs.unlinkSync(path.join(backupDir, name))
      log(`removed leftover partial backup ${name}`)
    } catch (error) {
      warn(`could not remove leftover ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function main() {
  const dbPath = await resolveDbPath()
  if (!fs.existsSync(dbPath)) {
    log(`no database at ${dbPath} yet; skipping backup`)
    return
  }

  const backupDir = path.join(path.dirname(dbPath), 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  removeLeftoverPartials(backupDir)

  const newest = listBackups(backupDir)[0]
  if (newest && Date.now() - newest.mtimeMs < MIN_BACKUP_AGE_MS) {
    const ageMin = Math.round((Date.now() - newest.mtimeMs) / 60000)
    log(`skipping: ${newest.name} is only ${ageMin} min old (< 6h)`)
    return
  }

  const dbSize = fs.statSync(dbPath).size
  const stats = await fs.promises.statfs(backupDir)
  const freeBytes = Number(stats.bavail) * Number(stats.bsize)
  if (freeBytes < dbSize * FREE_SPACE_FACTOR) {
    console.error(
      `🚨 [backup] SKIPPING BACKUP: only ${freeBytes} bytes free in ${backupDir}, ` +
        `need >= ${FREE_SPACE_FACTOR}x DB size (${dbSize * FREE_SPACE_FACTOR} bytes). ` +
        `Migrations will run WITHOUT a fresh backup.`,
    )
    return
  }

  const { Database, nativeBinding } = loadBetterSqlite3()
  const target = path.join(backupDir, `${BACKUP_PREFIX}${timestamp(new Date())}${BACKUP_SUFFIX}`)
  const partial = `${target}.partial`
  const db = new Database(dbPath, { fileMustExist: true, nativeBinding })
  try {
    await db.backup(partial)
  } catch (error) {
    try {
      fs.unlinkSync(partial)
    } catch {
      // nothing to clean up
    }
    throw error
  } finally {
    db.close()
  }
  fs.renameSync(partial, target)
  log(`backed up ${dbPath} (${dbSize} bytes) -> ${target}`)

  prune(backupDir)
}

try {
  await main()
} catch (error) {
  console.error(`🚨 [backup] backup failed, continuing boot: ${error instanceof Error ? error.stack || error.message : String(error)}`)
}
process.exit(0)
