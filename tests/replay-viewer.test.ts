import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { createResultDigest } from '../lib/racing/audit'
import { recordedWildInputsFromEvents } from '../lib/racing/persistence'
import { buildReplayTrackRow } from '../lib/racing/replay-track/store'
import { encodeReplayTrack, packReplayTrack } from '../lib/racing/replay-track/encode'
import { createReplayTrackRecorder } from '../lib/racing/replay-track/recorder'
import { IMMUTABLE_CACHE, replayTrackResponse } from '../lib/racing/replay-track/serve'
import { exportTrackGeometry, resolveHeadTrackGeometryId, serializeTrackGeometry, trackGeometryPath } from '../lib/racing/track-geometry'
import {
  UnsupportedRaceVersionError,
  createRiverTrack,
  createSimulation,
  resultFromSimulation,
  simulateRace,
  stepSimulation,
} from '../packages/race-core/src'
import { RACE_BALANCE_VERSION, RACE_ENGINE_VERSION, raceConfigSchema, type RaceConfig, type RaceEvent } from '../packages/race-protocol/src'
import { createPlayback, type PlaybackScene } from '../components/racing/drivers/playback'
import { createRecordingDriver } from '../components/racing/drivers/recording-driver'
import { createSimDriver } from '../components/racing/drivers/sim-driver'
import type { DriverFrame, TimelineDriver } from '../components/racing/drivers/types'
import { EventOrderError, eventFingerprint, isSceneEvent, manualInputsFromEvents, normalizeRaceEvent, splitStoredEvents } from '../src/race/event-vocab'
import { polylineTrack } from '../src/race/polyline-track'
import { canResimulate, fidelityBadge, planReplay } from '../src/race/replay-plan'
import { decodeReplayTrack } from '../src/race/replay-track/decode'
import { DTRK_Q } from '../src/race/replay-track/format'
import type { RaceReplayInfo, RaceWorld } from '../src/race/types'

const PICKUPS = {
  enabled: true,
  goldenBoxEnabled: true,
  goldenBoxProbability: 0.2,
  hazardsEnabled: true,
  positionAwareLoot: true,
  spawnMultiplier: 1.25,
  regularPickupCap: 3,
}

function makeConfig(seedByte: string, players = 6): RaceConfig {
  return raceConfigSchema.parse({
    raceId: `viewer-${seedByte}`,
    seed: seedByte.repeat(32),
    players: Array.from({ length: players }, (_, index) => ({ playerId: String(201 + index), name: `Duck ${index + 1}` })),
    loadouts: Array.from({ length: players }, (_, index) => ({
      playerId: String(201 + index),
      itemIds: [['NITRO', 'HOMING_ROCKET'], ['BANANA', 'BUBBLE_SHIELD'], ['FEATHER', 'QUACK_HORN']][index % 3],
      source: 'AUTO',
    })),
    pickupConfig: PICKUPS,
  })
}

/** A finished race with its recording, decoded track and in-memory event stream. */
function recordedRace(seedByte: string, players = 6) {
  const config = makeConfig(seedByte, players)
  const state = createSimulation(config)
  const recorder = createReplayTrackRecorder()
  recorder.push(state)
  while (!state.finished) {
    stepSimulation(state)
    recorder.push(state)
  }
  const result = resultFromSimulation(state)
  const recording = recorder.finalize()
  const built = buildReplayTrackRow({ recording, result, raceId: 77, resultDigest: createResultDigest(result), engineCommit: null })
  return { config, result, recording, built, decoded: built.decoded }
}

/** What GET /api/races/:id returns for the events: DB rows (persistRaceEvents) ordered by id, JSON round trip. */
function eventsThroughDatabase(raceId: number, events: RaceEvent[], meta: RaceEvent[]): RaceEvent[] {
  const rows = [...events, ...meta].map((event, index) => ({
    id: index + 1,
    type: event.type,
    tick: event.tick,
    timestampWithinRaceMs: event.timestampWithinRaceMs,
    sourcePlayerId: event.sourcePlayerId ?? null,
    targetPlayerId: event.targetPlayerId ?? null,
    metadataJson: JSON.stringify(event.metadata),
  }))
  const api = rows.sort((left, right) => left.id - right.id).map((row) => ({
    raceId: String(raceId),
    type: row.type,
    tick: row.tick,
    timestampWithinRaceMs: row.timestampWithinRaceMs,
    sourcePlayerId: row.sourcePlayerId,
    targetPlayerId: row.targetPlayerId,
    metadata: JSON.parse(row.metadataJson),
  }))
  const overTheWire = JSON.parse(JSON.stringify({ engine: { events: api } })) as { engine: { events: unknown[] } }
  return overTheWire.engine.events.map((value) => normalizeRaceEvent(value as Record<string, unknown>))
}

type SceneCall = { op: 'world'; snap: boolean; world: RaceWorld } | { op: 'event'; silent: boolean; event: RaceEvent } | { op: 'rebuild' }

function fakeScene(): PlaybackScene & { calls: SceneCall[] } {
  const calls: SceneCall[] = []
  return {
    calls,
    applyWorld(world, options) { calls.push({ op: 'world', snap: options?.snap === true, world }) },
    applyEvent(event, options) { calls.push({ op: 'event', silent: options?.silent === true, event }) },
    rebuild() { calls.push({ op: 'rebuild' }) },
  }
}

/** Plays a driver with a fixed frame schedule and returns the per-frame event fingerprints. */
function playSchedule(driver: TimelineDriver, frameMs: number[]) {
  const scene = fakeScene()
  const playback = createPlayback(driver, scene)
  const frames: string[][] = []
  for (const elapsed of frameMs) {
    const frame = playback.frame(elapsed, 1, false)!
    frames.push(frame.events.map(eventFingerprint))
    if (frame.finished) break
  }
  return frames
}

const FRAME_SCHEDULE = Array.from({ length: 8000 }, (_, index) => [16.7, 33.4, 8, 16.6, 50, 100][index % 6]!)

test('version guard: createSimulation/simulateRace throw on a 2.0.0 config and pass for the current pair', () => {
  const config = makeConfig('a1', 3)
  assert.equal(config.engineVersion, RACE_ENGINE_VERSION)
  assert.equal(config.balanceVersion, RACE_BALANCE_VERSION)
  assert.doesNotThrow(() => createSimulation(config))
  const rust = { ...config, engineVersion: '2.0.0', balanceVersion: 'S3.16' }
  assert.throws(() => createSimulation(rust), UnsupportedRaceVersionError)
  assert.throws(() => simulateRace(rust), /Unsupported race version: engine 2\.0\.0, balance S3\.16/)
  assert.throws(() => createSimulation({ ...config, balanceVersion: 'S3.9' }), UnsupportedRaceVersionError)
  // Opting in keeps the old behaviour, and the guard never changes a current-version result.
  assert.doesNotThrow(() => createSimulation(rust, { allowVersion: true }))
  assert.equal(createResultDigest(simulateRace(config)), createResultDigest(simulateRace(config, { allowVersion: true })))
})

test('track route: gzip bytes, ETag and immutable caching only for a matching ?h=', async () => {
  const { built } = recordedRace('b2', 3)
  const row = { byteSha256: built.row.byteSha256, bytes: built.row.bytes }
  const sha = built.row.byteSha256!

  const hit = replayTrackResponse(row, { h: sha, acceptEncoding: 'gzip, deflate, br', ifNoneMatch: null })
  assert.equal(hit.status, 200)
  assert.equal(hit.headers.get('Content-Encoding'), 'gzip')
  assert.equal(hit.headers.get('Cache-Control'), IMMUTABLE_CACHE)
  assert.equal(hit.headers.get('Cache-Control'), 'public, max-age=31536000, immutable')
  assert.equal(hit.headers.get('ETag'), `"${sha}"`)
  assert.equal(hit.headers.get('Content-Type'), 'application/octet-stream')
  assert.equal(hit.headers.get('Vary'), 'Accept-Encoding')
  assert.deepEqual(new Uint8Array(await hit.arrayBuffer()), new Uint8Array(built.row.bytes!))

  for (const h of [null, 'stale', sha.slice(0, 63)]) {
    const response = replayTrackResponse(row, { h, acceptEncoding: 'gzip', ifNoneMatch: null })
    assert.equal(response.headers.get('Cache-Control'), 'no-cache', `h=${h}`)
    assert.equal(response.headers.get('ETag'), `"${sha}"`)
  }

  for (const acceptEncoding of [null, 'identity', 'br', 'gzip;q=0']) {
    const plain = replayTrackResponse(row, { h: sha, acceptEncoding, ifNoneMatch: null })
    assert.equal(plain.headers.get('Content-Encoding'), null, `accept ${acceptEncoding}`)
    assert.deepEqual(new Uint8Array(await plain.arrayBuffer()), new Uint8Array(gunzipSync(built.row.bytes!)))
  }

  const notModified = replayTrackResponse(row, { h: sha, acceptEncoding: 'gzip', ifNoneMatch: `"${sha}"` })
  assert.equal(notModified.status, 304)
  assert.equal(notModified.headers.get('ETag'), `"${sha}"`)

  assert.equal(replayTrackResponse(null, { h: null, acceptEncoding: 'gzip', ifNoneMatch: null }).status, 404)
  assert.equal(replayTrackResponse({ byteSha256: null, bytes: null }, { h: null, acceptEncoding: 'gzip', ifNoneMatch: null }).status, 404)
})

test('driver seek is reset-and-replay: backward rebuilds and fast-applies [0, t] silently; forward never rebuilds', async () => {
  const { decoded, result } = recordedRace('c3')
  const sceneEvents = result.events.filter(isSceneEvent)
  const driver = createRecordingDriver(decoded, result.events)
  const scene = fakeScene()
  const playback = createPlayback(driver, scene)

  while (driver.tick() < 600) playback.frame(16.7, 4, false)
  const playedTo = driver.tick()
  const shownWithFx = scene.calls.filter((call) => call.op === 'event')
  assert.ok(shownWithFx.length > 0 && shownWithFx.every((call) => call.op === 'event' && !call.silent))
  assert.deepEqual(shownWithFx.map((call) => call.op === 'event' && eventFingerprint(call.event)), sceneEvents.filter((event) => event.tick <= playedTo).map(eventFingerprint))

  // Backward seek.
  scene.calls.length = 0
  const back = await playback.seek(240)
  assert.ok(back?.seeked)
  assert.equal(driver.tick(), 240)
  assert.equal(scene.calls[0]!.op, 'rebuild')
  assert.equal(scene.calls.filter((call) => call.op === 'rebuild').length, 1)
  const replayed = scene.calls.filter((call): call is Extract<SceneCall, { op: 'event' }> => call.op === 'event')
  assert.ok(replayed.every((call) => call.silent), 'fast-applied events are silent')
  assert.deepEqual(replayed.map((call) => eventFingerprint(call.event)), sceneEvents.filter((event) => event.tick <= 240).map(eventFingerprint))
  const worlds = scene.calls.filter((call): call is Extract<SceneCall, { op: 'world' }> => call.op === 'world')
  assert.equal(worlds.length, 1)
  assert.ok(worlds[0]!.snap)
  assert.deepEqual(worlds[0]!.world, decoded.worldAt(240))

  // Forward seek: no rebuild, only (240, 1200].
  scene.calls.length = 0
  await playback.seek(1200)
  assert.equal(scene.calls.filter((call) => call.op === 'rebuild').length, 0)
  const forward = scene.calls.filter((call): call is Extract<SceneCall, { op: 'event' }> => call.op === 'event')
  assert.ok(forward.every((call) => call.silent))
  assert.deepEqual(forward.map((call) => eventFingerprint(call.event)), sceneEvents.filter((event) => event.tick > 240 && event.tick <= 1200).map(eventFingerprint))

  // Normal playback resumes with FX; seeks clamp to the track's end and can return to 0.
  scene.calls.length = 0
  const next = playback.frame(16.7, 1, false)!
  assert.equal(next.seeked, false)
  assert.ok(scene.calls.filter((call) => call.op === 'event').every((call) => call.op === 'event' && !call.silent))
  await playback.seek(10 ** 9)
  assert.equal(driver.tick(), decoded.lastTick)
  assert.ok(driver.finished())
  await playback.seek(0)
  assert.equal(driver.tick(), 0)
  assert.equal(driver.finished(), false)

  // The sim driver seeks the same way (reset = a fresh simulation) and lands on the same events.
  const simDriver = createSimDriver(makeConfig('c3'), { endTick: decoded.lastTick })
  const simScene = fakeScene()
  const simPlayback = createPlayback(simDriver, simScene)
  await simPlayback.seek(900)
  simScene.calls.length = 0
  await simPlayback.seek(240)
  assert.equal(simScene.calls[0]!.op, 'rebuild')
  const simReplayed = simScene.calls.filter((call): call is Extract<SceneCall, { op: 'event' }> => call.op === 'event')
  assert.deepEqual(simReplayed.map((call) => eventFingerprint(call.event)), replayed.map((call) => eventFingerprint(call.event)))
})

test('seeks issued while one is rebuilding coalesce to the latest target', async () => {
  const { decoded, result } = recordedRace('d4', 3)
  const driver = createRecordingDriver(decoded, result.events)
  let release: () => void = () => {}
  const scene = fakeScene()
  scene.rebuild = () => new Promise<void>((resolve) => { scene.calls.push({ op: 'rebuild' }); release = resolve })
  const playback = createPlayback(driver, scene)
  await playback.seek(500)
  const first = playback.seek(100)
  assert.ok(playback.busy())
  assert.equal(playback.frame(16, 1, false), null, 'frames are skipped while seeking')
  const second = playback.seek(300)
  release()
  await Promise.all([first, second])
  assert.equal(driver.tick(), 300)
  assert.equal(playback.busy(), false)
  assert.equal(scene.calls.filter((call) => call.op === 'rebuild').length, 1)
})

test('scene-visible events from DB rows (JSON round trip, id order) equal the in-memory sequence, frame by frame', () => {
  const { decoded, result, config } = recordedRace('e5', 8)
  const golden = result.events.find((event) => event.type === 'GOLDEN_BOX_COLLECTED') ?? result.events[Math.floor(result.events.length / 2)]!
  // Meta events are inserted after the race with their own (earlier) ticks, exactly like season3-race.ts.
  const meta: RaceEvent[] = [
    { raceId: config.raceId, type: 'CHAOS_RESOLVED', tick: Math.ceil(result.durationMs / (1000 / config.tickRate)), timestampWithinRaceMs: result.durationMs, metadata: { chaosType: 'NORMAL' } },
    { raceId: config.raceId, type: 'QP_TRACK_REWARD_GRANTED', tick: golden.tick, timestampWithinRaceMs: golden.timestampWithinRaceMs, sourcePlayerId: golden.sourcePlayerId, metadata: { amount: 1 } },
  ] as RaceEvent[]
  const stored = eventsThroughDatabase(77, result.events, meta)
  const split = splitStoredEvents(stored)
  assert.equal(split.meta.length, 2)
  assert.equal(split.engine.length, result.events.length)
  assert.deepEqual(split.engine.map(eventFingerprint), result.events.map(eventFingerprint))

  const fromRows = playSchedule(createRecordingDriver(decoded, stored), FRAME_SCHEDULE)
  const inMemory = playSchedule(createSimDriver(config), FRAME_SCHEDULE)
  assert.equal(fromRows.length, inMemory.length)
  assert.deepEqual(fromRows, inMemory)
  assert.ok(fromRows.flat().length > 50, 'the race shows a meaningful number of events')
  assert.ok(!fromRows.flat().some((fingerprint) => fingerprint.includes('CHAOS_RESOLVED') || fingerprint.includes('QP_TRACK_REWARD_GRANTED')))

  // Ticks that go backwards inside the engine stream are refused.
  const broken = [...stored]
  ;[broken[10], broken[200]] = [broken[200]!, broken[10]!]
  assert.throws(() => splitStoredEvents(broken), EventOrderError)
  // The browser's manual-input extraction matches the server's.
  assert.deepEqual(manualInputsFromEvents(stored), recordedWildInputsFromEvents(stored))
})

test('track playback positions match the re-simulation within quantisation at every 10th tick', () => {
  const { decoded, config } = recordedRace('f6', 8)
  const recording = createRecordingDriver(decoded, [])
  const sim = createSimDriver(config)
  let maxProgress = 0
  let maxLateral = 0
  let samples = 0
  for (let tick = 0; tick <= decoded.lastTick; tick += 10) {
    const a = recording.advanceTo(tick)
    const b = sim.advanceTo(tick)
    assert.equal(a.tick, b.tick)
    const byId = new Map(b.world.ducks.map((duck) => [duck.playerId, duck]))
    for (const duck of a.world.ducks) {
      const truth = byId.get(duck.playerId)!
      assert.equal(duck.rank, truth.rank)
      maxProgress = Math.max(maxProgress, Math.abs(duck.progress - truth.progress))
      maxLateral = Math.max(maxLateral, Math.abs(duck.lateralOffset - truth.lateralOffset))
      samples += 1
    }
    assert.deepEqual(a.world.pickups, b.world.pickups)
    assert.deepEqual(a.world.hazards, b.world.hazards)
  }
  assert.ok(samples > 1000)
  assert.ok(maxProgress <= 2 ** -24, `progress error ${maxProgress}`)
  assert.ok(maxLateral <= 1 / DTRK_Q.lateral, `lateral error ${maxLateral}`)
})

test('a synthetic engine 2.0.0 race renders from its track and is never simulated', () => {
  const { recording, result } = recordedRace('a7', 4)
  const payload = encodeReplayTrack(recording, {
    raceId: '9100',
    tickRate: result.tickRate,
    trackVersion: result.trackVersion,
    trackGeometry: resolveHeadTrackGeometryId(result.trackVersion),
    engine: { impl: 'rust', engineVersion: '2.0.0', balanceVersion: 'S3.16', commit: null, build: 'b'.repeat(64) },
    source: 'LIVE_RUST',
    fidelity: 'RECORDED',
    resultDigest: null,
  })
  const packed = packReplayTrack(payload)
  const decoded = decodeReplayTrack(new Uint8Array(gunzipSync(packed.gzip)))
  assert.equal(decoded.header.engine.engineVersion, '2.0.0')
  // A Rust-era config shape the TS protocol does not know.
  const rustConfig = { engineVersion: '2.0.0', balanceVersion: 'S3.16', rngVersion: 'xs32-v1', digestVersion: 'jcs-sha256-v2' }
  const replay: RaceReplayInfo = {
    mode: 'track', fidelity: 'RECORDED', trackUrl: `/api/races/9100/track?h=${packed.byteSha256}`, geometryUrl: null,
    engineVersion: '2.0.0', balanceVersion: 'S3.16', byteSha256: packed.byteSha256, verify: 'none',
  }
  assert.equal(canResimulate(rustConfig), false)
  assert.equal(planReplay({ replay, config: rustConfig, eventsUsable: true }), 'track')
  assert.equal(planReplay({ replay: { ...replay, mode: 'none', trackUrl: null }, config: rustConfig, eventsUsable: true }), 'unavailable')
  assert.equal(planReplay({ replay, config: rustConfig, eventsUsable: true, trackFailed: true }), 'unavailable')
  assert.equal(fidelityBadge(replay), '✓ Ghi hình khớp kết quả gốc · engine 2.0.0/S3.16')

  const driver = createRecordingDriver(decoded, result.events)
  const scene = fakeScene()
  const playback = createPlayback(driver, scene)
  let frame: DriverFrame | null = null
  while (!driver.finished()) frame = playback.frame(100, 4, false)
  assert.equal(frame!.tick, decoded.lastTick)
  assert.ok(frame!.finished)
})

test('replay plan: track first, re-simulate only the current pair without a track, else unavailable', () => {
  const current = { engineVersion: RACE_ENGINE_VERSION, balanceVersion: RACE_BALANCE_VERSION }
  const none: RaceReplayInfo = { mode: 'none', fidelity: null, trackUrl: null, geometryUrl: null, engineVersion: null, balanceVersion: null, byteSha256: null, verify: 'none' }
  const track: RaceReplayInfo = { ...none, mode: 'track', fidelity: 'VERIFIED_EVENTS', trackUrl: '/api/races/1/track?h=x', engineVersion: '1.1.0', balanceVersion: 'S3.2' }
  assert.equal(planReplay({ replay: none, config: current, eventsUsable: true }), 'sim')
  assert.equal(planReplay({ replay: track, config: current, eventsUsable: true }), 'track')
  assert.equal(planReplay({ replay: none, config: { engineVersion: '1.1.0', balanceVersion: 'S3.2' }, eventsUsable: true }), 'unavailable')
  assert.equal(planReplay({ replay: track, config: { engineVersion: '1.1.0', balanceVersion: 'S3.2' }, eventsUsable: true }), 'track')
  assert.equal(planReplay({ replay: none, config: null, eventsUsable: true }), 'unavailable')
  assert.equal(planReplay({ replay: none, config: current, eventsUsable: false }), 'unavailable')
  assert.equal(fidelityBadge(track), '✓ Diễn biến khớp toàn bộ · digest gốc chưa tái lập được')
  assert.equal(fidelityBadge({ ...track, fidelity: 'UNAVAILABLE' }), null)
})

test('HEAD track geometry is committed, content-addressed and draws within 0.05 px of createRiverTrack', () => {
  const geometry = exportTrackGeometry('river-01-v2')
  const { json, id, sha256 } = serializeTrackGeometry(geometry)
  assert.match(id, /^river-01-v2@[0-9a-f]{8}$/)
  assert.equal(id.slice(-8), sha256.slice(0, 8))
  assert.equal(readFileSync(trackGeometryPath(id), 'utf8'), json, 'run `pnpm race:tracks` and commit public/race-tracks')
  assert.equal(resolveHeadTrackGeometryId('river-01-v2'), id)
  const head = createRiverTrack('river-01-v2')
  const drawn = polylineTrack(JSON.parse(json))
  assert.equal(drawn.length, head.length)
  assert.deepEqual(drawn.boostGates, JSON.parse(JSON.stringify(head.boostGates)))
  let maxError = 0
  for (let index = 0; index <= 2000; index += 1) {
    const progress = index / 2000
    for (const lateral of [-1.2, -1, -0.55, 0, 0.3, 1]) {
      const want = head.sample(progress, lateral)
      const got = drawn.sample(progress, lateral)
      maxError = Math.max(maxError, Math.hypot(got.x - want.x, got.y - want.y), Math.abs(got.width - want.width))
    }
  }
  assert.ok(maxError < 0.05, `max error ${maxError}px`)
})
