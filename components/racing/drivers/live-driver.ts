import type { RaceConfig, RaceEvent, RecordedWildItemInput } from '@/src/engine/protocol'
import {
  LiveSync,
  type DesyncReport,
  type LiveClockFrame,
  type LiveFinishedFrame,
  type LiveHelloFrame,
  type LiveInputFrame,
  type LiveStartFrame,
  type LiveSyncCommand,
  type SnapshotReason,
} from '@/src/race/live-sync'
import type { RaceWorld } from '@/src/race/types'
import { createLiveSimDriver, type LiveSimDriver } from './sim-driver'
import { connectSnapshotDriverV2, type EventSourceLike } from './snapshot-driver'

/**
 * A running race, re-simulated in the browser (WASM engine in a Web Worker): catch up silently to the
 * server's tick, then run in real time; manual wild-item inputs arrive over SSE and are queued at their
 * authoritative tick. Not seekable.
 */
export function createLiveDriver(config: RaceConfig, options: { syncTick?: number; manualInputs?: readonly RecordedWildItemInput[] } = {}): Promise<LiveSimDriver> {
  // Events from the catch-up are not shown (the old loop started counting after it).
  return createLiveSimDriver(config, { manualInputs: options.manualInputs, startTick: Math.max(0, options.syncTick ?? 0) })
}

/** Queues an applied WILD_ITEM_MANUAL_INPUT from the live SSE stream into the local simulation. */
export function applyLiveSyncEvent(driver: LiveSimDriver, config: RaceConfig, event: RaceEvent) {
  if (event.type !== 'WILD_ITEM_MANUAL_INPUT' || event.metadata.applied !== true) return
  const instanceId = event.metadata.instanceId
  const clientActionId = event.metadata.clientActionId
  if (!event.sourcePlayerId || typeof instanceId !== 'string' || typeof clientActionId !== 'string') return
  driver.queueInput({
    raceId: config.raceId,
    playerId: event.sourcePlayerId,
    wildItemInstanceId: instanceId,
    action: 'USE',
    clientActionId,
  }, event.tick)
}

/** Opens the live SSE stream; returns a closer. */
export function connectLiveDriver(raceId: number, driver: LiveSimDriver, config: RaceConfig, onFinished: () => void) {
  const source = new EventSource(`/api/races/${raceId}/live`)
  source.addEventListener('engine-event', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent<string>).data) as RaceEvent
      if (payload.type === 'WILD_ITEM_MANUAL_INPUT') applyLiveSyncEvent(driver, config, payload)
      if (payload.type === 'RACE_FINISHED') onFinished()
    } catch {
      // Ignore malformed sync events.
    }
  })
  source.addEventListener('finished', () => onFinished())
  return () => source.close()
}

// ---------------------------------------------------------------------------------------------------------
// SSE v2 (Rust server, plan D16): LiveSync + the WASM engine, snapshots as the fallback.
// ---------------------------------------------------------------------------------------------------------

type MaybePromise<T> = T | Promise<T>

/** One engine step's result. `hash` is `stateHash()` after the step, when it was asked for. */
export interface LiveAdvance {
  tick: number
  finished: boolean
  world: RaceWorld
  events: RaceEvent[]
  hash: string | null
}

/** A browser simulation of one live race (the WASM `SimHandle`, possibly behind a Web Worker). */
export interface LiveSimHandle {
  /** Steps to min(tick, finish) and returns the world and the events emitted since the last call. */
  advance(tick: number, options: { hash: boolean }): MaybePromise<LiveAdvance>
  /** Queues a confirmed input; the engine rejects `atTick <= tick`. */
  queueInput(input: LiveInputFrame): MaybePromise<void>
  dispose(): void
}

/** What the live view needs from the browser engine. */
export interface LiveEngine {
  /** `engineInfo().engineBuildId`; LiveDriver runs only when it equals `hello.engineBuildId`. */
  readonly engineBuildId: string
  /** A simulation of `configJcs` (the server's JCS text, passed through verbatim) at tick 0. */
  createHandle(configJcs: string): MaybePromise<LiveSimHandle>
}

/** The plan's WASM `SimHandle` surface (Phase 5): methods may be sync (wasm) or async (worker proxy). */
export interface SimHandleLike {
  /** May return the reached tick. */
  stepTo(tick: number): unknown
  world(): unknown
  drainEvents(): unknown
  stateHash(): unknown
  queueInput(input: string): unknown
  tick?(): unknown
  finished?(): unknown
  free?(): void
  dispose?(): void
}

const parseMaybeJson = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) : value) as T

/** Wraps a `SimHandle`-shaped object (JSON strings or objects either way) as a LiveSimHandle. */
export function liveHandleFromSimHandle(handle: SimHandleLike): LiveSimHandle {
  let finished = false
  return {
    async advance(tick, options) {
      const reached = await handle.stepTo(tick)
      const events = parseMaybeJson<RaceEvent[] | null>(await handle.drainEvents()) ?? []
      const world = parseMaybeJson<RaceWorld>(await handle.world())
      const finishEvent = events.find((event) => event.type === 'RACE_FINISHED')
      if (finishEvent) finished = true
      if (handle.finished) finished = Boolean(await handle.finished())
      let at: number
      if (typeof reached === 'number') at = reached
      else if (handle.tick) at = Number(await handle.tick())
      else at = finishEvent ? Math.min(tick, finishEvent.tick) : tick
      const hash = options.hash ? String(await handle.stateHash()) : null
      return { tick: at, finished, world, events, hash }
    },
    async queueInput(input) {
      await handle.queueInput(JSON.stringify(input))
    },
    dispose() {
      if (handle.free) handle.free()
      else handle.dispose?.()
    },
  }
}

interface EngineSeamModule {
  /** Preferred: the seam builds the LiveEngine itself (Worker-backed). */
  createLiveEngine?: () => MaybePromise<LiveEngine>
  /** Otherwise the plan's names: engineInfo() and a SimHandle class or factory. */
  engineInfo?: () => MaybePromise<unknown>
  SimHandle?: new (configJcs: string) => SimHandleLike
  createSimHandle?: (configJcs: string) => MaybePromise<SimHandleLike>
  loadEngine?: () => Promise<EngineSeamModule>
}

function readBuildId(info: unknown): string | null {
  let value = info
  if (typeof value === 'string' && value.startsWith('{')) {
    try { value = JSON.parse(value) } catch { /* a plain id */ }
  }
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as { engineBuildId?: unknown }).engineBuildId === 'string') {
    return (value as { engineBuildId: string }).engineBuildId
  }
  return null
}

async function liveEngineFromSeam(seam: EngineSeamModule): Promise<LiveEngine | null> {
  if (seam.createLiveEngine) return seam.createLiveEngine()
  if (seam.loadEngine) return liveEngineFromSeam(await seam.loadEngine())
  if (!seam.engineInfo) return null
  const engineBuildId = readBuildId(await seam.engineInfo())
  const SimHandle = seam.SimHandle
  const create = seam.createSimHandle ?? (SimHandle ? (configJcs: string) => new SimHandle(configJcs) : null)
  if (!engineBuildId || !create) return null
  return {
    engineBuildId,
    async createHandle(configJcs) {
      return liveHandleFromSimHandle(await create(configJcs))
    },
  }
}

/**
 * Loads the WASM engine through the seam `src/engine/index.ts` (Phase 5 "browser engine loading"), or null
 * when it doesn't exist yet or fails: the live view then follows snapshots. The glob keeps the build
 * working before the seam lands and keeps the engine in its own lazy chunk.
 */
export async function loadLiveEngine(): Promise<LiveEngine | null> {
  try {
    let loaders: Record<string, () => Promise<unknown>>
    try {
      loaders = import.meta.glob('/src/engine/index.ts')
    } catch {
      return null // not under Vite (node tests)
    }
    const load = loaders['/src/engine/index.ts']
    if (!load) return null
    return await liveEngineFromSeam(await load() as EngineSeamModule)
  } catch (error) {
    console.warn('[live] browser engine unavailable, following snapshots', error)
    return null
  }
}

/** The scene operations the v2 live view uses (DuckRaceScene implements them). */
export interface LiveScene {
  applyWorld(world: RaceWorld, options?: { snap?: boolean }): void
  applyEvent(event: RaceEvent, options?: { silent?: boolean }): void
  /** Snapshot mode: draw this world on the next frame (older ticks are dropped). */
  queueWorld(world: RaceWorld, tick: number): void
  /** The race starts in `endsInMs` (from hello.countdownEndsInMs). */
  showLiveCountdown(endsInMs: number): void
  /** Catch-up progress in [0, 1], or null to hide it. */
  setCatchUp(progress: number | null): void
}

export type LiveViewMode = 'connecting' | 'waiting' | 'live' | 'snapshot' | 'ended'

export interface LiveFrameInfo {
  tick: number
  ducks: RaceWorld['ducks']
  events: RaceEvent[]
  mode: LiveViewMode
}

export interface ConnectLiveV2Options {
  raceId: number
  scene: LiveScene
  /** After each applied step or snapshot (the race page's live leaderboard and timeline). */
  onFrame?: (info: LiveFrameInfo) => void
  /** The race is over (finished/resolved frame, or hello after the end): show the recorded track. */
  onEnded?: () => void
  onModeChange?: (mode: LiveViewMode, reason?: SnapshotReason) => void
  // Seams for tests.
  engine?: Promise<LiveEngine | null>
  now?: () => number
  openStream?: (url: string) => EventSourceLike
  postDesync?: (raceId: number, report: DesyncReport) => void
  requestFrame?: (callback: () => void) => number
  cancelFrame?: (handle: number) => void
  /** Wall-clock budget for engine steps per animation frame (catch-up runs across frames). */
  frameBudgetMs?: number
}

const LIVE_FRAME_TYPES = ['hello', 'start', 'clock', 'input', 'finished', 'resolved', 'failed'] as const

function defaultPostDesync(raceId: number, report: DesyncReport) {
  void fetch(`/api/races/${raceId}/desync`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
    keepalive: true,
  }).catch(() => undefined)
}

/**
 * Follows a Rust-server live race (SSE v2). Waits for `hello`; with a matching engine build it predicts
 * locally under LiveSync's bound, comparing state hashes; otherwise, or after a desync (reported once to
 * `/api/races/:id/desync`), it reconnects with `?snapshots=1` and draws the server's snapshots.
 * Returns a closer.
 */
export function connectLiveV2(options: ConnectLiveV2Options): () => void {
  const now = options.now ?? (() => performance.now())
  const openStream = options.openStream ?? ((url: string) => new EventSource(url) as unknown as EventSourceLike)
  const requestFrame = options.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback))
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle))
  const postDesync = options.postDesync ?? defaultPostDesync
  const frameBudgetMs = options.frameBudgetMs ?? 12
  const { scene, raceId } = options

  let active = true
  let mode: LiveViewMode = 'connecting'
  let engine: LiveEngine | null = null
  let sync: LiveSync | null = null
  let handle: LiveSimHandle | null = null
  let stream: EventSourceLike | null = null
  let closeSnapshots: (() => void) | null = null
  let frameHandle = 0
  let pumping = false
  let desyncReported = false
  let endedSent = false
  /** Frames that arrive before the engine finished loading, replayed in order. */
  let queued: Array<{ type: string; data: unknown; at: number }> | null = []

  const setMode = (next: LiveViewMode, reason?: SnapshotReason) => {
    if (mode === next) return
    mode = next
    options.onModeChange?.(next, reason)
  }

  const ended = () => {
    if (endedSent) return
    endedSent = true
    setMode('ended')
    scene.setCatchUp(null)
    options.onEnded?.()
  }

  const stopPredicting = () => {
    handle?.dispose()
    handle = null
    if (frameHandle) cancelFrame(frameHandle)
    frameHandle = 0
  }

  const toSnapshots = (reason: SnapshotReason) => {
    if (!active || mode === 'snapshot' || mode === 'ended') return
    stopPredicting()
    stream?.close()
    stream = null
    scene.setCatchUp(null)
    setMode('snapshot', reason)
    closeSnapshots = connectSnapshotDriverV2(raceId, {
      world: (world, tick) => {
        scene.queueWorld(world, tick)
        options.onFrame?.({ tick, ducks: world.ducks, events: [], mode: 'snapshot' })
      },
      event: (event) => scene.applyEvent(event),
      countdown: (endsInMs) => scene.showLiveCountdown(endsInMs),
      finished: ended,
    }, { openStream })
  }

  function loop() {
    frameHandle = 0
    if (!active || !handle || mode !== 'live') return
    if (!pumping) void pump()
    frameHandle = requestFrame(loop)
  }

  const createHandle = async (configJcs: string) => {
    try {
      if (!engine) throw new Error('no engine')
      const created = await engine.createHandle(configJcs)
      if (!active || !sync || sync.mode === 'snapshot' || sync.mode === 'ended') {
        created.dispose()
        return
      }
      handle = created
      sync.handleCreated()
      setMode('live')
      frameHandle = requestFrame(loop)
    } catch (error) {
      console.warn('[live] could not create the simulation', error)
      if (sync) runCommands(sync.engineFailed())
    }
  }

  function runCommands(commands: LiveSyncCommand[]) {
    for (const command of commands) {
      if (!active) return
      if (command.type === 'countdown') scene.showLiveCountdown(Math.max(0, command.endsAtMs - now()))
      else if (command.type === 'create-handle') void createHandle(command.configJcs)
      else if (command.type === 'desync') {
        if (!desyncReported) {
          desyncReported = true
          console.warn('[live] state hash mismatch, switching to snapshots', command.report)
          postDesync(raceId, command.report)
        }
      } else if (command.type === 'snapshot') toSnapshots(command.reason)
      else if (command.type === 'ended') {
        stopPredicting()
        stream?.close()
        stream = null
        ended()
      }
    }
  }

  async function pump() {
    if (!sync || !handle) return
    pumping = true
    const started = now()
    try {
      while (active && handle && sync.mode === 'live') {
        const step = sync.nextStep(now())
        if (!step) break
        for (const input of sync.takeInputs()) await handle.queueInput(input)
        const result = await handle.advance(step.tick, { hash: step.hash })
        if (!active || !handle) return
        const commands = sync.stepped(result.tick, result.hash, result.finished)
        scene.applyWorld(result.world, step.silent ? { snap: true } : undefined)
        for (const event of result.events) scene.applyEvent(event, step.silent ? { silent: true } : undefined)
        scene.setCatchUp(sync.catchUpProgress())
        options.onFrame?.({ tick: result.tick, ducks: result.world.ducks, events: result.events, mode: 'live' })
        runCommands(commands)
        if (now() - started >= frameBudgetMs) break
      }
    } catch (error) {
      console.warn('[live] engine step failed', error)
      if (sync) runCommands(sync.engineFailed())
    } finally {
      pumping = false
    }
  }

  const dispatch = (type: string, data: unknown, at: number) => {
    if (!sync) return
    let commands: LiveSyncCommand[] = []
    if (type === 'hello') {
      commands = sync.hello(data as LiveHelloFrame, at)
      if (sync.mode === 'waiting') setMode('waiting')
    } else if (type === 'start') commands = sync.start(data as LiveStartFrame, at)
    else if (type === 'clock') commands = sync.clockFrame(data as LiveClockFrame, at)
    else if (type === 'input') commands = sync.input(data as LiveInputFrame)
    else if (type === 'finished') commands = sync.finished(data as LiveFinishedFrame)
    else if (type === 'resolved') commands = sync.resolved()
    else if (type === 'failed') commands = sync.failed()
    runCommands(commands)
  }

  stream = openStream(`/api/races/${raceId}/live`)
  for (const type of LIVE_FRAME_TYPES) {
    stream.addEventListener(type, (event) => {
      if (!active) return
      let data: unknown
      try {
        data = JSON.parse(event.data)
      } catch {
        return // Ignore malformed frames.
      }
      const at = now()
      if (queued) queued.push({ type, data, at })
      else dispatch(type, data, at)
    })
  }

  void (options.engine ?? loadLiveEngine()).then((loaded) => {
    if (!active) return
    engine = loaded
    sync = new LiveSync({ localEngineBuildId: loaded?.engineBuildId ?? null })
    const backlog = queued ?? []
    queued = null
    for (const frame of backlog) dispatch(frame.type, frame.data, frame.at)
  })

  return () => {
    active = false
    stopPredicting()
    stream?.close()
    stream = null
    closeSnapshots?.()
    closeSnapshots = null
  }
}
