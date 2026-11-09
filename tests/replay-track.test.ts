import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createResultDigest } from '../lib/racing/audit'
import { runAuthoritativeRace } from '../lib/racing/runtime'
import { decodeReplayTrack } from '../src/race/replay-track/decode'
import { encodeReplayTrack, packReplayTrack } from '../lib/racing/replay-track/encode'
import { DTRK_Q, canonicalHeaderJson, quantiseProgress } from '../src/race/replay-track/format'
import {
  createReplayTrackRecorder,
  isReplayTrackRecordingEnabled,
  worldFromSimulation,
  type ReplayTrackRecorder,
} from '../lib/racing/replay-track/recorder'
import { buildReplayTrackRow, storeRecordedReplayTrack, type ReplayTrackRow } from '../lib/racing/replay-track/store'
import { createSimulation, resultFromSimulation, simulateRace, snapshotRaceWorld, stepSimulation } from '../packages/race-core/src'
import { raceConfigSchema, type RaceConfig, type RaceItemId, type RaceResult } from '../packages/race-protocol/src'
import { buildFixtureConfig, FIXTURE_DIR } from '../scripts/lib/replay-track-fixture'

const PROGRESS_TOLERANCE = 2 ** -24
const LATERAL_TOLERANCE = 1 / 32767

const PRODUCTION_PICKUPS = {
  enabled: true,
  goldenBoxEnabled: true,
  goldenBoxProbability: 0.15,
  hazardsEnabled: true,
  positionAwareLoot: true,
  spawnMultiplier: 1.25,
  regularPickupCap: 3,
  manualItemsEnabled: true,
  autoItemsEnabled: true,
  chaosBoxEnabled: false,
  forceGoldenBox: false,
  disabledItems: [],
  idealManualPlayerIds: [],
}

const LOADOUT_SETS: RaceItemId[][] = [
  ['NITRO', 'HOMING_ROCKET'],
  ['BANANA', 'BUBBLE_SHIELD'],
  ['FEATHER', 'QUACK_HORN'],
  ['DRAFT_FIN', 'PADDLE_BURST'],
  ['SHOCK_ABSORBER', 'HOMING_ROCKET'],
  ['BANANA', 'NITRO'],
]

function makeConfig(seedByte: string, options: { players?: number; pickups?: Record<string, unknown> | null; ghost?: boolean; chaos?: RaceConfig['chaosConfig'] } = {}): RaceConfig {
  const playerCount = options.players ?? 8
  return raceConfigSchema.parse({
    raceId: `replay-${seedByte}`,
    seed: seedByte.repeat(32),
    players: Array.from({ length: playerCount }, (_, index) => ({
      playerId: String(101 + index),
      name: `Duck ${index + 1}`,
      isGhost: options.ghost && index === playerCount - 1 ? true : undefined,
    })),
    loadouts: Array.from({ length: playerCount }, (_, index) => ({
      playerId: String(101 + index),
      itemIds: LOADOUT_SETS[(index + seedByte.charCodeAt(0)) % LOADOUT_SETS.length],
      source: 'AUTO',
    })),
    chaosConfig: options.chaos,
    pickupConfig: options.pickups === null ? undefined : { ...PRODUCTION_PICKUPS, ...(options.pickups ?? {}) },
  })
}

function recordRace(config: RaceConfig, recorder: ReplayTrackRecorder = createReplayTrackRecorder()) {
  const state = createSimulation(config)
  const truth = [snapshotRaceWorld(state)]
  recorder.push(state)
  while (!state.finished) {
    stepSimulation(state)
    recorder.push(state)
    truth.push(snapshotRaceWorld(state))
  }
  return { result: resultFromSimulation(state), truth, recorder }
}

function assertRoundTrip(config: RaceConfig) {
  const { result, truth, recorder } = recordRace(config)
  const built = buildReplayTrackRow({ recording: recorder.finalize(), result, raceId: 1, resultDigest: createResultDigest(result), engineCommit: null })
  const decoded = built.decoded
  assert.equal(decoded.lastTick, truth.length - 1)
  assert.equal(built.row.tickCount, truth.length - 1)
  let maxProgress = 0
  let maxLateral = 0
  const counts = { rockets: 0, bananas: 0, wildItems: 0, effects: 0 }
  for (let tick = 0; tick < truth.length; tick += 1) {
    const expected = truth[tick]!
    const actual = decoded.worldAt(tick)
    assert.equal(actual.ducks.length, expected.ducks.length)
    for (let index = 0; index < expected.ducks.length; index += 1) {
      const want = expected.ducks[index]!
      const got = actual.ducks[index]!
      assert.equal(got.playerId, want.playerId, `tick ${tick} duck order`)
      assert.equal(got.rank, want.rank)
      assert.deepEqual(got.activeEffects, want.activeEffects, `tick ${tick} effects`)
      assert.deepEqual(got.wildItem, want.wildItem, `tick ${tick} wild item`)
      assert.equal(got.regularPickupCount, want.regularPickupCount)
      assert.ok(Math.abs(got.progress - want.progress) <= PROGRESS_TOLERANCE, `tick ${tick} progress`)
      assert.ok(Math.abs(got.speed - want.speed) <= PROGRESS_TOLERANCE, `tick ${tick} speed`)
      assert.ok(Math.abs(got.lateralOffset - want.lateralOffset) <= LATERAL_TOLERANCE, `tick ${tick} lateral`)
      assert.equal(got.progress === 1, want.progress === 1, `tick ${tick} finished flag`)
      maxProgress = Math.max(maxProgress, Math.abs(got.progress - want.progress))
      maxLateral = Math.max(maxLateral, Math.abs(got.lateralOffset - want.lateralOffset))
      if (want.wildItem) counts.wildItems += 1
      if (want.activeEffects.length) counts.effects += 1
    }
    assert.deepEqual(actual.pickups, expected.pickups, `tick ${tick} pickups`)
    assert.deepEqual(actual.hazards, expected.hazards, `tick ${tick} hazards`)
    assert.deepEqual(actual.bananas, expected.bananas, `tick ${tick} bananas`)
    assert.equal(actual.rockets.length, expected.rockets.length, `tick ${tick} rockets`)
    for (let index = 0; index < expected.rockets.length; index += 1) {
      const { progress: wantProgress, ...wantRest } = expected.rockets[index]!
      const { progress: gotProgress, ...gotRest } = actual.rockets[index]!
      assert.deepEqual(gotRest, wantRest)
      assert.ok(Math.abs(gotProgress - wantProgress) <= PROGRESS_TOLERANCE)
    }
    counts.rockets += expected.rockets.length
    counts.bananas += expected.bananas.length
  }
  return { built, result, counts, maxProgress, maxLateral }
}

test('DTRK encode → decode round trip is exact up to quantisation across seeds, pickups and items', () => {
  const cases: Array<[string, Parameters<typeof makeConfig>[1]]> = [
    ['a1', {}],
    ['b2', { pickups: { forceItem: 'MINI_ROCKET' } }],
    ['c3', { pickups: { forceItem: 'BANANA', forceGoldenBox: true } }],
    ['d4', { players: 5, ghost: true }],
    ['e5', { pickups: null, players: 3 }],
    ['f6', { players: 12, chaos: { type: 'REVERSE' } }],
  ]
  let rockets = 0
  let bananas = 0
  let wildItems = 0
  for (const [seed, options] of cases) {
    const outcome = assertRoundTrip(makeConfig(seed, options))
    assert.ok(outcome.maxProgress <= PROGRESS_TOLERANCE)
    assert.ok(outcome.maxLateral <= LATERAL_TOLERANCE)
    rockets += outcome.counts.rockets
    bananas += outcome.counts.bananas
    wildItems += outcome.counts.wildItems
  }
  // The cases must actually exercise the entity and item sections.
  assert.ok(rockets > 0, 'no rocket samples')
  assert.ok(bananas > 0, 'no banana samples')
  assert.ok(wildItems > 0, 'no wild item samples')
})

test('DTRK header is canonical JSON and the payload hash covers the uncompressed bytes', () => {
  const config = makeConfig('aa', { players: 3 })
  const { result, recorder } = recordRace(config)
  const meta = {
    raceId: '7', tickRate: 60, trackVersion: result.trackVersion, trackGeometry: null,
    engine: { impl: 'ts' as const, engineVersion: result.engineVersion, balanceVersion: result.balanceVersion, commit: null, build: null },
    source: 'LIVE_TS' as const, fidelity: 'RECORDED' as const, resultDigest: createResultDigest(result),
  }
  const recording = recorder.finalize()
  const payload = encodeReplayTrack(recording, meta)
  assert.equal(new TextDecoder().decode(payload.subarray(0, 4)), 'DTRK')
  const view = new DataView(payload.buffer, payload.byteOffset)
  assert.equal(view.getUint16(4, true), 1)
  assert.equal(view.getUint16(6, true), 0)
  const headerText = new TextDecoder().decode(payload.subarray(12, 12 + view.getUint32(8, true)))
  assert.equal(headerText, canonicalHeaderJson(JSON.parse(headerText)))
  assert.deepEqual(Object.keys(JSON.parse(headerText)), [...Object.keys(JSON.parse(headerText))].sort())
  assert.throws(() => canonicalHeaderJson({ value: undefined }))
  const packed = packReplayTrack(payload)
  assert.equal(packed.byteSha256, createHash('sha256').update(payload).digest('hex'))
  assert.equal(createHash('sha256').update(gunzipSync(packed.gzip)).digest('hex'), packed.byteSha256)
  assert.deepEqual(encodeReplayTrack(recording, meta), payload, 'encoding is deterministic')
})

test('progress quantisation keeps an unfinished duck below the finish line', () => {
  assert.equal(quantiseProgress(1), DTRK_Q.progress)
  assert.equal(quantiseProgress(1 - 2 ** -30), DTRK_Q.progress - 1)
  assert.equal(quantiseProgress(0.5), DTRK_Q.progress / 2)
})

test('a throwing recorder source never breaks the race and writes no track', async () => {
  const config = makeConfig('9c', { pickups: { forceItem: 'MINI_ROCKET' } })
  const logs: string[] = []
  let calls = 0
  const recorder = createReplayTrackRecorder({
    source: (state) => {
      calls += 1
      if (state.tick === 120) throw new Error('injected recorder failure')
      return worldFromSimulation(state)
    },
    log: (message) => logs.push(message),
  })
  const result = await runAuthoritativeRace(config, {
    realtime: false,
    beforeTick: (state) => { if (state.tick === 0) recorder.push(state) },
    afterTick: (state) => recorder.push(state),
  })
  assert.deepEqual(result, simulateRace(config))
  assert.equal(recorder.disabled, true)
  assert.equal(calls, 121, 'source is not called again once disabled')
  assert.equal(logs.length, 1, 'the failure logs exactly once')

  const persisted: ReplayTrackRow[] = []
  const storeLogs: string[] = []
  const outcome = await storeRecordedReplayTrack({
    recorder, result, raceId: 1, resultDigest: createResultDigest(result),
    persist: async (row) => { persisted.push(row) },
    log: (message) => storeLogs.push(message),
  })
  assert.equal(outcome.stored, false)
  assert.equal(persisted.length, 0)
  assert.equal(storeLogs.length, 1)
})

test('a recorder whose logger also throws still lets the race finish', async () => {
  const config = makeConfig('7e', { players: 4 })
  const recorder = createReplayTrackRecorder({
    source: () => { throw new Error('source down') },
    log: () => { throw new Error('logger down') },
  })
  const result = await runAuthoritativeRace(config, { realtime: false, afterTick: (state) => recorder.push(state) })
  assert.deepEqual(result, simulateRace(config))
  assert.equal(recorder.disabled, true)
})

test('self-check failure writes no row and logs one line', async () => {
  const config = makeConfig('5d', { players: 6 })
  const { result, recorder } = recordRace(config)
  const standings = [...result.standings]
  ;[standings[0], standings[1]] = [standings[1]!, standings[0]!]
  const tampered: RaceResult = { ...result, standings }
  const persisted: ReplayTrackRow[] = []
  const logs: string[] = []
  const outcome = await storeRecordedReplayTrack({
    recorder, result: tampered, raceId: 2, resultDigest: 'x'.repeat(64),
    persist: async (row) => { persisted.push(row) },
    log: (message) => logs.push(message),
  })
  assert.equal(outcome.stored, false)
  assert.match(outcome.stored ? '' : outcome.reason, /self-check failed: finish order differs/)
  assert.equal(persisted.length, 0)
  assert.equal(logs.length, 1)
})

test('a persister failure is caught and logged once; stats failures only null statsJson', async () => {
  const config = makeConfig('4b', { players: 4 })
  const first = recordRace(config)
  const logs: string[] = []
  const failed = await storeRecordedReplayTrack({
    recorder: first.recorder, result: first.result, raceId: 3, resultDigest: createResultDigest(first.result),
    persist: async () => { throw new Error('db locked') },
    log: (message) => logs.push(message),
  })
  assert.equal(failed.stored, false)
  assert.equal(logs.length, 1)

  const second = recordRace(config)
  const persisted: ReplayTrackRow[] = []
  const stored = await storeRecordedReplayTrack({
    recorder: second.recorder, result: second.result, raceId: 3, resultDigest: createResultDigest(second.result), engineCommit: 'abc123',
    persist: async (row) => { persisted.push(row) },
    stats: () => { throw new Error('stats exploded') },
  })
  assert.equal(stored.stored, true)
  assert.equal(persisted.length, 1)
  const row = persisted[0]!
  assert.equal(row.statsJson, null)
  assert.equal(row.format, 'dtrk/1')
  assert.equal(row.source, 'LIVE_TS')
  assert.equal(row.fidelity, 'RECORDED')
  assert.equal(row.engineImpl, 'ts')
  assert.equal(row.engineCommit, 'abc123')
  assert.equal(row.reproducedDigest, createResultDigest(second.result))
  assert.equal(row.tickCount, second.result.events.find((event) => event.type === 'RACE_FINISHED')!.tick)
  assert.equal(createHash('sha256').update(gunzipSync(row.bytes!)).digest('hex'), row.byteSha256)
})

test('kill switch: REPLAY_TRACK_RECORDING=0 disables recording; a null recorder stores nothing', async () => {
  assert.equal(isReplayTrackRecordingEnabled({ REPLAY_TRACK_RECORDING: '0' }), false)
  assert.equal(isReplayTrackRecordingEnabled({}), true)
  assert.equal(isReplayTrackRecordingEnabled({ REPLAY_TRACK_RECORDING: '1' }), true)
  const result = simulateRace(makeConfig('3a', { players: 2 }))
  let persisted = 0
  const outcome = await storeRecordedReplayTrack({ recorder: null, result, raceId: 4, resultDigest: '', persist: async () => { persisted += 1 } })
  assert.equal(outcome.stored, false)
  assert.equal(persisted, 0)
})

test('recording is observational: digests and event streams are identical with and without the recorder', async () => {
  for (const [seed, options] of [['11', {}], ['22', { pickups: { forceItem: 'BANANA' } }], ['33', { players: 6, ghost: true }], ['44', { players: 16 }]] as const) {
    const config = makeConfig(seed, options)
    const plain = await runAuthoritativeRace(config, { realtime: false })
    const recorder = createReplayTrackRecorder()
    const recorded = await runAuthoritativeRace(config, {
      realtime: false,
      beforeTick: (state) => { if (state.tick === 0) recorder.push(state) },
      afterTick: (state) => recorder.push(state),
    })
    assert.equal(recorder.disabled, false)
    assert.equal(createResultDigest(recorded), createResultDigest(plain))
    assert.deepEqual(recorded.events, plain.events)
    assert.equal(createResultDigest(recorded), createResultDigest(simulateRace(config)))
    assert.equal(recorder.sampleCount, recorded.events.at(-1)!.tick + 1)
  }
})

test('committed fixture decodes and still matches a fresh recording byte for byte', () => {
  const manifest = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'short-race.json'), 'utf8'))
  const payload = new Uint8Array(gunzipSync(readFileSync(path.join(FIXTURE_DIR, 'short-race.dtrk.gz'))))
  assert.equal(createHash('sha256').update(payload).digest('hex'), manifest.byteSha256)
  const decoded = decodeReplayTrack(payload)
  assert.equal(decoded.lastTick, manifest.tickCount)
  const finalRanks = decoded.finalRanks()
  const finishOrder = decoded.header.ducks.map((playerId, index) => ({ playerId, rank: finalRanks[index]! }))
    .sort((left, right) => left.rank - right.rank).map((duck) => duck.playerId)
  assert.deepEqual(finishOrder, manifest.finishOrder)

  const config = buildFixtureConfig()
  const { result, recorder } = recordRace(config)
  assert.equal(createResultDigest(result), manifest.resultDigest)
  const built = buildReplayTrackRow({ recording: recorder.finalize(), result, raceId: Number(config.raceId), resultDigest: createResultDigest(result), engineCommit: null })
  assert.equal(built.row.byteSha256, manifest.byteSha256, 'DTRK output drifted: regenerate with `pnpm replay:fixture` only for an intended format or balance change')
})

test('size report: full 8-duck race with production pickups', (t) => {
  const { result, recorder } = recordRace(makeConfig('ab'))
  const built = buildReplayTrackRow({ recording: recorder.finalize(), result, raceId: 1, resultDigest: createResultDigest(result), engineCommit: null })
  t.diagnostic(`8 ducks, ${built.row.tickCount} ticks: raw ${built.rawBytes} B, gzip ${built.gzipBytes} B`)
  assert.ok(built.gzipBytes < 400_000)
})
