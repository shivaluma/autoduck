import type { RaceConfig, RaceEvent, RecordedWildItemInput } from '@/src/engine/protocol'
import { createSim, simulateReplay } from '@/src/engine'
import type { SimFrame } from '@/src/engine/worker-protocol'
import { decodeReplayTrack } from '@/src/race/replay-track/decode'
import { createRecordingDriver } from './recording-driver'
import type { DriverFrame, TimelineDriver } from './types'

/**
 * Re-simulates a config in the browser with the WASM engine (src/engine, in a Web Worker). The worker runs
 * the whole race once with the Rust track recorder, and the result plays exactly like a stored recording
 * (seekable, same FX timing). Rust refuses any engine/balance pair it doesn't implement, so callers only
 * pick this driver for current-version races without a stored track, and for the race lab.
 * Creation events (tick 0) are never emitted, matching what the canvas has always shown.
 */
export async function createSimDriver(
  config: RaceConfig | string,
  options: { manualInputs?: readonly RecordedWildItemInput[] } = {},
): Promise<TimelineDriver> {
  const { payload, events } = await simulateReplay(config, options.manualInputs ?? [])
  const driver = createRecordingDriver(decodeReplayTrack(payload), events)
  return { ...driver, kind: 'sim' }
}

/** A running simulation in the worker, driven frame by frame (the live view). */
export interface LiveSimDriver extends TimelineDriver {
  /** Queues a manual wild-item input from the server at its authoritative tick. */
  queueInput(input: Omit<RecordedWildItemInput, 'authoritativeTick'>, authoritativeTick: number): void
  /** Frees the worker-side simulation. */
  dispose(): void
}

function tickRateOf(config: RaceConfig | string) {
  try {
    const value = Number(typeof config === 'string' ? (JSON.parse(config) as { tickRate?: unknown }).tickRate : config.tickRate)
    return Number.isFinite(value) && value > 0 ? value : 60
  } catch {
    return 60
  }
}

/**
 * Steps a worker simulation from requestAnimationFrame. `advanceTo` is synchronous, so it returns the latest
 * frame the worker has produced and asks for the next one; the canvas is at most one round trip (a few ms)
 * behind. `tick()` is the tick asked for, so the playback clock never loses time while a step is in flight.
 * Not seekable. Starts after a silent catch-up to `startTick` (its events are dropped, as before).
 */
export async function createLiveSimDriver(
  config: RaceConfig | string,
  options: { manualInputs?: readonly RecordedWildItemInput[]; startTick?: number } = {},
): Promise<LiveSimDriver> {
  const sim = await createSim(config, { manualInputs: options.manualInputs })
  let frame: SimFrame = await sim.step(Math.max(0, options.startTick ?? 0))
  let requested = frame.tick
  let inFlight = false
  let failed = false
  let buffered: RaceEvent[] = []

  const pump = () => {
    if (inFlight || failed || frame.finished || requested <= frame.tick) return
    inFlight = true
    sim.step(requested).then((next) => {
      buffered = buffered.concat(next.events)
      frame = next
      inFlight = false
      pump()
    }, () => {
      // The worker restarted or the simulation was disposed: stop where we are.
      failed = true
      inFlight = false
    })
  }

  return {
    kind: 'live',
    tickRate: tickRateOf(config),
    endTick: null,
    seekable: false,
    tick: () => requested,
    finished: () => frame.finished || failed,
    reset() {
      throw new Error('a live simulation cannot be reset')
    },
    queueInput(input, authoritativeTick) {
      void sim.queueInput({ ...input, action: 'USE' }, authoritativeTick).catch(() => undefined)
    },
    dispose: () => sim.dispose(),
    advanceTo(targetTick: number): DriverFrame {
      if (!frame.finished) requested = Math.max(requested, Math.floor(targetTick))
      pump()
      const events = buffered
      buffered = []
      return { tick: frame.tick, finished: frame.finished, world: frame.world!, events }
    },
  }
}
