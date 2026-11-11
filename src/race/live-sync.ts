/**
 * Live race sync for the SSE v2 protocol (plan D16, Phase 5 "SPA").
 *
 * `ServerClock` estimates the server's tick from the `hello`/`clock` frames. `LiveSync` is pure: it holds
 * no timers, sockets or engine, takes `nowMs` as an argument, and answers two questions for the live
 * driver (components/racing/drivers/live-driver.ts):
 * - how far the local simulation may step now: never past
 *   `min(estimatedServerTick − renderDelay, lastClockTick + INPUT_LEAD)`, so it never mispredicts
 *   (no rollback, no checkpoint ring);
 * - what to do about a frame: create the engine handle, show the countdown, fall back to snapshots, report
 *   a desync, or end the live view.
 *
 * It keeps its own ring of local and server `stateHash`es (every `HASH_INTERVAL` ticks, hash after the
 * step) and compares them whichever side arrives second. Inputs with `seq <= seqHighWater` are
 * duplicates (already in `hello.inputs`, or replayed after a reconnect or `Lagged`) and are ignored.
 *
 * Nothing here imports the engine, so the race page can call `liveProtocolFor` without loading it.
 */
import { engineMajor } from './event-vocab'

/** Ticks the client may run ahead of the last confirmed clock (D16: 100 ms at 60 Hz). */
export const INPUT_LEAD = 6
/** The server sends `hash` on clock frames at every multiple of this tick. */
export const HASH_INTERVAL = 60
/** How far behind the estimated server tick the client renders, to absorb frame jitter. */
export const DEFAULT_RENDER_DELAY_TICKS = 6
/** Behind the bound by more than this: catch up in chunks with FX suppressed. */
export const CATCH_UP_THRESHOLD_TICKS = 30
/** The largest single engine step while catching up (one worker round trip). */
export const CATCH_UP_CHUNK_TICKS = 300
/** Hashes older than this many ticks behind both sides are dropped from the rings. */
const HASH_RING_TICKS = HASH_INTERVAL * 20

export type LiveEngineState = 'CREATED' | 'CHAOS_REVEALED' | 'PREPARING' | 'LOCKED' | 'COUNTDOWN' | 'RACING' | 'FINISHED' | 'RESOLVED' | 'ARCHIVED'

/** A wild-item input as the server streams it (`input` frames and `hello.inputs`). */
export interface LiveInputFrame {
  seq: number
  atTick: number
  playerId: string
  wildItemInstanceId: string
  action: 'USE'
  clientActionId: string
  raceId?: string
}

export interface LiveHelloFrame {
  protocolVersion: string
  engineVersion: string
  balanceVersion: string
  engineBuildId: string
  raceId: string | number
  state: LiveEngineState | string
  serverTick: number
  countdownEndsInMs?: number | null
  /** Only once the race is RACING or later (D17). */
  configJcs?: string | null
  /** Every input so far, including queued ones with `atTick > serverTick`. */
  inputs: LiveInputFrame[]
  seqHighWater: number
  /** Once FINISHED. */
  finalTick?: number | null
}

export interface LiveStartFrame { configJcs: string; startTick: number }
export interface LiveClockFrame { tick: number; hash?: string | null }
export interface LiveFinishedFrame { finalTick: number; digest: string; standings: unknown[] }

export interface DesyncReport {
  tick: number
  clientHash: string
  serverHash: string
  engineBuildId: string
}

export type SnapshotReason = 'no-engine' | 'engine-mismatch' | 'desync' | 'late-input' | 'config-changed' | 'engine-error'

/** What the driver must do after feeding a frame or a step result to LiveSync. */
export type LiveSyncCommand =
  | { type: 'create-handle'; configJcs: string }
  | { type: 'countdown'; endsAtMs: number }
  | { type: 'desync'; report: DesyncReport }
  | { type: 'snapshot'; reason: SnapshotReason }
  /** The race is over and the local view has played it out: switch to the recorded track. */
  | { type: 'ended' }

export type LiveSyncMode =
  /** No hello yet. */
  | 'connecting'
  /** Engine matches; waiting for the config (LOCKED/COUNTDOWN) or for the handle. */
  | 'waiting'
  /** Predicting locally. */
  | 'live'
  /** Following server snapshots (engine mismatch, desync, ...). Terminal for LiveSync. */
  | 'snapshot'
  /** Over: the view switches to the recorded track. Terminal. */
  | 'ended'

export interface LiveStep {
  /** stepTo target (state after step `tick`). */
  tick: number
  /** Take `stateHash()` after this step (a multiple of HASH_INTERVAL). */
  hash: boolean
  /** Apply this step's world and events without FX/audio (catch-up, or before the join tick). */
  silent: boolean
}

/**
 * Estimates the server's tick from clock samples: `tick ≈ nowMs·rate/1000 + offset`. A sample that
 * implies a larger offset (it arrived with less delay) is taken at once; a smaller one eases the offset
 * down slowly, so jitter doesn't move the estimate but drift and server stalls do. A sample more than
 * two seconds behind re-anchors the clock.
 */
export class ServerClock {
  private offset: number | null = null

  constructor(readonly tickRate = 60, private readonly ease = 0.05) {}

  observe(tick: number, nowMs: number) {
    const sample = tick - (nowMs * this.tickRate) / 1000
    if (this.offset === null || sample > this.offset || sample < this.offset - 2 * this.tickRate) {
      this.offset = sample
      return
    }
    this.offset += (sample - this.offset) * this.ease
  }

  /** Fractional estimated server tick, or null before any sample. */
  estimate(nowMs: number): number | null {
    return this.offset === null ? null : (nowMs * this.tickRate) / 1000 + this.offset
  }

  reset() {
    this.offset = null
  }
}

export interface LiveSyncOptions {
  /** `engineInfo().engineBuildId` of the loaded browser engine, or null when none could be loaded. */
  localEngineBuildId: string | null
  tickRate?: number
  renderDelayTicks?: number
  inputLead?: number
  catchUpThresholdTicks?: number
  catchUpChunkTicks?: number
}

const ENDED_STATES = new Set(['FINISHED', 'RESOLVED', 'ARCHIVED'])
const normalizeHash = (hash: string) => hash.toLowerCase()

export class LiveSync {
  readonly clock: ServerClock
  private readonly renderDelay: number
  private readonly inputLead: number
  private readonly catchUpThreshold: number
  private readonly catchUpChunk: number

  private modeValue: LiveSyncMode = 'connecting'
  private serverEngineBuildId: string | null = null
  private configJcsValue: string | null = null
  private handleReady = false
  private started = false
  private lastClock = Number.NEGATIVE_INFINITY
  private local = 0
  private localFinished = false
  private finalTick: number | null = null
  private serverFinished = false
  private endedSent = false
  private seqHighWater = Number.NEGATIVE_INFINITY
  private pendingInputs: LiveInputFrame[] = []
  private readonly localHashes = new Map<number, string>()
  private readonly serverHashes = new Map<number, string>()
  private joinTickValue = 0
  private catchUp: { from: number; to: number } | null = null
  private countdownEndsAt: number | null = null

  constructor(private readonly options: LiveSyncOptions) {
    this.clock = new ServerClock(options.tickRate ?? 60)
    this.renderDelay = options.renderDelayTicks ?? DEFAULT_RENDER_DELAY_TICKS
    this.inputLead = options.inputLead ?? INPUT_LEAD
    this.catchUpThreshold = options.catchUpThresholdTicks ?? CATCH_UP_THRESHOLD_TICKS
    this.catchUpChunk = Math.max(1, options.catchUpChunkTicks ?? CATCH_UP_CHUNK_TICKS)
  }

  get mode(): LiveSyncMode { return this.modeValue }
  /** The tick the local simulation has stepped to. */
  get localTick() { return this.local }
  get lastClockTick() { return this.lastClock }
  /** Ticks up to and including this one were simulated before the viewer joined: their FX are suppressed. */
  get joinTick() { return this.joinTickValue }
  get configJcs() { return this.configJcsValue }
  get countdownEndsAtMs() { return this.countdownEndsAt }
  get seqHighWaterMark() { return this.seqHighWater }

  /** Catch-up progress in [0, 1], or null when not catching up. */
  catchUpProgress(): number | null {
    if (!this.catchUp) return null
    const span = this.catchUp.to - this.catchUp.from
    return span <= 0 ? 1 : Math.min(1, Math.max(0, (this.local - this.catchUp.from) / span))
  }

  /**
   * The highest tick the local simulation may be at now: min(estimatedServerTick − renderDelay,
   * lastClockTick + INPUT_LEAD); after `finished`, min(estimate − renderDelay, finalTick) since every
   * input is known. Null before the race has a clock.
   */
  bound(nowMs: number): number | null {
    if (!this.started) return null
    const estimate = this.clock.estimate(nowMs)
    if (estimate === null) return null
    const byClock = Math.floor(estimate - this.renderDelay)
    const confirmed = this.finalTick !== null ? this.finalTick : this.lastClock + this.inputLead
    return Math.max(0, Math.min(byClock, confirmed))
  }

  hello(frame: LiveHelloFrame, nowMs: number): LiveSyncCommand[] {
    if (this.terminal()) return []
    const commands: LiveSyncCommand[] = []
    const first = this.modeValue === 'connecting'
    if (first) {
      this.serverEngineBuildId = frame.engineBuildId
      if (ENDED_STATES.has(frame.state)) return this.end()
      if (this.options.localEngineBuildId === null) return this.toSnapshot('no-engine')
      if (frame.engineBuildId !== this.options.localEngineBuildId) return this.toSnapshot('engine-mismatch')
      this.modeValue = 'waiting'
    } else {
      // A reconnect (or a server that re-sends hello): keep the simulation, reconcile.
      if (frame.engineBuildId !== this.serverEngineBuildId) return this.toSnapshot('engine-mismatch')
      if (ENDED_STATES.has(frame.state) && this.finalTick === null) {
        // Ended while we were away; the `finished` frame may follow from the replay log. Play out to the
        // server's tick, then end.
        this.serverFinished = true
        this.finalTick = Math.max(0, Math.floor(frame.finalTick ?? frame.serverTick))
      }
    }

    if (frame.state === 'COUNTDOWN' && typeof frame.countdownEndsInMs === 'number' && !this.started) {
      this.countdownEndsAt = nowMs + Math.max(0, frame.countdownEndsInMs)
      // Tick 0 happens when the countdown ends.
      this.clock.observe(0, this.countdownEndsAt)
      commands.push({ type: 'countdown', endsAtMs: this.countdownEndsAt })
    }

    if (frame.configJcs) commands.push(...this.acceptConfig(frame.configJcs))
    if (this.terminal()) return commands

    if (frame.state === 'RACING' || this.finalTick !== null) {
      this.started = true
      const serverTick = Math.max(0, Math.floor(frame.serverTick))
      if (first) this.joinTickValue = serverTick
      this.lastClock = Math.max(this.lastClock, serverTick)
      this.clock.observe(serverTick, nowMs)
    }

    for (const input of frame.inputs ?? []) commands.push(...this.acceptInput(input))
    if (Number.isFinite(frame.seqHighWater)) this.seqHighWater = Math.max(this.seqHighWater, frame.seqHighWater)
    commands.push(...this.maybeEnd())
    return commands
  }

  start(frame: LiveStartFrame, nowMs: number): LiveSyncCommand[] {
    if (this.terminal() || this.modeValue === 'connecting') return []
    const commands = this.acceptConfig(frame.configJcs)
    if (this.terminal()) return commands
    if (!this.started) {
      this.started = true
      const startTick = Math.max(0, Math.floor(frame.startTick ?? 0))
      this.lastClock = Math.max(this.lastClock, startTick)
      // Without a countdown sample, the start frame anchors tick 0 (or startTick) at now.
      if (this.countdownEndsAt === null) this.clock.observe(startTick, nowMs)
    }
    return commands
  }

  clockFrame(frame: LiveClockFrame, nowMs: number): LiveSyncCommand[] {
    if (this.terminal() || this.modeValue === 'connecting') return []
    const tick = Math.floor(frame.tick)
    if (!this.started) this.started = true
    this.clock.observe(tick, nowMs)
    this.lastClock = Math.max(this.lastClock, tick)
    if (frame.hash) {
      const serverHash = normalizeHash(frame.hash)
      this.serverHashes.set(tick, serverHash)
      const localHash = this.localHashes.get(tick)
      if (localHash !== undefined && localHash !== serverHash) return this.desync(tick, localHash, serverHash)
    }
    this.prune()
    return []
  }

  input(frame: LiveInputFrame): LiveSyncCommand[] {
    if (this.terminal() || this.modeValue === 'connecting') return []
    return this.acceptInput(frame)
  }

  finished(frame: LiveFinishedFrame): LiveSyncCommand[] {
    if (this.terminal()) return []
    this.serverFinished = true
    this.finalTick = Math.max(0, Math.floor(frame.finalTick))
    this.started = true
    this.lastClock = Math.max(this.lastClock, this.finalTick)
    if (this.localFinished && this.local !== this.finalTick) return this.finishMismatch()
    if (this.modeValue !== 'live') return this.end()
    return this.maybeEnd()
  }

  resolved(): LiveSyncCommand[] {
    if (this.terminal()) return []
    this.serverFinished = true
    // T2 is done; if `finished` never reached us, stop predicting rather than wait.
    if (this.finalTick === null || this.modeValue !== 'live') return this.end()
    return this.maybeEnd()
  }

  /** The server failed the race: stop; the page reloads the race and shows it failed. */
  failed(): LiveSyncCommand[] {
    if (this.terminal()) return []
    return this.end()
  }

  /** The driver created the engine handle for `configJcs`. */
  handleCreated() {
    if (this.terminal()) return
    this.handleReady = true
    this.modeValue = 'live'
  }

  /** The engine failed (trap, worker crash): follow snapshots. */
  engineFailed(): LiveSyncCommand[] {
    if (this.terminal()) return []
    return this.toSnapshot('engine-error')
  }

  /** Accepted inputs not yet queued into the engine; queue them before the next step. */
  takeInputs(): LiveInputFrame[] {
    const inputs = this.pendingInputs
    this.pendingInputs = []
    return inputs
  }

  /** The next engine step allowed now, or null (nothing to do until more time passes or frames arrive). */
  nextStep(nowMs: number): LiveStep | null {
    if (this.modeValue !== 'live' || !this.handleReady || this.localFinished) return null
    const bound = this.bound(nowMs)
    if (bound === null || bound <= this.local) {
      if (this.catchUp && bound !== null && bound - this.local <= this.catchUpThreshold) this.catchUp = null
      return null
    }
    if (bound - this.local > this.catchUpThreshold) {
      this.catchUp = this.catchUp ? { from: this.catchUp.from, to: Math.max(this.catchUp.to, bound) } : { from: this.local, to: bound }
    } else if (this.catchUp) {
      this.catchUp = null
    }
    let target = bound
    if (this.catchUp) target = Math.min(target, this.local + this.catchUpChunk)
    const nextHashTick = (Math.floor(this.local / HASH_INTERVAL) + 1) * HASH_INTERVAL
    target = Math.min(target, nextHashTick)
    return { tick: target, hash: target % HASH_INTERVAL === 0, silent: this.catchUp !== null || target <= this.joinTickValue }
  }

  /** The engine stepped to `tick` (its `stateHash` when the step asked for one). */
  stepped(tick: number, hash: string | null, finished: boolean): LiveSyncCommand[] {
    if (this.terminal()) return []
    this.local = Math.max(this.local, Math.floor(tick))
    if (finished) this.localFinished = true
    if (hash !== null && this.local % HASH_INTERVAL === 0) {
      const localHash = normalizeHash(hash)
      this.localHashes.set(this.local, localHash)
      const serverHash = this.serverHashes.get(this.local)
      if (serverHash !== undefined && serverHash !== localHash) return this.desync(this.local, localHash, serverHash)
    }
    if (this.catchUp && this.local >= this.catchUp.to) this.catchUp = null
    this.prune()
    if (this.localFinished && this.finalTick !== null && this.local !== this.finalTick) return this.finishMismatch()
    return this.maybeEnd()
  }

  private acceptConfig(configJcs: string): LiveSyncCommand[] {
    if (this.configJcsValue === null) {
      this.configJcsValue = configJcs
      return [{ type: 'create-handle', configJcs }]
    }
    return this.configJcsValue === configJcs ? [] : this.toSnapshot('config-changed')
  }

  private acceptInput(input: LiveInputFrame): LiveSyncCommand[] {
    if (!Number.isFinite(input.seq) || input.seq <= this.seqHighWater) return []
    this.seqHighWater = input.seq
    // The engine rejects atTick <= tick; an input for a tick already simulated can't be applied.
    if (this.handleReady && input.atTick <= this.local) return this.toSnapshot('late-input')
    this.pendingInputs.push(input)
    return []
  }

  private desync(tick: number, clientHash: string, serverHash: string): LiveSyncCommand[] {
    const report: DesyncReport = { tick, clientHash, serverHash, engineBuildId: this.options.localEngineBuildId ?? '' }
    return [{ type: 'desync', report }, ...this.toSnapshot('desync')]
  }

  private finishMismatch(): LiveSyncCommand[] {
    return this.desync(this.finalTick ?? this.local, `finalTick:${this.local}`, `finalTick:${this.finalTick}`)
  }

  private maybeEnd(): LiveSyncCommand[] {
    if (!this.serverFinished || this.finalTick === null) return []
    if (this.modeValue === 'live' && this.local < this.finalTick) return []
    return this.end()
  }

  private end(): LiveSyncCommand[] {
    this.modeValue = 'ended'
    this.catchUp = null
    this.pendingInputs = []
    if (this.endedSent) return []
    this.endedSent = true
    return [{ type: 'ended' }]
  }

  private toSnapshot(reason: SnapshotReason): LiveSyncCommand[] {
    this.modeValue = 'snapshot'
    this.catchUp = null
    this.pendingInputs = []
    return [{ type: 'snapshot', reason }]
  }

  private terminal() {
    return this.modeValue === 'snapshot' || this.modeValue === 'ended'
  }

  private prune() {
    const floor = Math.min(this.local, this.lastClock) - HASH_RING_TICKS
    for (const tick of this.localHashes.keys()) if (tick < floor) this.localHashes.delete(tick)
    for (const tick of this.serverHashes.keys()) if (tick < floor) this.serverHashes.delete(tick)
  }
}

export type LiveProtocol = 'v1-sim' | 'v1-snapshot' | 'v2'

/**
 * Which live stream a running race uses. Engine 2.x races come from the Rust server (SSE v2: hello/clock,
 * LiveSync); older ones from the Next API (SSE v1), simulated locally only for the TS engine's pair
 * (`v1-sim`, `planLiveView`), otherwise followed through snapshots.
 */
export function liveProtocolFor(
  engine: { engineVersion?: string | null; config?: { engineVersion?: unknown } | null } | null | undefined,
  v1CanSimulate: boolean,
): LiveProtocol {
  const major = engineMajor(engine?.engineVersion ?? engine?.config?.engineVersion)
  if (major !== null && major >= 2) return 'v2'
  return v1CanSimulate ? 'v1-sim' : 'v1-snapshot'
}
