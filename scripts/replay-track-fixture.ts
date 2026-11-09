/**
 * Regenerates fixtures/replay-track/short-race.{dtrk.gz,json} from a deterministic short race.
 * Run only for an intended DTRK format change or a balance/engine bump: `pnpm replay:fixture`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createResultDigest } from '../lib/racing/audit'
import { createReplayTrackRecorder } from '../lib/racing/replay-track/recorder'
import { buildReplayTrackRow } from '../lib/racing/replay-track/store'
import { createSimulation, resultFromSimulation, stepSimulation } from '../packages/race-core/src'
import { buildFixtureConfig, FIXTURE_DIR } from './lib/replay-track-fixture'

const config = buildFixtureConfig()
const state = createSimulation(config)
const recorder = createReplayTrackRecorder()
recorder.push(state)
while (!state.finished) {
  stepSimulation(state)
  recorder.push(state)
}
const result = resultFromSimulation(state)
const resultDigest = createResultDigest(result)
const built = buildReplayTrackRow({ recording: recorder.finalize(), result, raceId: Number(config.raceId), resultDigest, engineCommit: null })
mkdirSync(FIXTURE_DIR, { recursive: true })
writeFileSync(path.join(FIXTURE_DIR, 'short-race.dtrk.gz'), built.row.bytes!)
writeFileSync(path.join(FIXTURE_DIR, 'short-race.json'), `${JSON.stringify({
  description: 'DTRK/1 fixture recorded from scripts/lib/replay-track-fixture.ts buildFixtureConfig()',
  format: built.row.format,
  engineVersion: result.engineVersion,
  balanceVersion: result.balanceVersion,
  trackVersion: result.trackVersion,
  config,
  resultDigest,
  byteSha256: built.row.byteSha256,
  tickCount: built.row.tickCount,
  rawBytes: built.rawBytes,
  gzipBytes: built.gzipBytes,
  finishOrder: result.standings.map((entry) => entry.playerId),
}, null, 2)}\n`)
console.log(`fixture: ${built.row.tickCount} ticks, raw ${built.rawBytes} B, gzip ${built.gzipBytes} B, sha256 ${built.row.byteSha256}`)
