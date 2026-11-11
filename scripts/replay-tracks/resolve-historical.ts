/**
 * Historical replay-track resolver (plan §4.4, step 0.6).
 *
 *   pnpm replay:resolve --db <sanitised copy> [--out artifacts/replay-tracks] [--race N ...]
 *                       [--workers 6] [--budget-min 45] [--test-candidates 8] [--skip-tests] [--max-bundle-mb 20]
 *
 * For every finished race with an engine config and no RaceReplayTrack row, it searches the TS engine commits for
 * the one that reproduces the race: each candidate commit is extracted with `git archive` into
 * .cache/engines/<key> and run by resolve-worker.mts in a child process isolated to that directory (guard-hook.mjs).
 * The worker simulates with the commit's own engine and records with HEAD's DTRK/1 encoder (the esbuild bundle of
 * head-dtrk.ts). Grades: VERIFIED_DIGEST (stored resultDigest reproduced), VERIFIED_EVENTS (full stored event stream
 * reproduced, no candidate reproduces the digest), UNAVAILABLE (nothing reproduces; no bytes, never a HEAD re-sim).
 *
 * Output, all keyed by race id with versions and grades only (no names, tokens or player data):
 *   <out>/<raceId>.dtrk.gz, <out>/manifest.json, <out>/REPORT.md, public/race-tracks/<trackVersion>@<sha8>.json
 * The database is opened read-only. ensure-imported.ts loads the manifest into RaceReplayTrack at boot.
 */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { decodeReplayTrack } from '../../src/race/replay-track/decode'
import { selfCheckReplayTrack } from '../../lib/racing/replay-track/store'

const REPO = path.resolve(__dirname, '../..')
const SCRIPT_DIR = path.join(REPO, 'scripts/replay-tracks')
const CACHE = path.join(REPO, '.cache/engines')
const META_EVENT_TYPES = new Set(['CHAOS_RESOLVED', 'QP_TRACK_REWARD_GRANTED'])
/** Paths whose history defines a candidate (plan §4.4 step 2). */
const ENGINE_PATHS = ['packages/race-core', 'packages/race-protocol', 'lib/racing/audit.ts', 'lib/racing/persistence.ts', 'lib/racing/runtime.ts']
/** 0b67096 persisted events during the race with fireAndForget; 75e4f2d stopped it. Events are not authoritative there. */
const FIRE_AND_FORGET_ERA = new Set(['0b67096'])

// ---------------------------------------------------------------- args

function parseArgs(argv: string[]) {
  const args = { db: '', out: 'artifacts/replay-tracks', geometryOut: 'public/race-tracks', races: [] as number[], workers: Math.max(1, Math.min(8, cpus().length - 2)), budgetMin: 45, testCandidates: 8, skipTests: false, maxBundleMb: 20 }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`${flag} needs a value`)
      index += 1
      return next
    }
    if (flag === '--db') args.db = value()
    else if (flag === '--out') args.out = value()
    else if (flag === '--geometry-out') args.geometryOut = value()
    else if (flag === '--race') args.races.push(Number(value()))
    else if (flag === '--workers') args.workers = Number(value())
    else if (flag === '--budget-min') args.budgetMin = Number(value())
    else if (flag === '--test-candidates') args.testCandidates = Number(value())
    else if (flag === '--skip-tests') args.skipTests = true
    else if (flag === '--max-bundle-mb') args.maxBundleMb = Number(value())
    else throw new Error(`unknown flag ${flag}`)
  }
  if (!args.db) throw new Error('--db <sanitised copy> is required')
  return args
}

// ---------------------------------------------------------------- git

const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 }).trim()

interface Candidate {
  sha: string
  short: string
  time: number
  subject: string
  key: string
  balanceLabel: string | null
  isHead: boolean
}

function blobOrNone(sha: string, file: string) {
  try {
    return git('rev-parse', `${sha}:${file}`)
  } catch {
    return 'none'
  }
}

function listCandidates(): Candidate[] {
  const head = git('rev-parse', 'HEAD')
  const lines = git('log', '--first-parent', '--format=%H %ct %s', 'HEAD', '--', ...ENGINE_PATHS).split('\n').filter(Boolean)
  const seen = new Map<string, Candidate>()
  const result: Candidate[] = []
  for (const line of lines) {
    const [sha, time, ...subject] = line.split(' ')
    const key = createHash('sha256')
      .update([blobOrNone(sha!, 'packages'), blobOrNone(sha!, 'lib/racing/audit.ts'), blobOrNone(sha!, 'lib/racing/persistence.ts'), blobOrNone(sha!, 'lib/racing/runtime.ts')].join('|'))
      .digest('hex').slice(0, 16)
    if (seen.has(key)) continue
    let balanceLabel: string | null = null
    try {
      balanceLabel = /RACE_BALANCE_VERSION\s*=\s*'([^']+)'/.exec(git('show', `${sha}:packages/race-protocol/src/index.ts`))?.[1] ?? null
    } catch {
      balanceLabel = null
    }
    const candidate = { sha: sha!, short: sha!.slice(0, 7), time: Number(time) * 1000, subject: subject.join(' '), key, balanceLabel, isHead: false }
    seen.set(key, candidate)
    result.push(candidate)
  }
  // HEAD is a candidate in its own right (its engine may equal the newest engine commit; then it shares the key).
  const headKey = createHash('sha256')
    .update([blobOrNone(head, 'packages'), blobOrNone(head, 'lib/racing/audit.ts'), blobOrNone(head, 'lib/racing/persistence.ts'), blobOrNone(head, 'lib/racing/runtime.ts')].join('|'))
    .digest('hex').slice(0, 16)
  const existing = seen.get(headKey)
  if (existing) existing.isHead = true
  else result.unshift({ sha: head, short: head.slice(0, 7), time: Number(git('log', '-1', '--format=%ct', head)) * 1000, subject: 'HEAD', key: headKey, balanceLabel: null, isHead: true })
  return result // newest first
}

/** Candidate order for one race (plan §4.4 step 2; no deployment history is available). */
function orderCandidates(all: Candidate[], createdAt: number, balanceVersion: string) {
  const ordered: Candidate[] = []
  const add = (candidate: Candidate | undefined) => {
    if (candidate && !ordered.includes(candidate)) ordered.push(candidate)
  }
  const newestBefore = all.findIndex((candidate) => candidate.time <= createdAt)
  if (newestBefore >= 0) for (let index = newestBefore; index < Math.min(all.length, newestBefore + 4); index += 1) add(all[index])
  // Then one commit newer (a race may have run on a deploy of a commit pushed before its committer date was reached
  // in UTC terms is impossible, but dev-tree races run ahead of the commit).
  if (newestBefore > 0) add(all[newestBefore - 1])
  for (const candidate of all) if (candidate.balanceLabel === balanceVersion) add(candidate)
  add(all.find((candidate) => candidate.isHead))
  const rest = all.filter((candidate) => !ordered.includes(candidate))
  rest.sort((left, right) => Math.abs(left.time - createdAt) - Math.abs(right.time - createdAt))
  for (const candidate of rest) add(candidate)
  return ordered
}

function extract(candidate: Candidate) {
  const dir = path.join(CACHE, candidate.key)
  if (existsSync(path.join(dir, '.complete'))) return dir
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const wanted = ['packages', 'lib', 'tsconfig.json', 'package.json'].filter((entry) => {
    try {
      git('cat-file', '-e', `${candidate.sha}:${entry}`)
      return true
    } catch {
      return false
    }
  })
  execFileSync('sh', ['-c', `git archive ${candidate.sha} ${wanted.join(' ')} | tar -x -C "${dir}"`], { cwd: REPO })
  symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'))
  writeFileSync(path.join(dir, '.complete'), `${candidate.sha}\n`)
  return dir
}

// ---------------------------------------------------------------- HEAD bundle

async function buildHeadBundle() {
  const sources = [
    'scripts/replay-tracks/head-dtrk.ts', 'lib/racing/replay-track/recorder.ts', 'lib/racing/replay-track/encode.ts',
    'lib/racing/track-geometry.ts', 'src/race/replay-track/format.ts', 'packages/race-protocol/src/index.ts',
  ]
  const hash = createHash('sha256')
  for (const source of sources) hash.update(readFileSync(path.join(REPO, source)))
  const dir = path.join(CACHE, '_head', hash.digest('hex').slice(0, 16))
  const file = path.join(dir, 'dtrk.mjs')
  if (existsSync(file)) return file
  const esbuildPath = require.resolve('esbuild', { paths: [path.dirname(require.resolve('tsx'))] })
  const esbuild = await import(esbuildPath)
  mkdirSync(dir, { recursive: true })
  await (esbuild.build ?? esbuild.default.build)({
    entryPoints: [path.join(SCRIPT_DIR, 'head-dtrk.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: file,
    tsconfig: path.join(REPO, 'tsconfig.json'),
    logLevel: 'warning',
  })
  return file
}

// ---------------------------------------------------------------- races

interface RaceRow {
  id: number
  isTest: number
  createdAt: string
  engineVersion: string | null
  balanceVersion: string | null
  trackVersion: string | null
  engineConfigJson: string
  resultDigest: string | null
}

interface StoredEvent {
  type: string
  tick: number
  timestampWithinRaceMs: number
  sourcePlayerId: string | null
  targetPlayerId: string | null
  metadataJson: string
}

interface RaceJob {
  race: RaceRow
  createdAt: number
  storedEvents: StoredEvent[]
  manualInputs: unknown[]
  candidates: Candidate[]
  tried: number
  maxCandidates: number
  digestHit: WorkerResult | null
  eventsHit: WorkerResult | null
  outcomeMatchAt: string | null
  attempts: Array<{ sha: string; status: string; detail?: string }>
}

interface WorkerResult {
  raceId: number
  status: string
  sha: string
  digest?: string
  digestMatch?: boolean
  eventsMatch?: boolean
  eventDivergence?: number
  producedEvents?: number
  outcomeMatch?: boolean
  engineVersion?: string
  balanceVersion?: string
  trackVersion?: string
  tickRate?: number
  standings?: Array<{ playerId: string; rank: number; finishTimeMs: number }>
  raceFinishedTick?: number | null
  geometry?: { id: string; file: string }
  track?: { file: string; byteSha256: string; rawBytes: number; gzipBytes: number; movingEntities: number; orderViolations: number } | null
  trackError?: string | null
  baselineRank?: Record<string, number> | null
  error?: string
  ms?: number
}

function loadRaces(dbPath: string, only: number[]) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const hasTrackTable = Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='RaceReplayTrack'`).get())
  const races = db.prepare(`
    SELECT r.id, r."isTest", r."createdAt", r."engineVersion", r."balanceVersion", r."trackVersion", r."engineConfigJson", r."resultDigest"
    FROM "Race" r ${hasTrackTable ? 'LEFT JOIN "RaceReplayTrack" t ON t."raceId" = r.id' : ''}
    WHERE r."engineConfigJson" IS NOT NULL AND r.status = 'finished' ${hasTrackTable ? 'AND t."raceId" IS NULL' : ''}
    ORDER BY r.id`).all() as unknown as RaceRow[]
  const eventsStatement = db.prepare(`SELECT type, tick, "timestampWithinRaceMs", "sourcePlayerId", "targetPlayerId", "metadataJson" FROM "RaceEngineEvent" WHERE "raceId" = ? ORDER BY id`)
  const selected = only.length > 0 ? races.filter((race) => only.includes(race.id)) : races
  const loaded = selected.map((race) => {
    const events = eventsStatement.all(race.id) as unknown as StoredEvent[]
    const storedEvents = events.filter((event) => !META_EVENT_TYPES.has(event.type))
    const manualInputs = events.filter((event) => event.type === 'WILD_ITEM_MANUAL_INPUT').flatMap((event) => {
      const metadata = JSON.parse(event.metadataJson) as Record<string, unknown>
      if (!event.sourcePlayerId || typeof metadata.instanceId !== 'string' || typeof metadata.clientActionId !== 'string') return []
      return [{ raceId: String(race.id), playerId: event.sourcePlayerId, wildItemInstanceId: metadata.instanceId, action: 'USE', clientActionId: metadata.clientActionId, authoritativeTick: event.tick }]
    }).sort((left, right) => left.authoritativeTick - right.authoritativeTick || left.clientActionId.localeCompare(right.clientActionId))
    return { race, storedEvents, manualInputs }
  })
  const census = db.prepare(`
    SELECT "isTest", status, "engineVersion", "balanceVersion", "trackVersion", COUNT(*) n,
           SUM("resultDigest" IS NOT NULL) digests, MIN("createdAt") firstAt, MAX("createdAt") lastAt
    FROM "Race" WHERE "engineConfigJson" IS NOT NULL GROUP BY 1,2,3,4,5 ORDER BY MIN("createdAt")`).all() as Array<Record<string, unknown>>
  const manualInputCount = (db.prepare(`SELECT COUNT(*) n FROM "RaceEngineEvent" WHERE type='WILD_ITEM_MANUAL_INPUT'`).get() as { n: number }).n
  const stuck = db.prepare(`SELECT id, status, "engineState", "isTest" FROM "Race" WHERE status IN ('pending','running','failed') AND "engineConfigJson" IS NOT NULL ORDER BY id`).all() as Array<Record<string, unknown>>
  const legacy = (db.prepare(`SELECT COUNT(*) n FROM "Race" WHERE "engineConfigJson" IS NULL`).get() as { n: number }).n
  db.close()
  return { loaded, census, manualInputCount, stuck, legacy, hasTrackTable }
}

// ---------------------------------------------------------------- workers

function runWorker(candidate: Candidate, engineDir: string, headBundle: string, outDir: string, jobs: RaceJob[]): Promise<{ results: WorkerResult[]; loadError?: string }> {
  const guard = path.join(SCRIPT_DIR, 'guard-hook.mjs')
  const tsxLoader = path.join(REPO, 'node_modules/tsx/dist/loader.mjs')
  const job = {
    sha: candidate.sha,
    engineDir,
    headBundle,
    outDir,
    races: jobs.map((entry) => ({ raceId: entry.race.id, configJson: entry.race.engineConfigJson, resultDigest: entry.race.resultDigest, storedEvents: entry.storedEvents, manualInputs: entry.manualInputs })),
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, '--import', guard, path.join(SCRIPT_DIR, 'resolve-worker.mts')], {
      cwd: engineDir,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: path.join(engineDir, 'tsconfig.json'),
        REPLAY_GUARD_ROOTS: JSON.stringify([engineDir, path.dirname(headBundle), SCRIPT_DIR]),
        NODE_NO_WARNINGS: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout) as { results: WorkerResult[]; loadError?: string }
        resolve({ results: parsed.results.map((result) => ({ ...result, sha: candidate.sha })), loadError: parsed.loadError })
      } catch {
        resolve({ results: [], loadError: `worker output unreadable: ${(stderr || stdout).slice(-400)}` })
      }
    })
    child.stdin.end(JSON.stringify(job))
  })
}

async function pool<T>(tasks: Array<() => Promise<T>>, size: number) {
  const results: T[] = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next
      next += 1
      results[index] = await tasks[index]!()
    }
  }))
  return results
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const started = Date.now()
  const deadline = started + args.budgetMin * 60_000
  const outDir = path.resolve(REPO, args.out)
  const geometryDir = path.resolve(REPO, args.geometryOut)
  const scratch = path.join(CACHE, '_out', String(started))
  mkdirSync(outDir, { recursive: true })
  mkdirSync(geometryDir, { recursive: true })
  mkdirSync(scratch, { recursive: true })

  const head = git('rev-parse', 'HEAD')
  const candidates = listCandidates()
  const headBundle = await buildHeadBundle()
  const { loaded, census, manualInputCount, stuck, legacy, hasTrackTable } = loadRaces(path.resolve(args.db), args.races)
  console.log(`[resolve] HEAD ${head.slice(0, 7)}, ${candidates.length} candidate engines, ${loaded.length} races without a track`)

  const jobs: RaceJob[] = loaded.map(({ race, storedEvents, manualInputs }) => {
    const createdAt = Date.parse(race.createdAt)
    const isTest = Boolean(race.isTest)
    return {
      race, createdAt, storedEvents, manualInputs,
      candidates: orderCandidates(candidates, createdAt, race.balanceVersion ?? ''),
      tried: 0,
      maxCandidates: isTest ? (args.skipTests ? 0 : args.testCandidates) : Number.POSITIVE_INFINITY,
      digestHit: null, eventsHit: null, outcomeMatchAt: null, attempts: [],
    }
  })

  // Calibration first (plan §4.4 step 1): races since S3.15 must verify at HEAD before anything older is trusted.
  const headCandidate = candidates.find((candidate) => candidate.isHead)!
  const calibration = jobs.filter((job) => job.race.balanceVersion === 'S3.15')
  const loadErrors = new Map<string, string>()
  const record = (job: RaceJob, result: WorkerResult) => {
    job.attempts.push({ sha: result.sha.slice(0, 7), status: result.status === 'simulated' ? (result.digestMatch ? 'digest' : result.eventsMatch ? 'events' : `miss@event${result.eventDivergence}`) : result.status, detail: result.error })
    if (result.status !== 'simulated') return
    if (result.digestMatch && result.track && !job.digestHit) job.digestHit = result
    else if (result.eventsMatch && result.track && !job.eventsHit && !FIRE_AND_FORGET_ERA.has(result.sha.slice(0, 7))) job.eventsHit = result
    if (result.outcomeMatch && !job.outcomeMatchAt) job.outcomeMatchAt = result.sha.slice(0, 7)
  }
  if (calibration.length > 0) {
    const engineDir = extract(headCandidate)
    const chunks = Array.from({ length: Math.ceil(calibration.length / 4) }, (_, index) => calibration.slice(index * 4, index * 4 + 4))
    const outputs = await pool(chunks.map((chunk) => () => runWorker(headCandidate, engineDir, headBundle, scratch, chunk)), args.workers)
    for (const output of outputs) {
      if (output.loadError) throw new Error(`HEAD worker failed to load: ${output.loadError}`)
      for (const result of output.results) record(calibration.find((job) => job.race.id === result.raceId)!, result)
    }
    for (const job of calibration) job.tried = Math.max(job.tried, 0)
    const failed = calibration.filter((job) => !job.digestHit)
    console.log(`[resolve] calibration: ${calibration.length - failed.length}/${calibration.length} S3.15 races VERIFIED_DIGEST at HEAD`)
    if (failed.length > 0) throw new Error(`calibration failed for races ${failed.map((job) => job.race.id).join(', ')}: fix the environment (Node, ICU, locale) before trusting the search`)
  }

  // Rounds: each unresolved race tries its next candidate; one worker per commit per round.
  let round = 0
  let timedOut = false
  for (;;) {
    const pending = jobs.filter((job) => !job.digestHit && job.tried < Math.min(job.maxCandidates, job.candidates.length))
    if (pending.length === 0) break
    if (Date.now() > deadline) {
      timedOut = true
      break
    }
    round += 1
    const byCandidate = new Map<Candidate, RaceJob[]>()
    for (const job of pending) {
      let candidate: Candidate | undefined
      while (job.tried < job.candidates.length) {
        candidate = job.candidates[job.tried]
        job.tried += 1
        if (!(candidate!.isHead && job.attempts.some((attempt) => attempt.sha === candidate!.short)) && !loadErrors.has(candidate!.key)) break
        candidate = undefined
      }
      if (!candidate) continue
      byCandidate.set(candidate, [...(byCandidate.get(candidate) ?? []), job])
    }
    const tasks = [...byCandidate].flatMap(([candidate, group]) => {
      const chunks = Array.from({ length: Math.ceil(group.length / 6) }, (_, index) => group.slice(index * 6, index * 6 + 6))
      return chunks.map((chunk) => async () => {
        const engineDir = extract(candidate)
        const output = await runWorker(candidate, engineDir, headBundle, scratch, chunk)
        if (output.loadError) {
          loadErrors.set(candidate.key, output.loadError.slice(0, 300))
          for (const job of chunk) job.attempts.push({ sha: candidate.short, status: 'load-error' })
        }
        for (const result of output.results) record(chunk.find((job) => job.race.id === result.raceId)!, result)
      })
    })
    await pool(tasks, args.workers)
    const resolved = jobs.filter((job) => job.digestHit).length
    console.log(`[resolve] round ${round}: ${byCandidate.size} commits, ${pending.length} races tried, ${resolved}/${jobs.length} VERIFIED_DIGEST, ${Math.round((Date.now() - started) / 1000)} s`)
  }

  // Grade, verify with HEAD's decoder, copy outputs.
  interface Entry {
    raceId: number
    isTest: boolean
    engineVersion: string | null
    balanceVersion: string | null
    trackVersion: string | null
    resultDigest: string | null
    configSha256: string
    reproducedDigest: string | null
    fidelity: 'VERIFIED_DIGEST' | 'VERIFIED_EVENTS' | 'UNAVAILABLE'
    engineCommit: string | null
    trackGeometry: string | null
    file: string | null
    byteSha256: string | null
    gzipBytes: number | null
    tickRate: number
    tickCount: number
    baselineRank: Record<string, number> | null
    note: string | null
    candidatesTried: number
  }
  const entries: Entry[] = []
  const geometries = new Map<string, string>()
  const selfCheckFailures: string[] = []
  for (const job of jobs) {
    const hit = job.digestHit ?? job.eventsHit
    const config = JSON.parse(job.race.engineConfigJson) as { tickRate?: number }
    const base = {
      raceId: job.race.id,
      isTest: Boolean(job.race.isTest),
      engineVersion: job.race.engineVersion,
      balanceVersion: job.race.balanceVersion,
      trackVersion: job.race.trackVersion,
      resultDigest: job.race.resultDigest,
      configSha256: createHash('sha256').update(job.race.engineConfigJson).digest('hex'),
      candidatesTried: job.attempts.length,
    }
    const unavailable = (note: string | null): Entry => ({
      ...base, reproducedDigest: null, fidelity: 'UNAVAILABLE', engineCommit: null, trackGeometry: null, file: null, byteSha256: null,
      gzipBytes: null, tickRate: Number(config.tickRate) || 60, tickCount: 0, baselineRank: null, note,
    })
    if (!hit || !hit.track || !hit.geometry) {
      const notes = [
        job.outcomeMatchAt ? `outcome-match@${job.outcomeMatchAt}` : null,
        job.tried < job.candidates.length ? `search stopped after ${job.attempts.length} of ${job.candidates.length} candidates` : `no candidate reproduces (${job.attempts.length} tried)`,
      ].filter(Boolean)
      entries.push(unavailable(notes.join('; ')))
      continue
    }
    const gzip = readFileSync(hit.track.file)
    const raw = new Uint8Array(gunzipSync(gzip))
    const byteSha256 = createHash('sha256').update(raw).digest('hex')
    const decoded = decodeReplayTrack(raw)
    const problems = byteSha256 !== hit.track.byteSha256 ? ['byteSha256 differs from the worker'] : selfCheckReplayTrack(decoded, {
      standings: hit.standings as never,
      tickRate: hit.tickRate!,
      events: (hit.raceFinishedTick === null || hit.raceFinishedTick === undefined ? [] : [{ type: 'RACE_FINISHED', tick: hit.raceFinishedTick }]) as never,
    })
    if (problems.length > 0) {
      selfCheckFailures.push(`${job.race.id}: ${problems.join('; ')}`)
      entries.push(unavailable(`self-check failed at ${hit.sha.slice(0, 7)}: ${problems[0]}`))
      continue
    }
    const file = `${job.race.id}.dtrk.gz`
    copyFileSync(hit.track.file, path.join(outDir, file))
    geometries.set(hit.geometry.id, hit.geometry.file)
    const notes = [
      job.digestHit ? null : 'digest envelope differs',
      hit.track.movingEntities > 0 ? `moving entities: ${hit.track.movingEntities}` : null,
      hit.track.orderViolations > 0 ? `entity order violations: ${hit.track.orderViolations}` : null,
    ].filter(Boolean)
    entries.push({
      ...base,
      reproducedDigest: hit.digest ?? null,
      fidelity: job.digestHit ? 'VERIFIED_DIGEST' : 'VERIFIED_EVENTS',
      engineCommit: hit.sha,
      trackGeometry: hit.geometry.id,
      file,
      byteSha256,
      gzipBytes: gzip.length,
      tickRate: hit.tickRate!,
      tickCount: decoded.lastTick,
      baselineRank: hit.baselineRank ?? null,
      note: notes.length > 0 ? notes.join('; ') : null,
    })
  }

  // Bundle size rule: drop test-race bytes if the bundle is over the limit.
  let totalBytes = entries.reduce((sum, entry) => sum + (entry.gzipBytes ?? 0), 0)
  let testsDropped = false
  if (totalBytes > args.maxBundleMb * 1024 * 1024) {
    testsDropped = true
    for (const [index, entry] of entries.entries()) {
      if (!entry.isTest || !entry.file) continue
      rmSync(path.join(outDir, entry.file), { force: true })
      entries[index] = { ...entry, fidelity: 'UNAVAILABLE', file: null, byteSha256: null, gzipBytes: null, trackGeometry: null, reproducedDigest: null, baselineRank: null, note: `bundle over ${args.maxBundleMb} MB: test race skipped (resolvable at ${entry.engineCommit?.slice(0, 7)})`, engineCommit: null, tickCount: 0 }
    }
    totalBytes = entries.reduce((sum, entry) => sum + (entry.gzipBytes ?? 0), 0)
  }

  // Geometry files (content-addressed: an existing file must match byte for byte).
  const geometryWritten: string[] = []
  for (const [id, source] of geometries) {
    if (!entries.some((entry) => entry.trackGeometry === id)) continue
    const target = path.join(geometryDir, `${id}.json`)
    const bytes = readFileSync(source)
    if (existsSync(target)) {
      if (!readFileSync(target).equals(bytes)) throw new Error(`${target} exists with different content`)
    } else {
      writeFileSync(target, bytes)
      geometryWritten.push(id)
    }
  }
  // Stale .dtrk.gz files from earlier runs for races no longer graded.
  const keep = new Set(entries.map((entry) => entry.file).filter(Boolean))
  for (const name of readdirSync(outDir)) if (name.endsWith('.dtrk.gz') && !keep.has(name) && args.races.length === 0) rmSync(path.join(outDir, name))

  // Merge with an existing manifest when resolving single races (--race N appends, plan §4.4 step 10).
  const manifestFile = path.join(outDir, 'manifest.json')
  let mergedEntries = entries
  if (args.races.length > 0 && existsSync(manifestFile)) {
    const previous = JSON.parse(readFileSync(manifestFile, 'utf8')) as { races: Entry[] }
    mergedEntries = [...previous.races.filter((entry) => !args.races.includes(entry.raceId)), ...entries].sort((left, right) => left.raceId - right.raceId)
  }
  const environment = {
    node: process.versions.node,
    v8: process.versions.v8,
    icu: process.versions.icu,
    locale: new Intl.Collator().resolvedOptions().locale,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: `${process.platform}-${process.arch}`,
  }
  const manifest = {
    format: 'replay-tracks-manifest/1',
    resolverCommit: head,
    environment,
    races: mergedEntries.map((entry) => {
      const { candidatesTried, gzipBytes, ...kept } = entry
      void candidatesTried; void gzipBytes
      return kept
    }),
  }
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 1)}\n`)

  // REPORT.md: census + per-race outcome (ids, versions and grades only).
  const gradeCounts = new Map<string, number>()
  for (const entry of mergedEntries) {
    const key = `${entry.isTest === false ? 'official' : 'test'} ${entry.fidelity}`
    gradeCounts.set(key, (gradeCounts.get(key) ?? 0) + 1)
  }
  const lines: string[] = []
  lines.push('# Historical replay tracks (plan §4.4, step 0.6)', '')
  lines.push(`Generated by \`scripts/replay-tracks/resolve-historical.ts\` at resolver commit \`${head.slice(0, 7)}\` against a sanitised production copy. Ids, versions and grades only.`, '')
  lines.push(`Environment: Node ${environment.node}, V8 ${environment.v8}, ICU ${environment.icu}, collator locale \`${environment.locale}\`, TZ ${environment.tz}, ${environment.platform}.`, '')
  lines.push('## Census', '')
  lines.push('| isTest | status | engine | balance | track | n | digests | first | last |', '|---|---|---|---|---|---|---|---|---|')
  for (const row of census) lines.push(`| ${row.isTest} | ${row.status} | ${row.engineVersion} | ${row.balanceVersion} | ${row.trackVersion} | ${row.n} | ${row.digests} | ${String(row.firstAt).slice(0, 16)} | ${String(row.lastAt).slice(0, 16)} |`)
  lines.push('', `- Legacy v2 races without an engine config: ${legacy} (never simulated; no track).`)
  lines.push(`- \`WILD_ITEM_MANUAL_INPUT\` rows: ${manualInputCount}.`)
  lines.push(`- Not finished (pending/running/failed, with config): ${stuck.map((row) => `${row.id} (${row.status}/${row.engineState})`).join(', ') || 'none'}. Out of scope: only finished races get a track.`)
  lines.push(`- \`RaceReplayTrack\` table present in the copy: ${hasTrackTable ? 'yes' : 'no'}.`, '')
  lines.push('## Outcome', '')
  lines.push(`- Candidate engines (deduplicated by packages tree + audit/persistence/runtime blobs): ${candidates.length}. Rounds: ${round}. Time: ${Math.round((Date.now() - started) / 1000)} s${timedOut ? ' (budget reached; remaining test races left UNAVAILABLE)' : ''}.`)
  lines.push(`- Calibration: ${calibration.length} S3.15 races, all VERIFIED_DIGEST at HEAD (its engine tree is that of \`${headCandidate.short}\`, the last engine commit).`)
  lines.push(`- Commit search order per race: newest commit with committer date <= createdAt and the 3 before it, the next newer one, the rest of the balance label, HEAD, then all others by distance in time. No deployment history was available. Test races: at most ${args.testCandidates} candidates; official races: unlimited.`)
  for (const [key, count] of [...gradeCounts].sort()) lines.push(`- ${key}: ${count}`)
  lines.push(`- Bundle: ${(totalBytes / 1024 / 1024).toFixed(2)} MB of .dtrk.gz${testsDropped ? ' (over the limit: test races dropped)' : ''}. Geometry files: ${[...new Set(mergedEntries.map((entry) => entry.trackGeometry).filter(Boolean))].join(', ')}${geometryWritten.length ? ` (new: ${geometryWritten.join(', ')})` : ''}.`)
  if (selfCheckFailures.length) lines.push(`- Self-check failures: ${selfCheckFailures.join(' | ')}`)
  if (loadErrors.size) lines.push(`- Candidates that failed to load: ${[...loadErrors.keys()].map((key) => candidates.find((candidate) => candidate.key === key)?.short).join(', ')}`)
  lines.push('', '## Per race', '')
  lines.push('| race | test | engine/balance | track | fidelity | commit | geometry | ticks | KiB | tried | note |', '|---|---|---|---|---|---|---|---|---|---|---|')
  const triedById = new Map(jobs.map((job) => [job.race.id, job.attempts.length]))
  for (const entry of mergedEntries) {
    lines.push(`| ${entry.raceId} | ${entry.isTest ? 'y' : ''} | ${entry.engineVersion}/${entry.balanceVersion} | ${entry.trackVersion} | ${entry.fidelity} | ${entry.engineCommit?.slice(0, 7) ?? ''} | ${entry.trackGeometry ?? ''} | ${entry.tickCount || ''} | ${entry.gzipBytes ? (entry.gzipBytes / 1024).toFixed(0) : ''} | ${triedById.get(entry.raceId) ?? entry.candidatesTried ?? ''} | ${entry.note ?? ''} |`)
  }
  writeFileSync(path.join(outDir, 'REPORT.md'), `${lines.join('\n')}\n`)
  rmSync(scratch, { recursive: true, force: true })

  const official = mergedEntries.filter((entry) => entry.isTest === false)
  const officialBad = official.filter((entry) => entry.fidelity === 'UNAVAILABLE')
  console.log(`[resolve] done: ${[...gradeCounts].map(([key, count]) => `${key}=${count}`).join(', ')}; bundle ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
  if (officialBad.length > 0) {
    console.error(`[resolve] official races UNAVAILABLE: ${officialBad.map((entry) => entry.raceId).join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
