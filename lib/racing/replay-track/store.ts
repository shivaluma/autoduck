import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import type { RaceResult } from '@/packages/race-protocol/src'
import { decodeReplayTrack, type DecodedReplayTrack } from './decode'
import { encodeReplayTrack, packReplayTrack, type ReplayTrackMeta } from './encode'
import { DTRK_FORMAT, type ReplayTrackFidelity, type ReplayTrackSource } from './format'
import type { ReplayTrackRecorder, ReplayTrackRecording } from './recorder'

/** Columns of the RaceReplayTrack table (prisma/schema.prisma), minus createdAt. */
export interface ReplayTrackRow {
  raceId: number
  format: string
  source: ReplayTrackSource
  fidelity: ReplayTrackFidelity
  engineImpl: 'ts' | 'rust'
  engineCommit: string | null
  engineBuild: string | null
  engineVersion: string
  balanceVersion: string
  trackVersion: string
  trackGeometry: string | null
  tickRate: number
  tickCount: number
  stride: number
  reproducedDigest: string | null
  byteSha256: string | null
  bytes: Uint8Array | null
  statsJson: string | null
  note: string | null
}

export type ReplayTrackPersister = (row: ReplayTrackRow) => Promise<unknown>

export function replayTrackEngineCommit(env: Record<string, string | undefined> = process.env) {
  return env.SOURCE_COMMIT || env.GIT_SHA || null
}

/**
 * Self-check: the decoded finish order and finish ticks must equal the race result.
 * Returns a list of problems (empty when the track is consistent).
 */
export function selfCheckReplayTrack(decoded: DecodedReplayTrack, result: Pick<RaceResult, 'standings' | 'tickRate' | 'events'>): string[] {
  const problems: string[] = []
  const ducks = decoded.header.ducks
  const finishTicks = decoded.finishTicks()
  const finalRanks = decoded.finalRanks()
  const official = new Set(result.standings.map((entry) => entry.playerId))
  const decodedOrder = ducks
    .map((playerId, index) => ({ playerId, rank: finalRanks[index]!, finishTick: finishTicks[index] }))
    .filter((duck) => official.has(duck.playerId))
    .sort((left, right) => left.rank - right.rank)
  const expectedOrder = result.standings.map((entry) => entry.playerId)
  if (decodedOrder.map((duck) => duck.playerId).join('|') !== expectedOrder.join('|')) {
    problems.push(`finish order differs: track ${decodedOrder.map((duck) => duck.playerId).join(',')} vs result ${expectedOrder.join(',')}`)
  }
  const tickMs = 1000 / result.tickRate
  for (const entry of result.standings) {
    const index = ducks.indexOf(entry.playerId)
    const finishTick = index < 0 ? null : finishTicks[index]
    // The engine sets finishTimeMs = (tick - 1) * tickMs + fraction * tickMs, fraction in [0, 1].
    if (finishTick === null || finishTick === undefined
      || entry.finishTimeMs < (finishTick - 1) * tickMs - 1e-6
      || entry.finishTimeMs > finishTick * tickMs + 1e-6) {
      problems.push(`finish tick for ${entry.playerId}: track ${finishTick ?? 'none'} vs finishTimeMs ${entry.finishTimeMs}`)
    }
  }
  const raceFinished = result.events.find((event) => event.type === 'RACE_FINISHED')
  if (raceFinished && raceFinished.tick !== decoded.lastTick) problems.push(`last tick ${decoded.lastTick} vs RACE_FINISHED tick ${raceFinished.tick}`)
  return problems
}

export interface BuildReplayTrackInput {
  recording: ReplayTrackRecording
  result: RaceResult
  raceId: number
  resultDigest: string
  engineCommit: string | null
  source?: ReplayTrackSource
  fidelity?: ReplayTrackFidelity
  trackGeometry?: string | null
}

export class ReplayTrackSelfCheckError extends Error {
  constructor(readonly problems: string[]) {
    super(`replay-track self-check failed: ${problems.join('; ')}`)
  }
}

/** Encodes, gzips, decodes the gzip again and self-checks. Throws ReplayTrackSelfCheckError on mismatch. */
export function buildReplayTrackRow(input: BuildReplayTrackInput) {
  const meta: ReplayTrackMeta = {
    raceId: String(input.raceId),
    tickRate: input.result.tickRate,
    trackVersion: input.result.trackVersion,
    trackGeometry: input.trackGeometry ?? null,
    engine: { impl: 'ts', engineVersion: input.result.engineVersion, balanceVersion: input.result.balanceVersion, commit: input.engineCommit, build: null },
    source: input.source ?? 'LIVE_TS',
    fidelity: input.fidelity ?? 'RECORDED',
    resultDigest: input.resultDigest,
  }
  const payload = encodeReplayTrack(input.recording, meta)
  const packed = packReplayTrack(payload)
  const roundTrip = new Uint8Array(gunzipSync(packed.gzip))
  if (createHash('sha256').update(roundTrip).digest('hex') !== packed.byteSha256) throw new ReplayTrackSelfCheckError(['gzip round trip changed the payload'])
  const decoded = decodeReplayTrack(roundTrip)
  const problems = selfCheckReplayTrack(decoded, input.result)
  if (problems.length > 0) throw new ReplayTrackSelfCheckError(problems)
  const { movingEntities, orderViolations } = input.recording.stats
  const notes = [
    movingEntities > 0 ? `moving entities: ${movingEntities}` : null,
    orderViolations > 0 ? `entity order violations: ${orderViolations}` : null,
  ].filter(Boolean)
  const row: ReplayTrackRow = {
    raceId: input.raceId,
    format: DTRK_FORMAT,
    source: meta.source,
    fidelity: meta.fidelity,
    engineImpl: 'ts',
    engineCommit: input.engineCommit,
    engineBuild: null,
    engineVersion: input.result.engineVersion,
    balanceVersion: input.result.balanceVersion,
    trackVersion: input.result.trackVersion,
    trackGeometry: meta.trackGeometry,
    tickRate: input.result.tickRate,
    tickCount: decoded.lastTick,
    stride: 1,
    reproducedDigest: input.resultDigest,
    byteSha256: packed.byteSha256,
    bytes: packed.gzip,
    statsJson: null,
    note: notes.length > 0 ? notes.join('; ') : null,
  }
  return { row, decoded, rawBytes: payload.length, gzipBytes: packed.gzip.length }
}

export interface StoreReplayTrackInput {
  recorder: ReplayTrackRecorder | null
  result: RaceResult
  raceId: number
  resultDigest: string
  persist: ReplayTrackPersister
  engineCommit?: string | null
  /** Best effort; a throw here only leaves statsJson null. */
  stats?: () => string | null | Promise<string | null>
  log?: (message: string, error?: unknown) => void
}

export type StoreReplayTrackOutcome =
  | { stored: true; row: ReplayTrackRow; rawBytes: number; gzipBytes: number }
  | { stored: false; reason: string }

/**
 * Runs after the race is resolved: finalize → encode → decode → self-check → insert.
 * Never throws; any failure writes no row and logs exactly one line.
 */
export async function storeRecordedReplayTrack(input: StoreReplayTrackInput): Promise<StoreReplayTrackOutcome> {
  const log = input.log ?? ((message: string, error?: unknown) => (error === undefined ? console.error(message) : console.error(message, error)))
  if (!input.recorder) return { stored: false, reason: 'recording disabled (REPLAY_TRACK_RECORDING=0)' }
  try {
    const recording = input.recorder.finalize()
    const built = buildReplayTrackRow({
      recording,
      result: input.result,
      raceId: input.raceId,
      resultDigest: input.resultDigest,
      engineCommit: input.engineCommit === undefined ? replayTrackEngineCommit() : input.engineCommit,
    })
    let statsJson: string | null = null
    try {
      statsJson = (await input.stats?.()) ?? null
    } catch {
      statsJson = null
    }
    const row = { ...built.row, statsJson }
    await input.persist(row)
    return { stored: true, row, rawBytes: built.rawBytes, gzipBytes: built.gzipBytes }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    try {
      log(`[replay-track] race ${input.raceId}: no track stored (${reason})`)
    } catch {
      // ignore
    }
    return { stored: false, reason }
  }
}
