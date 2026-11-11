/// <reference lib="webworker" />
/**
 * The browser engine's Web Worker (plan Phase 5): loads race-core's WASM build (crates/race-wasm, built by
 * scripts/build-wasm.sh) and answers src/engine/index.ts. The `.wasm` file comes through Vite's `?url`, so it
 * is content-hashed and only downloaded when a page starts this worker.
 *
 * JSON stays text across the WASM boundary (Rust parses the numbers, D8); events and worlds are parsed here,
 * off the main thread, and structured-cloned to it. A WASM trap (`panic=abort`) poisons the instance: the
 * reply is marked `fatal` and the client replaces the worker.
 */
import init, {
  SimHandle,
  engineInfo,
  normalizeConfig,
  postRaceStats,
  simulate,
  verifyIntegrity,
  verifyResim,
} from '@/crates/race-wasm/pkg/race_wasm.js'
import wasmUrl from '@/crates/race-wasm/pkg/race_wasm_bg.wasm?url'
import type { EngineMessage, EngineReply, ReplayResult, SimFrame } from './worker-protocol'

declare const self: DedicatedWorkerGlobalScope

const ready = init({ module_or_path: wasmUrl })
const handles = new Map<number, SimHandle>()

function handleOf(id: number) {
  const handle = handles.get(id)
  if (!handle) throw new Error(`unknown simulation ${id}`)
  return handle
}

function run(message: EngineMessage): { result: unknown; transfer?: Transferable[] } {
  switch (message.op) {
    case 'info':
      return { result: JSON.parse(engineInfo()) }
    case 'normalizeConfig':
      return { result: JSON.parse(normalizeConfig(message.config)) }
    case 'simulate':
      return { result: JSON.parse(simulate(message.config, message.manualInputs, message.includeEvents)) }
    case 'verifyIntegrity':
      return { result: JSON.parse(verifyIntegrity(message.engineConfigJson, message.seedCommit)) }
    case 'verifyResim':
      return { result: JSON.parse(verifyResim(message.engineConfigJson, message.events, message.resultDigest)) }
    case 'postRaceStats':
      return { result: JSON.parse(postRaceStats(message.config, message.events, message.players)) }
    case 'replay': {
      const handle = new SimHandle(message.config, message.manualInputs, true)
      try {
        handle.stepTo(0xffffffff)
        const events = JSON.parse(handle.drainEvents())
        const payload = handle.trackPayload()
        const result: ReplayResult = { payload, events }
        return { result, transfer: [payload.buffer] }
      } finally {
        handle.free()
      }
    }
    case 'simCreate':
      handles.get(message.handle)?.free()
      handles.set(message.handle, new SimHandle(message.config, message.manualInputs, message.recordTrack))
      return { result: null }
    case 'simStep': {
      const handle = handleOf(message.handle)
      handle.stepTo(message.tick)
      const frame: SimFrame = {
        tick: handle.tick(),
        finished: handle.finished(),
        world: message.world ? JSON.parse(handle.world()) : null,
        events: JSON.parse(handle.drainEvents()),
      }
      if (message.stateHash) frame.stateHash = handle.stateHash()
      return { result: frame }
    }
    case 'simQueueInput':
      return { result: JSON.parse(handleOf(message.handle).queueInput(message.input, message.authoritativeTick)) }
    case 'simDigest':
      return { result: JSON.parse(handleOf(message.handle).digest()) }
    case 'simTrack': {
      const payload = handleOf(message.handle).trackPayload()
      return { result: payload, transfer: [payload.buffer] }
    }
    case 'simFree':
      handles.get(message.handle)?.free()
      handles.delete(message.handle)
      return { result: null }
  }
}

self.onmessage = (event: MessageEvent<EngineMessage>) => {
  const message = event.data
  void ready.then(
    () => {
      try {
        const { result, transfer } = run(message)
        self.postMessage({ id: message.id, ok: true, result } satisfies EngineReply, transfer ?? [])
      } catch (error) {
        const fatal = error instanceof WebAssembly.RuntimeError
        self.postMessage({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error), fatal } satisfies EngineReply)
      }
    },
    (error: unknown) => {
      self.postMessage({ id: message.id, ok: false, error: `engine failed to load: ${String(error)}`, fatal: true } satisfies EngineReply)
    },
  )
}
