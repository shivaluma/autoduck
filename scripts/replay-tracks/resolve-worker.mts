/**
 * Resolver worker (plan §4.4 steps 3-6): simulates races with ONE historical commit's TS engine and records them
 * with HEAD's DTRK/1 encoder.
 *
 * Spawned by resolve-historical.ts as
 *   node --import tsx --import <abs>/guard-hook.mjs <abs>/resolve-worker.mts
 * with cwd = the commit's extraction directory (.cache/engines/<key>), TSX_TSCONFIG_PATH = its tsconfig.json and
 * REPLAY_GUARD_ROOTS limiting what may be loaded. The job arrives as JSON on stdin; the answer is one JSON object
 * on stdout. Every import here is dynamic and absolute: the commit's race-core, race-protocol and
 * lib/racing/audit.ts, and the esbuild bundle of HEAD's recorder/encoder (scripts/replay-tracks/head-dtrk.ts).
 *
 * Per race: parse the config with that commit's raceConfigSchema (a ZodError means "not this commit"), run its
 * createSimulation/stepSimulation from tick 0 while HEAD's recorder samples every tick, compute its
 * createResultDigest, compare the digest and the stored event stream, and, when either matches, encode and gzip
 * the track, export the commit's createRiverTrack geometry and run its no-items baseline for post-race stats.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- historical commits' modules are untyped by design */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

interface StoredEvent {
  type: string
  tick: number
  timestampWithinRaceMs: number
  sourcePlayerId: string | null
  targetPlayerId: string | null
  metadataJson: string
}

interface WorkerRace {
  raceId: number
  configJson: string
  resultDigest: string | null
  /** Engine events (meta events removed), ORDER BY id. */
  storedEvents: StoredEvent[]
  manualInputs: unknown[]
}

interface WorkerJob {
  sha: string
  engineDir: string
  headBundle: string
  outDir: string
  races: WorkerRace[]
}

type AnyModule = Record<string, any>

async function load(file: string): Promise<AnyModule> {
  const loaded: AnyModule = await import(pathToFileURL(file).href)
  // tsx may expose a CommonJS-compiled .ts module as { default: exports }.
  const keys = Object.keys(loaded)
  if (keys.length === 1 && keys[0] === 'default' && loaded.default && typeof loaded.default === 'object') return loaded.default
  return { ...(loaded.default && typeof loaded.default === 'object' ? loaded.default : {}), ...loaded }
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** Index of the first differing event, or -1 when the streams are identical (plan §4.4 step 5). */
function firstEventDivergence(stored: StoredEvent[], produced: AnyModule[]): number {
  const count = Math.min(stored.length, produced.length)
  for (let index = 0; index < count; index += 1) {
    const left = stored[index]!
    const right = produced[index]!
    if (left.type !== right.type || left.tick !== right.tick || left.timestampWithinRaceMs !== right.timestampWithinRaceMs
      || left.sourcePlayerId !== (right.sourcePlayerId ?? null) || left.targetPlayerId !== (right.targetPlayerId ?? null)) return index
    let storedMetadata: unknown
    try { storedMetadata = JSON.parse(left.metadataJson) } catch { return index }
    const producedMetadata = JSON.parse(JSON.stringify(right.metadata ?? {}))
    if (canonicalize(storedMetadata) !== canonicalize(producedMetadata)) return index
  }
  return stored.length === produced.length ? -1 : count
}

const finishOrder = (events: Array<{ type: string; sourcePlayerId?: string | null }>) =>
  events.filter((event) => event.type === 'DUCK_FINISHED').map((event) => event.sourcePlayerId ?? '').join(',')

/**
 * The world HEAD's recorder samples. Ducks come straight from state.ducks (stable simulation order); pickups,
 * hazards, rockets and bananas from the commit's own snapshotRaceWorld, so the track holds exactly what that
 * commit's viewers were sent. Commits before 695f5ea have no snapshotRaceWorld (no pickups or wild items): the
 * lists are empty and missing fields get protocol defaults.
 */
function makeSource(core: AnyModule) {
  const snapshotWorld: ((state: any) => AnyModule) | null = typeof core.snapshotRaceWorld === 'function' ? core.snapshotRaceWorld : null
  return (state: any) => {
    const world = snapshotWorld ? snapshotWorld(state) : {}
    return {
      ducks: state.ducks,
      duckItems: (playerId: string) => {
        const runtime = state.itemState?.byPlayer?.get?.(playerId)
        if (!runtime) return undefined
        return { wildItem: runtime.wildItem ?? null, regularPickupCount: runtime.regularPickupCount ?? 0 }
      },
      pickups: (world.pickups ?? []) as any[],
      hazards: (world.hazards ?? []) as any[],
      rockets: ((world.rockets ?? []) as any[]).map((rocket) => ({ ...rocket, kind: rocket.kind ?? 'PREP', targetPlayerId: rocket.targetPlayerId ?? '' })),
      bananas: ((world.bananas ?? []) as any[]).map((banana) => ({ ...banana, kind: banana.kind ?? 'PREP', lateralOffset: banana.lateralOffset ?? 0 })),
    }
  }
}

async function main() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const job = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WorkerJob
  const started = performance.now()

  const head = await load(job.headBundle)
  let core: AnyModule
  let protocol: AnyModule
  let audit: AnyModule
  try {
    core = await load(path.join(job.engineDir, 'packages/race-core/src/index.ts'))
    protocol = await load(path.join(job.engineDir, 'packages/race-protocol/src/index.ts'))
    audit = await load(path.join(job.engineDir, 'lib/racing/audit.ts'))
  } catch (error) {
    process.stdout.write(JSON.stringify({ sha: job.sha, loadError: error instanceof Error ? error.message : String(error), results: [] }))
    return
  }

  const results: AnyModule[] = []
  for (const race of job.races) {
    const raceStarted = performance.now()
    const base = { raceId: race.raceId }
    try {
      let config: AnyModule
      try {
        config = protocol.raceConfigSchema.parse(JSON.parse(race.configJson))
      } catch (error) {
        results.push({ ...base, status: 'config-rejected', error: error instanceof Error ? error.message.slice(0, 200) : String(error) })
        continue
      }
      let recorderError: string | null = null
      const recorder = head.createReplayTrackRecorder({
        source: makeSource(core),
        log: (_message: string, error: unknown) => { recorderError = error instanceof Error ? error.message : String(error) },
      })
      const state = core.createSimulation(config, { manualInputs: race.manualInputs, allowVersion: true })
      const maximumTicks = 600 * config.tickRate
      while (!state.finished && state.tick < maximumTicks) {
        if (state.tick === 0) recorder.push(state)
        core.stepSimulation(state)
        recorder.push(state)
      }
      if (!state.finished) {
        results.push({ ...base, status: 'unfinished', ms: Math.round(performance.now() - raceStarted) })
        continue
      }
      const result = core.resultFromSimulation(state)
      const digest: string = audit.createResultDigest(result)
      const digestMatch = race.resultDigest !== null && digest === race.resultDigest
      const divergence = firstEventDivergence(race.storedEvents, result.events)
      const eventsMatch = divergence === -1
      const outcomeMatch = finishOrder(race.storedEvents) === finishOrder(result.events)
      const summary = {
        ...base,
        status: 'simulated',
        digest,
        digestMatch,
        eventsMatch,
        eventDivergence: divergence,
        producedEvents: result.events.length,
        outcomeMatch,
      }
      if (!digestMatch && !eventsMatch) {
        results.push({ ...summary, ms: Math.round(performance.now() - raceStarted) })
        continue
      }

      // Graded candidate: geometry, track bytes and the no-items baseline.
      const trackVersion: string = result.trackVersion ?? config.trackVersion
      const geometry = head.serializeTrackGeometry(head.exportTrackGeometryFromTrack(core.createRiverTrack(trackVersion), trackVersion))
      const geometryFile = path.join(job.outDir, `${geometry.id}.json`)
      writeFileSync(geometryFile, geometry.json)

      let track: AnyModule | null = null
      let trackError: string | null = null
      try {
        const recording = recorder.finalize()
        const payload = head.encodeReplayTrack(recording, {
          raceId: String(race.raceId),
          tickRate: result.tickRate,
          trackVersion,
          trackGeometry: geometry.id,
          engine: { impl: 'ts', engineVersion: result.engineVersion, balanceVersion: result.balanceVersion, commit: job.sha, build: null },
          source: 'BACKFILL',
          fidelity: digestMatch ? 'VERIFIED_DIGEST' : 'VERIFIED_EVENTS',
          resultDigest: race.resultDigest,
        })
        const packed = head.packReplayTrack(payload)
        const file = path.join(job.outDir, `${race.raceId}@${job.sha.slice(0, 12)}.dtrk.gz`)
        writeFileSync(file, packed.gzip)
        track = {
          file,
          byteSha256: packed.byteSha256,
          rawBytes: packed.rawBytes,
          gzipBytes: packed.gzip.length,
          movingEntities: recording.stats.movingEntities,
          orderViolations: recording.stats.orderViolations,
        }
      } catch (error) {
        trackError = recorderError ?? (error instanceof Error ? error.message : String(error))
      }

      let baselineRank: Record<string, number> | null = null
      try {
        const baseline = core.simulateRace({ ...config, raceId: `${config.raceId}-post-race-baseline`, loadouts: [] }, { recordEvents: false, allowVersion: true })
        baselineRank = Object.fromEntries(baseline.standings.map((entry: AnyModule) => [entry.playerId, entry.rank]))
      } catch {
        baselineRank = null
      }

      const raceFinished = result.events.find((event: AnyModule) => event.type === 'RACE_FINISHED')
      results.push({
        ...summary,
        engineVersion: result.engineVersion,
        balanceVersion: result.balanceVersion,
        trackVersion,
        tickRate: result.tickRate,
        standings: result.standings.map((entry: AnyModule) => ({ playerId: entry.playerId, rank: entry.rank, finishTimeMs: entry.finishTimeMs })),
        raceFinishedTick: raceFinished ? raceFinished.tick : null,
        geometry: { id: geometry.id, file: geometryFile },
        track,
        trackError,
        baselineRank,
        ms: Math.round(performance.now() - raceStarted),
      })
    } catch (error) {
      results.push({ ...base, status: 'error', error: error instanceof Error ? error.message.slice(0, 300) : String(error) })
    }
  }
  process.stdout.write(JSON.stringify({ sha: job.sha, ms: Math.round(performance.now() - started), results }))
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ loadError: error instanceof Error ? error.stack ?? error.message : String(error), results: [] }))
  process.exitCode = 0
})
