/**
 * The browser race engine (plan Phase 5, D18): race-core compiled to WASM, running in a Web Worker
 * (./sim-worker.ts). This replaces the frozen TS engine in the browser: nothing here imports packages/race-*.
 *
 * Every call is async (a message to the worker). Configs may be passed as stored JSON text
 * (`engineConfigJson`, passed through verbatim) or as an object (JSON.stringify'd); Rust parses either and
 * refuses configs of other engine/balance versions.
 *
 * Only pages that simulate import this module (the race canvas for a replay without a track or a live race,
 * the race lab, the stats panel without frozen stats), and the worker plus the `.wasm` only load on first use.
 */
import type { RaceConfig, RaceEvent, RaceFinishEntry, RecordedWildItemInput, WildItemUseCommand } from './protocol'
import type { PostRacePlayerInput, PostRaceStats } from '@/src/race/post-race-stats'
import type { EngineMessage, EngineReply, EngineRequest, ReplayResult, SimFrame } from './worker-protocol'

export type { ReplayResult, SimFrame } from './worker-protocol'

export interface EngineInfo {
  engineBuildId: string
  raceEngineVersion: string
  raceBalanceVersion: string
  raceProtocolVersion: string
  trackVersion: string
  raceTickRate: number
  supportedBalanceVersions: string[]
}

/** D9 `DigestEnvelope`. */
export interface DigestEnvelope {
  digestVersion: string
  configCommit: string
  engineVersion: string
  balanceVersion: string
  protocolVersion: string
  rngVersion: string
  trackVersion: string
  trackDefSha256: string
  durationTicks: number
  standings: Array<{ playerId: string; rank: number; finishTick: number; finishTimeMs: number }>
  eventsSha256: string
  motionSha256: string
}

export interface SimDigest {
  resultDigest: string
  envelope: DigestEnvelope
  /** JCS of the resolved config, as the server stores it. */
  engineConfigJson: string
  seedCommit: string
  standings: RaceFinishEntry[]
  durationMs: number
  finalTick: number
}

export interface SimulateResult extends SimDigest {
  events?: RaceEvent[]
}

export interface IntegrityReport {
  ok: boolean
  configCommit: string
  seedCommitMatches: boolean
  configValid: boolean
  canonical: boolean
  error?: string
}

export interface ResimReport {
  ok: boolean
  resultDigest: string | null
  digestMatches: boolean
  eventsMatch: boolean | null
  finalTick: number | null
  error?: string
}

type ConfigInput = RaceConfig | string | Record<string, unknown>

const text = (config: ConfigInput) => (typeof config === 'string' ? config : JSON.stringify(config))

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
/** Bumped whenever the worker is replaced; remote simulations of an older generation are dead. */
let generation = 0

function restart(reason: string) {
  worker?.terminate()
  worker = null
  generation += 1
  for (const [, request] of pending) request.reject(new Error(reason))
  pending.clear()
}

function ensureWorker(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module', name: 'race-engine' })
  created.onmessage = (event: MessageEvent<EngineReply>) => {
    const reply = event.data
    const request = pending.get(reply.id)
    if (!request) return
    pending.delete(reply.id)
    if (reply.ok) request.resolve(reply.result)
    else {
      request.reject(new Error(reply.error))
      if (reply.fatal) restart(`race engine restarted: ${reply.error}`)
    }
  }
  created.onerror = (event) => restart(`race engine worker failed: ${event.message}`)
  worker = created
  return created
}

function call<T>(request: EngineRequest, transfer: Transferable[] = []): Promise<T> {
  const target = ensureWorker()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    target.postMessage({ ...request, id } as EngineMessage, transfer)
  })
}

/** The engine compiled into the shipped WASM; the live view predicts only when `engineBuildId` matches the server's. */
export function engineInfo(): Promise<EngineInfo> {
  return call({ op: 'info' })
}

/** Parses a config with this engine's rules (defaults filled, versions checked). */
export function normalizeConfig(config: ConfigInput): Promise<RaceConfig> {
  return call({ op: 'normalizeConfig', config: text(config) })
}

/** Runs a race to the end; with `includeEvents` the result carries every event. */
export function simulate(config: ConfigInput, options: { manualInputs?: readonly RecordedWildItemInput[]; includeEvents?: boolean } = {}): Promise<SimulateResult> {
  return call({ op: 'simulate', config: text(config), manualInputs: JSON.stringify(options.manualInputs ?? []), includeEvents: options.includeEvents ?? false })
}

/** The stored config text hashes to `seedCommit`, parses, and is canonical (no simulation). */
export function verifyIntegrity(engineConfigJson: string, seedCommit: string): Promise<IntegrityReport> {
  return call({ op: 'verifyIntegrity', engineConfigJson, seedCommit })
}

/** "Xác minh lại": re-simulates the stored config with the stored manual inputs and compares digests. */
export function verifyResim(engineConfigJson: string, events: readonly RaceEvent[], resultDigest: string): Promise<ResimReport> {
  return call({ op: 'verifyResim', engineConfigJson, events: JSON.stringify(events), resultDigest })
}

/** Full post-race stats with this engine's motion and no-items baseline (as the server freezes them). */
export function postRaceStats(config: ConfigInput, events: readonly RaceEvent[], players: readonly PostRacePlayerInput[]): Promise<PostRaceStats> {
  return call({ op: 'postRaceStats', config: text(config), events: JSON.stringify(events), players: JSON.stringify(players) })
}

/** The whole race as a recorded DTRK/1 track plus its events (one simulation, in the worker). */
export function simulateReplay(config: ConfigInput, manualInputs: readonly RecordedWildItemInput[] = []): Promise<ReplayResult> {
  return call({ op: 'replay', config: text(config), manualInputs: JSON.stringify(manualInputs) })
}

/** A simulation living in the worker (`SimHandle`). Calls are queued in order. */
export interface RemoteSim {
  /** Steps to `min(tick, finish)`; returns the frame there and the events since the last step. */
  step(tick: number, options?: { world?: boolean; stateHash?: boolean }): Promise<SimFrame>
  /** Queues a manual wild-item input; it applies at `max(authoritativeTick, tick + 1)`. */
  queueInput(input: WildItemUseCommand, authoritativeTick?: number | null): Promise<RecordedWildItemInput>
  /** The finished race's digest. */
  digest(): Promise<SimDigest>
  /** The finished race's DTRK/1 payload (only with `recordTrack`). */
  trackPayload(): Promise<Uint8Array>
  /** Frees the worker-side simulation. */
  dispose(): void
}

let nextHandle = 1

export async function createSim(config: ConfigInput, options: { manualInputs?: readonly RecordedWildItemInput[]; recordTrack?: boolean } = {}): Promise<RemoteSim> {
  const handle = nextHandle++
  await call({ op: 'simCreate', handle, config: text(config), manualInputs: JSON.stringify(options.manualInputs ?? []), recordTrack: options.recordTrack ?? false })
  const born = generation
  let disposed = false
  const alive = () => {
    if (disposed) throw new Error('simulation disposed')
    if (born !== generation) throw new Error('race engine restarted; the simulation is gone')
  }
  return {
    step(tick, stepOptions = {}) {
      alive()
      return call({ op: 'simStep', handle, tick: Math.max(0, Math.min(0xffffffff, Math.floor(tick))), world: stepOptions.world ?? true, stateHash: stepOptions.stateHash ?? false })
    },
    queueInput(input, authoritativeTick = null) {
      alive()
      return call({ op: 'simQueueInput', handle, input: JSON.stringify(input), authoritativeTick })
    },
    digest() {
      alive()
      return call({ op: 'simDigest', handle })
    },
    trackPayload() {
      alive()
      return call({ op: 'simTrack', handle })
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (born === generation && worker) void call({ op: 'simFree', handle }).catch(() => undefined)
    },
  }
}

/** A wild-item input as the SSE v2 stream carries it (src/race/live-sync.ts `LiveInputFrame`). */
interface LiveInput {
  atTick: number
  playerId: string
  wildItemInstanceId: string
  clientActionId: string
  raceId?: string
}

/**
 * The live view's engine (components/racing/drivers/live-driver.ts `LiveEngine`, loaded through this seam):
 * the build id to compare with `hello.engineBuildId`, and worker simulations of the server's config text.
 */
export async function createLiveEngine() {
  const info = await engineInfo()
  return {
    engineBuildId: info.engineBuildId,
    async createHandle(configJcs: string) {
      const raceId = String((JSON.parse(configJcs) as { raceId?: unknown }).raceId ?? '')
      const sim = await createSim(configJcs)
      return {
        async advance(tick: number, options: { hash: boolean }) {
          const frame = await sim.step(tick, { world: true, stateHash: options.hash })
          return { tick: frame.tick, finished: frame.finished, world: frame.world!, events: frame.events, hash: frame.stateHash ?? null }
        },
        async queueInput(input: LiveInput) {
          await sim.queueInput({
            raceId: input.raceId ?? raceId,
            playerId: input.playerId,
            wildItemInstanceId: input.wildItemInstanceId,
            action: 'USE',
            clientActionId: input.clientActionId,
          }, input.atTick)
        },
        dispose: () => sim.dispose(),
      }
    },
  }
}
