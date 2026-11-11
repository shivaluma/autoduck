/**
 * Messages between the browser engine client (src/engine/index.ts) and its Web Worker
 * (src/engine/sim-worker.ts). Type-only: importing it adds nothing to a bundle.
 */
import type { RaceEvent, RecordedWildItemInput } from './protocol'
import type { RaceWorld } from '@/src/race/types'

/** One step of a remote simulation: where it is now and the events since the last step. */
export interface SimFrame {
  tick: number
  finished: boolean
  /** `snapshotRaceWorld` (ducks by rank); null when not requested. */
  world: RaceWorld | null
  /** Events emitted since the previous frame (creation events never appear). */
  events: RaceEvent[]
  /** The `sh1` state hash after the step, when requested. */
  stateHash?: string
}

export type EngineRequest =
  | { op: 'info' }
  | { op: 'normalizeConfig'; config: string }
  | { op: 'simulate'; config: string; manualInputs: string; includeEvents: boolean }
  | { op: 'verifyIntegrity'; engineConfigJson: string; seedCommit: string }
  | { op: 'verifyResim'; engineConfigJson: string; events: string; resultDigest: string }
  | { op: 'postRaceStats'; config: string; events: string; players: string }
  | { op: 'replay'; config: string; manualInputs: string }
  | { op: 'simCreate'; handle: number; config: string; manualInputs: string; recordTrack: boolean }
  | { op: 'simStep'; handle: number; tick: number; world: boolean; stateHash: boolean }
  | { op: 'simQueueInput'; handle: number; input: string; authoritativeTick: number | null }
  | { op: 'simDigest'; handle: number }
  | { op: 'simTrack'; handle: number }
  | { op: 'simFree'; handle: number }

export type EngineMessage = EngineRequest & { id: number }

export type EngineReply =
  | { id: number; ok: true; result: unknown }
  /** `fatal`: the wasm instance trapped and must be discarded (the client restarts the worker). */
  | { id: number; ok: false; error: string; fatal: boolean }

/** What the `replay` op returns: a recorded track of the whole race plus its events. */
export interface ReplayResult {
  /** Uncompressed DTRK/1 payload. */
  payload: Uint8Array
  /** Events after tick 0, in emission order. */
  events: RaceEvent[]
}

export type { RecordedWildItemInput }
