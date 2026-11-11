import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createSimulation, simulateRace, snapshotRaceWorld, stepSimulation, type RaceSimulationState } from '../packages/race-core/src'
import { raceConfigSchema, type RaceEvent } from '../packages/race-protocol/src'
import { connectLiveV2, type LiveEngine, type LiveScene } from '../components/racing/drivers/live-driver'
import type { EventSourceLike } from '../components/racing/drivers/snapshot-driver'
import {
  CATCH_UP_CHUNK_TICKS,
  DEFAULT_RENDER_DELAY_TICKS,
  HASH_INTERVAL,
  INPUT_LEAD,
  LiveSync,
  ServerClock,
  liveProtocolFor,
  type LiveHelloFrame,
  type LiveInputFrame,
  type LiveSyncCommand,
} from '../src/race/live-sync'

// Phase 5 LiveSync (plan D16): the client never steps past min(estimate − renderDelay, lastClock + 6),
// compares state hashes every 60 ticks, ignores duplicate inputs, and catches up in silent chunks.

const TICK_MS = 1000 / 60
const BUILD = 'build-a'

/** A seeded xorshift32 for jitter, so failures reproduce. */
function rng(seed: number) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13; state >>>= 0
    state ^= state >>> 17
    state ^= state << 5; state >>>= 0
    return state / 4_294_967_296
  }
}

/** A deterministic stand-in engine: its state is the tick plus the inputs applied so far. */
class CounterSim {
  tick = 0
  applied: LiveInputFrame[] = []
  private queued: LiveInputFrame[] = []
  constructor(readonly finishTick: number) {}
  get finished() { return this.tick >= this.finishTick }
  queue(input: LiveInputFrame) {
    if (input.atTick <= this.tick) throw new Error(`late input atTick=${input.atTick} tick=${this.tick}`)
    this.queued.push(input)
  }
  stepTo(target: number) {
    while (this.tick < target && !this.finished) {
      this.tick += 1
      for (const input of this.queued.filter((entry) => entry.atTick === this.tick)) this.applied.push(input)
      this.queued = this.queued.filter((entry) => entry.atTick !== this.tick)
    }
  }
  hash() {
    return `h${this.tick}:${this.applied.map((input) => `${input.seq}@${input.atTick}`).join(',')}`
  }
}

type Frame =
  | { type: 'hello'; data: LiveHelloFrame }
  | { type: 'start'; data: { configJcs: string; startTick: number } }
  | { type: 'clock'; data: { tick: number; hash?: string } }
  | { type: 'input'; data: LiveInputFrame }
  | { type: 'finished'; data: { finalTick: number; digest: string; standings: unknown[] } }

function hello(overrides: Partial<LiveHelloFrame> = {}): LiveHelloFrame {
  return {
    protocolVersion: '2.0.0', engineVersion: '2.0.0', balanceVersion: 'S3.16', engineBuildId: BUILD,
    raceId: 1, state: 'RACING', serverTick: 0, configJcs: '{"cfg":1}', inputs: [], seqHighWater: 0,
    ...overrides,
  }
}

function input(seq: number, atTick: number): LiveInputFrame {
  return { seq, atTick, playerId: '1', wildItemInstanceId: `w${seq}`, action: 'USE', clientActionId: `action-${seq}` }
}

/**
 * The server: a CounterSim stepped in real time. Inputs are scheduled INPUT_LEAD + 1 ticks ahead and
 * emitted before the clock that confirms them; a clock frame every 3 ticks, `hash` every 60.
 */
function serverTimeline(finishTick: number, inputsAt: Map<number, number>) {
  const sim = new CounterSim(finishTick)
  const frames: Array<{ sentAt: number; frame: Frame }> = []
  let seq = 0
  for (let tick = 1; !sim.finished; tick += 1) {
    const sentAt = tick * TICK_MS
    const count = inputsAt.get(tick) ?? 0
    for (let index = 0; index < count; index += 1) {
      seq += 1
      const frame = input(seq, tick + INPUT_LEAD + 1)
      sim.queue(frame)
      frames.push({ sentAt, frame: { type: 'input', data: frame } })
    }
    sim.stepTo(tick)
    if (tick % 3 === 0 || sim.finished) frames.push({ sentAt, frame: { type: 'clock', data: { tick, ...(tick % HASH_INTERVAL === 0 ? { hash: sim.hash() } : {}) } } })
  }
  frames.push({ sentAt: sim.tick * TICK_MS + 5, frame: { type: 'finished', data: { finalTick: sim.tick, digest: sim.hash(), standings: [] } } })
  return { frames, sim }
}

/** Delivers frames in order with jitter; returns arrival times. */
function deliver(frames: Array<{ sentAt: number; frame: Frame }>, jitterMs: number, seed: number, stalls: Array<{ from: number; to: number }> = []) {
  const random = rng(seed)
  let last = 0
  return frames.map(({ sentAt, frame }) => {
    let at = Math.max(last, sentAt + 20 + random() * jitterMs)
    for (const stall of stalls) if (at >= stall.from && at < stall.to) at = stall.to
    last = at
    return { at, frame }
  })
}

function feed(sync: LiveSync, frame: Frame, at: number): LiveSyncCommand[] {
  if (frame.type === 'hello') return sync.hello(frame.data, at)
  if (frame.type === 'start') return sync.start(frame.data, at)
  if (frame.type === 'clock') return sync.clockFrame(frame.data, at)
  if (frame.type === 'input') return sync.input(frame.data)
  return sync.finished(frame.data)
}

interface RunResult {
  commands: LiveSyncCommand[]
  client: CounterSim
  steps: Array<{ at: number; tick: number; silent: boolean }>
  maxLead: number
}

/**
 * Drives a LiveSync against delivered frames with animation frames every 16.7 ms (none while
 * `hidden`), asserting the bound on every step.
 */
function run(options: {
  arrivals: Array<{ at: number; frame: Frame }>
  finishTick: number
  helloAt?: number
  helloFrame?: LiveHelloFrame
  hidden?: Array<{ from: number; to: number }>
  extra?: Array<{ at: number; frame: Frame }>
}): RunResult {
  const sync = new LiveSync({ localEngineBuildId: BUILD })
  const client = new CounterSim(options.finishTick)
  const commands: LiveSyncCommand[] = []
  const steps: RunResult['steps'] = []
  let maxLead = Number.NEGATIVE_INFINITY
  const helloFrame = options.helloFrame ?? hello()
  const arrivals = [{ at: options.helloAt ?? 0, frame: { type: 'hello', data: helloFrame } as Frame }, ...options.arrivals, ...(options.extra ?? [])]
    .filter((entry) => entry.at >= (options.helloAt ?? 0))
    .sort((left, right) => left.at - right.at)
  let cursor = 0
  const end = arrivals[arrivals.length - 1]!.at + 2000
  for (let now = options.helloAt ?? 0; now <= end && sync.mode !== 'ended'; now += TICK_MS) {
    while (cursor < arrivals.length && arrivals[cursor]!.at <= now) {
      const { frame, at } = arrivals[cursor]!
      const result = feed(sync, frame, at)
      commands.push(...result)
      if (result.some((command) => command.type === 'create-handle')) sync.handleCreated()
      cursor += 1
    }
    if (options.hidden?.some((range) => now >= range.from && now < range.to)) continue
    for (let guard = 0; guard < 1000; guard += 1) {
      const step = sync.nextStep(now)
      if (!step) break
      const estimate = sync.clock.estimate(now)!
      assert.ok(step.tick <= sync.lastClockTick + INPUT_LEAD, `tick ${step.tick} past lastClock ${sync.lastClockTick} + ${INPUT_LEAD}`)
      assert.ok(step.tick <= Math.floor(estimate - DEFAULT_RENDER_DELAY_TICKS), `tick ${step.tick} past the estimate ${estimate}`)
      maxLead = Math.max(maxLead, step.tick - sync.lastClockTick)
      for (const queued of sync.takeInputs()) client.queue(queued)
      client.stepTo(step.tick)
      steps.push({ at: now, tick: client.tick, silent: step.silent })
      commands.push(...sync.stepped(client.tick, step.hash ? client.hash() : null, client.finished))
    }
  }
  return { commands, client, steps, maxLead }
}

test('ServerClock: jittered samples keep the estimate near the fastest path; a stall re-anchors', () => {
  const clock = new ServerClock(60)
  assert.equal(clock.estimate(0), null)
  const random = rng(7)
  for (let tick = 0; tick <= 600; tick += 3) clock.observe(tick, tick * TICK_MS + 30 + random() * 60)
  const estimate = clock.estimate(600 * TICK_MS + 30)!
  assert.ok(Math.abs(estimate - 600) < 4, `estimate ${estimate}`)
  // The server stalls for 5 s: the next sample is far behind and re-anchors.
  clock.observe(603, 605 * TICK_MS + 5000)
  assert.ok(Math.abs(clock.estimate(605 * TICK_MS + 5000)! - 603) < 1)
})

test('LiveSync: under jitter the client never passes the bound, inputs land before their tick, hashes agree', () => {
  const finishTick = 1500
  const inputsAt = new Map([[100, 1], [400, 2], [901, 1]])
  const { frames, sim } = serverTimeline(finishTick, inputsAt)
  const result = run({ arrivals: deliver(frames, 80, 11), finishTick })
  assert.deepEqual(result.commands.filter((command) => command.type !== 'create-handle'), [{ type: 'ended' }])
  assert.equal(result.client.tick, finishTick)
  assert.equal(result.client.hash(), sim.hash(), 'final state equals the server run')
  assert.equal(result.client.applied.length, 4)
  assert.ok(result.maxLead <= INPUT_LEAD)
  // Live play is smooth: after the start, no frame jumps more than a few ticks.
  const live = result.steps.filter((step) => !step.silent)
  let worst = 0
  for (let index = 1; index < live.length; index += 1) worst = Math.max(worst, live[index]!.tick - live[index - 1]!.tick)
  assert.ok(worst <= 12, `largest per-frame jump ${worst}`)
})

test('LiveSync: a duplicate hello and replayed frames after a reconnect change nothing', () => {
  const finishTick = 900
  const { frames, sim } = serverTimeline(finishTick, new Map([[120, 1], [300, 1]]))
  const arrivals = deliver(frames, 40, 3)
  // Reconnect at 6 s: hello again (all inputs, seqHighWater 2), then the replay log from frame 50 on.
  const reconnectAt = 6000
  const replay = arrivals.filter((entry) => entry.at < reconnectAt).slice(50).map((entry, index) => ({ at: reconnectAt + 1 + index * 0.01, frame: entry.frame }))
  const extra = [{ at: reconnectAt, frame: { type: 'hello', data: hello({ serverTick: 357, inputs: [input(1, 127), input(2, 307)], seqHighWater: 2 }) } as Frame }, ...replay]
  const result = run({ arrivals, finishTick, extra })
  assert.deepEqual(result.commands.map((command) => command.type), ['create-handle', 'ended'])
  assert.equal(result.client.applied.length, 2, 'duplicate inputs ignored')
  assert.equal(result.client.hash(), sim.hash())
})

test('LiveSync: a 30 s background gap catches up in silent chunks, then plays live again', () => {
  const finishTick = 60 * 60
  const { frames, sim } = serverTimeline(finishTick, new Map())
  const hidden = [{ from: 10_000, to: 40_000 }]
  const result = run({ arrivals: deliver(frames, 30, 5), finishTick, hidden })
  assert.equal(result.client.hash(), sim.hash())
  const resumed = result.steps.filter((step) => step.at >= 40_000)
  const firstLive = resumed.findIndex((step) => !step.silent)
  assert.ok(firstLive > 0, 'catch-up steps come first')
  const catchUp = resumed.slice(0, firstLive)
  assert.ok(catchUp.every((step) => step.silent))
  // Chunked: each engine call covers at most one hash interval (and never more than CATCH_UP_CHUNK_TICKS).
  let previous = result.steps[result.steps.indexOf(resumed[0]!) - 1]!.tick
  for (const step of catchUp) {
    assert.ok(step.tick - previous <= Math.min(HASH_INTERVAL, CATCH_UP_CHUNK_TICKS))
    previous = step.tick
  }
  assert.ok(catchUp.length >= 25, `${catchUp.length} catch-up steps for a 30 s gap`)
  assert.ok(resumed[firstLive]!.tick >= Math.floor((40_000 / TICK_MS) - 40), 'live again near the server tick')
})

test('LiveSync: a late joiner catches up silently to the join tick', () => {
  const finishTick = 1200
  const { frames } = serverTimeline(finishTick, new Map())
  const helloAt = 700 * TICK_MS
  const result = run({ arrivals: deliver(frames, 20, 9), finishTick, helloAt, helloFrame: hello({ serverTick: 700 }) })
  const atJoin = result.steps.filter((step) => step.tick <= 700)
  assert.ok(atJoin.length > 0 && atJoin.every((step) => step.silent), 'no FX before the join tick')
  assert.ok(result.steps.some((step) => !step.silent && step.tick > 700))
  assert.equal(result.client.tick, finishTick)
})

test('LiveSync: a hash mismatch reports a desync and falls back to snapshots', () => {
  const sync = new LiveSync({ localEngineBuildId: BUILD })
  sync.hello(hello({ serverTick: 0 }), 0)
  sync.handleCreated()
  sync.clockFrame({ tick: 60, hash: 'AAAA' }, 1000)
  const step = sync.nextStep(1200)!
  assert.equal(step.tick, 60)
  assert.equal(step.hash, true)
  const commands = sync.stepped(60, 'bbbb', false)
  assert.deepEqual(commands, [
    { type: 'desync', report: { tick: 60, clientHash: 'bbbb', serverHash: 'aaaa', engineBuildId: BUILD } },
    { type: 'snapshot', reason: 'desync' },
  ])
  assert.equal(sync.mode, 'snapshot')
  assert.equal(sync.nextStep(5000), null)
})

test('LiveSync: engine mismatch, missing engine, countdown and a hello after the end', () => {
  assert.deepEqual(new LiveSync({ localEngineBuildId: BUILD }).hello(hello({ engineBuildId: 'other' }), 0), [{ type: 'snapshot', reason: 'engine-mismatch' }])
  assert.deepEqual(new LiveSync({ localEngineBuildId: null }).hello(hello(), 0), [{ type: 'snapshot', reason: 'no-engine' }])
  assert.deepEqual(new LiveSync({ localEngineBuildId: BUILD }).hello(hello({ state: 'RESOLVED', serverTick: 3000 }), 0), [{ type: 'ended' }])

  const sync = new LiveSync({ localEngineBuildId: BUILD })
  assert.deepEqual(sync.hello(hello({ state: 'COUNTDOWN', countdownEndsInMs: 2500, configJcs: null }), 1000), [{ type: 'countdown', endsAtMs: 3500 }])
  assert.deepEqual(sync.start({ configJcs: '{"cfg":1}', startTick: 0 }, 3500), [{ type: 'create-handle', configJcs: '{"cfg":1}' }])
  sync.handleCreated()
  assert.equal(sync.nextStep(3400), null, 'nothing before the countdown ends')
  assert.equal(sync.nextStep(3500 + 5 * TICK_MS), null, 'render delay')
  assert.equal(sync.nextStep(3500 + 20 * TICK_MS)!.tick, INPUT_LEAD, 'bounded by lastClock + INPUT_LEAD before the first clock')
  // A changed config on a later hello can't be predicted.
  assert.deepEqual(sync.hello(hello({ configJcs: '{"cfg":2}', serverTick: 3 }), 3600), [{ type: 'snapshot', reason: 'config-changed' }])
})

test('LiveSync: an input for a tick already simulated falls back to snapshots', () => {
  const sync = new LiveSync({ localEngineBuildId: BUILD })
  sync.hello(hello({ serverTick: 30 }), 0)
  sync.handleCreated()
  sync.stepped(30, null, false)
  assert.deepEqual(sync.input(input(1, 30)), [{ type: 'snapshot', reason: 'late-input' }])
})

test('liveProtocolFor: engine 2.x uses SSE v2, older races keep the v1 stream', () => {
  assert.equal(liveProtocolFor({ engineVersion: '2.0.0' }, false), 'v2')
  assert.equal(liveProtocolFor({ engineVersion: null, config: { engineVersion: '2.1.0' } }, false), 'v2')
  assert.equal(liveProtocolFor({ engineVersion: '1.2.0' }, true), 'v1-sim')
  assert.equal(liveProtocolFor({ engineVersion: '1.1.0' }, false), 'v1-snapshot')
  assert.equal(liveProtocolFor(null, false), 'v1-snapshot')
})

// --- The real (TS) engine behind LiveSync: the predicted race equals a straight run. ---

const config = raceConfigSchema.parse({
  raceId: 'live-sync',
  seed: '5e'.repeat(32),
  players: Array.from({ length: 6 }, (_, index) => ({ playerId: String(401 + index), name: `Duck ${index + 1}` })),
  loadouts: Array.from({ length: 6 }, (_, index) => ({
    playerId: String(401 + index),
    itemIds: [['NITRO', 'HOMING_ROCKET'], ['BANANA', 'BUBBLE_SHIELD'], ['FEATHER', 'QUACK_HORN']][index % 3],
    source: 'AUTO',
  })),
})
const configJcs = JSON.stringify(config)
const stateHash = (state: RaceSimulationState) => createHash('sha256').update(JSON.stringify(snapshotRaceWorld(state))).digest('hex')

function tsEngine(): LiveEngine {
  return {
    engineBuildId: BUILD,
    createHandle(jcs) {
      const state = createSimulation(JSON.parse(jcs))
      let drained = state.events.length
      return {
        advance(tick, options) {
          while (state.tick < tick && !state.finished) stepSimulation(state)
          const events = state.events.slice(drained) as RaceEvent[]
          drained = state.events.length
          return { tick: state.tick, finished: state.finished, world: snapshotRaceWorld(state), events, hash: options.hash ? stateHash(state) : null }
        },
        queueInput() { throw new Error('no inputs in this test') },
        dispose() {},
      }
    },
  }
}

class FakeStream implements EventSourceLike {
  listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>()
  closed = false
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) } as MessageEvent<string>)
  }
  close() { this.closed = true }
}

function fakeScene() {
  const scene = {
    worlds: 0, events: [] as RaceEvent[], silent: 0, countdowns: [] as number[], queued: 0, catchUp: [] as Array<number | null>,
  }
  const api: LiveScene = {
    applyWorld: () => { scene.worlds += 1 },
    applyEvent: (event, options) => { scene.events.push(event); if (options?.silent) scene.silent += 1 },
    queueWorld: () => { scene.queued += 1 },
    showLiveCountdown: (ms) => { scene.countdowns.push(ms) },
    setCatchUp: (progress) => { scene.catchUp.push(progress) },
  }
  return { scene, api }
}

async function flush() {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('connectLiveV2: a late joiner predicts the whole race with the engine and ends; events equal a straight run', async () => {
  const expected = simulateRace(config)
  const server = createSimulation(config)
  let now = 0
  const streams: FakeStream[] = []
  const frameCallbacks: Array<() => void> = []
  const { scene, api } = fakeScene()
  let ended = 0
  const desyncs: unknown[] = []
  const close = connectLiveV2({
    raceId: 1, scene: api, engine: Promise.resolve(tsEngine()), now: () => now,
    openStream: (url) => { const stream = new FakeStream(url); streams.push(stream); return stream },
    requestFrame: (callback) => { frameCallbacks.push(callback); return frameCallbacks.length },
    cancelFrame: () => {},
    postDesync: (_raceId, report) => { desyncs.push(report) },
    onEnded: () => { ended += 1 },
    frameBudgetMs: Number.POSITIVE_INFINITY,
  })
  const live = streams[0]!
  assert.equal(live.url, '/api/races/1/live')
  // Join at server tick 600.
  while (server.tick < 600) stepSimulation(server)
  now = 600 * TICK_MS
  live.emit('hello', hello({ serverTick: 600, configJcs, engineBuildId: BUILD }))
  await flush()
  const runFrame = async () => { const callbacks = frameCallbacks.splice(0); for (const callback of callbacks) callback(); await flush() }
  while (!server.finished) {
    stepSimulation(server)
    now = server.tick * TICK_MS + 25
    if (server.tick % 3 === 0 || server.finished) live.emit('clock', { tick: server.tick, ...(server.tick % HASH_INTERVAL === 0 ? { hash: stateHash(server) } : {}) })
    if (server.tick % 2 === 0) await runFrame()
  }
  live.emit('finished', { finalTick: server.tick, digest: 'x', standings: [] })
  for (let index = 0; index < 120 && ended === 0; index += 1) { now += TICK_MS; await runFrame() }
  assert.equal(ended, 1)
  assert.deepEqual(desyncs, [])
  assert.ok(live.closed)
  const engineEvents = expected.events.filter((event) => event.tick > 0)
  assert.deepEqual(scene.events.map((event) => `${event.tick}:${event.type}`), engineEvents.map((event) => `${event.tick}:${event.type}`))
  assert.ok(scene.silent > 0 && scene.events.filter((event) => event.tick <= 600).length <= scene.silent, 'FX suppressed before the join tick')
  assert.equal(scene.catchUp.at(-1), null)
  close()
})

test('connectLiveV2: an engine build mismatch reconnects with snapshots; a desync is posted once', async () => {
  const streams: FakeStream[] = []
  const { scene, api } = fakeScene()
  let ended = 0
  connectLiveV2({
    raceId: 7, scene: api, engine: Promise.resolve(tsEngine()), now: () => 0,
    openStream: (url) => { const stream = new FakeStream(url); streams.push(stream); return stream },
    requestFrame: () => 1, cancelFrame: () => {}, postDesync: () => {}, onEnded: () => { ended += 1 },
  })
  await flush()
  streams[0]!.emit('hello', hello({ engineBuildId: 'server-build' }))
  assert.ok(streams[0]!.closed)
  assert.equal(streams[1]!.url, '/api/races/7/live?snapshots=1')
  streams[1]!.emit('snapshot', { type: 'STATE_SNAPSHOT', tick: 30, ducks: [], pickups: [] })
  assert.equal(scene.queued, 1)
  streams[1]!.emit('resolved', {})
  assert.equal(ended, 1)

  const desyncs: unknown[] = []
  const second: FakeStream[] = []
  let now = 0
  const frames: Array<() => void> = []
  connectLiveV2({
    raceId: 8, scene: fakeScene().api, engine: Promise.resolve(tsEngine()), now: () => now,
    openStream: (url) => { const stream = new FakeStream(url); second.push(stream); return stream },
    requestFrame: (callback) => { frames.push(callback); return frames.length }, cancelFrame: () => {},
    postDesync: (_raceId, report) => { desyncs.push(report) }, frameBudgetMs: Number.POSITIVE_INFINITY,
  })
  await flush()
  second[0]!.emit('hello', hello({ serverTick: 0, configJcs, engineBuildId: BUILD }))
  await flush()
  now = 80 * TICK_MS
  second[0]!.emit('clock', { tick: 60, hash: 'not-the-hash' })
  second[0]!.emit('clock', { tick: 63 })
  for (const callback of frames.splice(0)) callback()
  await flush()
  assert.equal(desyncs.length, 1)
  assert.equal((desyncs[0] as { tick: number }).tick, 60)
  assert.equal(second[1]!.url, '/api/races/8/live?snapshots=1')
})
