import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import type { RaceEvent, RaceItemId } from '../src/engine/protocol'
import { aggregatePostRaceStats, type PostRacePlayerInput } from '../src/race/post-race-stats'
import { decodeReplayTrack } from '../src/race/replay-track/decode'

// The shipped browser engine (crates/race-wasm built by scripts/build-wasm.sh) in Node:
// - its digests equal the native engine's on the pinned determinism cases,
// - its DTRK tracks decode with the browser's TS decoder within quantisation,
// - its post-race stats equal the TS aggregation over the same events, motion and baseline.
// Skipped when the package has not been built (`pnpm build:wasm`).

const repo = path.join(__dirname, '..')
const pkg = path.join(repo, 'crates/race-wasm/pkg')
const built = existsSync(path.join(pkg, 'race_wasm.js')) && existsSync(path.join(pkg, 'race_wasm_bg.wasm'))

type Wasm = typeof import('../crates/race-wasm/pkg/race_wasm.js')
let wasmPromise: Promise<Wasm> | null = null
function wasm(): Promise<Wasm> {
  wasmPromise ??= (async () => {
    const engine = (await import(pathToFileURL(path.join(pkg, 'race_wasm.js')).href)) as Wasm
    await engine.default({ module_or_path: readFileSync(path.join(pkg, 'race_wasm_bg.wasm')) })
    return engine
  })()
  return wasmPromise
}

interface PinnedCase {
  id: string
  line: string
  default: { finalTick: number; eventCount: number; eventsSha256: string; motionSha256: string; standings: Array<{ playerId: string; rank: number; finishTimeBits: string }> }
}

const pinned = (JSON.parse(readFileSync(path.join(repo, 'crates/race-core/tests/fixtures/determinism-pinned.json'), 'utf8')) as { cases: PinnedCase[] }).cases

const VERSION_KEYS = ['protocolVersion', 'engineVersion', 'balanceVersion', 'trackVersion', 'pickupSpawnVersion', 'wildItemBalanceVersion', 'hazardBalanceVersion']

/** A corpus line as `race_core::sim::parse_corpus_line` reads it without ts-compat: labels dropped. */
function caseInput(line: string) {
  const parsed = JSON.parse(line) as Record<string, unknown>
  const manualInputs = parsed.oracleManualInputs ?? []
  delete parsed.oracleManualInputs
  for (const key of VERSION_KEYS) delete parsed[key]
  return { config: JSON.stringify(parsed), manualInputs: JSON.stringify(manualInputs) }
}

function bits(value: number) {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  return view.getBigUint64(0).toString(16).padStart(16, '0')
}

interface Simulated {
  resultDigest: string
  engineConfigJson: string
  seedCommit: string
  finalTick: number
  envelope: { eventsSha256: string; motionSha256: string; durationTicks: number; standings: Array<{ playerId: string; rank: number; finishTimeMs: number; finishTick: number }> }
  events: RaceEvent[]
}

test('wasm engine: digests equal the native pinned digests', { skip: !built && 'race-wasm package not built' }, async () => {
  const engine = await wasm()
  const cases = pinned.filter((_, index) => index % 4 === 0)
  assert.ok(cases.length >= 10)
  for (const testCase of cases) {
    const { config, manualInputs } = caseInput(testCase.line)
    const result = JSON.parse(engine.simulate(config, manualInputs, true)) as Simulated
    const expected = testCase.default
    assert.equal(result.finalTick, expected.finalTick, testCase.id)
    assert.equal(result.envelope.durationTicks, expected.finalTick, testCase.id)
    assert.equal(result.envelope.eventsSha256, expected.eventsSha256, testCase.id)
    assert.equal(result.envelope.motionSha256, expected.motionSha256, testCase.id)
    assert.deepEqual(
      result.envelope.standings.map((entry) => ({ playerId: entry.playerId, rank: entry.rank, finishTimeBits: bits(entry.finishTimeMs) })),
      expected.standings,
      testCase.id,
    )
    // The digest re-verifies from the stored text (seed commit) and by re-simulation.
    assert.equal(JSON.parse(engine.verifyIntegrity(result.engineConfigJson, result.seedCommit)).ok, true, testCase.id)
    assert.equal(JSON.parse(engine.verifyResim(result.engineConfigJson, JSON.stringify(result.events), result.resultDigest)).ok, true, testCase.id)
  }
})

test('wasm engine: SimHandle tracks decode with the browser decoder within quantisation', { skip: !built && 'race-wasm package not built' }, async () => {
  const engine = await wasm()
  const { config, manualInputs } = caseInput(pinned.find((entry) => entry.id === 'full-0112')!.line)
  const handle = new engine.SimHandle(config, manualInputs, true)
  const worlds = new Map<number, { ducks: Array<{ playerId: string; progress: number; lateralOffset: number; rank: number; activeEffects: string[] }>; pickups: unknown[]; hazards: unknown[] }>()
  for (let tick = 300; !handle.finished(); tick += 300) {
    handle.stepTo(tick)
    worlds.set(handle.tick(), JSON.parse(handle.world()))
  }
  const digest = JSON.parse(handle.digest()) as Simulated & { standings: Array<{ playerId: string }> }
  const track = decodeReplayTrack(handle.trackPayload())
  handle.free()
  assert.equal(track.header.engine.impl, 'rust')
  assert.equal(track.header.resultDigest, digest.resultDigest)
  assert.equal(track.lastTick, digest.finalTick)
  for (const [tick, world] of worlds) {
    const decoded = track.worldAt(tick)
    for (const duck of world.ducks) {
      const back = decoded.ducks.find((entry) => entry.playerId === duck.playerId)!
      assert.ok(Math.abs(back.progress - duck.progress) <= 2 ** -24)
      assert.ok(Math.abs(back.lateralOffset - duck.lateralOffset) <= 1 / 32767)
      assert.equal(back.rank, duck.rank)
      assert.deepEqual(back.activeEffects, duck.activeEffects)
    }
    assert.deepEqual(decoded.pickups, world.pickups)
    assert.deepEqual(decoded.hazards, world.hazards)
  }
  const finalRanks = track.worldAt(track.lastTick).ducks.filter((duck) => digest.standings.some((entry) => entry.playerId === duck.playerId))
  assert.deepEqual(finalRanks.map((duck) => duck.playerId), digest.standings.map((entry) => entry.playerId))
})

test('wasm engine: post-race stats equal the TS aggregation of the same race', { skip: !built && 'race-wasm package not built' }, async () => {
  const engine = await wasm()
  for (const id of ['full-0112', 'full-0048', 'items-0040']) {
    const { config, manualInputs } = caseInput(pinned.find((entry) => entry.id === id)!.line)
    const resolved = JSON.parse(engine.normalizeConfig(config)) as { tickRate: number; players: Array<{ playerId: string; name: string }>; loadouts: Array<{ playerId: string; itemIds: RaceItemId[] }> }
    const { events } = JSON.parse(engine.simulate(config, manualInputs, true)) as Simulated
    const players: PostRacePlayerInput[] = resolved.players.map((player, index) => ({
      playerId: player.playerId,
      name: player.name,
      ...(index % 2 === 0 ? { avatarUrl: index % 4 === 0 ? null : `https://example.test/${player.playerId}.png` } : {}),
      itemIds: resolved.loadouts.find((loadout) => loadout.playerId === player.playerId)?.itemIds ?? [],
    }))
    const rust = JSON.parse(engine.postRaceStats(config, JSON.stringify(events), JSON.stringify(players))) as ReturnType<typeof aggregatePostRaceStats>
    assert.equal(rust.hasBaseline, true, id)
    const ts = aggregatePostRaceStats({ tickRate: resolved.tickRate }, events, players, {
      motion: new Map(rust.players.map((player) => [player.playerId, { averageSpeed: player.averageSpeed, peakSpeed: player.peakSpeed }])),
      baselineRank: new Map(rust.players.map((player) => [player.playerId, player.baselineRank])),
    })
    assert.deepEqual(rust, JSON.parse(JSON.stringify(ts)), id)
    assert.ok(rust.players.some((player) => player.itemStats.length > 0), id)
    assert.ok(rust.players.every((player) => player.averageSpeed > 0), id)
  }
})
